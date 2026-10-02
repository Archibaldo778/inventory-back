import EventReportEmailPreview from '../models/EventReportEmailPreview.js';
import User from '../models/Users.js';
import { isAdminAuth } from '../middleware/auth.js';
import { generateEventReportEmailBrief, validateEmailBrief } from './eventReportEmailBrief.js';
import { renderEventReportEmail, renderEventReportText } from './eventReportEmail.js';
import { fetchWithTimeout } from './fetchWithTimeout.js';

export const previewRecipient = (user) => {
  const email = String(user?.email || '').trim().toLowerCase();
  if (!user || user.isActive === false || !isAdminAuth(user) || !/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(email)) {
    throw new Error('A personal preview requires an active administrator with one email address');
  }
  return email;
};

export const buildReportPreviewPayload = ({ report, user, brief }) => {
  if (report?.status !== 'submitted') throw new Error('Only submitted reports can be previewed');
  const emailBrief = validateEmailBrief(brief);
  return {
    from: process.env.EVENT_REPORT_FROM || 'Staffing and Service Department <reports@reports.occdecks.com>',
    to: [previewRecipient(user)],
    reply_to: process.env.EVENT_REPORT_REPLY_TO || 'staffing@ocnyc.com',
    subject: `[PREVIEW] ${report.reportType === 'kitchen' ? 'Kitchen Report' : "Captain's Report"} · ${report.eventTitle} · ${report.reporterName}`,
    html: renderEventReportEmail(report, { emailBrief }),
    text: renderEventReportText(report, { emailBrief }),
  };
};

// Only explicit preview jobs are consumed. Never select reports or their mailing lists
// automatically, and never reclaim a processing job after a crash/uncertain delivery.
export const runEventReportEmailPreview = async ({
  Preview = EventReportEmailPreview,
  Users = User,
  generateBrief = generateEventReportEmailBrief,
  fetchImpl = globalThis.fetch,
  apiKey = process.env.RESEND_API_KEY,
  now = new Date(),
} = {}) => {
  if (!apiKey) return { status: 'unconfigured' };
  const job = await Preview.findOneAndUpdate({ status: 'queued' }, {
    $set: { status: 'processing' },
  }, { new: true, sort: { createdAt: 1 } }).select('+reportSnapshot +payload').lean();
  if (!job) return { status: 'idle' };
  try {
    if (!job.createdAt || now - new Date(job.createdAt) > 24 * 60 * 60_000) throw new Error('Preview request expired; request a new preview');
    const user = await Users.findById(job.requestedBy).select('email role isActive').lean();
    if (previewRecipient(user) !== job.recipient) throw new Error('Preview recipient does not match its requesting administrator');
    if (String(job.reportSnapshot?._id) !== String(job.reportId)) throw new Error('Preview report snapshot does not match the selected report');
    const brief = await generateBrief({ report: job.reportSnapshot });
    const payload = buildReportPreviewPayload({ report: job.reportSnapshot, user, brief });
    await Preview.updateOne({ _id: job._id, status: 'processing' }, {
      $set: { summary: brief, payload, sendAttemptedAt: new Date() },
    });
    const response = await fetchWithTimeout('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': `event-report-preview:${job._id}` },
      body: JSON.stringify(payload),
    }, { timeoutMs: 20_000, fetchImpl });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.id) throw new Error(`Preview email was not confirmed (HTTP ${response.status})`);
    await Preview.updateOne({ _id: job._id, status: 'processing' }, {
      $set: { status: 'sent', sentAt: new Date(), providerId: result.id, error: '' },
    });
    return { status: 'sent', id: String(job._id) };
  } catch (error) {
    await Preview.updateOne({ _id: job._id, status: 'processing' }, {
      $set: { status: 'failed', error: String(error?.message || 'Preview failed').slice(0, 500) },
    });
    return { status: 'failed', id: String(job._id) };
  }
};
