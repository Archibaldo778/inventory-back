import { Router } from 'express';
import mongoose from 'mongoose';
import Event from '../models/Event.js';
import EventReport from '../models/EventReport.js';
import EventReportSettings from '../models/EventReportSettings.js';
import { createMemoryRateLimiter } from '../middleware/rateLimit.js';
import { sendApiError } from '../utils/apiErrors.js';
import { verifyEventGuestAccess } from '../utils/eventGuestAccess.js';
import { sendEventReportEmail } from '../utils/eventReportEmail.js';
import { EVENT_REPORT_CONTEXT_SELECT, resolveReportSalesRep } from '../utils/eventReportSalesRep.js';
import { validateStaffKitchenReportAccess } from '../utils/staffKitchenReport.js';
import { requiresEventReport } from '../utils/eventReportRequirement.js';
import { reportCaptainStillAssigned } from '../utils/captainEventDuties.js';
import { pinReportTemplate, reportTemplate, captainTemplateAnswers } from '../utils/captainReportTemplate.js';

import { validateReportPhotos, sendReportPhoto } from '../utils/eventReportPhotos.js';

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
  eventDate: report.eventDate, reporterName: report.reporterName, reporterEmail: report.reporterEmail,
  eventEndsAt: report.eventEndsAt || null,
  position: report.position, salesRep: report.salesRep, reportType: report.reportType || 'captain',
  status: report.status, submittedAt: report.submittedAt, answers: report.answers || {}, emailDelivery: report.emailDelivery,
  templateSnapshot: reportTemplate(report), photos: report.photos || [],
});

router.get('/:eventId', limiter, async (req, res) => {
  try {
    const access = loadAccess(req, res);
    if (!access) return undefined;
    let report = await EventReport.findOne({ eventId: req.params.eventId, slackUserId: clean(access.subjectId, 100) });
    if (!report) return res.status(404).json({ message: 'Event report was not found' });
    const kitchenIdentity = await validateStaffKitchenReportAccess(access, report);
    const event = await Event.findById(report.eventId).select(`title ${EVENT_REPORT_CONTEXT_SELECT}`).lean();
    const reportRequired = report.status !== 'cancelled' && requiresEventReport(event || { title: report.eventTitle }) && await reportCaptainStillAssigned(report, event);
    if (reportRequired) report = await pinReportTemplate(report);
    return res.json({ report: { ...publicReport(report), ...(report.status === 'pending' ? kitchenIdentity : {}), salesRep: resolveReportSalesRep(report, event), reportRequired: reportRequired && report.status !== 'cancelled' } });
  } catch (error) {
    return sendApiError(res, error, { context: 'Public event report load failed', fallbackMessage: 'Could not load this event report' });
  }
});

router.post('/:eventId', limiter, async (req, res) => {
  try {
    const access = loadAccess(req, res);
    if (!access) return undefined;
    let report = await EventReport.findOne({ eventId: req.params.eventId, slackUserId: clean(access.subjectId, 100) });
    if (!report) return res.status(404).json({ message: 'Event report was not found' });
    const kitchenIdentity = await validateStaffKitchenReportAccess(access, report);
    if (report.status === 'submitted') return res.status(409).json({ message: 'This report has already been submitted' });
    if (report.status === 'cancelled') return res.status(403).json({ message: 'This report request was cancelled. No report is required.' });
    const event = await Event.findById(report.eventId).select(`title ${EVENT_REPORT_CONTEXT_SELECT}`).lean();
    if (!requiresEventReport(event || { title: report.eventTitle })) return res.status(403).json({ message: 'No report is required for this event' });
    if (!await reportCaptainStillAssigned(report, event)) return res.status(403).json({ message: 'No Captain report is required for your booking on this event' });
    const templateSnapshot = reportTemplate(report);
    if ((req.body?.templateRevision ?? 0) !== templateSnapshot.revision) return res.status(409).json({ message: 'The report form has changed. Reload it before submitting.' });
    const answers = captainTemplateAnswers(templateSnapshot, req.body?.answers);
    const photoFields = await validateReportPhotos(req.body?.photos);
    const settings = await EventReportSettings.findOne({ key: 'default' }).lean();
    // Cancellation and submission compete for the same pending state. A stale
    // form cannot revive a cancelled request or send a second submission email.
    const templateGuard = report.templateSnapshot ? { 'templateSnapshot.revision': templateSnapshot.revision } : { templateSnapshot: null };
    report = await EventReport.findOneAndUpdate({ _id: report._id, status: 'pending', ...templateGuard }, { $set: {
      ...kitchenIdentity, ...photoFields,
      salesRep: resolveReportSalesRep(report, event), answers, status: 'submitted', submittedAt: new Date(),
      templateSnapshot,
      nextReminderAt: null, emailDelivery: { status: 'pending', recipients: [], cc: [], error: '' },
    } }, { new: true, runValidators: true });
    if (!report) return res.status(409).json({ message: 'This report was submitted or cancelled. Reload the page.' });
    const configuredRecipients = settings?.emailEnabled === true
      ? (settings.recipients || []).map((recipient) => recipient.email)
      : [];
    try {
      report.emailDelivery = await sendEventReportEmail({ report: report.toObject(), event, configuredRecipients });
    } catch (emailError) {
      report.emailDelivery = { status: 'failed', recipients: configuredRecipients, cc: [], error: clean(emailError?.message || 'Email delivery failed', 1000) };
    }
    await report.save();
    return res.json({ ok: true, report: publicReport(report) });
  } catch (error) {
    return sendApiError(res, error, { context: 'Public event report submit failed', fallbackMessage: 'Could not submit this event report' });
  }
});

router.get('/:eventId/photos/:index', limiter, async (req, res) => {
  try {
    const access = loadAccess(req, res);
    if (!access) return undefined;
    const report = await EventReport.findOne({ eventId: req.params.eventId, slackUserId: clean(access.subjectId, 100) });
    if (!report) return res.status(404).json({ message: 'Report not found' });
    await validateStaffKitchenReportAccess(access, report);
    return await sendReportPhoto(res, report, req.params.index);
  } catch (error) { return sendApiError(res, error, { fallbackMessage: 'Could not load photo' }); }
});

export default router;
