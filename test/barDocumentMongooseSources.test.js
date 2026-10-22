import test from 'node:test';
import assert from 'node:assert/strict';
import Event from '../models/Event.js';
import { selectBarDocumentsForEvent } from '../utils/barDocumentSources.js';
import { blockUnverifiedBarImport, preserveUninspectedBarItems } from '../utils/barImportReview.js';

const event = () => new Event({
  title: 'Cleary', date: '2026-10-22',
  documents: [
    { type: 'po', fileName: '10-22-26 Cleary BEVERAGE PO.docx', checksum: 'beverage', sourceProvider: 'dropbox', barReview: { status: 'verified' }, barItems: [{ name: 'Panna', sentQty: 400 }] },
    { type: 'po', fileName: '10-22-26 Cleary GREENROOMS PO.docx', checksum: 'greenrooms', sourceProvider: 'dropbox', barReview: { status: 'needs_review', issues: ['Uncertain row'] } },
    { type: 'po', fileName: '10-25-26 Other PO.docx', checksum: 'other', sourceProvider: 'dropbox', barReview: { status: 'verified' }, barItems: [{ name: 'Other water', sentQty: 99 }] },
  ],
});
test('hydrated event sources retain PO counts, review status and provenance exactly like lean sources', () => {
  const e = event();
  const hydrated = selectBarDocumentsForEvent(e.documents, e);
  const plain = selectBarDocumentsForEvent(e.toObject().documents, e.toObject());
  assert.deepEqual(hydrated, plain);
  assert.equal(hydrated.length, 2);
  const verified = hydrated.filter(d => d.barReview?.status === 'verified');
  assert.equal(verified.length, 1);
  assert.equal(verified[0].barItems[0].sentQty, 400);
  assert.equal(verified[0].fileName, '10-22-26 Cleary BEVERAGE PO.docx');
  assert.equal(verified[0].checksum, 'beverage');
});
test('unverified hydrated PO remains blocking instead of being mistaken for an empty successful import', async () => {
  const e = event();
  const docs = selectBarDocumentsForEvent([e.documents[1]], e);
  let saved;
  assert.equal(await blockUnverifiedBarImport(e, docs, { async updateOne(filter, update) { saved = update; } }), true);
  assert.equal(saved.$set.importReview.status, 'needs_review');
  assert.match(saved.$set.importReview.issues[0], /Uncertain row/);
});
test('valid hydrated PO applies independently and retains counted stock from a failed neighbour', async () => {
  const e = event(); const docs = selectBarDocumentsForEvent(e.documents, e);
  assert.equal(await blockUnverifiedBarImport(e, docs, { updateOne() { throw Error('must not block'); } }), false);
  const incoming = docs.filter(d => d.barReview?.status === 'verified').flatMap(d => d.barItems);
  const items = preserveUninspectedBarItems([{ name: 'Previous wine', sentQty: 12 }], incoming, docs);
  assert.deepEqual(items.map(i => [i.name, i.sentQty]), [['Panna', 400], ['Previous wine', 12]]);
});
