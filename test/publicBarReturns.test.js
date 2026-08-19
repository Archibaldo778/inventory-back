import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGuestEventDedupeKey,
  guestEventNameSimilarity,
  safeGuestReturnsPinEqual,
  selectGuestEventNameMatch,
} from '../routes/publicBarReturns.js';

test('guest returns PIN comparison accepts only an exact PIN', () => {
  assert.equal(safeGuestReturnsPinEqual('2468', '2468'), true);
  assert.equal(safeGuestReturnsPinEqual('2467', '2468'), false);
  assert.equal(safeGuestReturnsPinEqual('2468 ', '2468'), false);
  assert.equal(safeGuestReturnsPinEqual('', '2468'), false);
});

test('guest event names match at sixty percent without exposing a list', () => {
  assert.equal(guestEventNameSimilarity('Valentino Soho', 'Valentino Soho Cocktail') >= 0.6, true);
  assert.equal(guestEventNameSimilarity('Van Clef Arpels', 'Van Cleef & Arpels') >= 0.6, true);
  assert.equal(guestEventNameSimilarity('Birthday', 'Valentino Soho Cocktail') >= 0.6, false);
  const result = selectGuestEventNameMatch('Valentino Soho', [
    { id: 'expected', name: 'Valentino Soho Cocktail' },
    { id: 'other', name: 'Van Cleef Dinner' },
  ]);
  assert.equal(result.match?.id, 'expected');
});

test('guest event lookup rejects ambiguous fuzzy matches', () => {
  const result = selectGuestEventNameMatch('Acme Dinner', [
    { id: 'one', name: 'Acme Dinner East' },
    { id: 'two', name: 'Acme Dinner West' },
  ]);
  assert.equal(result.match, null);
  assert.equal(result.ambiguous, true);
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
