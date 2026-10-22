import BarEvent from '../models/BarEvent.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { barDocumentLines, validateBarAiResult } from '../utils/barDocumentAi.js';
import { prepareBarDocumentRecheck, selectRecheckDocumentVersions, selectAutomaticRecheckSources } from '../utils/barDocumentRecheckPlan.js';
import { barDocumentExclusion } from '../utils/barDocumentSources.js';
import { inspectBarMetadata } from '../utils/barDocumentAiService.js';
import { resolveBarOfficeReview } from '../utils/barOfficeReview.js';
import { blockUnverifiedBarImport, buildBarImportReview } from '../utils/barImportReview.js';
import router, { normalizePackoutItems } from '../routes/bar.js';
import BeverageItem from '../models/BeverageItem.js';
import CocktailRecipe from '../models/CocktailRecipe.js';
const root = new URL('./fixtures/bar-oct22/', import.meta.url);
const events = JSON.parse(fs.readFileSync(new URL('events.json', root)));
const inspect = (document) => {
  const lines = barDocumentLines(fs.readFileSync(new URL(document.textFile, root), 'utf8'));
  return validateBarAiResult(document.response, { lines, documentType: document.type, baseline: document.baseline });
};
const normalize = async (items) => items.map((i) => ({ ...i, sentQty: i.quantity ?? 0, sentQtyPending: i.quantity === null }));
for (const [match, count] of [['McDermott', 27], ['Prada Madison', 5], ['Junto', 26]]) {
  test(match + ' real PO imports confirmed quantities while quarantining disputed rows', async () => {
    const event = events.find((e) => e.title.includes(match));
    const doc = event.documents.find((d) => d.type === 'po' && !d.fileName.includes('KPO'));
    const result = inspect(doc);
    assert.equal(result.status, 'verified'); assert.equal(result.items.length, count);
    assert.deepEqual(result.items.map((i) => [i.name, i.quantity]), doc.expected);
    assert.ok(result.items.every((i) => !i.sentQtyPending));
    const disputed = match === 'McDermott' ? ['Garmish: Lemon Wheel', 'Gold Leaf'] : match === 'Prada Madison' ? ['margarita salt'] : ['TBC', 'TBC'];
    assert.deepEqual(result.reviewRows.map((i) => i.name), disputed);
    assert.ok(result.items.every((i) => !disputed.includes(i.name)));
    const metadata = await inspectBarMetadata({ documentType: 'po', barItems: doc.baseline }, '', async () => result);
    assert.deepEqual(metadata.barItems, result.items); assert.equal(metadata.barReview.rows.length, disputed.length);
  });
}
test('Cleary 19 attached documents cannot block BEVERAGE PO; two uncounted cocktails remain pending', async () => {
  const event = events.find((e) => e.title.includes('Cleary'));
  assert.equal(event.documents.length, 19);
  const calls = []; const completed = []; let inFlight = false;
  const plan = await prepareBarDocumentRecheck({ bar: { eventDate: event.date, eventNumber: event.externalId, items: [] }, documents: event.documents,
    read: async (doc) => {
      assert.equal(inFlight, false); inFlight = true; calls.push(doc.fileName); await Promise.resolve(); inFlight = false;
      if (doc.type === 'kitchen_menu') throw new Error('Menu inspection unavailable');
      const result = inspect(doc); return { barItems: result.items, barReview: { ...result, rows: result.reviewRows } };
    }, normalize, onDocument: async (doc) => completed.push(doc.fileName) });
  assert.deepEqual(completed, calls);
  assert.equal(plan.status, 'ready'); assert.match(plan.packout.fileName, /BEVERAGE PO/); assert.doesNotMatch(plan.packout.fileName, /KM REV2/); assert.ok(calls.some((name) => name.includes('_BEVERAGE PO')));
  assert.deepEqual(plan.items.filter((i) => /MAPLE OLD FASHIONED|NON-ALCOHOLIC FRENCH 75/.test(i.name)).map((i) => [i.name, i.sentQtyPending, i.quantity]), [['MAPLE OLD FASHIONED', true, null], ['NON-ALCOHOLIC FRENCH 75', true, null]]);
  assert.equal(plan.items.find((i) => i.name === 'AGAVE SPICE').sentQty, 450);
  assert.ok(plan.review.issues.some((i) => i.includes('Menu inspection unavailable')));
});
test('Chanel 22 October excludes other dates and copies before choosing revisions or reading AI', async () => {
  const event = events.find((e) => e.title.includes('Chanel'));
  const selected = selectRecheckDocumentVersions(event.documents, event);
  assert.deepEqual(selected.map((d) => d.fileName), ['10-22-26 Chanel WFJ Private Viewing 1 KM REV1.docx', '10-22-26 Chanel WFJ Private Viewing 1 PO.docx']);
  for (const fileName of ['10-25-26 Chanel WFJ Private Viewing 2 KM.docx', '10-22-26 Chanel copy.docx', '10-22-26 Chanel (2).docx', 'E99999_AKM.docx']) assert.ok(barDocumentExclusion({ fileName }, event), fileName);
});
test('arbitrary non-beverage disagreement is a warning, without a vocabulary allowlist', () => {
  for (const name of ['Unexpected supplier annotation', 'Unlisted decoration 99']) {
    const result = validateBarAiResult({ rows: [{ row: 1, kind: 'note', name: '' }, { row: 2, kind: 'alcohol', name: 'Wine', quantity: 6, quantityRow: 2 }], issues: [] },
      { lines: [name, 'Wine\t6'], documentType: 'po', baseline: [{ name, scope: 'alcohol' }] });
    assert.equal(result.status, 'verified'); assert.equal(result.items[0].quantity, 6); assert.equal(result.reviewRows[0].name, name);
  }
});
test('water classification survives normalization without a brand regex', async (t) => {
  t.mock.method(BeverageItem, 'find', () => ({ select: async () => [] }));
  t.mock.method(CocktailRecipe, 'find', () => ({ select: () => ({ lean: async () => [] }) }));
  const result = validateBarAiResult({ rows: [{ row: 1, kind: 'water', name: 'Previously unseen brand', quantity: 12, quantityRow: 1 }], issues: [] }, { lines: ['Previously unseen brand\t12'], documentType: 'po' });
  const items = await normalizePackoutItems(result.items);
  assert.equal(items.length, 1); assert.equal(items[0].beverageKind, 'water'); assert.equal(items[0].sentQty, 12);
});
test('failed neighbouring file cannot erase previously counted stock', async () => {
  const plan = await prepareBarDocumentRecheck({ bar: { items: [{ name: 'Existing wine', scope: 'alcohol', sentQty: 8 }] },
    documents: [{ type: 'po', fileName: 'one.docx' }, { type: 'po', fileName: 'two.docx' }],
    read: async (d) => d.fileName === 'one.docx' ? { barReview: { status: 'verified' }, barItems: [{ name: 'New wine', scope: 'alcohol', quantity: 4 }] } : Promise.reject(new Error('unavailable')), normalize });
  assert.equal(plan.status, 'ready'); assert.equal(plan.items.find((i) => i.name === 'Existing wine').sentQty, 8);
});
test('mixed document statuses no longer block automatic import', async () => {
  let update;
  const blocked = await blockUnverifiedBarImport({ _id: 'event' }, [{ fileName: 'good', barReview: { status: 'verified' } }, { fileName: 'bad', barReview: { status: 'needs_review', issues: ['Unavailable'] } }], { updateOne: async (_f, u) => { update = u; } });
  assert.equal(blocked, false); assert.equal(update, undefined);
});
test('office confirmation requires current revision, explicit drink identity and records only the selected row', () => {
  const event = { revision: 3, items: [], importReview: { rows: [{ id: 'a', name: 'TBC' }, { id: 'b', name: 'TBC' }] } };
  assert.throws(() => resolveBarOfficeReview(event, { rowId: 'a', expectedRevision: 2 }), /changed/);
  const resolved = resolveBarOfficeReview(event, { rowId: 'a', expectedRevision: 3, action: 'confirm', name: 'Chosen wine', kind: 'alcohol', quantity: '' });
  assert.equal(resolved.item.entrySource, 'manual'); assert.equal(resolved.item.sentQtyPending, true); assert.equal(resolved.item.quantity, null);
  assert.deepEqual(resolved.review.rows.map((r) => r.id), ['b']);
  assert.equal(resolveBarOfficeReview(event, { rowId: 'a', expectedRevision: 3, action: 'exclude' }).item, null);
});
test('captains cannot confirm disputed document rows', () => {
  const guard = router.stack.find((l) => l.route?.path === '/events/:id/document-review').route.stack[0].handle;
  let status; const res = { status: (s) => { status = s; return { json() {} }; } };
  guard({ auth: { role: 'captain' } }, res, () => assert.fail('Captain gained office review permission'));
  assert.equal(status, 403);
});

test('ambiguous Qty never becomes a numeric count even when AI picks one number', () => {
  const result = validateBarAiResult({ rows: [{ row: 1, kind: 'alcohol', name: 'Wine', quantity: 4, quantityRow: 1 }], issues: [] }, { lines: ['Wine\t4 or 12'], documentType: 'po' });
  assert.equal(result.status, 'verified'); assert.equal(result.items[0].quantity, null); assert.equal(result.items[0].sentQtyPending, true);
});

test('a manually attached copy or another date does not prevent queuing the real automatic PO', () => {
  const po = { fileName: '10-22-26 Dinner PO.docx', type: 'po', sourceProvider: 'dropbox' };
  const docs = [po, { fileName: '10-22-26 Dinner PO (2).docx', type: 'po' }, { fileName: '10-25-26 Dinner PO.docx', type: 'po' }];
  assert.deepEqual(selectAutomaticRecheckSources(docs, { eventDate: '2026-10-22' }), [po]);
  assert.deepEqual(selectAutomaticRecheckSources([...docs, { fileName: '10-22-26 Manual PO.docx', type: 'po' }], { eventDate: '2026-10-22' }), []);
});

test('a review-only upload preserves existing quantities and records the office audit', async (t) => {
  const event = new BarEvent({ _id: '507f1f77bcf86cd799439011', name: 'Dinner', revision: 2,
    items: [{ name: 'Existing wine', scope: 'alcohol', sentQty: 12, returnConfirmed: true }] });
  const before = JSON.stringify(event.items);
  t.mock.method(BarEvent, 'findById', async () => event);
  t.mock.method(event, 'save', async () => event);
  const handler = router.stack.find((l) => l.route?.path === '/events/:id/packout' && l.route.methods.post).route.stack.at(-1).handle;
  let response; const res = { status: (code) => { assert.fail('Unexpected HTTP ' + code); }, json: (body) => { response = body; } };
  await handler({ params: { id: String(event._id) }, auth: { role: 'bar admin', userId: 'office', username: 'Reviewer' }, body: {
    items: [], reviews: [{ fileName: 'PO.docx', barReview: { status: 'verified', rows: [{ row: 7, name: 'Uncertain', reason: 'Unknown identity' }] } }],
  } }, res);
  assert.equal(JSON.stringify(event.items), before);
  assert.equal(response.importReview.rows.length, 1); assert.equal(event.audit.at(-1).action, 'document_review_saved');
  assert.equal(event.audit.at(-1).userId, 'office');
});
test('excluding a row survives later reviews even if the order of other disputed rows changes', () => {
  const document = { checksum: 'same', fileName: 'PO.docx', barReview: { status: 'verified', rows: [{ row: 7, name: 'One' }, { row: 9, name: 'Two' }] } };
  const previous = buildBarImportReview([document]);
  const audit = [{ action: 'document_row_reviewed', details: { action: 'exclude', row: previous.rows[1] } }];
  document.barReview.rows.reverse();
  assert.deepEqual(buildBarImportReview([document], audit).rows.map((r) => r.name), ['One']);
});
