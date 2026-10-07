import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBarImportChecksum,
  barItemsHaveRecordedReturns,
  visibleBarSourceChangeAfterReturns,
  recordBarSourceChangeAfterReturns,
} from '../utils/barSourceChangeProtection.js';

test('automatic cocktail confirmations and legacy food headings neither lock imports nor show stale warnings', () => {
  const event = {
    status: 'ready', revision: 4, audit: [],
    sourceChangedAfterReturns: { source: 'Dropbox automatic sync', checksum: 'old', at: new Date() },
    items: ['APPLE CIDER GIMLET', 'TABLE NIBBLES', 'FIRST COURSE - SERVED FAMILY STYLE'].map((name) => ({
      name, section: 'COCKTAIL', returnConfirmed: true, returnedFullQty: 0, returnedOpenQty: 0,
    })),
  };
  assert.equal(barItemsHaveRecordedReturns(event), false);
  assert.equal(visibleBarSourceChangeAfterReturns(event), null);
  assert.ok(event.sourceChangedAfterReturns); // Reading does not mutate the document.
  assert.deepEqual(recordBarSourceChangeAfterReturns(event, { source: 'Dropbox automatic sync', checksum: 'new' }),
    { locked: false, changed: false });
  assert.equal(event.sourceChangedAfterReturns, undefined);
  assert.equal(event.revision, 4);
  assert.deepEqual(event.audit, []);
});

test('real returns remain protected regardless of date, classification or zero quantity', () => {
  const warning = { source: 'Dropbox automatic sync', checksum: 'old' };
  for (const item of [
    { name: 'Gin', scope: 'alcohol', section: 'COCKTAIL', returnConfirmed: true, returnedFullQty: 0 },
    { name: 'Gimlet', section: 'COCKTAIL', returnedOpenQty: 1 },
    { name: 'TABLE NIBBLES', returnedFullQty: 1 },
    { name: 'Wine', lostDamagedQty: 1 },
  ]) {
    const event = { status: 'ready', eventDate: '2099-01-01', items: [item], sourceChangedAfterReturns: warning };
    assert.equal(barItemsHaveRecordedReturns(event), true);
    assert.equal(visibleBarSourceChangeAfterReturns(event), warning);
  }
  for (const status of ['submitted', 'reviewed', 'closed']) {
    assert.equal(barItemsHaveRecordedReturns({ status, items: [] }), true);
  }
});

test('a renamed PO item cannot replace items after returns were submitted', () => {
  const barEvent = {
    status: 'submitted',
    revision: 7,
    items: [{ name: 'Old Champagne Name', sentQty: 2, returnedFullQty: 1, returnConfirmed: true }],
    audit: [],
  };
  const before = structuredClone(barEvent.items);
  const checksum = buildBarImportChecksum([{ name: 'Renamed Champagne', sentQty: 4 }]);
  const result = recordBarSourceChangeAfterReturns(barEvent, {
    source: 'Caterease operational sync', checksum, at: new Date('2026-10-01T12:00:00Z'),
  });
  assert.deepEqual(barEvent.items, before);
  assert.deepEqual(result, { locked: true, changed: true });
  assert.equal(barEvent.sourceChangedAfterReturns.checksum, checksum);
  assert.equal(barEvent.sourceChangedAfterReturns.source, 'Caterease operational sync');
  assert.equal(barEvent.audit.at(-1).action, 'bar_source_changed_after_returns');
  assert.equal(barEvent.revision, 8);
});

test('one confirmed return locks items even before report submission and duplicate checksums do not repeat audit', () => {
  const barEvent = {
    status: 'in_progress', revision: 2,
    items: [{ name: 'Gin', returnConfirmed: true }], audit: [],
  };
  const input = { source: 'Dropbox automatic sync', checksum: 'same' };
  assert.deepEqual(recordBarSourceChangeAfterReturns(barEvent, input), { locked: true, changed: true });
  assert.deepEqual(recordBarSourceChangeAfterReturns(barEvent, input), { locked: true, changed: false });
  assert.equal(barEvent.audit.length, 1);
  assert.equal(barEvent.revision, 3);
});

test('the post-return source warning is stored on the bar event and not repeated', async () => {
  const { default: BarEvent } = await import('../models/BarEvent.js');
  const event = new BarEvent({ name: 'Locked event', status: 'submitted', items: [{ name: 'Wine', returnConfirmed: true }] });
  const first = recordBarSourceChangeAfterReturns(event, { source: 'Dropbox automatic sync', checksum: 'abc' });
  assert.deepEqual(first, { locked: true, changed: true });
  assert.equal(event.toObject().sourceChangedAfterReturns.checksum, 'abc');
  const reloaded = new BarEvent(event.toObject());
  assert.deepEqual(
    recordBarSourceChangeAfterReturns(reloaded, { source: 'Dropbox automatic sync', checksum: 'abc' }),
    { locked: true, changed: false },
  );
});
