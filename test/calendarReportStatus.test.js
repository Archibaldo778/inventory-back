import test from 'node:test';
import assert from 'node:assert/strict';
import CalendarReportStatus from '../models/CalendarReportStatus.js';

test('calendar email status keeps manual values and per-field audit details', () => {
  const changedAt = new Date('2026-09-18T12:00:00Z');
  const status = new CalendarReportStatus({
    eventKey: '00001-00000000022842',
    externalId: 'E22842',
    sr: {
      value: 'Rev2',
      updatedAt: changedAt,
      updatedBy: 'Sales User',
      updatedById: 'user-1',
    },
  });
  const validation = status.validateSync();
  assert.equal(validation, undefined);
  assert.equal(status.sr.value, 'Rev2');
  assert.equal(status.sr.updatedBy, 'Sales User');
  assert.equal(status.km.value, '');
  assert.equal(status.po.value, '');
});
