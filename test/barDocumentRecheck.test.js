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

test('automatic queue starts at New York today and excludes closed reports and malformed dates', async () => {
  const { barDocumentRecheckQuery } = await import('../utils/barDocumentRecheckPlan.js');
  const beforeMidnight = barDocumentRecheckQuery(new Date('2026-10-14T03:59:00Z'));
  const afterMidnight = barDocumentRecheckQuery(new Date('2026-10-14T04:01:00Z'));
  assert.equal(beforeMidnight.eventDate.$gte, '2026-10-13');
  assert.equal(afterMidnight.eventDate.$gte, '2026-10-14');
  assert.equal(afterMidnight.eventDate.$regex.test('74512-06-05'), false);
  assert.equal(afterMidnight.eventDate.$regex.test('2026-10-15'), true);
  assert.deepEqual(afterMidnight.status.$nin, ['submitted', 'reviewed', 'closed']);
  assert.equal(afterMidnight.linkedEventId, undefined);
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


test('separate bar PO is used without kitchen KPO blocking it; a lone KPO is not silently discarded', async () => {
  const { selectRecheckDocumentVersions } = await import('../utils/barDocumentRecheckPlan.js');
  const po = { fileName: 'Dinner PO.docx', type: 'po' };
  const kpo = { fileName: 'Dinner KPO.docx', type: 'po' };
  const km = { fileName: 'Dinner KM.docx', type: 'kitchen_menu' };
  assert.deepEqual(selectRecheckDocumentVersions([po, kpo, km]).map((d) => d.fileName), [po.fileName, km.fileName]);
  assert.deepEqual(selectRecheckDocumentVersions([kpo, km]).map((d) => d.fileName), [kpo.fileName, km.fileName]);
  const result = await prepareBarDocumentRecheck({ bar: { items: [] }, documents: [po, kpo],
    read: async (document) => { assert.equal(document.fileName, po.fileName); return { barReview: { status: 'verified' }, barItems: [{ name: 'Panna', scope: 'bar_support', sentQty: 16 }] }; },
    normalize: async (items) => items,
  });
  assert.equal(result.status, 'ready'); assert.equal(result.items[0].sentQty, 16);
});


test('complete verified menu recheck removes stale notes instead of retaining fake alcohol', () => {
  const bar = { status: 'ready', items: [{ ...wine, name: 'Client provide champagne, wine,' }] };
  const result = planBarDocumentRecheck(bar, [], ['kitchen_menu']);
  assert.equal(result.status, 'ready');
  assert.deepEqual(result.items, []);
});

test('recheck replaces duplicate whiskey and fake headings with verified PO counts', () => {
  const bar = { status: 'ready', items: [
    { name: 'WHISKEY SOUR', scope: 'alcohol', sentQty: 70 },
    { name: 'WHISKEY SOUR', section: 'COCKTAIL', sentQty: 70 },
    { name: 'SPECIALTY COCKTAILS', section: 'COCKTAIL', sentQty: 1 },
  ] };
  const result = planBarDocumentRecheck(bar, [{ name: 'WHISKEY SOUR', section: 'COCKTAIL', sentQty: 20, cocktailServingsAuto: false }], ['po']);
  assert.equal(result.status, 'ready');
  assert.deepEqual(result.items.map((item) => [item.name, item.sentQty]), [['WHISKEY SOUR', 20]]);
});

test('menu-only recheck cannot silently remove a previous positive PO quantity', () => {
  const result = planBarDocumentRecheck({ items: [{ ...wine, sentQty: 12, sentQtyPending: false }] }, [], ['kitchen_menu']);
  assert.equal(result.status, 'needs_review');
  assert.match(result.issues[0], /Previous PO quantity/);
});


test('manual KM upload does not freeze subsequent PO quantities; prepared menu items survive', async () => {
  const { selectAutomaticRecheckSources, canCommitBarRecheck } = await import('../utils/barDocumentRecheckPlan.js');
  const menu = { type: 'kitchen_menu', fileName: 'Dinner KM REV1.docx' };
  const documents = [...source, menu];
  const bar = { status: 'ready', revision: 1, items: [wine, cocktail],
    audit: [{ action: 'packout_imported', details: { fileName: menu.fileName } }] };
  assert.equal(protectedBarRecheckReason(bar), '');
  assert.deepEqual(selectAutomaticRecheckSources(documents), source);
  for (const quantity of [12, 18]) {
    const result = await prepareBarDocumentRecheck({ bar, documents: selectAutomaticRecheckSources(documents),
      read: async () => ({ barReview: { status: 'verified' }, barItems: [{ ...wine, sentQty: quantity, sentQtyPending: false }] }),
      normalize: async (items) => items });
    assert.equal(result.status, 'ready');
    assert.equal(result.items.find((i) => i.name === wine.name).sentQty, quantity);
    assert.ok(result.items.find((i) => i.name === cocktail.name));
    bar.items = result.items;
  }
  assert.equal(canCommitBarRecheck({ beforeBar: bar, currentBar: bar, beforeDocuments: documents,
    currentDocuments: documents, rulesRevision: 0, signature: recheckSourceSignature(source) }), true);
  assert.ok(protectedBarRecheckReason({ ...bar, items: [{ ...wine, updatedBy: 'Sam' }] }));
  assert.ok(protectedBarRecheckReason({ ...bar, items: [{ ...wine, returnConfirmed: true }] }));
});

test('manual PO and unidentified uploads remain protected; stale automatic KM cannot override uploaded KM', async () => {
  const { selectAutomaticRecheckSources } = await import('../utils/barDocumentRecheckPlan.js');
  assert.deepEqual(selectAutomaticRecheckSources([...source, { type: 'po' }]), []);
  assert.deepEqual(selectAutomaticRecheckSources([...source, { type: 'unknown' }]), []);
  assert.deepEqual(selectAutomaticRecheckSources([{ type: 'kitchen_menu' }]), []);
  assert.deepEqual(selectAutomaticRecheckSources([...source,
    { type: 'kitchen_menu', sourceProvider: 'dropbox' }, { type: 'kitchen_menu' }]), source);
  for (const fileName of ['Dinner PO.docx', '', 'Dinner.docx']) {
    assert.ok(protectedBarRecheckReason({ audit: [{ action: 'packout_imported', details: { fileName } }] }));
  }
});

test('pricing-only refresh during AI inspection does not discard PO quantities; operational changes still conflict', async () => {
  const { canCommitBarRecheck } = await import('../utils/barDocumentRecheckPlan.js');
  const beforeBar = { revision: 3, status: 'ready', guestCount: 300, items: [wine], audit: [], clientCharge: 0 };
  const currentBar = { ...beforeBar, revision: 4, clientCharge: 21200, updatedAt: new Date(),
    audit: [{ action: 'caterease_client_pricing_synced' }], clientChargeDetails: { total: 21200 } };
  const input = { beforeBar, currentBar, beforeDocuments: source, currentDocuments: source, rulesRevision: 0, signature: recheckSourceSignature(source) };
  assert.equal(canCommitBarRecheck(input), true);
  for (const change of [{ items: [{ ...wine, sentQty: 99 }] }, { guestCount: 400 }, { status: 'submitted' },
    { audit: [{ action: 'client_charge_updated' }] }, { packout: { fileName: 'New PO.docx' } }]) {
    assert.equal(canCommitBarRecheck({ ...input, currentBar: { ...currentBar, ...change } }), false);
  }
});
