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
      loadTeams: async () => ({ teams: [], users: [] }),
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
    captainReportRecipients('Emma', ['configured-team@example.com']),
    ['captainreport@ocnyc.com', 'configured-team@example.com'],
  );
});

const salesDirectory = [
  { id: 'U_GEORGE', profile: { real_name: 'George Smith', email: 'george.office@example.com' } },
  { id: 'U_MEGAN', profile: { real_name: 'Megan Jones', email: 'megan.office@example.com' } },
  { id: 'U_GUILLAUME', profile: { real_name: 'Guillaume Darriet', email: 'guillaume.office@example.com' } },
];

test('George reports include George and Megan using their directory emails, without unrelated recipients', () => {
  for (const salesRep of ['George', ' George Smith ', 'GEORGE SMITH']) {
    assert.deepEqual(captainReportRecipients(salesRep, ['unrelated@example.com'], salesDirectory), [
      ...CAPTAIN_REPORT_RECIPIENTS, 'george.office@example.com', 'megan.office@example.com',
    ]);
  }
});

test('Guillaume reports include Guillaume without an assistant', () => {
  for (const salesRep of ['Guillaume', 'Guillaume Darriet']) {
    assert.deepEqual(captainReportRecipients(salesRep, ['unrelated@example.com'], salesDirectory), [
      ...CAPTAIN_REPORT_RECIPIENTS, 'guillaume.office@example.com',
    ]);
  }
});

test('sales team resolution rejects missing, inactive and ambiguous people', () => {
  assert.throws(() => captainReportRecipients('George', [], salesDirectory.filter((user) => user.id !== 'U_MEGAN')), /no email address found for Megan/);
  assert.throws(() => captainReportRecipients('George', [], [...salesDirectory, { id: 'U_OTHER_MEGAN', profile: { real_name: 'Megan Other', email: 'another@example.com' } }]), /multiple email addresses found for Megan/);
  assert.throws(() => captainReportRecipients('Guillaume', [], salesDirectory.map((user) => ({ ...user, deleted: true }))), /no email address found/);
  assert.throws(() => captainReportRecipients('George Different', [], salesDirectory), /no email address found for George Different/);
});

test('George and Guillaume delivery preserves the central mailbox and captain CC', async (t) => {
  const previousKey = process.env.RESEND_API_KEY;
  process.env.RESEND_API_KEY = 'test-key';
  t.after(() => { if (previousKey === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = previousKey; });
  for (const salesRep of ['George Smith', 'Guillaume Darriet']) {
    let request;
    const result = await sendEventReportEmail({
      loadTeams: async () => ({ teams: [], users: [] }),
      report: { reportType: 'captain', salesRep, reporterEmail: 'captain@example.com' },
      event: {},
      loadSlackUsers: async () => salesDirectory,
      fetchImpl: async (_url, options) => { request = JSON.parse(options.body); return { ok: true, json: async () => ({ id: 'test-email' }) }; },
    });
    assert.equal(result.status, 'sent');
    assert.deepEqual(request.to, captainReportRecipients(salesRep, [], salesDirectory));
    assert.deepEqual(request.cc, ['captain@example.com']);
    assert.deepEqual(result.recipients, request.to);
  }
});

test('missing team or unavailable directory reports delivery failure without sending to a partial list', async () => {
  for (const loadSlackUsers of [async () => [], async () => { throw new Error('Slack unavailable'); }]) {
    let sent = false;
    const result = await sendEventReportEmail({
      loadTeams: async () => ({ teams: [], users: [] }),
      report: { reportType: 'captain', salesRep: 'George Smith' }, event: {}, loadSlackUsers,
      fetchImpl: async () => { sent = true; throw new Error('Must not send'); },
    });
    assert.equal(result.status, 'failed');
    assert.ok(result.error);
    assert.deepEqual(result.recipients, []);
    assert.equal(sent, false);
  }
});

test('test events never resolve or email the sales team', async (t) => {
  const previousKey = process.env.RESEND_API_KEY;
  process.env.RESEND_API_KEY = 'test-key';
  t.after(() => { if (previousKey === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = previousKey; });
  let request;
  const result = await sendEventReportEmail({
      loadTeams: async () => ({ teams: [], users: [] }),
    report: { reportType: 'captain', salesRep: 'George Smith' }, event: { meta: { eventReportTest: true } },
    loadSlackUsers: async () => { assert.fail('Test events must not load sales team recipients'); },
    fetchImpl: async (_url, options) => { request = JSON.parse(options.body); return { ok: true, json: async () => ({ id: 'test-email' }) }; },
  });
  assert.equal(result.status, 'sent');
  assert.deepEqual(request.to, ['ivan@ocnyc.com', 'iurie@ocnyc.com']);
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
      loadTeams: async () => ({ teams: [], users: [] }),
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
