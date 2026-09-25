const clean = (value, max = 5000) => String(value ?? '').trim().slice(0, max);
const email = (value) => {
  const normalized = clean(value, 320).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : '';
};
const escapeHtml = (value) => clean(value).replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]));

const formatEventDate = (value) => {
  const normalized = clean(value, 40);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return normalized;
  const [year, month, day] = normalized.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', {
    month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, day)));
};

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

export const KITCHEN_REPORT_EMAIL_SECTIONS = [
  ['Staff', [
    ['staffLate', 'Staff late'], ['staffLateWho', 'Who was late'], ['staffProperlyDressed', 'Staff properly dressed'],
    ['staffDressIssues', 'Dress issues'], ['staffFollowedDirection', 'Followed direction / communicated'],
    ['staffDirectionIssues', 'Direction or communication issues'], ['staffSizeAppropriate', 'Staff size appropriate'],
    ['staffSizeComments', 'Staff size comments'], ['staffBroughtTools', 'Staff brought knives / tools'],
    ['staffToolsMissing', 'Missing tools'], ['staffComments', 'Staff comments'],
  ]],
  ['Equipment', [
    ['rentalsReceived', 'All required rentals received'], ['rentalsWorking', 'Rentals working properly'],
    ['kitchenEquipmentReceived', 'All kitchen equipment / tools received'],
  ]],
  ['Service / Kitchen', [
    ['choiceEntreeService', 'Choice of entree service'], ['choiceEntreeDetails', 'Entree counts'],
    ['foodEnough', 'Enough food'], ['foodQuality', 'Food quality'], ['foodOnTime', 'Food served on time'],
    ['fohKitchenCommunication', 'FOH / kitchen communication'], ['otherIssues', 'Other issues'],
    ['paperworkLeadTime', 'Paperwork lead time'], ['paperworkAccurate', 'Paperwork reflected event needs'],
    ['healthSafetyIssues', 'Health & Safety issues'], ['healthSafetyFeedback', 'Health & Safety feedback'],
    ['concernsImprovements', 'Concerns / Improvements'],
  ]],
  ['Final Evaluation', [
    ['rerunsOrPurchases', 'Re-runs or purchases'], ['rerunsDetails', 'Re-run details'],
    ['overtime', 'Overtime'], ['overtimeDetails', 'Overtime details'], ['prepWorkTimeAdded', 'Prep-work time added'],
    ['prepWorkTimeDetails', 'Added time details'], ['photoLinks', 'Event photo links'],
    ['overallEvaluation', 'Overall event evaluation'],
  ]],
];

const emailSections = (report) => report?.reportType === 'kitchen' ? KITCHEN_REPORT_EMAIL_SECTIONS : EVENT_REPORT_EMAIL_SECTIONS;
const emailReportTitle = (report) => report?.reportType === 'kitchen' ? 'Kitchen Report' : "Captain's Report";

export const renderEventReportEmail = (report = {}) => {
  const answers = report.answers || {};
  const sections = emailSections(report).map(([title, fields]) => {
    const rows = fields.map(([key, label], index) => {
      const raw = key === 'followUpRequired' ? (answers[key] ? 'Yes' : 'No') : answers[key];
      const value = clean(raw) || '—';
      const color = value === 'Yes' ? '#176a43' : value === 'No' ? '#a33a35' : '#20272c';
      const background = index % 2 === 0 ? '#ffffff' : '#f7f6f2';
      return `<tr bgcolor="${background}">
        <td width="230" valign="top" style="width:230px;padding:10px 14px;border-bottom:1px solid #e5e2da;font-family:Arial,sans-serif;font-size:13px;line-height:18px;font-weight:bold;color:#5d574b">${escapeHtml(label)}</td>
        <td width="350" valign="top" style="width:350px;padding:10px 14px;border-bottom:1px solid #e5e2da;font-family:Arial,sans-serif;font-size:13px;line-height:18px;color:${color};white-space:pre-wrap">${escapeHtml(value)}</td>
      </tr>`;
    }).join('');
    return `<tr><td height="20" style="height:20px;line-height:20px;font-size:1px">&nbsp;</td></tr>
      <tr><td bgcolor="#263038" style="padding:10px 14px;border-left:4px solid #c8aa62;font-family:Arial,sans-serif;font-size:17px;line-height:22px;font-weight:bold;color:#ffffff">${escapeHtml(title)}</td></tr>
      <tr><td><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse">${rows}</table></td></tr>`;
  }).join('');
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Type" content="text/html; charset=UTF-8"></head>
  <body bgcolor="#edf0f2" style="margin:0;padding:0;background-color:#edf0f2;color:#20272c">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escapeHtml(emailReportTitle(report))} for ${escapeHtml(report.eventTitle)}</div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#edf0f2" style="width:100%;background-color:#edf0f2">
      <tr><td align="center" style="padding:24px 10px">
        <table role="presentation" width="640" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="width:640px;max-width:640px;border-collapse:collapse;background-color:#ffffff;border:1px solid #d9dde0">
          <tr><td bgcolor="#172129" style="padding:24px 28px;border-top:5px solid #c8aa62;font-family:Arial,sans-serif;color:#ffffff">
            <div style="font-size:11px;line-height:16px;font-weight:bold;letter-spacing:1.4px;color:#d8c38d">OCC STAFFING &amp; SERVICE</div>
            <div style="padding-top:6px;font-size:28px;line-height:34px;font-weight:bold">${escapeHtml(emailReportTitle(report))}</div>
          </td></tr>
          <tr><td style="padding:20px 28px 4px;font-family:Arial,sans-serif">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse">
              <tr><td width="120" style="padding:5px 0;font-size:12px;font-weight:bold;color:#756b55;text-transform:uppercase">Event</td><td style="padding:5px 0;font-size:15px;font-weight:bold;color:#20272c">${escapeHtml(report.eventTitle) || '—'}</td></tr>
              <tr><td width="120" style="padding:5px 0;font-size:12px;font-weight:bold;color:#756b55;text-transform:uppercase">Date</td><td style="padding:5px 0;font-size:14px;color:#20272c">${escapeHtml(formatEventDate(report.eventDate)) || '—'}</td></tr>
              <tr><td width="120" style="padding:5px 0;font-size:12px;font-weight:bold;color:#756b55;text-transform:uppercase">${report?.reportType === 'kitchen' ? 'Lead Chef' : 'Captain'}</td><td style="padding:5px 0;font-size:14px;color:#20272c">${escapeHtml(report.reporterName) || '—'}</td></tr>
              <tr><td width="120" style="padding:5px 0;font-size:12px;font-weight:bold;color:#756b55;text-transform:uppercase">Position</td><td style="padding:5px 0;font-size:14px;color:#20272c">${escapeHtml(report.position) || '—'}</td></tr>
            </table>
          </td></tr>
          <tr><td style="padding:0 28px 24px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse">${sections}</table></td></tr>
          <tr><td bgcolor="#172129" align="center" style="padding:16px 24px;font-family:Arial,sans-serif;font-size:11px;line-height:16px;color:#cfd6da">Generated by OCC Event Operations &nbsp;&bull;&nbsp; Saved with the event</td></tr>
        </table>
      </td></tr>
    </table>
  </body></html>`;
};

export const renderEventReportText = (report = {}) => {
  const answers = report.answers || {};
  const sections = emailSections(report).map(([title, fields]) => {
    const rows = fields.map(([key, label]) => {
      const raw = key === 'followUpRequired' ? (answers[key] ? 'Yes' : 'No') : answers[key];
      return `${label}: ${clean(raw) || '—'}`;
    }).join('\n');
    return `${title}\n${rows}`;
  }).join('\n\n');
  return `${emailReportTitle(report).toUpperCase()}\n${clean(report.eventTitle) || '—'} · ${formatEventDate(report.eventDate) || '—'}\n${clean(report.reporterName) || '—'} · ${clean(report.position) || '—'}\n\n${sections}`;
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
      subject: `${emailReportTitle(report)} · ${clean(report.eventTitle, 300)} · ${clean(report.reporterName, 200)}`,
      html: renderEventReportEmail(report),
      text: renderEventReportText(report),
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.id) {
    return { status: 'failed', recipients: to, cc, error: clean(payload?.message || `Resend HTTP ${response.status}`, 1000) };
  }
  return { status: 'sent', providerId: clean(payload.id, 200), sentAt: new Date(), recipients: to, cc, error: '' };
};
