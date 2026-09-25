import test from 'node:test';
import assert from 'node:assert/strict';
import { EVENT_REPORT_EMAIL_SECTIONS, renderEventReportEmail, renderEventReportText, sendEventReportEmail } from '../utils/eventReportEmail.js';

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
