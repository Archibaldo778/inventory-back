import { Router } from 'express';
import mongoose from 'mongoose';
import Event from '../models/Event.js';
import EventReport from '../models/EventReport.js';
import EventReportFile from '../models/EventReportFile.js';
import { completedReportPdf, publicReportFile, reportFileName } from '../utils/eventReportFiles.js';
import { sendApiError } from '../utils/apiErrors.js';

import { sendReportPhoto } from '../utils/eventReportPhotos.js';

const router = Router();
export const UNIFORM_EVENT_FIELDS = 'title date client externalId managerId status meta.nowsta meta.guestCount meta.venue meta.address meta.eventTime catereaseOperations.staffRequest';
const active = { status: { $not: /^(deleted|cancelled|canceled|lost|archived)$/i }, 'meta.nowsta.excluded': { $ne: true } };
const valid = (id) => mongoose.isValidObjectId(id);
const fail = (res, error) => sendApiError(res, error, { field: 'message', fallbackMessage: 'Could not load the event workspace' });

router.get('/events', async (req, res) => {
  try {
    const q = { ...active };
    const search = String(req.query.dashboardSearch || '').trim().slice(0, 160);
    if (search) q.title = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    if (req.query.calendar === '1') {
      const { from, to } = req.query;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(from || '') || !/^\d{4}-\d{2}-\d{2}$/.test(to || '') || from > to) return res.status(400).json({ message: 'Choose valid dates' });
      const [items, undated, counts] = await Promise.all([
        Event.find({ ...q, date: { $gte: from, $lte: to } }).select(UNIFORM_EVENT_FIELDS).sort({ date: 1, title: 1 }).lean(),
        Event.find({ ...q, $or: [{ date: null }, { date: '' }] }).select(UNIFORM_EVENT_FIELDS).sort({ title: 1 }).lean(),
        Event.aggregate([{ $match: { ...active, date: { $regex: /^\d{4}-\d{2}/ } } }, { $group: { _id: { $substrBytes: ['$date', 0, 7] }, count: { $sum: 1 } } }]),
      ]);
      return res.json({ items, undated, monthCounts: Object.fromEntries(counts.map((row) => [row._id, row.count])) });
    }
    return res.json(await Event.find(q).select(UNIFORM_EVENT_FIELDS).sort({ date: -1 }).limit(1000).lean());
  } catch (error) { return fail(res, error); }
});

router.use('/events/:eventId', async (req, res, next) => {
  try {
    if (!valid(req.params.eventId)) return res.status(400).json({ message: 'Invalid event' });
    const event = await Event.findOne({ _id: req.params.eventId, ...active }).select(UNIFORM_EVENT_FIELDS).lean();
    if (!event) return res.status(404).json({ message: 'Event is unavailable' });
    req.uniformEvent = event; return next();
  } catch (error) { return fail(res, error); }
});
router.get('/events/:eventId', (req, res) => res.json(req.uniformEvent));
router.get('/events/:eventId/reports', async (req, res) => {
  try {
    const [items, files] = await Promise.all([
      EventReport.find({ eventId: req.uniformEvent._id, status: 'submitted' }).sort({ submittedAt: -1 }).lean(),
      EventReportFile.find({ eventId: req.uniformEvent._id }).sort({ createdAt: 1 }).lean(),
    ]);
    return res.json({ items: items.map((report) => ({ ...report, canCancelRequest: false })), files: files.map(publicReportFile) });
  } catch (error) { return fail(res, error); }
});
router.get('/events/:eventId/reports/:reportId/pdf', async (req, res) => {
  try {
    if (!valid(req.params.reportId)) return res.status(400).json({ message: 'Invalid report' });
    const report = await EventReport.findOne({ _id: req.params.reportId, eventId: req.uniformEvent._id, status: 'submitted' }).lean();
    if (!report) return res.status(404).json({ message: 'Submitted report not found for this event' });
    const buffer = await completedReportPdf(report);
    res.setHeader('Cache-Control', 'private, no-store'); res.type('application/pdf'); res.attachment(reportFileName(`${report.eventDate}-${report.reporterName}.pdf`));
    return res.send(buffer);
  } catch (error) { return fail(res, error); }
});
router.get('/events/:eventId/files/:fileId', async (req, res) => {
  try {
    if (!valid(req.params.fileId)) return res.status(400).json({ message: 'Invalid report file' });
    const file = await EventReportFile.findOne({ _id: req.params.fileId, eventId: req.uniformEvent._id }).select('+data');
    if (!file) return res.status(404).json({ message: 'Report file not found for this event' });
    res.setHeader('Cache-Control', 'private, no-store'); res.type('application/pdf'); res.attachment(reportFileName(file.fileName));
    return res.send(Buffer.from(file.data));
  } catch (error) { return fail(res, error); }
});
router.get('/events/:eventId/reports/:reportId/photos/:index', async (req, res) => {
  try {
    if (!valid(req.params.reportId)) return res.status(400).json({ message: 'Invalid report' });
    const report = await EventReport.findOne({ _id: req.params.reportId, eventId: req.uniformEvent._id, status: 'submitted' }).lean();
    if (!report) return res.status(404).json({ message: 'Report not found' });
    return await sendReportPhoto(res, report, req.params.index);
  } catch (error) { return fail(res, error); }
});
export default router;
