import test from 'node:test';
import assert from 'node:assert/strict';
import { planDecorPackoutConsolidation as plan } from '../utils/decorPackoutConsolidation.js';
const make = (id, items, updatedAt) => ({ _id: id, eventId: 'event', deckId: 'deck', pageId: 'page', status: 'draft', items, updatedAt });
test('repeated all-board snapshots become one current packout without adding their quantities together', () => {
  const old = make('old', [{ inventoryCode: 'OCC1', quantity: 12, boardItemId: 'canvas1' }], '2026-10-21');
  const current = make('current', [{ inventoryCode: 'OCC1', quantity: 10, boardItemId: 'canvas1' }], '2026-10-27');
  const original = structuredClone([old, current]);
  const result = plan([old, current]);
  assert.equal(result.currentId, 'current'); assert.equal(result.items[0].quantity, 10);
  assert.deepEqual(result.previousIds, ['old']); assert.deepEqual([old, current], original);
});
test('unique manually scanned rows survive and identical manual quantities are not doubled', () => {
  const old = make('old', [{ _id: 'a', inventoryCode: 'OCC1', quantity: 4 }, { _id: 'b', inventoryCode: 'OCC2', quantity: 3 }], '2026-10-21');
  const current = make('current', [{ _id: 'c', inventoryCode: 'OCC1', quantity: 4 }], '2026-10-27');
  const result = plan([old, current]);
  assert.deepEqual(result.items.map(i => i.quantity), [4, 3]);
  assert.equal(result.items[1]._id, 'b'); assert.equal(result.items[1].pageId, 'page');
  old.items[0].quantity = 9; assert.throws(() => plan([old, current]), /Conflicting manual/);
});
test('empty duplicates never replace a populated completed packout and different events cannot merge', () => {
  const full = { ...make('full', [{ quantity: 4, boardItemId: 'canvas' }], '2026-10-21'), status: 'complete' };
  const empty = make('empty', [], '2026-10-27');
  assert.equal(plan([full, empty]).currentId, 'full');
  assert.equal(full.status, 'complete');
  assert.throws(() => plan([full, { ...empty, eventId: 'other' }]), /different events/);
  assert.equal(plan([{ ...full, supersededBy: 'replacement' }]), null);
});
