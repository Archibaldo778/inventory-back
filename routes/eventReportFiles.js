import { Router } from 'express';
import mongoose from 'mongoose';
import multer from 'multer';
import Event from '../models/Event.js';
import EventReport from '../models/EventReport.js';
import EventReportFile from '../models/EventReportFile.js';
import { requireAdmin } from '../middleware/auth.js';
import { sendApiError } from '../utils/apiErrors.js';
import { MAX_REPORT_PDF_BYTES, completedReportPdf, publicReportFile, reportFileName, validateReportPdf } from '../utils/eventReportFiles.js';

import { sendReportPhoto } from '../utils/eventReportPhotos.js';

const router = Router();
router.use(requireAdmin);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_REPORT_PDF_BYTES, files: 1 } }).single('file');
const validId = (id) => mongoose.Types.ObjectId.isValid(String(id || ''));
const receivePdf = (req, res, next) => upload(req, res, (error) => error
  ? res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ message: error.code === 'LIMIT_FILE_SIZE' ? 'PDF reports must be 10 MB or smaller' : 'Upload one PDF file' })
  : next());

router.post('/events/:eventId/files', receivePdf, async (req, res) => {
  try {
    const { eventId } = req.params;
    if (!validId(eventId)) return res.status(400).json({ message: 'Invalid event' });
    if (!await Event.exists({ _id: eventId })) return res.status(404).json({ message: 'Event was not found' });
    const fields = await validateReportPdf(req.file);
    const query = { eventId, checksum: fields.checksum };
    let file = await EventReportFile.findOne(query);
    if (!file) {
      try { file = await EventReportFile.create({ ...fields, eventId, uploadedBy: req.auth?.email || req.auth?.username || req.auth?.userId || '' }); }
      catch (error) { if (error.code !== 11000) throw error; file = await EventReportFile.findOne(query); }
    }
    return res.status(201).json({ file: publicReportFile(file) });
  } catch (error) { return sendApiError(res, error, { field: 'message', fallbackMessage: 'Could not upload this report' }); }
});

router.get('/events/:eventId/files/:fileId', async (req, res) => {
  try {
    const { eventId, fileId } = req.params;
    if (!validId(eventId) || !validId(fileId)) return res.status(400).json({ message: 'Invalid report file' });
    const file = await EventReportFile.findOne({ _id: fileId, eventId }).select('+data');
    if (!file) return res.status(404).json({ message: 'Report file was not found for this event' });
    res.setHeader('Cache-Control', 'private, no-store');
    res.type('application/pdf'); res.attachment(file.fileName);
    return res.send(Buffer.from(file.data));
  } catch (error) { return sendApiError(res, error, { field: 'message', fallbackMessage: 'Could not download this report' }); }
});

router.delete('/events/:eventId/files/:fileId', async (req, res) => {
  try {
    const { eventId, fileId } = req.params;
    if (!validId(eventId) || !validId(fileId)) return res.status(400).json({ message: 'Invalid report file' });
    const removed = await EventReportFile.findOneAndDelete({ _id: fileId, eventId });
    if (!removed) return res.status(404).json({ message: 'Report file was not found for this event' });
    return res.json({ ok: true });
  } catch (error) { return sendApiError(res, error, { field: 'message', fallbackMessage: 'Could not remove this report file' }); }
});

router.get('/:reportId/pdf', async (req, res) => {
  try {
    if (!validId(req.params.reportId)) return res.status(400).json({ message: 'Invalid report' });
    const report = await EventReport.findById(req.params.reportId).lean();
    if (!report) return res.status(404).json({ message: 'Report was not found' });
    const buffer = await completedReportPdf(report);
    res.setHeader('Cache-Control', 'private, no-store');
    res.type('application/pdf'); res.attachment(reportFileName(`${report.reportType || 'captain'}-${report.eventDate}-${report.reporterName || 'report'}.pdf`));
    return res.send(buffer);
  } catch (error) { return sendApiError(res, error, { field: 'message', fallbackMessage: 'Could not download this report' }); }
});

router.get('/:reportId/photos/:index', async (req, res) => {
  try {
    if (!validId(req.params.reportId)) return res.status(400).json({ message: 'Invalid report' });
    const report = await EventReport.findById(req.params.reportId).lean();
    if (!report) return res.status(404).json({ message: 'Report not found' });
    return await sendReportPhoto(res, report, req.params.index);
  } catch (error) { return sendApiError(res, error, { fallbackMessage: 'Could not load photo' }); }
});
export default router;
