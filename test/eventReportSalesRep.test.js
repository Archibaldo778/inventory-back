import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveEventSalesRep, resolveReportSalesRep } from '../utils/eventReportSalesRep.js';

test('captain reports resolve the account rep from Caterease and imported metadata', () => {
  for (const event of [
    { catereaseOperations: { salesRep: 'Olivier Cheng' } },
    { catereaseOperations: { snapshot: { salesRep: 'Olivier Cheng' } } },
    { meta: { salesRep: 'Olivier Cheng' } },
    { managerId: 'Olivier Cheng' },
    { meta: { catereaseSnapshot: { salesRep: 'Olivier Cheng' } } },
  ]) assert.equal(resolveEventSalesRep(event), 'Olivier Cheng');
  assert.equal(resolveEventSalesRep({ managerId: '   ', meta: { salesRep: ' Olivier Cheng ' } }), 'Olivier Cheng');
  assert.equal(resolveEventSalesRep({ salesRep: { name: 'Olivier Cheng' } }), 'Olivier Cheng');
});

test('current Dashboard representative takes priority over the stale bar report fallback', () => {
  assert.equal(resolveEventSalesRep({ catereaseOperations: { salesRep: 'Olivier Cheng' }, managerId: 'Old Rep' }, 'Old Bar Rep'), 'Olivier Cheng');
  assert.equal(resolveEventSalesRep({}, 'Existing Rep'), 'Existing Rep');
  assert.equal(resolveEventSalesRep(null), '');
});

test('pending reports refresh the rep while submitted reports preserve their recorded rep', () => {
  const event = { meta: { salesRep: 'Olivier Cheng' } };
  assert.equal(resolveReportSalesRep({ status: 'pending', salesRep: '' }, event), 'Olivier Cheng');
  assert.equal(resolveReportSalesRep({ status: 'pending', salesRep: 'Old Rep' }, event), 'Olivier Cheng');
  assert.equal(resolveReportSalesRep({ status: 'submitted', salesRep: 'Original Rep' }, event), 'Original Rep');
  assert.equal(resolveReportSalesRep({ status: 'submitted', salesRep: '' }, event), 'Olivier Cheng');
  assert.equal(resolveReportSalesRep({ status: 'pending', salesRep: 'Existing Rep' }, null), 'Existing Rep');
});
