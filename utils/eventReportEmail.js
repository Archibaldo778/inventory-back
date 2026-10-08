import { loadReportPhotoData, reportPhotoEmailContent } from './eventReportPhotos.js';
import { listSlackUsers } from './slackApi.js';
import { loadReportTeamDirectory, resolveTeamRouting } from './reportTeams.js';
import { generateEventReportEmailBrief, validateEmailBrief } from './eventReportEmailBrief.js';

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

export const eventReportEmailSections = (report) => report?.templateSnapshot?.sections?.map((section) => [section.title, section.fields.map((field) => [field.key, field.label])])
  || (report?.reportType === 'kitchen' ? KITCHEN_REPORT_EMAIL_SECTIONS : EVENT_REPORT_EMAIL_SECTIONS);
export const eventReportAnswer = (report, key) => {
  const checkbox = key === 'followUpRequired' || report?.templateSnapshot?.sections?.some((section) => section.fields.some((field) => field.key === key && field.type === 'checkbox'));
  return checkbox ? (report?.answers?.[key] ? 'Yes' : 'No') : report?.answers?.[key];
};
const emailReportTitle = (report) => report?.reportType === 'kitchen' ? 'Kitchen Report' : "Captain's Report";

export const CAPTAIN_REPORT_RECIPIENTS = [
  'captainreport@ocnyc.com',
];

const normalizedPersonName = (value) => clean(value, 200).normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const salesTeamNames = (salesRep) => {
  const normalized = normalizedPersonName(salesRep);
  if (/^george(?: |$)/.test(normalized)) return [salesRep, 'Megan'];
  if (/^guillaume(?: |$)/.test(normalized)) return [salesRep];
  return [];
};

const directoryEmail = (name, slackUsers) => {
  const normalized = normalizedPersonName(name);
  const emails = [...new Set(slackUsers.filter((user) => {
    if (user?.deleted || user?.is_bot || user?.id === 'USLACKBOT') return false;
    const names = [user?.profile?.real_name, user?.real_name].map(normalizedPersonName).filter(Boolean);
    return names.some((candidate) => candidate === normalized
      || (!normalized.includes(' ') && candidate.startsWith(`${normalized} `)));
  }).map((user) => email(user?.profile?.email)).filter(Boolean))];
  if (emails.length !== 1) throw new Error(`Report email not sent: ${emails.length ? 'multiple email addresses found' : 'no email address found'} for ${clean(name, 200)} in Slack. Check the sales team directory.`);
  return emails[0];
};

export const captainReportRecipients = (salesRep, configuredRecipients = [], slackUsers = [], baseRecipients = CAPTAIN_REPORT_RECIPIENTS) => {
  const normalized = normalizedPersonName(salesRep);
  const olivierTeam = ['olivier cheng', 'oliver cheng'].some((name) => (
    normalized === name || normalized.startsWith(`${name} `) || name.startsWith(`${normalized} `)
  ));
  const teamNames = salesTeamNames(salesRep);
  return [...new Set([
    ...baseRecipients,
    ...(olivierTeam
      ? ['olivier@ocnyc.com', 'heidi@ocnyc.com', 'sebastian@ocnyc.com', 'ashley@ocnyc.com']
      : (teamNames.length ? teamNames.map((name) => directoryEmail(name, slackUsers)) : configuredRecipients)),
  ].map(email).filter(Boolean))];
};

export const renderEventReportEmail = (report = {}, { emailBrief = null } = {}) => {
  const sections = eventReportEmailSections(report).map(([title, fields]) => {
    const rows = fields.map(([key, label], index) => {
      const raw = eventReportAnswer(report, key);
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
  const brief = emailBrief?.summary ? `<tr><td style="padding:16px 28px 4px;font-family:Arial,sans-serif">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f3f1e9" style="border-left:4px solid #c8aa62;background:#f3f1e9"><tr><td style="padding:14px 16px">
      <div style="font-size:11px;font-weight:bold;letter-spacing:1px;color:#756b55">AI QUICK SUMMARY</div>
      <p style="margin:8px 0;font-size:14px;line-height:21px;color:#20272c">${escapeHtml(emailBrief.summary)}</p>
      ${emailBrief.attention?.length ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#fff0ef" style="margin:12px 0;background-color:#fff0ef;border:1px solid #dfaaa5;border-left:4px solid #b42318"><tr><td style="padding:12px 14px;font-family:Arial,sans-serif;color:#9b1c13">
        <div style="font-size:13px;line-height:18px;font-weight:bold;color:#9b1c13">NEEDS ATTENTION</div>
        ${emailBrief.attention.map((item) => `<p style="margin:8px 0 0;font-size:14px;line-height:21px;color:#9b1c13">${escapeHtml(item)}</p>`).join('')}
      </td></tr></table>` : ''}
      <div style="font-size:11px;color:#756b55">Based on the submitted report. Full responses below.</div>
    </td></tr></table>
  </td></tr>` : '';
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
          ${brief}
          <tr><td style="padding:0 28px 24px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse">${sections}</table>${reportPhotoEmailContent(report).html}</td></tr>
          <tr><td bgcolor="#172129" align="center" style="padding:16px 24px;font-family:Arial,sans-serif;font-size:11px;line-height:16px;color:#cfd6da">Generated by OCC Event Operations &nbsp;&bull;&nbsp; Saved with the event</td></tr>
        </table>
      </td></tr>
    </table>
  </body></html>`;
};

export const renderEventReportText = (report = {}, { emailBrief = null } = {}) => {
  const sections = eventReportEmailSections(report).map(([title, fields]) => {
    const rows = fields.map(([key, label]) => {
      const raw = eventReportAnswer(report, key);
      return `${label}: ${clean(raw) || '—'}`;
    }).join('\n');
    return `${title}\n${rows}`;
  }).join('\n\n');
  const brief = emailBrief?.summary ? `AI QUICK SUMMARY\n${clean(emailBrief.summary)}\n${(emailBrief.attention || []).map((item) => `Needs attention: ${clean(item)}`).join('\n')}\nBased on the submitted report. Full responses below.\n\n` : '';
  return `${emailReportTitle(report).toUpperCase()}\n${clean(report.eventTitle) || '—'} · ${formatEventDate(report.eventDate) || '—'}\n${clean(report.reporterName) || '—'} · ${clean(report.position) || '—'}\n\n${brief}${sections}${reportPhotoEmailContent(report).text}`;
};

export const sendEventReportEmail = async ({ report, event, configuredRecipients = [], fetchImpl = fetch, loadSlackUsers = listSlackUsers, loadTeams = loadReportTeamDirectory, generateBrief = generateEventReportEmailBrief }) => {
  const isTest = event?.meta?.eventReportTest === true;
  const kitchen = report?.reportType === 'kitchen';
  const baseRecipients = kitchen
    ? [email(process.env.LEAD_CHEF_REPORT_EMAIL) || 'leadchefreport@ocnyc.com']
    : CAPTAIN_REPORT_RECIPIENTS;
  const fallbackRecipients = kitchen ? configuredRecipients.filter((address) => !CAPTAIN_REPORT_RECIPIENTS.includes(email(address))) : configuredRecipients;
  let teamRecipients = null;
  if (!isTest) {
    try {
      const routing = resolveTeamRouting({ event, salesRep: report?.salesRep, ...await loadTeams() });
      if (routing.status === 'blocked') throw new Error(routing.issues.join('; '));
      if (routing.status === 'ready') teamRecipients = [...baseRecipients, ...routing.recipients];
    } catch (error) {
      return { status: 'failed', recipients: [], cc: [], error: clean(error?.message || 'Could not resolve the report team', 1000) };
    }
  }
  let slackUsers = [];
  if (!teamRecipients && !isTest && salesTeamNames(report?.salesRep).length) {
    try {
      slackUsers = await loadSlackUsers();
      captainReportRecipients(report?.salesRep, fallbackRecipients, slackUsers, baseRecipients);
    } catch (error) {
      return { status: 'failed', recipients: [], cc: [], error: clean(error?.message || 'Could not resolve the report sales team', 1000) };
    }
  }
  const to = [...new Set((isTest
    ? ['ivan@ocnyc.com', 'iurie@ocnyc.com']
    : (teamRecipients || captainReportRecipients(report?.salesRep, fallbackRecipients, slackUsers, baseRecipients))
  ).map(email).filter(Boolean))];
  if (!to.length) return { status: 'not_sent', recipients: [], cc: [], error: '' };
  const reporterEmail = email(report?.reporterEmail);
  const cc = reporterEmail && !to.includes(reporterEmail) ? [reporterEmail] : [];
  const apiKey = clean(process.env.RESEND_API_KEY, 1000);
  if (!apiKey) return { status: 'failed', recipients: to, cc, error: 'RESEND_API_KEY is not configured' };
  let emailBrief = null;
  if (report?.status === 'submitted') {
    try {
      emailBrief = validateEmailBrief(await generateBrief({ report, fetchImpl }));
    } catch (error) {
      console.warn('Event report email AI summary unavailable:', clean(error?.message, 300));
    }
  }
  const photoData = report.photos?.some((photo) => photo.url) ? [] : await loadReportPhotoData(report);
  const response = await fetchImpl('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: clean(process.env.EVENT_REPORT_FROM, 320) || 'Staffing and Service Department <reports@reports.occdecks.com>',
      to,
      ...(cc.length ? { cc } : {}),
      subject: `${emailReportTitle(report)} · ${clean(report.eventTitle, 300)} · ${clean(report.reporterName, 200)}`,
      ...(photoData.length ? { attachments: report.photos.map((photo, index) => ({ filename: photo.fileName, content: photoData[index], content_type: photo.contentType })) } : {}),
      html: renderEventReportEmail(report, { emailBrief }),
      text: renderEventReportText(report, { emailBrief }),
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.id) {
    return { status: 'failed', recipients: to, cc, error: clean(payload?.message || `Resend HTTP ${response.status}`, 1000) };
  }
  return { status: 'sent', providerId: clean(payload.id, 200), sentAt: new Date(), recipients: to, cc, error: '' };
};
