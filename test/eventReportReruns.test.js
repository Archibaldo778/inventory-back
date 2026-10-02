import test from 'node:test';
import assert from 'node:assert/strict';
import { eventReportRerunContext, EVENT_REPORT_RERUN_GUIDANCE } from '../utils/eventReportReruns.js';
import { analyzeEventReports, eventReportAnalysisInput } from '../utils/eventReportAi.js';
import { generateEventReportEmailBrief } from '../utils/eventReportEmailBrief.js';

test('no re-runs is a positive observation limited to the reporting captain', () => {
  const report = { answers: { rerunsOrPurchases: 'No re-runs that I am aware of' } };
  assert.deepEqual(eventReportRerunContext(report), {
    scope: 'individual_reporter', status: 'none_reported', assessment: 'positive_for_reporter_scope',
  });
  assert.equal(eventReportRerunContext({ answers: { rerunsOrPurchases: ' NO ' } }).status, 'none_reported');
});

test('different captains keep separate re-run observations and supporting details', () => {
  const input = eventReportAnalysisInput({ reports: [
    { reporterName: 'Bar Captain', position: 'Captain', answers: { rerunsOrPurchases: 'No re-runs that I am aware of' } },
    { reporterName: 'Service Captain', position: 'Captain', answers: { rerunsOrPurchases: 'Yes, there were re-runs', rerunsDetails: 'One trip for additional glasses requested by the client.' } },
    { reportType: 'kitchen', reporterName: 'Lead Chef', answers: { rerunsOrPurchases: 'No re-runs that I am aware of' } },
  ] });
  assert.deepEqual(input.reports.map(({ reporter, reruns }) => [reporter, reruns.status, reruns.assessment]), [
    ['Bar Captain', 'none_reported', 'positive_for_reporter_scope'],
    ['Service Captain', 'reported', 'assess_stated_reason_and_impact'],
    ['Lead Chef', 'none_reported', 'positive_for_reporter_scope'],
  ]);
  assert.ok(input.reports.every((report) => report.reruns.scope === 'individual_reporter'));
  assert.ok(input.reports[1].answers.some((answer) => answer.answer === 'One trip for additional glasses requested by the client.'));
});

test('missing, N/A and free-text answers do not imply a positive or negative re-run outcome', () => {
  for (const answer of [undefined, '', 'N/A', 'Not sure', 'No re-runs for the bar, but a kitchen delivery was late']) {
    const report = { answers: { rerunsOrPurchases: answer, rerunsDetails: 'Keep these details available to the analyst.' } };
    assert.deepEqual(eventReportRerunContext(report), {
      scope: 'individual_reporter', status: 'unspecified', assessment: 'no_conclusion',
    });
    assert.ok(eventReportAnalysisInput({ reports: [report] }).reports[0].answers.some((entry) => entry.answer === report.answers.rerunsDetails));
  }
});

test('website and email AI requests share re-run guidance and reporter-scoped evidence', async () => {
  const report = { status: 'submitted', reportType: 'captain', reporterName: 'Captain', answers: { rerunsOrPurchases: 'No re-runs that I am aware of' } };
  const requests = [];
  const fetchImpl = async (_url, options) => {
    const request = JSON.parse(options.body);
    requests.push(request);
    const output = request.text.format.name === 'event_report_analysis'
      ? { summary: 'The captain reported no additional trips.', positives: ['No re-runs reported by this captain.'], problems: [], risks: [], recommendations: [] }
      : { summary: 'The captain reported no additional trips.', attention: [] };
    return { ok: true, json: async () => ({ output_text: JSON.stringify(output) }) };
  };
  await analyzeEventReports({ reports: [report], apiKey: 'test', fetchImpl });
  await generateEventReportEmailBrief({ report, apiKey: 'test', fetchImpl });
  assert.equal(requests.length, 2);
  for (const request of requests) {
    assert.ok(request.instructions.includes(EVENT_REPORT_RERUN_GUIDANCE));
    const input = JSON.parse(request.input);
    assert.equal(input.reports[0].reporter, 'Captain');
    assert.deepEqual(input.reports[0].reruns, {
      scope: 'individual_reporter', status: 'none_reported', assessment: 'positive_for_reporter_scope',
    });
    assert.ok(input.reports[0].answers.some((answer) => answer.answer === 'No re-runs that I am aware of'));
  }
});
