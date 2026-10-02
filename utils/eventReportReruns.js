export const EVENT_REPORT_RERUN_GUIDANCE = [
  'Re-runs are additional trips or purchases to supply an event. No re-runs is a positive operational outcome: no extra trip was reported for that reporter’s part of the work.',
  'The standard answer "No re-runs that I am aware of" is not a problem, risk, evidence gap or reason to request reconciliation. Never put that answer alone in problems, risks, recommendations or attention.',
  'Each captain or chef reports their own area of responsibility and awareness, not an exhaustive event-wide transport audit. Attribute re-run observations to the named reporter.',
  'Several captains may work the same event: one can report re-runs while another reports none. These answers are compatible, not a contradiction or a reporting failure. Preserve both accounts without treating the no-re-run answer as an event-wide claim.',
  'When re-runs are reported, describe only the stated reason, items and impact. An additional trip alone does not prove someone forgot supplies; flag problems only when supported by the reported circumstances.',
  'Do not infer that every item was supplied correctly, that the entire event had no re-runs, or any fuel/cost amount from a single no-re-run answer. Missing or N/A answers are not evidence of either success or failure.',
].join(' ');

export const eventReportRerunContext = (report) => {
  const answer = String(report?.answers?.rerunsOrPurchases || '').trim().toLowerCase();
  const status = ['no re-runs that i am aware of', 'no'].includes(answer)
    ? 'none_reported'
    : ['yes, there were re-runs', 'yes'].includes(answer) ? 'reported' : 'unspecified';
  return {
    scope: 'individual_reporter',
    status,
    assessment: status === 'none_reported' ? 'positive_for_reporter_scope'
      : status === 'reported' ? 'assess_stated_reason_and_impact' : 'no_conclusion',
  };
};
