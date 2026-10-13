import test from 'node:test';
import assert from 'node:assert/strict';
import { protectedBarRecheckReason, recheckSourceSignature, prepareBarDocumentRecheck, planBarDocumentRecheck } from '../utils/barDocumentRecheckPlan.js';
const cocktail = { name: 'NEW YORK 45 (RED THREAD 45)', section: 'COCKTAIL', scope: 'bar_support', entrySource: 'packout', sentQty: 0, returnConfirmed: true };
const wine = { name: 'Champagne', scope: 'alcohol', entrySource: 'packout', sentQty: 0, sentQtyPending: true, returnConfirmed: false };
const source = [{ _id: 'doc', sourceId: 'id:file', sourceProvider: 'dropbox', sourceRevision: 'rev1', checksum: 'hash', type: 'po' }];
test('unchanged file is queued again after rules/parser signature changes, parsed results do not trigger endless rechecks', () => {
  const original = recheckSourceSignature(source, 0);
  assert.notEqual(recheckSourceSignature(source, 1), original);
  assert.notEqual(recheckSourceSignature([{ ...source[0], sourceRevision: 'rev2' }], 0), original);
  assert.equal(recheckSourceSignature([{ ...source[0], barItems: [{ name: 'Wine', quantity: 2 }], barReview: { status: 'verified' } }], 0), original);
});
test('confirmed reports, zero confirmed bottle returns and manually corrected events are never reimported', async () => {
  const cases = [
    { status: 'submitted' }, { status: 'reviewed' }, { status: 'closed' },
    { items: [{ ...wine, returnConfirmed: true }] }, { items: [{ ...wine, returnedFullQty: 1 }] },
    { items: [{ ...wine, updatedBy: 'Sam Rivers' }] }, { items: [{ ...wine, entrySource: 'manual' }] },
    { items: [{ ...wine, deliveredQty: 0 }] }, { audit: [{ action: 'packout_item_deleted' }] },
    { audit: [{ action: 'packout_imported' }] }, { audit: [{ action: 'returns_reviewed' }], status: 'ready' },
  ];
  for (const bar of cases) {
    assert.ok(protectedBarRecheckReason(bar));
    const result = await prepareBarDocumentRecheck({ bar, documents: source, read: () => assert.fail('protected source must not be downloaded'), normalize: () => assert.fail('protected items must not change') });
    assert.equal(result.status, 'protected');
  }
});
test('Dieter-like old import merges the abbreviated PO cocktail without duplication and retains PO counts', () => {
  const bar = { status: 'ready', eventDate: '2026-10-06', items: [cocktail, wine] };
  assert.equal(protectedBarRecheckReason(bar), '');
  const imported = [
    { ...cocktail, quantity: null, sentQty: 0, sentQtyPending: true },
    { name: 'NEW YORK 45', section: 'COCKTAIL', scope: 'bar_support', quantity: 20, sentQty: 20, cocktailServingsAuto: false },
    { ...wine, quantity: 12, sentQty: 12, sentQtyPending: false },
    { name: 'White Burgundy', scope: 'alcohol', sentQty: 9 },
    { name: 'Red Bordeaux', scope: 'alcohol', sentQty: 5 },
    { name: 'Panna', scope: 'bar_support', sentQty: 16 },
    { name: 'Pellegrino', scope: 'bar_support', sentQty: 10 },
  ];
  const plan = planBarDocumentRecheck(bar, imported, ['po', 'kitchen_menu']);
  assert.equal(plan.status, 'ready'); assert.equal(plan.items.length, 6);
  assert.equal(plan.items.find((i) => i.name.startsWith('NEW YORK')).sentQty, 20);
  assert.equal(plan.items.find((i) => i.name === 'Champagne').sentQty, 12);
  assert.equal(bar.items[0].sentQty, 0);
});
test('one failed source blocks the entire replacement and transient AI failure stays retryable', async () => {
  for (const retryable of [false, true]) {
    const result = await prepareBarDocumentRecheck({ bar: { items: [] }, documents: source,
      read: async () => ({ barReview: { status: 'needs_review', issues: ['AI unavailable'], retryable } }),
      normalize: () => assert.fail('no partial replacement'),
    });
    assert.equal(result.status, retryable ? 'retry' : 'needs_review');
  }
});
test('all verified documents are normalized together once before a replacement plan is produced', async () => {
  let count = 0;
  const result = await prepareBarDocumentRecheck({ bar: { items: [], guestCount: 20 }, documents: source,
    read: async () => ({ barItems: [{ name: 'Wine', sentQty: 3, scope: 'alcohol' }], barReview: { status: 'verified' } }),
    normalize: async (items) => { count += 1; return items; },
  });
  assert.equal(result.status, 'ready'); assert.equal(count, 1); assert.equal(result.items[0].sentQty, 3);
});

test('concurrent edits, new confirmations, rule changes or replaced documents reject a prepared result', async () => {
  const { canCommitBarRecheck } = await import('../utils/barDocumentRecheckPlan.js');
  const beforeBar = { status: 'ready', revision: 5, items: [wine] };
  const input = { beforeBar, currentBar: structuredClone(beforeBar), beforeDocuments: source, currentDocuments: source, rulesRevision: 0, signature: recheckSourceSignature(source, 0) };
  assert.equal(canCommitBarRecheck(input), true);
  for (const change of [
    { currentBar: { ...beforeBar, revision: 6 } },
    { currentBar: { ...beforeBar, status: 'submitted' } },
    { currentBar: { ...beforeBar, items: [{ ...wine, returnConfirmed: true }] } },
    { currentBar: { ...beforeBar, items: [{ ...wine, sentQty: 25 }] } },
    { currentDocuments: [{ ...source[0], sourceRevision: 'new' }] },
    { rulesRevision: 1 },
  ]) assert.equal(canCommitBarRecheck({ ...input, ...change }), false);
});

test('only the explicitly requested Dieter event can enter the historical queue', async () => {
  const { barDocumentRecheckQuery } = await import('../utils/barDocumentRecheckPlan.js');
  assert.deepEqual(barDocumentRecheckQuery(), { linkedEventId: { $in: ['6aa993cb55df57b2093ba0b2'] }, status: { $nin: ['submitted', 'reviewed', 'closed'] } });
});


test('renamed event folders and numbered menu revisions contribute one authoritative PO count', async () => {
  const documents = [
    { fileName: 'Dinner PO.docx', type: 'po', uploadedAt: '2026-10-01', sourcePath: '/old/Dinner PO.docx', quantity: 6 },
    { fileName: 'Dinner PO.docx', type: 'po', uploadedAt: '2026-10-05', sourcePath: '/renamed/Dinner PO.docx', quantity: 12 },
    { fileName: 'Dinner KM.docx', type: 'kitchen_menu', uploadedAt: '2026-10-01', quantity: null },
    { fileName: 'Dinner KM REV1.docx', type: 'kitchen_menu', uploadedAt: '2026-10-05', quantity: null },
  ];
  const readNames = [];
  const result = await prepareBarDocumentRecheck({ bar: { items: [] }, documents,
    read: async (doc) => {
      readNames.push(doc.fileName);
      return { barReview: { status: 'verified' }, barItems: [{ name: 'Champagne', scope: 'alcohol', sentQty: doc.quantity || 0, sentQtyPending: doc.quantity === null }] };
    }, normalize: async (items) => items,
  });
  assert.equal(result.status, 'ready');
  assert.deepEqual(readNames, ['Dinner PO.docx', 'Dinner KM REV1.docx']);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].sentQty, 12);
});


test('exact named wine aliases in KM merge into PO quantities without inventing a match', async () => {
  const result = await prepareBarDocumentRecheck({ bar: { items: [] },
    documents: [{ type: 'po', fileName: 'Dinner PO.docx' }, { type: 'kitchen_menu', fileName: 'Dinner KM.docx' }],
    read: async (doc) => ({ barReview: { status: 'verified' }, barItems: doc.type === 'po'
      ? [{ name: 'White Burgundy (Les Vergelesses)', scope: 'alcohol', sentQty: 9 }, { name: 'Red Bordeaux (Chateau Gloria)', scope: 'alcohol', sentQty: 5 }]
      : [{ name: 'Les Vergelesses- White', scope: 'alcohol', sentQty: 0, sentQtyPending: true }, { name: 'Chateau Gloria- Red', scope: 'alcohol', sentQty: 0, sentQtyPending: true }, { name: 'Other Vineyard- Red', scope: 'alcohol', sentQty: 0, sentQtyPending: true }] }),
    normalize: async (items) => items,
  });
  assert.equal(result.status, 'ready');
  assert.equal(result.items.length, 3);
  assert.equal(result.items.find((item) => item.name === 'White Burgundy (Les Vergelesses)').sentQty, 9);
  assert.equal(result.items.find((item) => item.name === 'Red Bordeaux (Chateau Gloria)').sentQty, 5);
  assert.equal(result.items.find((item) => item.name === 'Other Vineyard- Red').sentQtyPending, true);
});
