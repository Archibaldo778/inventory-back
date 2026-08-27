import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGuestEventDedupeKey,
  buildGuestEventChoices,
  filterGuestBarReportsForActiveEvents,
  guestEventNameSimilarity,
  guestMutationWasApplied,
  publicEvent,
  safeGuestReturnsPinEqual,
  serializeGuestBarItem,
  selectGuestEventNameMatch,
  selectGuestEventNumberMatch,
} from '../routes/publicBarReturns.js';

test('captain treats an imported zero-return PO as attached', () => {
  const event = publicEvent({
    _id: 'event', name: 'No return event', eventDate: '2026-08-29', items: [],
    packout: { importedAt: new Date('2026-08-27T12:00:00Z') },
  });
  assert.equal(event.hasPackout, true);
  assert.deepEqual(event.items, []);
});

test('captain payload keeps included PO items visible even when they do not require returns', () => {
  const cocktail = serializeGuestBarItem({
    _id: 'cocktail-row',
    name: 'Gin Basil Smash',
    section: 'Specialty Cocktails',
    scope: 'review',
    included: true,
    sentQty: 195,
  });
  assert.equal(cocktail.included, true);
  assert.equal(cocktail.returnRequired, false);

  const excluded = serializeGuestBarItem({
    _id: 'excluded-row',
    name: 'Office use only',
    included: false,
  });
  assert.equal(excluded.included, false);
  assert.equal(excluded.returnRequired, false);
});

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

test('captain lookup excludes bar reports linked to deleted dashboard duplicates', () => {
  const active = { _id: 'active-dashboard' };
  const reports = filterGuestBarReportsForActiveEvents([
    { _id: 'correct-report', linkedEventId: 'active-dashboard', items: Array(29) },
    { _id: 'stale-report', linkedEventId: 'deleted-dashboard', items: Array(9) },
    { _id: 'manual-report', linkedEventId: null, items: [] },
  ], [active]);

  assert.deepEqual(reports.map((report) => report._id), ['correct-report', 'manual-report']);
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

test('identically named active events stay ambiguous so the captain can choose by Event ID', () => {
  const result = selectGuestEventNameMatch('Prada Day 1', [
    { id: 'nowsta', name: 'Prada Day 1', eventNumber: 'E22304 - S60815' },
    { id: 'po', name: 'Prada Day 1', eventNumber: 'E22301' },
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
