import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeEventReports, eventReportAnalysisInput, normalizeEventReportAnalysis } from '../utils/eventReportAi.js';

test('event report AI input includes labeled captain and kitchen answers', () => {
  const input = eventReportAnalysisInput({
    event: { title: 'Report testing', date: '2026-09-25' },
    reports: [
      { reportType: 'captain', reporterName: 'Ivan', answers: { staffingComments: 'All good' } },
      { reportType: 'kitchen', reporterName: 'Chef', answers: { foodQuality: 'Excellent' } },
    ],
  });
  assert.equal(input.reports.length, 2);
  assert.ok(input.reports[0].answers.some((entry) => entry.question === 'Staffing comments' && entry.answer === 'All good'));
  assert.ok(input.reports[1].answers.some((entry) => entry.question === 'Food quality' && entry.answer === 'Excellent'));
});

test('event report AI normalizes bounded structured output', () => {
  const result = normalizeEventReportAnalysis({
    summary: 'Good event', positives: ['Strong team'],
    problems: [{ title: 'Late service', severity: 'urgent', detail: 'Dinner ran late', evidence: ['Captain'] }],
    risks: ['Repeat timing issue'], recommendations: ['Confirm timing'],
  });
  assert.equal(result.summary, 'Good event');
  assert.equal(result.problems[0].severity, 'medium');
  assert.deepEqual(result.recommendations, ['Confirm timing']);
});

test('event report AI calls Responses API with structured output', async () => {
  let request;
  const fetchImpl = async (url, options) => {
    request = { url, options };
    return { ok: true, json: async () => ({ output: [{ content: [{ type: 'output_text', text: JSON.stringify({
      summary: 'Service completed successfully', positives: [], problems: [], risks: [], recommendations: [],
    }) }] }] }) };
  };
  const result = await analyzeEventReports({ event: { title: 'Test' }, reports: [], apiKey: 'secret', fetchImpl });
  assert.equal(request.url, 'https://api.openai.com/v1/responses');
  const body = JSON.parse(request.options.body);
  assert.equal(body.text.format.type, 'json_schema');
  assert.equal(result.analysis.summary, 'Service completed successfully');
  assert.ok(!request.options.body.includes('secret'));
});
