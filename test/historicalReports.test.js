import test from 'node:test';
import assert from 'node:assert/strict';
import {
  historicalReportMetadata,
  inferHistoricalReportDate,
  inferHistoricalReportType,
  normalizedHistoricalEventTitle,
} from '../utils/historicalReports.js';

test('historical report metadata handles old event report paths without an Event record', () => {
  const metadata = historicalReportMetadata({
    name: '09-25-2023 Smith Wedding Captain Report.pdf',
    path_display: '/Operations christopher@ocnyc.com/Reports/2023/09-25-2023 Smith Wedding Captain Report.pdf',
  }, '/Operations christopher@ocnyc.com/Reports');
  assert.equal(metadata.inferredDate, '2023-09-25');
  assert.equal(metadata.inferredYear, 2023);
  assert.equal(metadata.inferredTitle, 'Smith Wedding');
  assert.equal(metadata.reportType, 'captain');
  assert.equal(metadata.supported, true);
});

test('historical report inference recognizes common dates and report types', () => {
  assert.equal(inferHistoricalReportDate('/Reports/2022/7.4.22 Kitchen Evaluation.xlsx'), '2022-07-04');
  assert.equal(inferHistoricalReportDate('/Reports/2021/2021-12-31 report.pdf'), '2021-12-31');
  assert.equal(inferHistoricalReportType('Lead Chef Event Evaluation Form'), 'kitchen');
  assert.equal(normalizedHistoricalEventTitle('The Smith & Jones Party'), 'smith and jones');
});
