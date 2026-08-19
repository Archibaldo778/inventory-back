import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGuestEventDedupeKey,
  safeGuestReturnsPinEqual,
} from '../routes/publicBarReturns.js';

test('guest returns PIN comparison accepts only an exact PIN', () => {
  assert.equal(safeGuestReturnsPinEqual('2468', '2468'), true);
  assert.equal(safeGuestReturnsPinEqual('2467', '2468'), false);
  assert.equal(safeGuestReturnsPinEqual('2468 ', '2468'), false);
  assert.equal(safeGuestReturnsPinEqual('', '2468'), false);
});

test('guest pending reports deduplicate normalized event names and exact dates', () => {
  assert.equal(
    buildGuestEventDedupeKey('  Van Cleef & Arpels  ', '08/19/2026'),
    buildGuestEventDedupeKey('van cleef arpels', '2026-08-19')
  );
  assert.notEqual(
    buildGuestEventDedupeKey('Van Cleef & Arpels', '2026-08-19'),
    buildGuestEventDedupeKey('Van Cleef & Arpels', '2026-08-20')
  );
});
