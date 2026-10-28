import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import router from '../routes/decorPackouts.js';
import Packout from '../models/DecorPackout.js';
import Deck from '../models/Deck.js';
import Page from '../models/Page.js';
import Event from '../models/Event.js';
import Product from '../models/Product.js';
const oid = n => n.toString(16).padStart(24, '0');
const handler = router.stack.find(l => l.route?.path === '/:id/export' && l.route.methods.get).route.stack.at(-1).handle;
for (const count of [1, 3, 5]) for (const status of ['draft', 'complete']) test(`Word includes all ${count} boards for a ${status} packout without database writes`, async t => {
  const eventId = oid(1); const packoutId = oid(2);
  const decks = Array.from({ length: count }, (_, i) => ({ _id: oid(10+i), title: `Zone ${i+1}` }));
  const pages = decks.map((deck,i) => ({ _id: oid(30+i), deckId: deck._id, revision: 4, canvas: { images: [{ id: `manual-${i}`, inventoryCode: `OCC${String(i+1).padStart(5, '0')}`, name: `Tray ${i+1}`, quantity: i+2 }] } }));
  const packout = { _id: packoutId, eventId, deckId: decks[0]._id, pageId: pages[0]._id, status,
    items: [{ _id: oid(50), name: 'Tray 1', inventoryCode: 'OCC00001', quantity: 2, boardItemId: 'manual-0', deckId: decks[0]._id, pageId: pages[0]._id }],
    save: async () => assert.fail('Export must not save a packout') };
  t.mock.method(Packout, 'findById', async () => packout);
  t.mock.method(Packout, 'find', () => ({ select: () => ({ lean: async () => [] }) }));
  t.mock.method(Deck, 'find', query => { assert.equal(String(query.eventId), eventId); return { sort: () => ({ lean: async () => decks }) }; });
  t.mock.method(Page, 'find', query => { assert.deepEqual(query.deckId.$in, decks.map(d=>d._id)); assert.equal(query.deletedAt, null); return { sort: () => ({ lean: async () => pages }) }; });
  t.mock.method(Product, 'find', () => ({ lean: async () => [] }));
  t.mock.method(Event, 'findById', () => ({ select: () => ({ lean: async () => ({ title: 'Dinner', date: '2026-10-28' }) }) }));
  for (const model of [Page, Packout]) for (const method of ['updateOne','findOneAndUpdate','create','deleteOne']) t.mock.method(model, method, () => assert.fail('Export must not write'));
  t.mock.method(globalThis, 'fetch', async () => ({ ok: false }));
  const res = { code: 200, status(code) { this.code=code;return this; }, json(body) { this.body=body;return this; }, setHeader() {}, send(body) { this.body=body;return this; } };
  await handler({ params: { id: packoutId } },res); assert.equal(res.code,200);
  const zip=await JSZip.loadAsync(res.body);const xml=await zip.file('word/document.xml').async('string');
  for(let i=0;i<count;i++){assert.ok(xml.includes(`Tray ${i+1}`),`Missing tray ${i+1}`);assert.ok(xml.includes(`ZONE ${i+1}`),`Missing zone ${i+1}`);}
  for (let i = 0; i < count; i++) {
    const row = xml.match(/<w:tr[ >][\s\S]*?<\/w:tr>/g).find(value => value.includes(`Tray ${i+1}`));
    assert.ok(row.includes(`>${i+2}</w:t>`), `Wrong quantity for Tray ${i+1}`);
  }
  assert.equal(packout.status,status);
});
