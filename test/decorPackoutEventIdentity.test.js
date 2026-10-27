import test from 'node:test';
import assert from 'node:assert/strict';
import router from '../routes/decorPackouts.js';
import Event from '../models/Event.js';
import Packout from '../models/DecorPackout.js';
import Deck from '../models/Deck.js';
import Page from '../models/Page.js';
const eventId = '507f1f77bcf86cd799439011';
const deckId = '507f1f77bcf86cd799439012';
const pageId = '507f1f77bcf86cd799439013';
const otherDeckId = '507f1f77bcf86cd799439014';
const packoutId = '507f1f77bcf86cd799439015';
const handler = (path, method) => router.stack.find(layer => layer.route?.path === path && layer.route.methods[method]).route.stack.at(-1).handle;
const response = () => ({ code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
for (const status of ['draft', 'complete']) test(`opening packout from a different board reuses the existing ${status} event packout`, async t => {
  const existing = { _id: packoutId, eventId, deckId, pageId, status, items: [{ name: 'Tray', quantity: 2 }], save: async () => {} };
  t.mock.method(Event, 'findById', async () => ({ _id: eventId, title: 'Dinner' }));
  t.mock.method(Packout, 'findOne', filter => { assert.equal(String(filter.eventId), eventId); assert.equal(filter.deckId, undefined); assert.equal(filter.status, undefined); return { sort: async () => existing }; });
  t.mock.method(Packout, 'find', () => ({ sort: async () => [] }));
  t.mock.method(Deck, 'findOne', async () => ({ _id: otherDeckId }));
  t.mock.method(Page, 'findOne', () => ({ sort: async () => ({ _id: pageId }) }));
  t.mock.method(Packout, 'create', () => assert.fail('Opening another board must not create a second packout'));
  const res = response(); await handler('/', 'post')({ body: { eventId, deckId: otherDeckId }, auth: {} }, res);
  assert.equal(res.code, 200); assert.equal(res.body, existing); assert.equal(existing.status, status); assert.equal(existing.items[0].quantity, 2);
});
test('an old archived packout link opens the current packout without writing', async t => {
  const current = { _id: packoutId, eventId, status: 'draft', items: [{ name: 'Tray', quantity: 2 }] };
  t.mock.method(Packout, 'findById', async id => String(id) === otherDeckId ? { _id: otherDeckId, eventId, supersededBy: packoutId } : current);
  t.mock.method(Packout, 'create', () => assert.fail('Reading history must not create'));
  const res = response(); await handler('/:id', 'get')({ params: { id: otherDeckId } }, res);
  assert.equal(res.code, 200); assert.equal(res.body, current);
});
test('history never redirects a packout into another event', async t => {
  t.mock.method(Packout, 'findById', async id => String(id) === otherDeckId
    ? { _id: otherDeckId, eventId, supersededBy: packoutId }
    : { _id: packoutId, eventId: pageId });
  const res = response(); await handler('/:id', 'get')({ params: { id: otherDeckId } }, res);
  assert.notEqual(res.code, 200);
});
test('legacy deck-scoped list requests return the event packout and exclude archived copies', async t => {
  const current = { _id: packoutId, eventId, deckId };
  t.mock.method(Deck, 'findById', () => ({ select: () => ({ lean: async () => ({ eventId }) }) }));
  t.mock.method(Packout, 'find', filter => {
    assert.deepEqual(filter, { supersededBy: null, eventId });
    return { sort: () => ({ limit: async () => [current] }) };
  });
  const res = response(); await handler('/', 'get')({ query: { deckId: otherDeckId } }, res);
  assert.equal(res.code, 200); assert.deepEqual(res.body, [current]);
});
test('simultaneous first opens create one event packout with its normal generated identity', async t => {
  let stored; let attempts = 0;
  t.mock.method(Event, 'findById', async () => ({ _id: eventId, title: 'Dinner' }));
  t.mock.method(Packout, 'findOne', () => ({ sort: async () => stored || null }));
  t.mock.method(Deck, 'findOne', async () => ({ _id: deckId }));
  t.mock.method(Page, 'findOne', () => ({ sort: async () => ({ _id: pageId }) }));
  t.mock.method(Packout, 'create', async payload => {
    attempts++; assert.equal(payload._id, undefined);
    stored = { ...payload, _id: packoutId, status: 'draft', items: [], save: async () => {} }; return stored;
  });
  const a = response(); const b = response();
  await Promise.all([a, b].map(res => handler('/', 'post')({ body: { eventId, deckId }, auth: {} }, res)));
  assert.equal(a.body, stored); assert.equal(b.body, stored); assert.equal(attempts, 1);
  assert.deepEqual([a.code, b.code].sort(), [200, 201]);
});
