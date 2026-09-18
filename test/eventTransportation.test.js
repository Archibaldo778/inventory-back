import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addTransportationRow,
  buildTransportationPatch,
  buildTransportationRow,
  removeTransportationRow,
  updateTransportationRow,
} from '../utils/eventTransportation.js';

test('buildTransportationRow denormalizes the driver name from a resolved staff record', () => {
  const row = buildTransportationRow(
    { vehicle: 'Green van', callTime: '12:00 PM' },
    { staff: { _id: '507f1f77bcf86cd799439011', firstName: 'Attilio', lastName: 'Campos' } }
  );
  assert.equal(row.driverStaffId, '507f1f77bcf86cd799439011');
  assert.equal(row.name, 'Attilio Campos');
  assert.equal(row.vehicle, 'Green van');
  assert.equal(row.source, 'manual');
  assert.ok(row.id);
});

test('buildTransportationRow keeps a free-text name when no staff is resolved', () => {
  const row = buildTransportationRow({ name: 'Contract Driver' });
  assert.equal(row.driverStaffId, null);
  assert.equal(row.name, 'Contract Driver');
});

test('buildTransportationRow preserves an explicit dropbox source', () => {
  const row = buildTransportationRow({ name: 'Attilio Campos', source: 'dropbox' });
  assert.equal(row.source, 'dropbox');
});

test('addTransportationRow appends without mutating the original array', () => {
  const rows = [{ id: 'a' }];
  const next = addTransportationRow(rows, { id: 'b' });
  assert.equal(rows.length, 1);
  assert.deepEqual(next.map((row) => row.id), ['a', 'b']);
});

test('updateTransportationRow edits only the matching row and keeps its id', () => {
  const rows = [{ id: 'a', vehicle: 'Van' }, { id: 'b', vehicle: 'Truck' }];
  const { rows: next, found } = updateTransportationRow(rows, 'b', { vehicle: 'Box truck', id: 'ignored' });
  assert.equal(found, true);
  assert.deepEqual(next, [{ id: 'a', vehicle: 'Van' }, { id: 'b', vehicle: 'Box truck' }]);
});

test('updateTransportationRow reports not found for an unknown row id', () => {
  const { found } = updateTransportationRow([{ id: 'a' }], 'missing', { vehicle: 'x' });
  assert.equal(found, false);
});

test('buildTransportationPatch only includes fields explicitly provided', () => {
  const patch = buildTransportationPatch({ vehicle: 'Box truck' });
  assert.deepEqual(patch, { vehicle: 'Box truck' });
});

test('buildTransportationPatch attaches a resolved driver without touching other fields', () => {
  const patch = buildTransportationPatch(
    { notes: 'Confirmed' },
    { staff: { _id: '507f1f77bcf86cd799439011', firstName: 'Attilio', lastName: 'Campos' } }
  );
  assert.deepEqual(patch, {
    notes: 'Confirmed',
    driverStaffId: '507f1f77bcf86cd799439011',
    name: 'Attilio Campos',
  });
});

test('buildTransportationPatch clears the driver when an empty driverStaffId is sent', () => {
  const patch = buildTransportationPatch({ driverStaffId: '' });
  assert.deepEqual(patch, { driverStaffId: null });
});

test('a full row survives an unrelated field patch unchanged', () => {
  const rows = [buildTransportationRow({ name: 'Attilio Campos', vehicle: 'Van', notes: 'Old note' })];
  const patch = buildTransportationPatch({ notes: 'New note' });
  const { rows: next } = updateTransportationRow(rows, rows[0].id, patch);
  assert.equal(next[0].name, 'Attilio Campos');
  assert.equal(next[0].vehicle, 'Van');
  assert.equal(next[0].notes, 'New note');
});

test('removeTransportationRow deletes only the matching row', () => {
  const rows = [{ id: 'a' }, { id: 'b' }];
  const { rows: next, found } = removeTransportationRow(rows, 'a');
  assert.equal(found, true);
  assert.deepEqual(next, [{ id: 'b' }]);
});
