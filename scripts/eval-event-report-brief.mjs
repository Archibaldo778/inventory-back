// Opt-in live model check: OPENAI_API_KEY=... node scripts/eval-event-report-brief.mjs
// Uses fixtures only. No database access and no email delivery.
import { generateEventReportEmailBrief } from '../utils/eventReportEmailBrief.js';
import { briefEvaluationCases } from '../test/fixtures/eventReportBriefCases.js';

if (!process.env.OPENAI_API_KEY) {
  console.error('OPENAI_API_KEY is required for live summary evaluation.');
  process.exitCode = 1;
} else {
  for (const sample of briefEvaluationCases) {
    try {
      const brief = await generateEventReportEmailBrief({ report: sample.report });
      const text = [brief.summary, ...brief.attention].join(' ');
      const missing = sample.required.filter((rule) => !new RegExp(rule.pattern, 'i').test(rule.field === 'attention' ? brief.attention.join(' ') : text)).map((rule) => rule.label);
      if (sample.noAttention && brief.attention.length) missing.push('unexpected attention item');
      console.log(JSON.stringify({ case: sample.name, passed: !missing.length, missing, brief }));
      if (missing.length) process.exitCode = 1;
    } catch (error) {
      console.error(JSON.stringify({ case: sample.name, passed: false, error: error.message })); process.exitCode = 1;
    }
  }
  console.log('Review the generated text as well: keyword checks do not prove factual accuracy or completeness.');
}
