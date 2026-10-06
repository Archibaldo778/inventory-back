// Opt-in live model check: OPENAI_API_KEY=... node scripts/eval-event-report-brief.mjs
// Uses fixtures only. No database access and no email delivery.
import { generateEventReportEmailBrief } from '../utils/eventReportEmailBrief.js';
import { briefEvaluationCases, evaluateBrief } from '../test/fixtures/eventReportBriefCases.js';

if (!process.env.OPENAI_API_KEY) {
  console.error('OPENAI_API_KEY is required for live summary evaluation.');
  process.exitCode = 1;
} else {
  for (const sample of briefEvaluationCases) {
    try {
      const brief = await generateEventReportEmailBrief({ report: sample.report });
      const missing = evaluateBrief(sample, brief);
      console.log(JSON.stringify({ case: sample.name, passed: !missing.length, missing, brief }));
      if (missing.length) process.exitCode = 1;
    } catch (error) {
      console.error(JSON.stringify({ case: sample.name, passed: false, error: error.message })); process.exitCode = 1;
    }
  }
  console.log('Review the generated text as well: keyword checks do not prove factual accuracy or completeness.');
}
