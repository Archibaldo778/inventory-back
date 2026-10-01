import test from 'node:test';
import assert from 'node:assert/strict';
import { CAPTAIN_REPORT_RECIPIENTS, EVENT_REPORT_EMAIL_SECTIONS, KITCHEN_REPORT_EMAIL_SECTIONS, captainReportRecipients, renderEventReportEmail, renderEventReportText, sendEventReportEmail } from '../utils/eventReportEmail.js';

test('captain report email renders every report section and escapes answers', () => {
  const html = renderEventReportEmail({ eventTitle: '<Test>', reporterName: 'Ivan', answers: { overallFeedback: '<script>alert(1)</script>' } });
  assert.equal(EVENT_REPORT_EMAIL_SECTIONS.length, 6);
  EVENT_REPORT_EMAIL_SECTIONS.forEach(([title]) => assert.ok(html.includes(title.replace("'", '&#39;'))));
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /width="640"/);
  assert.match(html, /role="presentation"/);
  assert.match(renderEventReportText({ eventTitle: 'Test', answers: { overallFeedback: 'All good' } }), /Overall feedback: All good/);
});

test('production captain reports route to the event sales team and copy the captain', async () => {
  const previousKey = process.env.RESEND_API_KEY;
  process.env.RESEND_API_KEY = 'test-key';
  let request;
  try {
    await sendEventReportEmail({
      event: { meta: {} },
      report: { reportType: 'captain', eventTitle: 'Maison Madison', reporterName: 'Captain', reporterEmail: 'captain@ocnyc.com', salesRep: 'Olivier Cheng', answers: {} },
      configuredRecipients: ['old-list@ocnyc.com'],
      fetchImpl: async (_url, options) => { request = JSON.parse(options.body); return { ok: true, json: async () => ({ id: 'email_456' }) }; },
    });
    assert.deepEqual(request.to, [
      ...CAPTAIN_REPORT_RECIPIENTS,
      'olivier@ocnyc.com',
      'heidi@ocnyc.com',
      'sebastian@ocnyc.com',
      'ashley@ocnyc.com',
    ]);
    assert.deepEqual(request.cc, ['captain@ocnyc.com']);
    assert.match(request.from, /Staffing and Service Department/);
  } finally {
    if (previousKey === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = previousKey;
  }
});

test('captain report keeps the central mailbox and configured team for other sales managers', () => {
  assert.deepEqual(
    captainReportRecipients('George Henderson', ['george-team@ocnyc.com', 'megan-team@ocnyc.com']),
    ['captainreport@ocnyc.com', 'george-team@ocnyc.com', 'megan-team@ocnyc.com'],
  );
});

test('kitchen report email uses the kitchen template', () => {
  const html = renderEventReportEmail({ reportType: 'kitchen', eventTitle: 'Kitchen Test', reporterName: 'Chef', answers: { overallEvaluation: 'Successful service' } });
  assert.equal(KITCHEN_REPORT_EMAIL_SECTIONS.length, 4);
  assert.match(html, /Kitchen Report/);
  assert.match(html, /Service \/ Kitchen/);
  assert.match(html, /Successful service/);
  assert.doesNotMatch(html, /Sanitation \/ Rentals/);
});

test('test report email uses fixed OCC recipients and copies the Slack email', async () => {
  const previousKey = process.env.RESEND_API_KEY;
  process.env.RESEND_API_KEY = 'test-key';
  let request;
  try {
    const result = await sendEventReportEmail({
      event: { meta: { eventReportTest: true } },
      report: { eventTitle: 'Report testing', reporterName: 'Ivan', reporterEmail: 'Personal@Example.com', answers: {} },
      fetchImpl: async (_url, options) => { request = JSON.parse(options.body); return { ok: true, json: async () => ({ id: 'email_123' }) }; },
    });
    assert.equal(result.status, 'sent');
    assert.deepEqual(request.to, ['ivan@ocnyc.com', 'iurie@ocnyc.com']);
    assert.deepEqual(request.cc, ['personal@example.com']);
    assert.match(request.text, /CAPTAIN'S REPORT/);
  } finally {
    if (previousKey === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = previousKey;
  }
});
