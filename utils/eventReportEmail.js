const clean = (value, max = 5000) => String(value ?? '').trim().slice(0, max);
const email = (value) => {
  const normalized = clean(value, 320).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : '';
};
const escapeHtml = (value) => clean(value).replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]));

export const EVENT_REPORT_EMAIL_SECTIONS = [
  ['Staff', [
    ['staffEnough', 'Enough staff'], ['staffingResponsive', 'Staffing Department responsive'], ['staffingComments', 'Staffing comments'],
    ['uniformsReturned', 'Uniforms returned'], ['uniformCheckInOut', 'Uniform check-out / return'], ['staffAppearance', 'Staff appearance met standards'],
    ['staffAppearanceComments', 'Appearance comments'], ['positiveStaff', 'Positive staff'], ['staffBelowStandards', 'Staff below standards'],
  ]],
  ['Kitchen', [
    ['foodProvidedByOcc', 'Food provided by OCC'], ['leadChefName', 'Lead Chef'], ['foodMetStandards', 'Food met OCC standards'],
    ['foodStandardsComments', 'Food comments'], ['leadChefCooperative', 'Lead Chef cooperative and proactive'],
    ['leadChefComments', 'Lead Chef comments'], ['kitchenPerformanceComments', 'Kitchen performance comments'],
  ]],
  ['Bar', [
    ['barProductProvidedByOcc', 'Bar product provided by OCC'], ['barServiceMetStandards', 'Bar service met OCC standards'],
    ['barServiceComments', 'Bar service comments'], ['barProductEnough', 'Enough bar product'], ['beverageCountsCompleted', 'Counts completed before and after'],
  ]],
  ['Sanitation / Rentals', [
    ['sanitationCaptainName', 'Sanitation Captain'], ['rentalEquipmentEnough', 'Enough rental equipment'],
    ['rentalEquipmentComments', 'Rental comments'], ['sanitationCooperative', 'Sanitation Captain / Assistant cooperative'],
    ['sanitationComments', 'Sanitation comments'],
  ]],
  ['Venue Notes', [
    ['venueAccessNotes', 'Venue access notes'], ['venueKitchenNotes', 'Kitchen / BOH notes'], ['finalWalkthrough', 'Final walkthrough'],
  ]],
  ["Event Satisfaction / Client's Feedback", [
    ['actualGuestCount', 'Actual guest count'], ['rerunsOrPurchases', 'Re-runs or purchases'], ['rerunsDetails', 'Re-run details'],
    ['paperworkAccurate', 'Paperwork reflected event needs'], ['paperworkComments', 'Paperwork comments'], ['partyExtended', 'Party extended'],
    ['partyExtendedComments', 'Extension details'], ['staffStayedLate', 'Staff stayed late'], ['staffStayedLateComments', 'Late staff details'],
    ['prepWorkTimeAdded', 'Prep-work time added'], ['prepWorkTimeComments', 'Added time details'], ['healthSafetyIssues', 'Health & safety issues'],
    ['healthSafetyComments', 'Health & safety comments'], ['overallFeedback', 'Overall feedback'], ['followUpRequired', 'Management follow-up required'],
  ]],
];

export const renderEventReportEmail = (report = {}) => {
  const answers = report.answers || {};
  const sections = EVENT_REPORT_EMAIL_SECTIONS.map(([title, fields]) => {
    const rows = fields.map(([key, label]) => {
      const raw = key === 'followUpRequired' ? (answers[key] ? 'Yes' : 'No') : answers[key];
      const value = clean(raw) || '—';
      return `<tr><th style="padding:8px 10px;border-bottom:1px solid #e6e1d7;text-align:left;vertical-align:top;width:38%;color:#665b43">${escapeHtml(label)}</th><td style="padding:8px 10px;border-bottom:1px solid #e6e1d7;white-space:pre-wrap">${escapeHtml(value)}</td></tr>`;
    }).join('');
    return `<h2 style="margin:26px 0 8px;color:#3f392d">${escapeHtml(title)}</h2><table style="width:100%;border-collapse:collapse">${rows}</table>`;
  }).join('');
  return `<!doctype html><html><body style="margin:0;background:#f4f1ea;color:#24221e;font-family:Arial,sans-serif"><div style="max-width:760px;margin:auto;padding:28px"><div style="padding:26px;background:#fff;border:1px solid #ded8ca;border-radius:16px"><div style="color:#927d49;font-size:12px;font-weight:bold;letter-spacing:.1em;text-transform:uppercase">OCC Staffing &amp; Service</div><h1 style="margin:8px 0">Captain's Report</h1><p style="margin:0 0 4px"><strong>${escapeHtml(report.eventTitle)}</strong> · ${escapeHtml(report.eventDate)}</p><p style="margin:0">${escapeHtml(report.reporterName)} · ${escapeHtml(report.position)}</p>${sections}</div></div></body></html>`;
};

export const sendEventReportEmail = async ({ report, event, configuredRecipients = [], fetchImpl = fetch }) => {
  const isTest = event?.meta?.eventReportTest === true;
  const to = [...new Set((isTest
    ? ['ivan@ocnyc.com', 'iurie@ocnyc.com']
    : configuredRecipients
  ).map(email).filter(Boolean))];
  if (!to.length) return { status: 'not_sent', recipients: [], cc: [], error: '' };
  const reporterEmail = email(report?.reporterEmail);
  const cc = reporterEmail && !to.includes(reporterEmail) ? [reporterEmail] : [];
  const apiKey = clean(process.env.RESEND_API_KEY, 1000);
  if (!apiKey) return { status: 'failed', recipients: to, cc, error: 'RESEND_API_KEY is not configured' };
  const response = await fetchImpl('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: clean(process.env.EVENT_REPORT_FROM, 320) || 'OCC Staffing & Service <reports@reports.occdecks.com>',
      to,
      ...(cc.length ? { cc } : {}),
      subject: `Captain's Report · ${clean(report.eventTitle, 300)} · ${clean(report.reporterName, 200)}`,
      html: renderEventReportEmail(report),
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.id) {
    return { status: 'failed', recipients: to, cc, error: clean(payload?.message || `Resend HTTP ${response.status}`, 1000) };
  }
  return { status: 'sent', providerId: clean(payload.id, 200), sentAt: new Date(), recipients: to, cc, error: '' };
};
