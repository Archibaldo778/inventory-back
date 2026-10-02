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

test('new captain and kitchen report emails generate a short AI brief and preserve normal recipients and full answers', async (t) => {
  const previousResend = process.env.RESEND_API_KEY;
  const previousOpenAI = process.env.OPENAI_API_KEY;
  process.env.RESEND_API_KEY = 'test-resend';
  process.env.OPENAI_API_KEY = 'test-openai';
  t.after(() => {
    if (previousResend === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = previousResend;
    if (previousOpenAI === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previousOpenAI;
  });
  for (const reportType of ['captain', 'kitchen']) {
    const requests = [];
    const report = {
      status: 'submitted', reportType, eventTitle: 'New event', reporterName: 'Reporter',
      reporterEmail: 'reporter@example.com', salesRep: 'Olivier Cheng',
      answers: { overallFeedback: 'Good service.', overallEvaluation: 'Good service.' },
    };
    const result = await sendEventReportEmail({
      report, event: {}, configuredRecipients: ['kitchen-manager@example.com'],
      loadTeams: async () => ({ teams: [], users: [] }),
      fetchImpl: async (url, options) => {
        const body = JSON.parse(options.body);
        requests.push({ url, body });
        if (url === 'https://api.openai.com/v1/responses') {
          assert.equal(JSON.parse(body.input).reports[0].type, reportType === 'kitchen' ? 'Kitchen Report' : "Captain's Report");
          return { ok: true, json: async () => ({ output_text: JSON.stringify({ summary: 'Good service was reported.', attention: [] }) }) };
        }
        assert.equal(url, 'https://api.resend.com/emails');
        return { ok: true, json: async () => ({ id: 'sent-with-ai' }) };
      },
    });
    assert.equal(result.status, 'sent');
    assert.equal(requests.length, 2);
    const email = requests[1].body;
    assert.match(email.html, /AI QUICK SUMMARY/);
    assert.match(email.html, /Good service was reported\./);
    assert.match(email.text, /Good service was reported\./);
    assert.match(email.text, /Good service\./);
    assert.doesNotMatch(email.html, /NEEDS ATTENTION/);
    assert.doesNotMatch(email.subject, /PREVIEW/);
    assert.deepEqual(email.to, [
      ...(reportType === 'kitchen' ? ['leadchefreport@ocnyc.com'] : CAPTAIN_REPORT_RECIPIENTS), 'olivier@ocnyc.com', 'heidi@ocnyc.com', 'sebastian@ocnyc.com', 'ashley@ocnyc.com',
    ]);
    assert.deepEqual(email.cc, ['reporter@example.com']);
    assert.equal(email.bcc, undefined);
  }
});

test('reported issues appear in a red attention panel and remain readable in plain text', () => {
  const report = { answers: { staffBelowStandards: 'Two staff arrived late.' } };
  const emailBrief = { summary: 'Service had staffing issues.', attention: ['Two staff arrived late.', 'Client requested follow-up about <staffing>.'] };
  const html = renderEventReportEmail(report, { emailBrief });
  const text = renderEventReportText(report, { emailBrief });
  assert.match(html, /bgcolor="#fff0ef"[^>]*border-left:4px solid #b42318/);
  assert.match(html, /font-weight:bold;color:#9b1c13">NEEDS ATTENTION/);
  assert.match(html, /color:#9b1c13">Two staff arrived late\./);
  assert.match(html, /Client requested follow-up about &lt;staffing&gt;/);
  assert.match(text, /Needs attention: Two staff arrived late\./);
  assert.match(text, /Needs attention: Client requested follow-up about <staffing>\./);
  assert.match(text, /Staff below standards: Two staff arrived late\./);
});

test('AI failure, timeout or invalid summary still sends the complete report once', async (t) => {
  const previous = process.env.RESEND_API_KEY;
  process.env.RESEND_API_KEY = 'test-key';
  t.after(() => { if (previous === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = previous; });
  for (const generateBrief of [
    async () => { throw new Error('OpenAI API key is not configured'); },
    async () => { throw new Error('Upstream request timed out'); },
    async () => ({ summary: '', attention: [] }),
    async () => ({ summary: 'Good', attention: 'not an array' }),
  ]) {
    const sent = [];
    const result = await sendEventReportEmail({
      report: { status: 'submitted', reportType: 'kitchen', salesRep: 'Example Sales', reporterEmail: 'chef@example.com', answers: { overallEvaluation: 'Full report preserved.' } },
      event: {}, configuredRecipients: ['manager@example.com'], generateBrief,
      loadTeams: async () => ({ teams: [], users: [] }),
      fetchImpl: async (_url, options) => { sent.push(JSON.parse(options.body)); return { ok: true, json: async () => ({ id: 'fallback-email' }) }; },
    });
    assert.equal(result.status, 'sent');
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0].to, ['leadchefreport@ocnyc.com', 'manager@example.com']);
    assert.deepEqual(sent[0].cc, ['chef@example.com']);
    assert.match(sent[0].text, /Full report preserved\./);
    assert.doesNotMatch(sent[0].html, /AI QUICK SUMMARY|NEEDS ATTENTION/);
  }
});

test('no recipient or blocked routing never triggers AI generation or email delivery', async () => {
  for (const report of [
    { status: 'submitted', reportType: 'kitchen' },
    { status: 'submitted', reportType: 'captain', salesRep: 'George' },
  ]) {
    const result = await sendEventReportEmail({
      report, event: {}, configuredRecipients: [],
      loadTeams: async () => ({ teams: [], users: [] }), loadSlackUsers: async () => [],
      generateBrief: async () => { assert.fail('No AI generation without valid recipients'); },
      fetchImpl: async () => { assert.fail('No email without valid recipients'); },
    });
    assert.notEqual(result.status, 'sent');
  }
});
