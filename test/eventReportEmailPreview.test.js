import test from 'node:test';
import assert from 'node:assert/strict';
import { generateEventReportEmailBrief, validateEmailBrief } from '../utils/eventReportEmailBrief.js';
import { buildReportPreviewPayload, runEventReportEmailPreview } from '../utils/eventReportEmailPreviews.js';
import { renderEventReportEmail, renderEventReportText } from '../utils/eventReportEmail.js';
import { readinessReport, briefEvaluationCases, evaluateBrief } from './fixtures/eventReportBriefCases.js';

const report = {
  _id: 'report-1', status: 'submitted', reportType: 'captain', eventTitle: 'Prada Day 1',
  reporterName: 'Christian', reporterEmail: 'captain@example.com', salesRep: 'Olivier Cheng',
  emailDelivery: { status: 'sent', recipients: ['management@example.com'], cc: ['captain@example.com'] },
  answers: { overallFeedback: 'Client happy.', prepWorkTimeAdded: 'Yes', prepWorkTimeComments: '30 minutes of prep time' },
};
const user = { _id: 'admin-1', email: 'reviewer@example.com', role: 'admin', isActive: true };
const brief = { summary: 'The client was happy. An additional 30 minutes of prep time was reported.', attention: [] };

test('live brief evaluation catches a routine service answer incorrectly flagged as a problem', () => {
  const sample = briefEvaluationCases[0];
  const valid = { summary: 'Guests were happy despite lower turnout.', attention: [
    'The work area was cluttered; Alex cleared it and Jordan helped.',
    'PIB was excessive; the chef estimated supplies could cover both days and noted the refrigerator.',
  ] };
  assert.deepEqual(evaluateBrief(sample, valid), []);
  assert.deepEqual(evaluateBrief(sample, { ...valid, attention: [...valid.attention,
    'The report indicates there was no choice of entree service. No further impact was stated.',
  ] }), ['routine entree format flagged as a problem']);
  assert.ok(evaluateBrief(sample, { ...valid, attention: valid.attention.slice(1) }).includes('site not ready'));
  assert.deepEqual(evaluateBrief(briefEvaluationCases[1], { summary: 'Guests were happy.', attention: [] }), []);
  assert.deepEqual(evaluateBrief(briefEvaluationCases[1], { summary: 'Guests were happy.', attention: ['No re-runs.'] }), ['unexpected attention item']);
});

test('AI brief uses only the selected submitted report and accepts structured output', async () => {
  let body;
  const result = await generateEventReportEmailBrief({ report, apiKey: 'test', fetchImpl: async (_url, options) => {
    body = JSON.parse(options.body);
    return { ok: true, json: async () => ({ output: [{ content: [{ type: 'output_text', text: JSON.stringify(brief) }] }] }) };
  } });
  assert.equal(result.summary, brief.summary);
  assert.deepEqual(result.attention, []);
  assert.equal(body.text.format.strict, true);
  assert.equal(body.store, false);
  const input = JSON.parse(body.input);
  assert.equal(input.reports.length, 1);
  assert.equal(input.reports[0].reporter, 'Christian');
  assert.ok(input.reports[0].answers.some((answer) => answer.answer === '30 minutes of prep time'));
  assert.doesNotMatch(body.input, /management@example.com|captain@example.com/);
});

test('AI failures, refusals, drafts and oversized output cannot become an email brief', async () => {
  await assert.rejects(generateEventReportEmailBrief({ report: { ...report, status: 'draft' }, apiKey: 'test' }), /submitted/);
  for (const response of [
    { ok: false, status: 500, json: async () => ({}) },
    { ok: true, status: 200, json: async () => ({ status: 'incomplete', output_text: JSON.stringify(brief) }) },
    { ok: true, json: async () => ({ output: [{ content: [{ type: 'refusal', refusal: 'No' }] }] }) },
  ]) {
    await assert.rejects(generateEventReportEmailBrief({ report, apiKey: 'test', fetchImpl: async () => response }));
  }
  for (const value of [{}, { ...brief, summary: 'a'.repeat(1001) }, { ...brief, summary: 'word '.repeat(151) }, { ...brief, attention: ['a'.repeat(501)] }, { ...brief, attention: [''] }]) {
    assert.throws(() => validateEmailBrief(value));
  }
});

test('briefs can preserve more than two issues within a shared 150-word limit', () => {
  const expanded = { summary: Array(90).fill('outcome').join(' '), attention: ['Setup required clearing.', 'Equipment needed replacement.', 'Food was excessive.'] };
  assert.deepEqual(validateEmailBrief(expanded), expanded);
  assert.deepEqual(validateEmailBrief({ summary: Array(147).fill('ok').join(' '), attention: ['one', 'two', 'three'] }).attention, ['one', 'two', 'three']);
  assert.throws(() => validateEmailBrief({ summary: Array(148).fill('ok').join(' '), attention: ['one', 'two', 'three'] }));
});

test('kitchen brief receives all reported context and retains long staff comments through the email renderer', async () => {
  const source = structuredClone(readinessReport);
  source.answers.staffComments = `${'The staff worked together. '.repeat(85)}${source.answers.staffComments}`;
  const before = structuredClone(source);
  const expected = {
    summary: 'Service was on time and guests were happy, although turnout was lower than planned. The chef reported no re-runs or overtime and 30 minutes of added prep.',
    attention: [
      'The work area was cluttered with bicycles and boxes on arrival; Alex organized clearing it and Jordan helped with heavy lifting.',
      'Food, especially PIB, was excessive. The chef estimated day-one supplies could cover both days and noted the onsite refrigerator.',
    ],
  };
  const output = await generateEventReportEmailBrief({ report: source, apiKey: 'test', fetchImpl: async (_url, options) => {
    const request = JSON.parse(options.body);
    const input = JSON.parse(request.input).reports[0];
    for (const value of [source.answers.staffComments, source.answers.foodEnough, source.answers.overallEvaluation]) {
      assert.ok(input.answers.some((entry) => entry.answer === value));
    }
    assert.equal(input.reruns.status, 'none_reported');
    return { ok: true, json: async () => ({ output_text: JSON.stringify(expected) }) };
  } });
  assert.deepEqual(validateEmailBrief(output), expected);
  const email = renderEventReportText(source, { emailBrief: output });
  for (const item of expected.attention) assert.ok(email.includes(`Needs attention: ${item}`));
  assert.ok(email.includes(source.answers.staffComments));
  assert.deepEqual(source, before);
});

test('preview contains the brief and full report with exactly one recipient, no manager or captain copies', () => {
  const before = structuredClone(report);
  const payload = buildReportPreviewPayload({ report, user, brief });
  assert.deepEqual(payload.to, [user.email]);
  assert.equal(payload.cc, undefined);
  assert.equal(payload.bcc, undefined);
  assert.match(payload.subject, /^\[PREVIEW\].*Prada Day 1.*Christian/);
  assert.match(payload.html, /AI QUICK SUMMARY/);
  assert.match(payload.text, /AI QUICK SUMMARY/);
  assert.match(payload.text, /Overall feedback: Client happy\./);
  assert.ok(payload.text.indexOf('AI QUICK SUMMARY') < payload.text.indexOf('Staff\n'));
  assert.doesNotMatch(payload.html, /NEEDS ATTENTION/);
  assert.deepEqual(report, before);
  assert.doesNotMatch(renderEventReportEmail(report), /AI QUICK SUMMARY/);
  assert.doesNotMatch(renderEventReportText(report), /AI QUICK SUMMARY/);
});

test('preview escapes AI output and displays significant issues without altering answers', () => {
  const payload = buildReportPreviewPayload({ report, user, brief: { summary: '<script>bad</script>', attention: ['Broken <glass>'] } });
  assert.doesNotMatch(payload.html, /<script>|<glass>/);
  assert.match(payload.html, /&lt;script&gt;/);
  assert.match(payload.html, /NEEDS ATTENTION/);
  assert.match(payload.html, /Broken &lt;glass&gt;/);
  assert.match(payload.text, /Overall feedback: Client happy\./);
});

const harness = ({ jobChanges = {}, userChanges = {}, generateBrief = async () => brief, sendError = null } = {}) => {
  const job = { _id: 'preview-1', reportId: report._id, reportSnapshot: structuredClone(report), requestedBy: user._id,
    recipient: user.email, status: 'queued', createdAt: new Date(), ...jobChanges };
  const requests = [];
  const Preview = {
    findOneAndUpdate(filter, update) {
      assert.deepEqual(filter, { status: 'queued' });
      const claimed = job.status === filter.status;
      if (claimed) Object.assign(job, update.$set);
      return { select: () => ({ lean: async () => claimed ? structuredClone(job) : null }) };
    },
    async updateOne(filter, update) {
      assert.equal(filter._id, job._id);
      assert.equal(job.status, filter.status);
      Object.assign(job, update.$set);
      return { matchedCount: 1 };
    },
  };
  const Users = { findById: (id) => { assert.equal(id, user._id); return { select: () => ({ lean: async () => ({ ...user, ...userChanges }) }) }; } };
  const run = () => runEventReportEmailPreview({ Preview, Users, generateBrief, apiKey: 'test', fetchImpl: async (_url, options) => {
    requests.push({ payload: JSON.parse(options.body), key: options.headers['Idempotency-Key'] });
    if (sendError) throw sendError;
    return { ok: true, json: async () => ({ id: 'provider-1' }) };
  } });
  return { job, requests, run };
};

test('worker atomically claims only an explicit preview, records provider acceptance, never resends it', async () => {
  const h = harness();
  const results = await Promise.all([h.run(), h.run()]);
  assert.deepEqual(results.map((result) => result.status).sort(), ['idle', 'sent']);
  assert.equal(h.job.status, 'sent');
  assert.equal(h.job.providerId, 'provider-1');
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].key, 'event-report-preview:preview-1');
  assert.deepEqual(h.requests[0].payload.to, [user.email]);
  assert.deepEqual(h.job.reportSnapshot.emailDelivery, report.emailDelivery);
  assert.equal((await h.run()).status, 'idle');
});

test('worker rejects changed recipients, unauthorized accounts, stale requests and mismatched reports without sending', async () => {
  for (const options of [
    { jobChanges: { recipient: 'someone-else@example.com' } },
    { userChanges: { email: 'changed@example.com' } },
    { userChanges: { email: 'one@example.com,two@example.com' } },
    { userChanges: { role: 'captain' } },
    { userChanges: { isActive: false } },
    { jobChanges: { createdAt: new Date(Date.now() - 25 * 60 * 60_000) } },
    { jobChanges: { reportId: 'other-report' } },
    { jobChanges: { reportSnapshot: { ...report, status: 'draft' } } },
  ]) {
    const h = harness(options);
    assert.equal((await h.run()).status, 'failed');
    assert.equal(h.requests.length, 0);
  }
});

test('AI failure sends nothing; uncertain provider response is not retried automatically', async () => {
  const ai = harness({ generateBrief: async () => { throw new Error('AI unavailable'); } });
  assert.equal((await ai.run()).status, 'failed');
  assert.equal(ai.requests.length, 0);
  const mail = harness({ sendError: new Error('Timeout after provider accepted') });
  assert.equal((await mail.run()).status, 'failed');
  assert.equal((await mail.run()).status, 'idle');
  assert.equal(mail.requests.length, 1);
  const crashed = harness({ jobChanges: { status: 'processing' } });
  assert.equal((await crashed.run()).status, 'idle');
  assert.equal(crashed.requests.length, 0);
});
