import User from '../models/Users.js';

const accidentalDraftAccountId = (report) => {
  if (report.reportType !== 'captain' || report.status !== 'pending'
    || report.submittedAt || report.requestSentAt || report.lastReminderAt || report.reminderCount
    || Object.keys(report.answers || {}).length) return '';
  return /^account:([a-f0-9]{24})$/i.exec(report.slackUserId || '')?.[1] || '';
};

// Older admin preview links created empty personal requests. Do not present
// those as outstanding work; retain every submitted, edited or explicitly sent report.
export const visibleEventReports = async (reports) => {
  const ids = [...new Set(reports.map(accidentalDraftAccountId).filter(Boolean))];
  if (!ids.length) return reports;
  const admins = await User.find({ _id: { $in: ids }, role: { $in: ['admin', 'super admin', 'bar admin'] } }).select('_id').lean();
  const adminIds = new Set(admins.map((user) => String(user._id)));
  return reports.filter((report) => !adminIds.has(accidentalDraftAccountId(report)));
};
