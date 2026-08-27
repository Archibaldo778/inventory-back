import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGuestEventDedupeKey,
  buildGuestEventChoices,
  guestEventNameSimilarity,
  guestMutationWasApplied,
  safeGuestReturnsPinEqual,
  selectGuestEventNameMatch,
  selectGuestEventNumberMatch,
} from '../routes/publicBarReturns.js';

test('guest mutation ids make offline retries idempotent', () => {
  const event = {
    audit: [{ action: 'guest_returns_submitted', details: { clientMutationId: 'device-mutation-1' } }],
  };
  assert.equal(guestMutationWasApplied(event, 'guest_returns_submitted', 'device-mutation-1'), true);
  assert.equal(guestMutationWasApplied(event, 'guest_received_saved', 'device-mutation-1'), false);
  assert.equal(guestMutationWasApplied(event, 'guest_returns_submitted', ''), false);
});

test('guest returns PIN comparison accepts only an exact PIN', () => {
  assert.equal(safeGuestReturnsPinEqual('2468', '2468'), true);
  assert.equal(safeGuestReturnsPinEqual('2467', '2468'), false);
  assert.equal(safeGuestReturnsPinEqual('2468 ', '2468'), false);
  assert.equal(safeGuestReturnsPinEqual('', '2468'), false);
});

test('guest event names match at sixty percent', () => {
  assert.equal(guestEventNameSimilarity('Valentino Soho', 'Valentino Soho Cocktail') >= 0.6, true);
  assert.equal(guestEventNameSimilarity('Valentino', 'Valentino Soho Cocktail') >= 0.6, true);
  assert.equal(guestEventNameSimilarity('Valentno', 'Valentino Soho Cocktail') >= 0.6, true);
  assert.equal(guestEventNameSimilarity('Van Clef Arpels', 'Van Cleef & Arpels') >= 0.6, true);
  assert.equal(guestEventNameSimilarity('Birthday', 'Valentino Soho Cocktail') >= 0.6, false);
  const result = selectGuestEventNameMatch('Valentino Soho', [
    { id: 'expected', name: 'Valentino Soho Cocktail' },
    { id: 'other', name: 'Van Cleef Dinner' },
  ]);
  assert.equal(result.match?.id, 'expected');
});

test('ambiguous guest lookup can show every event on the date without duplicating linked events', () => {
  const choices = buildGuestEventChoices([
    { _id: 'bar-one', linkedEventId: 'dashboard-one', name: 'Acme Dinner East', eventDate: '2026-08-26', venue: 'East Room' },
    { _id: 'bar-two', name: 'Other Event', eventDate: '2026-08-26', venue: 'West Room' },
  ], [
    { _id: 'dashboard-one', title: 'Acme Dinner East', date: '2026-08-26', meta: { venue: 'East Room' } },
    { _id: 'dashboard-two', title: 'Acme Dinner West', date: '2026-08-26', meta: { venue: 'West Room' } },
  ]);
  assert.deepEqual(choices.map((choice) => choice.name), ['Acme Dinner East', 'Acme Dinner West', 'Other Event']);
  assert.equal(choices.filter((choice) => choice.name === 'Acme Dinner East').length, 1);
});

test('a unique first word can select an event but a shared first word stays ambiguous', () => {
  const unique = selectGuestEventNameMatch('Valentino', [
    { id: 'expected', name: 'Valentino Soho Cocktail' },
    { id: 'other', name: 'Van Cleef Dinner' },
  ]);
  assert.equal(unique.match?.id, 'expected');
  const ambiguous = selectGuestEventNameMatch('Valentino', [
    { id: 'one', name: 'Valentino Soho Cocktail' },
    { id: 'two', name: 'Valentino Madison Dinner' },
  ]);
  assert.equal(ambiguous.match, null);
  assert.equal(ambiguous.ambiguous, true);
});

test('guest event lookup rejects ambiguous fuzzy matches', () => {
  const result = selectGuestEventNameMatch('Acme Dinner', [
    { id: 'one', name: 'Acme Dinner East' },
    { id: 'two', name: 'Acme Dinner West' },
  ]);
  assert.equal(result.match, null);
  assert.equal(result.ambiguous, true);
});

test('guest event id lookup does not require a date and supports the PO base id', () => {
  const result = selectGuestEventNumberMatch('E22346', [
    { id: 'expected', eventNumber: 'E22346-S60940' },
    { id: 'other', eventNumber: 'E60815' },
  ]);
  assert.equal(result.match?.id, 'expected');
  assert.equal(result.ambiguous, false);
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
