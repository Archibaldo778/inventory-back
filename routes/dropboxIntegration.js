import { Router } from 'express';
import DropboxIntegration from '../models/DropboxIntegration.js';
import DropboxDocument from '../models/DropboxDocument.js';
import { requireAdmin, requireAuth } from '../middleware/auth.js';
import { createMemoryRateLimiter } from '../middleware/rateLimit.js';
import { sendApiError } from '../utils/apiErrors.js';
import {
  buildDropboxAuthorizeUrl,
  createDropboxOauthState,
  decryptDropboxSecret,
  encryptDropboxSecret,
  exchangeDropboxAuthorizationCode,
  getDropboxConfig,
  getDropboxCurrentAccount,
  listDropboxFolder,
  refreshDropboxAccessToken,
  verifyDropboxOauthState,
} from '../utils/dropboxApi.js';
import { buildDropboxRevisionPlan, classifyDropboxEntry, getDropboxRevisionMetadata } from '../utils/dropboxDocuments.js';

const router = Router();
const syncRateLimit = createMemoryRateLimiter({ windowMs: 10 * 60 * 1000, max: 8, message: 'Too many Dropbox sync requests' });
let syncPromise = null;
let syncProgress = null;

const requireDropboxAdmin = [requireAuth, requireAdmin];

const reconcileDropboxRevisions = async () => {
  const documents = await DropboxDocument.find({
    status: { $in: ['discovered', 'review', 'superseded', 'imported'] },
  }).lean();
  const plan = buildDropboxRevisionPlan(documents);
  if (!plan.length) return;
  const byId = new Map(documents.map((document) => [String(document.dropboxId), document]));
  await DropboxDocument.bulkWrite(plan.filter((entry) => entry.dropboxId).map((entry) => {
    const current = byId.get(entry.dropboxId);
    const set = {
      eventId: entry.eventId,
      revisionNumber: entry.revisionNumber,
      revisionLabel: entry.revisionLabel,
      revisionSeries: entry.revisionSeries,
      revisionGroupKey: entry.revisionGroupKey,
      isLatestRevision: entry.isLatestRevision,
      supersededByDropboxId: entry.supersededByDropboxId,
    };
    if (entry.status) {
      set.status = entry.status;
      set.reason = entry.reason;
    } else if (current?.status === 'superseded') {
      set.status = current.importedAt ? 'imported' : 'discovered';
      set.reason = current.importedAt ? 'Latest revision; already imported' : 'Latest revision; ready for safe matching';
    }
    return { updateOne: { filter: { dropboxId: entry.dropboxId }, update: { $set: set } } };
  }), { ordered: false });
};

const safeReturnUrl = (value) => {
  try {
    const url = new URL(String(value || ''));
    if (![
      'https://occdecks.com',
      'https://www.occdecks.com',
      'https://ocdecks.com',
      'https://www.ocdecks.com',
      'http://localhost:5173',
    ].includes(url.origin)) return '';
    return url.toString();
  } catch { return ''; }
};

const callbackHtml = (ok, message, returnTo = '') => {
  const target = safeReturnUrl(returnTo);
  const escaped = String(message || '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const link = target ? `<p><a href="${target}">Return to OCC Decks</a></p>` : '';
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Dropbox connection</title><body style="font-family:system-ui;padding:40px;background:#101316;color:#fff"><h1>${ok ? 'Dropbox connected' : 'Dropbox connection failed'}</h1><p>${escaped}</p>${link}</body>`;
};

const loadIntegrationWithSecrets = () => DropboxIntegration.findOne({ provider: 'dropbox' })
  .select('+refreshToken.ciphertext +refreshToken.iv +refreshToken.tag +cursor');

export const runDropboxDiscoverySync = async () => {
  if (syncPromise) return syncPromise;
  syncPromise = (async () => {
    const integration = await loadIntegrationWithSecrets();
    if (!integration?.enabled || !integration?.refreshToken?.ciphertext) throw Object.assign(new Error('Dropbox is not connected'), { statusCode: 409 });
    integration.lastSyncStartedAt = new Date();
    integration.lastSyncError = '';
    await integration.save();
    try {
      syncProgress = { processed: 0, pages: 0, startedAt: new Date() };
      const accessToken = await refreshDropboxAccessToken(decryptDropboxSecret(integration.refreshToken));
      let page = await listDropboxFolder(accessToken, {
        path: integration.rootPath,
        cursor: integration.cursor || '',
      });
      const stats = {
        seen: 0,
        new: 0,
        updated: 0,
        unchanged: 0,
        discovered: 0,
        review: 0,
        skippedOld: 0,
        ignored: 0,
        deleted: 0,
      };
      let latestCursor = page.cursor || integration.cursor || '';
      while (page) {
        const entries = (Array.isArray(page.entries) ? page.entries : [])
          .map((entry) => ({
            entry,
            dropboxId: String(entry.id || entry.path_lower || entry.path_display || ''),
          }))
          .filter(({ dropboxId }) => dropboxId);
        const existingRows = await DropboxDocument.find({
          dropboxId: { $in: entries.map(({ dropboxId }) => dropboxId) },
        }).select('dropboxId rev contentHash status importedAt').lean();
        const existingById = new Map(existingRows.map((row) => [String(row.dropboxId), row]));
        const operations = [];
        for (const { entry, dropboxId } of entries) {
          stats.seen += 1;
          const classification = classifyDropboxEntry(entry);
          const revision = getDropboxRevisionMetadata({ ...entry, ...classification });
          const statusKey = { discovered: 'discovered', review: 'review', skipped_old: 'skippedOld', ignored: 'ignored', deleted: 'deleted' }[classification.status];
          if (statusKey) stats[statusKey] += 1;
          const existing = existingById.get(dropboxId);
          const revisionChanged = Boolean(existing) && (
            String(existing.rev || '') !== String(entry.rev || '')
            || String(existing.contentHash || '') !== String(entry.content_hash || '')
          );
          if (!existing) stats.new += 1;
          else if (revisionChanged) stats.updated += 1;
          else stats.unchanged += 1;
          const unchangedImported = existing?.status === 'imported'
            && String(existing.rev || '') === String(entry.rev || '')
            && String(existing.contentHash || '') === String(entry.content_hash || '');
          const nextStatus = unchangedImported ? 'imported' : classification.status;
          operations.push({
            updateOne: {
              filter: { dropboxId },
              update: {
              $set: {
                path: String(entry.path_display || entry.path_lower || ''),
                name: String(entry.name || ''),
                rev: String(entry.rev || ''),
                contentHash: String(entry.content_hash || ''),
                size: Number(entry.size || 0),
                clientModifiedAt: entry.client_modified || null,
                serverModifiedAt: entry.server_modified || null,
                documentType: classification.documentType,
                inferredDate: classification.inferredDate,
                eventId: revision.eventId,
                revisionNumber: revision.revisionNumber,
                revisionLabel: revision.revisionLabel,
                revisionSeries: revision.revisionSeries,
                revisionGroupKey: revision.revisionGroupKey,
                status: nextStatus,
                reason: unchangedImported ? 'Already imported; Dropbox revision is unchanged' : classification.reason,
                lastSeenAt: new Date(),
              },
              $setOnInsert: { firstSeenAt: new Date() },
              },
              upsert: true,
            },
          });
        }
        if (operations.length) await DropboxDocument.bulkWrite(operations, { ordered: false });
        syncProgress = {
          ...syncProgress,
          processed: stats.seen,
          pages: Number(syncProgress?.pages || 0) + 1,
          summary: { ...stats },
        };
        latestCursor = page.cursor || latestCursor;
        page = page.has_more ? await listDropboxFolder(accessToken, { cursor: latestCursor }) : null;
      }
      await reconcileDropboxRevisions();
      integration.cursor = latestCursor;
      integration.lastSyncCompletedAt = new Date();
      integration.lastSyncSummary = stats;
      await integration.save();
      return stats;
    } catch (error) {
      integration.lastSyncError = String(error?.message || 'Dropbox sync failed').slice(0, 500);
      await integration.save().catch(() => null);
      throw error;
    }
  })();
  try { return await syncPromise; } finally { syncPromise = null; syncProgress = null; }
};

router.get('/connect-url', ...requireDropboxAdmin, (req, res) => {
  try {
    const state = createDropboxOauthState({ userId: req.auth.userId, returnTo: req.query?.returnTo });
    return res.json({ url: buildDropboxAuthorizeUrl({ state }) });
  } catch (error) {
    return sendApiError(res, error, { context: 'Dropbox connect URL failed', fallbackMessage: 'Dropbox is not configured' });
  }
});

router.get('/callback', async (req, res) => {
  try {
    if (req.query?.error) return res.status(400).send(callbackHtml(false, req.query.error_description || req.query.error));
    const state = verifyDropboxOauthState(req.query?.state);
    const token = await exchangeDropboxAuthorizationCode(req.query?.code);
    if (!token?.refresh_token) throw Object.assign(new Error('Dropbox did not return an offline refresh token. Reconnect and approve access again.'), { statusCode: 409 });
    const account = await getDropboxCurrentAccount(token.access_token);
    const config = getDropboxConfig();
    await DropboxIntegration.findOneAndUpdate(
      { provider: 'dropbox' },
      {
        $set: {
          accountId: String(account?.account_id || ''),
          accountEmail: String(account?.email || '').toLowerCase(),
          rootPath: config.rootPath,
          refreshToken: encryptDropboxSecret(token.refresh_token),
          cursor: '',
          connectedAt: new Date(),
          connectedBy: String(state.userId),
          enabled: true,
          lastSyncError: '',
        },
      },
      { upsert: true, new: true, runValidators: true }
    );
    return res.status(200).send(callbackHtml(true, `Read-only sync is connected to ${config.rootPath}.`, state.returnTo));
  } catch (error) {
    return res.status(Number(error?.statusCode) || 500).send(callbackHtml(false, error?.message || 'Dropbox connection failed'));
  }
});

router.get('/status', ...requireDropboxAdmin, async (_req, res) => {
  try {
    const integration = await DropboxIntegration.findOne({ provider: 'dropbox' }).lean();
    const [counts, reviewDocuments] = await Promise.all([
      DropboxDocument.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
      DropboxDocument.find({ status: 'review' })
        .select('dropboxId path name documentType inferredDate eventId revisionNumber revisionLabel reason serverModifiedAt')
        .sort({ inferredDate: 1, serverModifiedAt: -1 })
        .limit(100)
        .lean(),
    ]);
    return res.json({
      configured: Boolean(getDropboxConfig().appKey && getDropboxConfig().appSecret && String(process.env.DROPBOX_TOKEN_ENCRYPTION_KEY || '').length >= 32),
      connected: Boolean(integration?.connectedAt),
      syncing: Boolean(syncPromise),
      progress: syncProgress,
      integration: integration ? {
        accountEmail: integration.accountEmail,
        rootPath: integration.rootPath,
        connectedAt: integration.connectedAt,
        lastSyncStartedAt: integration.lastSyncStartedAt,
        lastSyncCompletedAt: integration.lastSyncCompletedAt,
        lastSyncError: integration.lastSyncError,
        lastSyncSummary: integration.lastSyncSummary,
        enabled: integration.enabled,
      } : null,
      counts: Object.fromEntries(counts.map((entry) => [entry._id, entry.count])),
      reviewDocuments,
    });
  } catch (error) {
    return sendApiError(res, error, { context: 'Dropbox status failed', fallbackMessage: 'Failed to load Dropbox status' });
  }
});

router.post('/sync', ...requireDropboxAdmin, syncRateLimit, async (_req, res) => {
  try {
    if (syncPromise) return res.status(202).json({ ok: true, started: false, syncing: true });
    void runDropboxDiscoverySync().catch((error) => {
      console.error('Dropbox background sync failed:', error?.message || error);
    });
    return res.status(202).json({ ok: true, started: true, syncing: true });
  } catch (error) {
    return sendApiError(res, error, { context: 'Dropbox sync failed', defaultStatus: 502, fallbackMessage: 'Dropbox sync failed' });
  }
});

router.get('/documents', ...requireDropboxAdmin, async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(200, Number(req.query?.limit) || 100));
    const status = String(req.query?.status || '').trim();
    const query = status ? { status } : { status: { $in: ['discovered', 'review', 'superseded', 'failed'] } };
    const documents = await DropboxDocument.find(query).sort({ inferredDate: 1, serverModifiedAt: -1 }).limit(limit).lean();
    return res.json({ items: documents });
  } catch (error) {
    return sendApiError(res, error, { context: 'Dropbox documents failed', fallbackMessage: 'Failed to load Dropbox documents' });
  }
});

export default router;
