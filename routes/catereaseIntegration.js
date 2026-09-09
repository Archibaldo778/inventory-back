import { Router } from 'express';
import crypto from 'node:crypto';
import CatereaseFile from '../models/CatereaseFile.js';
import CatereaseIntegration from '../models/CatereaseIntegration.js';
import Event from '../models/Event.js';
import BarEvent from '../models/BarEvent.js';
import KitchenIngredient from '../models/KitchenIngredient.js';
import KitchenIngredientUnit from '../models/KitchenIngredientUnit.js';
import KitchenRecipe from '../models/KitchenRecipe.js';
import { requireAdmin, requireAuth } from '../middleware/auth.js';
import { createMemoryRateLimiter } from '../middleware/rateLimit.js';
import { sendApiError } from '../utils/apiErrors.js';
import { clearApiCacheGroups } from '../utils/apiCache.js';
import { mergeEventDocumentHistory } from '../utils/documentImportAudit.js';
import { readDropboxDocxMetadata } from '../utils/dropboxDocxMetadata.js';
import {
  combineImportedBarItems,
  mergePackoutDocumentItems,
  preservePackoutOperationalState,
  schedulePreparedItemsForEvent,
} from '../utils/barManualItems.js';
import { normalizePackoutItems } from './bar.js';
import {
  downloadCatereaseEventFile,
  getCatereaseConfig,
  getCatereaseEventBundle,
  listCatereaseEventFiles,
  listCatereaseHubResource,
} from '../utils/catereaseApi.js';
import {
  catereaseFileRevision,
  normalizeCatereaseEventId,
  normalizeCatereaseFile,
} from '../utils/catereaseFiles.js';
import { nyToday } from '../utils/dropboxDocuments.js';
import { buildCatereaseFinancialPreview, buildCatereaseKitchenCatalog } from '../utils/catereaseKitchen.js';

const router = Router();
const requireCatereaseAdmin = [requireAuth, requireAdmin];
const syncRateLimit = createMemoryRateLimiter({ windowMs: 10 * 60 * 1000, max: 8, message: 'Too many Caterease sync requests' });
const downloadRateLimit = createMemoryRateLimiter({ windowMs: 60 * 1000, max: 120, message: 'Too many Caterease file downloads' });
let syncPromise = null;
let syncProgress = null;
let recipeSyncPromise = null;
let recipeSyncProgress = null;

const isDocx = (fileName, contentType = '') => /\.docx$/i.test(String(fileName || ''))
  || /officedocument\.wordprocessingml\.document/i.test(String(contentType || ''));

const dashboardEventGuestCount = (event) => {
  const parsed = Number(event?.meta?.guestCount ?? event?.meta?.guest_count ?? event?.meta?.guests);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

const syncCatereaseBarItems = async (event) => {
  const sourceDocuments = (Array.isArray(event?.documents) ? event.documents : [])
    .filter((document) => String(document?.sourceProvider || '') === 'caterease');
  const rawItems = sourceDocuments.flatMap((document) => Array.isArray(document?.barItems) ? document.barItems : []);
  const documentTypes = [...new Set(sourceDocuments.map((document) => String(document?.type || '')).filter(Boolean))];
  const guestCount = dashboardEventGuestCount(event);
  const importedItems = combineImportedBarItems(await normalizePackoutItems(rawItems, { allowFinancials: false, guestCount }));
  let barEvent = await BarEvent.findOne({ linkedEventId: event._id });
  if (!barEvent && !rawItems.length) return false;
  if (!barEvent) {
    barEvent = new BarEvent({
      linkedEventId: event._id,
      eventNumber: String(event.externalId || ''),
      name: String(event.title || 'Untitled event'),
      eventDate: String(event.date || ''),
      client: String(event.client || ''),
      salesRep: String(event.managerId || ''),
      guestCount,
      guestCountSource: 'dashboard',
      status: 'draft',
    });
  }
  const existingItems = Array.isArray(barEvent.items) ? barEvent.items : [];
  barEvent.items = schedulePreparedItemsForEvent(
    preservePackoutOperationalState(existingItems, mergePackoutDocumentItems(existingItems, importedItems, documentTypes)),
    String(event.date || ''),
    { by: 'Caterease automatic sync' }
  );
  barEvent.packout = {
    fileName: sourceDocuments.map((document) => document.fileName).filter(Boolean).join(', ').slice(0, 500),
    contentType: sourceDocuments.map((document) => document.contentType).find(Boolean) || 'application/octet-stream',
    packoutType: sourceDocuments.some((document) => document.type === 'po') ? 'general' : 'bar_only',
    importedAt: new Date(),
    importedBy: 'Caterease automatic sync',
  };
  if (barEvent.status === 'draft') barEvent.status = 'ready';
  barEvent.revision = Number(barEvent.revision || 0) + 1;
  barEvent.audit = [...(Array.isArray(barEvent.audit) ? barEvent.audit : []), {
    action: 'caterease_documents_synced',
    username: 'Caterease automatic sync',
    at: new Date(),
    details: { documents: sourceDocuments.length, items: importedItems.length },
  }].slice(-200);
  await barEvent.save();
  return true;
};

const listAllEventFiles = async (eventId) => {
  const files = [];
  let cursor = '';
  let pages = 0;
  do {
    const page = await listCatereaseEventFiles(eventId, { cursor, limit: 200 });
    files.push(...page.data);
    if (page.pagination.hasMore && !page.pagination.nextCursor) throw new Error(`Caterease file pagination cursor is missing for ${eventId}`);
    cursor = page.pagination.hasMore ? page.pagination.nextCursor : '';
    pages += 1;
    if (pages > 1000) throw new Error(`Caterease pagination did not finish for ${eventId}`);
  } while (cursor);
  return files;
};

const listAllHubRows = async (resource) => {
  const rows = [];
  let cursor = '';
  let pages = 0;
  do {
    const page = await listCatereaseHubResource(resource, { cursor, limit: 200 });
    rows.push(...page.data);
    if (page.pagination.hasMore && !page.pagination.nextCursor) throw new Error(`Caterease ${resource} pagination cursor is missing`);
    cursor = page.pagination.hasMore ? page.pagination.nextCursor : '';
    pages += 1;
    recipeSyncProgress = { resource, rows: rows.length, pages };
    if (pages > 5000) throw new Error(`Caterease ${resource} pagination did not finish`);
  } while (cursor);
  return rows;
};

const createIntegration = () => CatereaseIntegration.findOneAndUpdate(
  { provider: 'caterease' },
  { $setOnInsert: { provider: 'caterease', enabled: true } },
  { upsert: true, new: true }
);

export const runCatereaseRecipeSync = async () => {
  if (recipeSyncPromise) return recipeSyncPromise;
  recipeSyncPromise = (async () => {
    const integration = await createIntegration();
    integration.lastRecipeSyncStartedAt = new Date();
    integration.lastRecipeSyncError = '';
    await integration.save();
    const runId = crypto.randomUUID();
    try {
      const [menuItems, menuItemRecipes, ingredients, ingredientRecipes, ingredientUnits] = await Promise.all([
        listAllHubRows('menuitem'),
        listAllHubRows('menuitemrecipe'),
        listAllHubRows('ingredient'),
        listAllHubRows('ingredientrecipe'),
        listAllHubRows('ingredientunit'),
      ]);
      const catalog = buildCatereaseKitchenCatalog({ menuItems, menuItemRecipes, ingredients, ingredientRecipes, ingredientUnits });
      const ingredientOperations = catalog.ingredients.map(({ key: _key, ...ingredient }) => ({
        updateOne: {
          filter: { sourceProvider: 'caterease', locationId: ingredient.locationId, sourceId: ingredient.sourceId },
          update: { $set: { ...ingredient, lastSeenRun: runId, sourceDeletedAt: null } },
          upsert: true,
        },
      }));
      const recipeOperations = catalog.recipes.map(({ key: _key, ...recipe }) => ({
        updateOne: {
          filter: { sourceProvider: 'caterease', locationId: recipe.locationId, sourceId: recipe.sourceId },
          update: { $set: { ...recipe, lastSeenRun: runId, sourceDeletedAt: null } },
          upsert: true,
        },
      }));
      const unitOperations = ingredientUnits.map((row) => ({
        updateOne: {
          filter: {
            sourceProvider: 'caterease',
            locationId: String(row.LocNum || '').trim() || 'default',
            ingredientSourceId: String(row.IRNum || '').trim(),
            unitId: String(row.UnitNum || '').trim(),
          },
          update: { $set: {
            name: String(row.UnitName || '').trim(),
            convertFrom: String(row.ConvertFrom || '').trim(),
            convertTo: String(row.ConvertTo || '').trim(),
            conversionUnitId: String(row.ConversionUnitNum || '').trim(),
            conversionRatio: Number.isFinite(Number(row.ConversionRatio)) ? Number(row.ConversionRatio) : null,
            baseConversionRatio: Number.isFinite(Number(row.BaseConversionRatio)) ? Number(row.BaseConversionRatio) : null,
            note: String(row.Note || '').trim(),
            lastSeenRun: runId,
            sourceDeletedAt: null,
          } },
          upsert: true,
        },
      })).filter((operation) => operation.updateOne.filter.unitId);
      if (ingredientOperations.length) await KitchenIngredient.bulkWrite(ingredientOperations, { ordered: false });
      if (recipeOperations.length) await KitchenRecipe.bulkWrite(recipeOperations, { ordered: false });
      if (unitOperations.length) await KitchenIngredientUnit.bulkWrite(unitOperations, { ordered: false });
      const removedAt = new Date();
      const [removedIngredients, removedRecipes, removedUnits] = await Promise.all([
        KitchenIngredient.updateMany({ sourceProvider: 'caterease', lastSeenRun: { $ne: runId }, sourceDeletedAt: null }, { $set: { sourceDeletedAt: removedAt } }),
        KitchenRecipe.updateMany({ sourceProvider: 'caterease', lastSeenRun: { $ne: runId }, sourceDeletedAt: null }, { $set: { sourceDeletedAt: removedAt } }),
        KitchenIngredientUnit.updateMany({ sourceProvider: 'caterease', lastSeenRun: { $ne: runId }, sourceDeletedAt: null }, { $set: { sourceDeletedAt: removedAt } }),
      ]);
      const summary = {
        recipes: catalog.recipes.length,
        ingredients: catalog.ingredients.length,
        recipeComponents: catalog.recipes.reduce((total, recipe) => total + recipe.ingredients.length, 0),
        subRecipeComponents: catalog.ingredients.reduce((total, ingredient) => total + ingredient.components.length, 0),
        units: ingredientUnits.length,
        removedRecipes: Number(removedRecipes.modifiedCount || 0),
        removedIngredients: Number(removedIngredients.modifiedCount || 0),
        removedUnits: Number(removedUnits.modifiedCount || 0),
      };
      integration.lastRecipeSyncCompletedAt = new Date();
      integration.lastRecipeSyncSummary = summary;
      await integration.save();
      clearApiCacheGroups('kitchen');
      return summary;
    } catch (error) {
      integration.lastRecipeSyncError = String(error?.message || 'Caterease recipe sync failed').slice(0, 500);
      await integration.save().catch(() => null);
      throw error;
    }
  })();
  try { return await recipeSyncPromise; } finally { recipeSyncPromise = null; recipeSyncProgress = null; }
};

const nextFileVersion = (event, uid) => Math.max(0, ...[
  ...(Array.isArray(event?.documents) ? event.documents : []),
  ...(Array.isArray(event?.documentHistory) ? event.documentHistory : []),
].filter((document) => String(document?.sourceProvider || '') === 'caterease' && String(document?.sourceId || '') === String(uid))
  .map((document) => Number(document?.version) || 0)) + 1;

const reconcileDeletedFiles = async (event, eventId, seenUids, stats) => {
  const missing = await CatereaseFile.find({
    catereaseEventId: eventId,
    status: { $ne: 'deleted' },
    uid: { $nin: [...seenUids] },
  }).select('uid').lean();
  if (!missing.length) return false;
  const missingIds = new Set(missing.map((file) => String(file.uid)));
  const removed = (event.documents || []).filter((document) => (
    String(document?.sourceProvider || '') === 'caterease' && missingIds.has(String(document?.sourceId || ''))
  ));
  if (removed.length) {
    event.documentHistory = mergeEventDocumentHistory(event.documentHistory, removed);
    event.documents = (event.documents || []).filter((document) => !removed.includes(document));
    await event.save();
  }
  await CatereaseFile.updateMany({ uid: { $in: missing.map((file) => file.uid) } }, {
    $set: { status: 'deleted', reason: 'No longer returned by Caterease', deletedAt: new Date(), lastSeenAt: new Date() },
  });
  stats.deleted += missing.length;
  return removed.length > 0;
};

const syncOneEvent = async (event, eventId, stats) => {
  const rawFiles = await listAllEventFiles(eventId);
  stats.filesSeen += rawFiles.length;
  const seenUids = new Set();
  let eventChanged = false;
  for (const rawFile of rawFiles) {
    const file = normalizeCatereaseFile(rawFile, eventId);
    if (!Number.isSafeInteger(file.uid) || file.uid <= 0 || !file.fileName) {
      stats.failed += 1;
      continue;
    }
    seenUids.add(file.uid);
    const existingRecord = await CatereaseFile.findOne({ uid: file.uid }).lean();
    if (file.documentType === 'review') {
      await CatereaseFile.findOneAndUpdate({ uid: file.uid }, {
        $set: { ...file, status: 'ignored', reason: 'Not named as a PO/KPO/Pack Out or KM/AKM', lastSeenAt: new Date(), deletedAt: null },
        $setOnInsert: { firstSeenAt: new Date() },
      }, { upsert: true, runValidators: true });
      stats.ignored += 1;
      continue;
    }
    const revision = catereaseFileRevision(file);
    const current = (event.documents || []).find((document) => (
      String(document?.sourceProvider || '') === 'caterease' && String(document?.sourceId || '') === String(file.uid)
    ));
    const unchanged = current && String(current.sourceRevision || '') === revision && existingRecord?.status === 'imported';
    if (unchanged) {
      await CatereaseFile.updateOne({ uid: file.uid }, { $set: { ...file, status: 'imported', reason: 'Attached to event; unchanged', lastSeenAt: new Date(), deletedAt: null } });
      stats.unchanged += 1;
      continue;
    }
    try {
      const downloaded = await downloadCatereaseEventFile(file.uid);
      let metadata = { kitchenItems: [], barItems: [], packoutType: '' };
      let parseWarning = '';
      if (isDocx(file.fileName, downloaded.contentType)) {
        try {
          metadata = await readDropboxDocxMetadata(downloaded.buffer, { documentType: file.documentType });
        } catch (error) {
          parseWarning = String(error?.message || 'DOCX content could not be parsed').slice(0, 300);
        }
      }
      const currentDocuments = Array.isArray(event.documents) ? event.documents : [];
      const replaced = currentDocuments.filter((document) => (
        String(document?.sourceProvider || '') === 'caterease' && String(document?.sourceId || '') === String(file.uid)
      ));
      event.documentHistory = mergeEventDocumentHistory(event.documentHistory, replaced);
      event.documents = [
        ...currentDocuments.filter((document) => !replaced.includes(document)),
        {
          type: file.documentType,
          fileName: file.fileName,
          contentType: downloaded.contentType,
          size: downloaded.buffer.length,
          checksum: downloaded.etag || revision,
          url: `/api/integrations/caterease/files/${file.uid}/content`,
          version: nextFileVersion(event, file.uid),
          uploadedAt: file.revisedAt || new Date(),
          uploadedBy: 'Caterease automatic sync',
          sourceProvider: 'caterease',
          sourceId: String(file.uid),
          sourcePath: `event:${eventId}`,
          sourceSeries: `caterease:${file.uid}`,
          sourceRevision: revision,
          kitchenItems: file.documentType === 'kitchen_menu' ? metadata.kitchenItems : undefined,
          barItems: Array.isArray(metadata.barItems) ? metadata.barItems : undefined,
        },
      ];
      await event.save();
      eventChanged = true;
      await CatereaseFile.findOneAndUpdate({ uid: file.uid }, {
        $set: {
          ...file,
          etag: downloaded.etag,
          contentType: downloaded.contentType,
          size: downloaded.buffer.length,
          kitchenItems: metadata.kitchenItems,
          barItems: metadata.barItems,
          packoutType: metadata.packoutType,
          status: 'imported',
          reason: parseWarning ? `Attached to event; content not parsed: ${parseWarning}` : 'Attached to event',
          importedEventId: event._id,
          lastSeenAt: new Date(),
          deletedAt: null,
        },
        $setOnInsert: { firstSeenAt: new Date() },
      }, { upsert: true, runValidators: true });
      if (existingRecord) stats.updated += 1;
      else stats.added += 1;
      stats.imported += 1;
    } catch (error) {
      stats.failed += 1;
      await CatereaseFile.findOneAndUpdate({ uid: file.uid }, {
        $set: { ...file, status: 'failed', reason: String(error?.message || 'Import failed').slice(0, 500), lastSeenAt: new Date(), deletedAt: null },
        $setOnInsert: { firstSeenAt: new Date() },
      }, { upsert: true, runValidators: true }).catch(() => null);
    }
  }
  if (await reconcileDeletedFiles(event, eventId, seenUids, stats)) eventChanged = true;
  if (eventChanged) await syncCatereaseBarItems(event);
};

export const runCatereaseFileSync = async () => {
  if (syncPromise) return syncPromise;
  syncPromise = (async () => {
    const integration = await createIntegration();
    integration.lastSyncStartedAt = new Date();
    integration.lastSyncError = '';
    await integration.save();
    const stats = { eventsSeen: 0, eventsWithoutCatereaseId: 0, filesSeen: 0, imported: 0, added: 0, updated: 0, unchanged: 0, ignored: 0, deleted: 0, failed: 0 };
    try {
      const events = await Event.find({ date: { $gte: nyToday() }, status: { $ne: 'deleted' } })
        .select('externalId title date client managerId meta documents documentHistory')
        .sort({ date: 1 });
      for (let index = 0; index < events.length; index += 1) {
        const event = events[index];
        stats.eventsSeen += 1;
        const eventId = normalizeCatereaseEventId(event.externalId);
        syncProgress = { event: index + 1, totalEvents: events.length, eventId, title: event.title, ...stats };
        if (!eventId) {
          stats.eventsWithoutCatereaseId += 1;
          continue;
        }
        try {
          await syncOneEvent(event, eventId, stats);
        } catch (error) {
          stats.failed += 1;
          console.error(`Caterease file sync failed for ${eventId}:`, error?.message || error);
        }
      }
      integration.lastSyncCompletedAt = new Date();
      integration.lastSyncSummary = stats;
      await integration.save();
      if (stats.imported || stats.deleted) clearApiCacheGroups('events', 'bar');
      return stats;
    } catch (error) {
      integration.lastSyncError = String(error?.message || 'Caterease sync failed').slice(0, 500);
      await integration.save().catch(() => null);
      throw error;
    }
  })();
  try { return await syncPromise; } finally { syncPromise = null; syncProgress = null; }
};

router.get('/status', ...requireCatereaseAdmin, async (_req, res) => {
  try {
    const config = getCatereaseConfig();
    const [integration, counts, recentFiles, recipeCount, ingredientCount, recentRecipes] = await Promise.all([
      CatereaseIntegration.findOne({ provider: 'caterease' }).lean(),
      CatereaseFile.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
      CatereaseFile.find({ status: { $in: ['imported', 'failed'] } })
        .select('uid catereaseEventId fileName documentType status reason revisedAt importedEventId')
        .sort({ lastSeenAt: -1 }).limit(100).populate('importedEventId', 'title date externalId').lean(),
      KitchenRecipe.countDocuments({ sourceProvider: 'caterease', sourceDeletedAt: null }),
      KitchenIngredient.countDocuments({ sourceProvider: 'caterease', sourceDeletedAt: null }),
      KitchenRecipe.find({ sourceProvider: 'caterease', sourceDeletedAt: null })
        .select('sourceId locationId name category servings price cost costPerServing ingredients revisedAt')
        .sort({ updatedAt: -1 }).limit(50).lean(),
    ]);
    return res.json({
      configured: Boolean(config.apiKey),
      primaryFiles: config.primaryFiles,
      syncing: Boolean(syncPromise),
      progress: syncProgress,
      recipeSyncing: Boolean(recipeSyncPromise),
      recipeProgress: recipeSyncProgress,
      integration: integration ? {
        enabled: integration.enabled,
        lastSyncStartedAt: integration.lastSyncStartedAt,
        lastSyncCompletedAt: integration.lastSyncCompletedAt,
        lastSyncError: integration.lastSyncError,
        lastSyncSummary: integration.lastSyncSummary,
        lastRecipeSyncStartedAt: integration.lastRecipeSyncStartedAt,
        lastRecipeSyncCompletedAt: integration.lastRecipeSyncCompletedAt,
        lastRecipeSyncError: integration.lastRecipeSyncError,
        lastRecipeSyncSummary: integration.lastRecipeSyncSummary,
      } : null,
      counts: Object.fromEntries(counts.map((entry) => [entry._id, entry.count])),
      recentFiles,
      recipeCount,
      ingredientCount,
      recentRecipes,
    });
  } catch (error) {
    return sendApiError(res, error, { context: 'Caterease status failed', fallbackMessage: 'Failed to load Caterease status' });
  }
});

router.post('/recipes/sync', ...requireCatereaseAdmin, syncRateLimit, async (_req, res) => {
  try {
    if (recipeSyncPromise) return res.status(202).json({ ok: true, started: false, syncing: true });
    void runCatereaseRecipeSync().catch((error) => console.error('Caterease recipe sync failed:', error?.message || error));
    return res.status(202).json({ ok: true, started: true, syncing: true });
  } catch (error) {
    return sendApiError(res, error, { context: 'Caterease recipe sync failed', defaultStatus: 502, fallbackMessage: 'Caterease recipe sync failed' });
  }
});

router.get('/financial-preview/:eventId', ...requireCatereaseAdmin, async (req, res) => {
  try {
    const eventId = normalizeCatereaseEventId(req.params.eventId);
    if (!eventId) return res.status(400).json({ error: 'A Caterease E-number is required' });
    return res.json(buildCatereaseFinancialPreview(await getCatereaseEventBundle(eventId)));
  } catch (error) {
    return sendApiError(res, error, { context: 'Caterease financial preview failed', fallbackMessage: 'Failed to load Caterease financial preview' });
  }
});

router.get('/recipes', ...requireCatereaseAdmin, async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 100));
    const search = String(req.query.search || '').trim();
    const query = { sourceProvider: 'caterease', sourceDeletedAt: null };
    if (search) query.name = { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
    const items = await KitchenRecipe.find(query).sort({ name: 1 }).limit(limit).lean();
    return res.json({ items });
  } catch (error) {
    return sendApiError(res, error, { context: 'Caterease recipes failed', fallbackMessage: 'Failed to list Caterease recipes' });
  }
});

router.post('/sync', ...requireCatereaseAdmin, syncRateLimit, async (_req, res) => {
  try {
    if (syncPromise) return res.status(202).json({ ok: true, started: false, syncing: true });
    void runCatereaseFileSync().catch((error) => console.error('Caterease background sync failed:', error?.message || error));
    return res.status(202).json({ ok: true, started: true, syncing: true });
  } catch (error) {
    return sendApiError(res, error, { context: 'Caterease sync failed', defaultStatus: 502, fallbackMessage: 'Caterease sync failed' });
  }
});

router.get('/files/:uid/content', requireAuth, downloadRateLimit, async (req, res) => {
  try {
    const uid = Number(req.params.uid);
    const file = await CatereaseFile.findOne({ uid, status: { $ne: 'deleted' } }).lean();
    if (!file) return res.status(404).json({ error: 'Caterease file not found' });
    const download = await downloadCatereaseEventFile(uid);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Type', download.contentType || file.contentType || 'application/octet-stream');
    if (download.etag) res.setHeader('ETag', download.etag);
    res.attachment(file.fileName || `caterease-${uid}`);
    return res.send(download.buffer);
  } catch (error) {
    return sendApiError(res, error, { context: 'Caterease file download failed', fallbackMessage: 'Failed to download Caterease file' });
  }
});

export default router;
