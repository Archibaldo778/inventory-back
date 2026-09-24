import { Router } from 'express';
import mongoose from 'mongoose';
import EventReport from '../models/EventReport.js';
import { createMemoryRateLimiter } from '../middleware/rateLimit.js';
import { sendApiError } from '../utils/apiErrors.js';
import { verifyEventGuestAccess } from '../utils/eventGuestAccess.js';

const router = Router();
const limiter = createMemoryRateLimiter({ windowMs: 10 * 60 * 1000, max: 60, message: 'Too many event report requests' });
const clean = (value, max = 5000) => String(value ?? '').trim().slice(0, max);
const loadAccess = (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(String(req.params.eventId || ''))) {
    res.status(400).json({ message: 'Invalid event' });
    return null;
  }
  try {
    return verifyEventGuestAccess(clean(req.query?.access || req.body?.accessToken, 4096), req.params.eventId, 'event:report');
  } catch {
    res.status(401).json({ message: 'This report link is invalid or expired' });
    return null;
  }
};

const publicReport = (report) => ({
  id: String(report._id), eventId: String(report.eventId), eventTitle: report.eventTitle,
  eventDate: report.eventDate, reporterName: report.reporterName, position: report.position,
  status: report.status, submittedAt: report.submittedAt, answers: report.answers || {},
});

router.get('/:eventId', limiter, async (req, res) => {
  try {
    const access = loadAccess(req, res);
    if (!access) return undefined;
    const report = await EventReport.findOne({ eventId: req.params.eventId, slackUserId: clean(access.subjectId, 100) });
    if (!report) return res.status(404).json({ message: 'Event report was not found' });
    return res.json({ report: publicReport(report) });
  } catch (error) {
    return sendApiError(res, error, { context: 'Public event report load failed', fallbackMessage: 'Could not load this event report' });
  }
});

router.post('/:eventId', limiter, async (req, res) => {
  try {
    const access = loadAccess(req, res);
    if (!access) return undefined;
    const report = await EventReport.findOne({ eventId: req.params.eventId, slackUserId: clean(access.subjectId, 100) });
    if (!report) return res.status(404).json({ message: 'Event report was not found' });
    if (report.status === 'submitted') return res.status(409).json({ message: 'This report has already been submitted' });
    const answers = {
      overallSummary: clean(req.body?.answers?.overallSummary),
      issues: clean(req.body?.answers?.issues),
      staffingNotes: clean(req.body?.answers?.staffingNotes),
      kitchenNotes: clean(req.body?.answers?.kitchenNotes),
      clientFeedback: clean(req.body?.answers?.clientFeedback),
      followUpRequired: req.body?.answers?.followUpRequired === true,
    };
    if (!Object.entries(answers).some(([key, value]) => key === 'followUpRequired' ? value : Boolean(value))) {
      return res.status(400).json({ message: 'Add at least one report note before submitting' });
    }
    report.answers = answers;
    report.status = 'submitted';
    report.submittedAt = new Date();
    report.nextReminderAt = null;
    await report.save();
    return res.json({ ok: true, report: publicReport(report) });
  } catch (error) {
    return sendApiError(res, error, { context: 'Public event report submit failed', fallbackMessage: 'Could not submit this event report' });
  }
});

export default router;
