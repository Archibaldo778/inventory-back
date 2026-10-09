import { requiresCaptainReport } from '../utils/eventReportRequirement.js';
import { Router } from 'express';
import mongoose from 'mongoose';
import Event from '../models/Event.js';
import EventReport from '../models/EventReport.js';
import EventReportSettings from '../models/EventReportSettings.js';
import DropboxIntegration from '../models/DropboxIntegration.js';
import HistoricalEventReport from '../models/HistoricalEventReport.js';
import { listSlackUsers } from '../utils/slackApi.js';
import { sendApiError } from '../utils/apiErrors.js';
import { sendEventReportEmail } from '../utils/eventReportEmail.js';
import { EVENT_REPORT_CONTEXT_SELECT, resolveReportSalesRep, resolveEventSalesRep } from '../utils/eventReportSalesRep.js';
import { loadReportTeamDirectory, resolveTeamRouting } from '../utils/reportTeams.js';
import User from '../models/Users.js';
import ReportTeam from '../models/ReportTeam.js';
import { analyzeEventReports, eventReportAnalysisIsStale } from '../utils/eventReportAi.js';
import EventReportFile from '../models/EventReportFile.js';
import eventReportFilesRouter from './eventReportFiles.js';
import { publicReportFile } from '../utils/eventReportFiles.js';
import { visibleEventReports } from '../utils/eventReportVisibility.js';
import { loadReportRequestContext, buildEventReportRequests, cancelEventReportRequest } from '../utils/eventReportRequests.js';
import {
  decryptDropboxSecret,
  getDropboxCurrentAccount,
  getDropboxMetadata,
  listDropboxFolder,
  refreshDropboxAccessToken,
} from '../utils/dropboxApi.js';
import {
  historicalReportMetadata,
  normalizedHistoricalEventTitle,
} from '../utils/historicalReports.js';

const router = Router();
router.use(eventReportFilesRouter);
const clean = (value, max = 500) => String(value ?? '').trim().slice(0, max);
const DEFAULT_HISTORICAL_REPORTS_PATH = '/Operations christopher@ocnyc.com/Reports';
let historicalReportScanPromise = null;

const archivePath = () => clean(process.env.DROPBOX_HISTORICAL_REPORTS_PATH, 1000) || DEFAULT_HISTORICAL_REPORTS_PATH;

const loadDropboxArchiveConnection = async () => {
  const integration = await DropboxIntegration.findOne({ provider: 'dropbox' })
    .select('+refreshToken.ciphertext +refreshToken.iv +refreshToken.tag namespaceId homePath enabled');
  if (!integration?.enabled || !integration?.refreshToken?.ciphertext) {
    throw Object.assign(new Error('Dropbox is not connected'), { statusCode: 409 });
  }
  const accessToken = await refreshDropboxAccessToken(decryptDropboxSecret(integration.refreshToken));
  const account = await getDropboxCurrentAccount(accessToken);
  const namespaceId = clean(account?.root_info?.root_namespace_id || integration.namespaceId, 200);
  const homePath = clean(account?.root_info?.home_path || integration.homePath, 1000);
  const configuredPath = archivePath();
  const candidates = [...new Set([
    configuredPath,
    configuredPath === DEFAULT_HISTORICAL_REPORTS_PATH ? '/Reports' : '',
    homePath ? `${homePath.replace(/\/$/, '')}/Reports` : '',
  ].filter(Boolean))];
  let rootPath = '';
  let lastError = null;
  for (const candidate of candidates) {
    try {
      const metadata = await getDropboxMetadata(accessToken, candidate, { namespaceId });
      if (metadata?.['.tag'] === 'folder') {
        rootPath = clean(metadata.path_display || candidate, 1000);
        break;
      }
    } catch (error) {
      lastError = error;
    }
  }
  if (!rootPath) {
    throw Object.assign(new Error(`Historical Reports folder was not found${lastError?.message ? ` (${lastError.message})` : ''}`), { statusCode: 404 });
  }
  return { accessToken, namespaceId, rootPath };
};

const listHistoricalReportEntries = async ({ accessToken, namespaceId, rootPath }) => {
  const entries = [];
  let cursor = '';
  do {
    const page = await listDropboxFolder(accessToken, { path: rootPath, cursor, namespaceId });
    entries.push(...(Array.isArray(page?.entries) ? page.entries : []));
    if (entries.length > 50_000) throw Object.assign(new Error('Historical report archive is larger than the safe scan limit'), { statusCode: 409 });
    cursor = page?.has_more ? clean(page.cursor, 2000) : '';
  } while (cursor);
  return entries.filter((entry) => entry?.['.tag'] === 'file');
};

const historicalEventMatches = async (rows) => {
  const dates = [...new Set(rows.map((row) => row.inferredDate).filter(Boolean))];
  if (!dates.length) return new Map();
  const events = await Event.find({
    date: { $in: dates },
    status: { $not: /^deleted$/i },
  }).select('_id title date').lean();
  const candidates = new Map();
  events.forEach((event) => {
    const key = `${event.date}:${normalizedHistoricalEventTitle(event.title)}`;
    if (!key.endsWith(':')) candidates.set(key, [...(candidates.get(key) || []), event]);
  });
  return new Map([...candidates.entries()].filter(([, matches]) => matches.length === 1).map(([key, matches]) => [key, matches[0]]));
};

const scanHistoricalReports = async (actor = '') => {
  const connection = await loadDropboxArchiveConnection();
  const entries = await listHistoricalReportEntries(connection);
  const rows = entries.map((entry) => ({
    entry,
    ...historicalReportMetadata(entry, connection.rootPath),
  }));
  const eventMatches = await historicalEventMatches(rows);
  const now = new Date();
  const operations = rows.map(({ entry, ...row }) => {
    const matchKey = `${row.inferredDate}:${normalizedHistoricalEventTitle(row.inferredTitle)}`;
    const linkedEvent = row.inferredDate && row.inferredTitle ? eventMatches.get(matchKey) : null;
    return {
      updateOne: {
        filter: { dropboxId: clean(entry.id || entry.path_lower || row.path, 1000) },
        update: {
          $set: {
            provider: 'dropbox',
            namespaceId: connection.namespaceId,
            path: row.path,
            name: row.name,
            extension: row.extension,
            size: Number(entry.size) || 0,
            rev: clean(entry.rev, 200),
            contentHash: clean(entry.content_hash, 300),
            clientModifiedAt: entry.client_modified ? new Date(entry.client_modified) : null,
            serverModifiedAt: entry.server_modified ? new Date(entry.server_modified) : null,
            inferredDate: row.inferredDate,
            inferredYear: row.inferredYear,
            inferredTitle: row.inferredTitle,
            reportType: row.reportType,
            supported: row.supported,
            linkedEventId: linkedEvent?._id || null,
            matchType: linkedEvent ? 'exact' : 'none',
            lastSeenAt: now,
          },
          $setOnInsert: { firstSeenAt: now, ingestionStatus: row.supported ? 'discovered' : 'skipped' },
        },
        upsert: true,
      },
    };
  });
  for (let index = 0; index < operations.length; index += 500) {
    await HistoricalEventReport.bulkWrite(operations.slice(index, index + 500), { ordered: false });
  }
  const extensions = {};
  const years = {};
  rows.forEach((row) => {
    extensions[row.extension || 'none'] = (extensions[row.extension || 'none'] || 0) + 1;
    years[row.inferredYear || 'unknown'] = (years[row.inferredYear || 'unknown'] || 0) + 1;
  });
  const summary = {
    rootPath: connection.rootPath,
    files: rows.length,
    supported: rows.filter((row) => row.supported).length,
    matched: operations.filter((operation) => operation.updateOne.update.$set.linkedEventId).length,
    extensions,
    years,
  };
  await EventReportSettings.findOneAndUpdate({ key: 'default' }, { $set: {
    historicalArchive: { ...summary, lastScanAt: now, lastScanBy: actor, error: '' },
  } }, { upsert: true, setDefaultsOnInsert: true });
  return summary;
};

const historicalArchiveStatus = async () => {
  const [settings, total, supported, matched, years, extensions, samples] = await Promise.all([
    EventReportSettings.findOne({ key: 'default' }).select('historicalArchive').lean(),
    HistoricalEventReport.countDocuments(),
    HistoricalEventReport.countDocuments({ supported: true }),
    HistoricalEventReport.countDocuments({ linkedEventId: { $ne: null } }),
    HistoricalEventReport.aggregate([{ $group: { _id: '$inferredYear', count: { $sum: 1 } } }, { $sort: { _id: 1 } }]),
    HistoricalEventReport.aggregate([{ $group: { _id: '$extension', count: { $sum: 1 } } }, { $sort: { count: -1 } }]),
    HistoricalEventReport.find({}).select('name path inferredDate inferredYear inferredTitle reportType supported linkedEventId ingestionStatus').sort({ serverModifiedAt: -1 }).limit(20).lean(),
  ]);
  return {
    configuredPath: archivePath(),
    lastScan: settings?.historicalArchive || null,
    counts: { total, supported, matched, unmatched: Math.max(0, total - matched) },
    years: Object.fromEntries(years.map((row) => [row._id || 'unknown', row.count])),
    extensions: Object.fromEntries(extensions.map((row) => [row._id || 'none', row.count])),
    samples,
  };
};

router.get('/', async (req, res) => {
  try {
    const filter = {};
    const eventId = clean(req.query?.eventId, 80);
    if (eventId && !mongoose.Types.ObjectId.isValid(eventId)) return res.status(400).json({ message: 'Invalid event' });
    if (eventId) filter.eventId = eventId;
    if (req.query?.status && !eventId) filter.status = clean(req.query.status, 40);
    const [reports, event, files] = await Promise.all([
      EventReport.find(filter).sort({ eventDate: -1, reporterName: 1 }).limit(1000).lean(),
      eventId ? Event.findById(eventId).select('title date status meta.nowsta meta.eventReportTest meta.eventReportAnalysis meta.captainReportDisabled').lean() : null,
      eventId ? EventReportFile.find({ eventId }).sort({ createdAt: 1 }).lean() : [],
    ]);
    const analysis = event?.meta?.eventReportAnalysis || null;
    const visible = await visibleEventReports(reports);
    const context = event ? await loadReportRequestContext(event) : null;
    const items = context ? buildEventReportRequests({ event, ...context, reports: visible }) : visible;
    return res.json({
      items: req.query?.status ? items.filter((report) => report.status === req.query.status) : items,
      files: files.map(publicReportFile),
      captainReportPolicy: event ? { disabled: event.meta?.captainReportDisabled === true, required: requiresCaptainReport(event, context?.schedule) } : undefined,
      ai: eventId ? {
        enabledForEvent: Boolean(event),
        configured: Boolean(clean(process.env.OPENAI_API_KEY, 2000)),
        analysis,
        stale: eventReportAnalysisIsStale(analysis, reports, files),
      } : undefined,
    });
  } catch (error) {
    return sendApiError(res, error, { context: 'Event reports list failed', fallbackMessage: 'Could not load event reports' });
  }
});

router.put('/events/:eventId/captain-report-policy', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.eventId) || typeof req.body?.disabled !== 'boolean') {
      return res.status(400).json({ message: 'Choose a valid event and report setting' });
    }
    const event = await Event.findOneAndUpdate({ _id: req.params.eventId }, {
      $set: { 'meta.captainReportDisabled': req.body.disabled },
      $push: { 'meta.captainReportPolicyAudit': { $each: [{ disabled: req.body.disabled, actor: req.auth.userId, at: new Date() }], $slice: -100 } },
    }, { new: true }).select('title meta.captainReportDisabled').lean();
    if (!event) return res.status(404).json({ message: 'Event not found' });
    return res.json({ disabled: event.meta?.captainReportDisabled === true, required: requiresCaptainReport(event) });
  } catch (error) {
    return sendApiError(res, error, { context: 'Captain report policy update failed', fallbackMessage: 'Could not update the report requirement' });
  }
});

router.post('/events/:eventId/requests/cancel', async (req, res) => {
  try {
    const { eventId } = req.params;
    const reportId = clean(req.body?.reportId, 80);
    const userId = clean(req.body?.userId, 80);
    if (!mongoose.isValidObjectId(eventId) || Boolean(reportId) === Boolean(userId)
      || !mongoose.isValidObjectId(reportId || userId)) return res.status(400).json({ message: 'Choose a valid event and report request' });
    const event = await Event.findById(eventId).select('title date status meta.nowsta').lean();
    if (!event) return res.status(404).json({ message: 'Event not found' });
    const report = await cancelEventReportRequest({ event, reportId, userId, actor: req.auth.userId });
    return res.json({ report });
  } catch (error) {
    return sendApiError(res, error, { field: 'message', context: 'Cancel report request failed', fallbackMessage: 'Could not cancel this report request' });
  }
});

router.get('/routing', async (req, res) => {
  try {
    const day = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
    const from = String(req.query?.from || day(-30));
    const to = String(req.query?.to || day(90));
    if (![from, to].every((value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)))
      || from > to || Date.parse(to) - Date.parse(from) > 366 * 86400000) {
      return res.status(400).json({ message: 'Choose a date range of up to one year' });
    }
    const [directory, rows] = await Promise.all([
      loadReportTeamDirectory(),
      Event.find({ date: { $gte: from, $lte: to }, status: { $not: /^(?:deleted|cancelled|canceled|lost)$/i }, 'meta.nowsta.excluded': { $ne: true } })
        .select(`_id title date ${EVENT_REPORT_CONTEXT_SELECT}`).sort({ date: 1, title: 1 }).limit(1001).lean(),
    ]);
    const events = rows.slice(0, 1000).map((event) => ({
      id: String(event._id), title: event.title, date: event.date,
      salesRep: resolveEventSalesRep(event), assignedSalesUserId: String(event.meta?.reportSalesUserId || ''),
      routing: event.meta?.eventReportTest === true
        ? { status: 'test', issues: ['Test event: uses test recipients'], recipients: [] }
        : resolveTeamRouting({ event, ...directory }),
    }));
    return res.json({ events, from, to, truncated: rows.length > 1000 });
  } catch (error) {
    return sendApiError(res, error, { fallbackMessage: 'Could not check report recipients' });
  }
});

router.patch('/events/:eventId/sales', async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(String(req.params.eventId || ''))) return res.status(400).json({ message: 'Invalid event' });
    const salesUserId = String(req.body?.salesUserId || '');
    let update;
    if (salesUserId) {
      if (!mongoose.Types.ObjectId.isValid(salesUserId)) return res.status(400).json({ message: 'Invalid Sales account' });
      const [sales, team] = await Promise.all([
        User.findById(salesUserId).select('_id username isActive').lean(), ReportTeam.findOne({ salesUserId }).lean(),
      ]);
      if (!sales || sales.isActive === false || !team) return res.status(400).json({ message: 'Choose an active Sales account with a team' });
      update = { $set: { 'meta.reportSalesUserId': salesUserId, 'meta.reportSalesRep': sales.username } };
    } else {
      update = { $unset: { 'meta.reportSalesUserId': '', 'meta.reportSalesRep': '' } };
    }
    const event = await Event.findByIdAndUpdate(req.params.eventId, update, { new: true }).select('_id').lean();
    if (!event) return res.status(404).json({ message: 'Event was not found' });
    return res.json({ ok: true });
  } catch (error) {
    return sendApiError(res, error, { fallbackMessage: 'Could not assign event Sales' });
  }
});

router.get('/history', async (_req, res) => {
  try {
    return res.json(await historicalArchiveStatus());
  } catch (error) {
    return sendApiError(res, error, { context: 'Historical reports status failed', fallbackMessage: 'Could not load historical report archive status' });
  }
});

router.post('/history/scan', async (req, res) => {
  try {
    if (historicalReportScanPromise) return res.status(409).json({ message: 'Historical report scan is already running' });
    const actor = clean(req.auth?.email || req.auth?.username || req.auth?.userId, 200);
    historicalReportScanPromise = scanHistoricalReports(actor);
    const summary = await historicalReportScanPromise;
    return res.json({ ok: true, summary, status: await historicalArchiveStatus() });
  } catch (error) {
    await EventReportSettings.findOneAndUpdate({ key: 'default' }, { $set: {
      'historicalArchive.error': clean(error?.message || 'Historical report scan failed', 500),
      'historicalArchive.lastAttemptAt': new Date(),
    } }, { upsert: true, setDefaultsOnInsert: true }).catch(() => {});
    return sendApiError(res, error, { context: 'Historical reports scan failed', fallbackMessage: 'Could not scan historical reports' });
  } finally {
    historicalReportScanPromise = null;
  }
});

router.post('/:eventId/analysis', async (req, res) => {
  try {
    const eventId = clean(req.params.eventId, 80);
    if (!mongoose.Types.ObjectId.isValid(eventId)) return res.status(400).json({ message: 'Invalid event' });
    const event = await Event.findById(eventId).select('title date client meta.eventReportTest').lean();
    if (!event) return res.status(404).json({ message: 'Event was not found' });
    const [reports, files] = await Promise.all([
      EventReport.find({ eventId, status: 'submitted' }).sort({ submittedAt: 1 }).limit(51).lean(),
      EventReportFile.find({ eventId }).select('+data').sort({ createdAt: 1 }).limit(21),
    ]);
    if (!reports.length && !files.length) return res.status(409).json({ message: 'Submit a report or upload a PDF before generating an AI analysis' });
    const result = await analyzeEventReports({ event, reports, files });
    const saved = {
      ...result.analysis,
      model: result.model,
      generatedAt: new Date(),
      generatedBy: clean(req.auth?.email || req.auth?.username || req.auth?.userId, 200),
      reportCount: reports.length + files.length,
      reportIds: reports.map((report) => String(report._id)),
      fileIds: files.map((file) => String(file._id)),
    };
    await Event.updateOne({ _id: eventId }, { $set: { 'meta.eventReportAnalysis': saved } });
    return res.json({ analysis: saved, stale: false });
  } catch (error) {
    return sendApiError(res, error, { context: 'Event report AI analysis failed', fallbackMessage: 'Could not generate the AI analysis' });
  }
});

router.get('/settings', async (_req, res) => {
  try {
    const [settings, slackUsers] = await Promise.all([
      EventReportSettings.findOne({ key: 'default' }).lean(),
      listSlackUsers(),
    ]);
    const people = slackUsers.filter((user) => !user?.deleted && !user?.is_bot && user?.id !== 'USLACKBOT').map((user) => ({
      slackUserId: clean(user.id, 100),
      name: clean(user?.profile?.real_name || user?.real_name || user?.name, 200),
      email: clean(user?.profile?.email, 320).toLowerCase(),
    })).filter((user) => user.slackUserId && user.name && user.email).sort((a, b) => a.name.localeCompare(b.name));
    return res.json({ settings: settings || { recipients: [], emailEnabled: false }, people });
  } catch (error) {
    return sendApiError(res, error, { context: 'Event report settings load failed', fallbackMessage: 'Could not load report settings' });
  }
});

router.put('/settings', async (req, res) => {
  try {
    const recipients = (Array.isArray(req.body?.recipients) ? req.body.recipients : []).slice(0, 100).map((recipient) => ({
      slackUserId: clean(recipient?.slackUserId, 100), name: clean(recipient?.name, 200), email: clean(recipient?.email, 320).toLowerCase(),
    })).filter((recipient) => recipient.name && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient.email));
    const settings = await EventReportSettings.findOneAndUpdate({ key: 'default' }, { $set: {
      recipients, emailEnabled: req.body?.emailEnabled === true,
      updatedBy: clean(req.auth?.email || req.auth?.username || req.auth?.userId, 200),
    } }, { upsert: true, new: true, setDefaultsOnInsert: true });
    return res.json({ settings });
  } catch (error) {
    return sendApiError(res, error, { context: 'Event report settings save failed', fallbackMessage: 'Could not save report settings' });
  }
});

router.post('/:reportId/email', async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(String(req.params.reportId || ''))) return res.status(400).json({ message: 'Invalid report' });
    const report = await EventReport.findById(req.params.reportId);
    if (!report) return res.status(404).json({ message: 'Event report was not found' });
    if (report.status !== 'submitted') return res.status(409).json({ message: 'The report has not been submitted yet' });
    if (report.emailDelivery?.status === 'sent' && req.body?.force !== true) return res.status(409).json({ message: 'This report email has already been sent' });
    const [event, settings] = await Promise.all([
      Event.findById(report.eventId).select(EVENT_REPORT_CONTEXT_SELECT).lean(),
      EventReportSettings.findOne({ key: 'default' }).lean(),
    ]);
    const configuredRecipients = settings?.emailEnabled === true
      ? (settings.recipients || []).map((recipient) => recipient.email)
      : [];
    report.salesRep = resolveReportSalesRep(report, event);
    report.emailDelivery = { status: 'pending', recipients: [], cc: [], error: '' };
    await report.save();
    report.emailDelivery = await sendEventReportEmail({ report: report.toObject(), event, configuredRecipients });
    await report.save();
    return res.json({ ok: report.emailDelivery.status === 'sent', report });
  } catch (error) {
    return sendApiError(res, error, { context: 'Event report email retry failed', fallbackMessage: 'Could not send the event report email' });
  }
});

export default router;
