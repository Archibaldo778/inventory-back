import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeMenuCard, menuCardRevision } from '../utils/eventMenuCards.js';
import router from '../routes/eventMenuCards.js';
import EventMenuCard from '../models/EventMenuCard.js';
import Event from '../models/Event.js';

const eventId = '507f1f77bcf86cd799439011';
const cardId = '507f1f77bcf86cd799439012';
const sample = () => ({ name: 'Dinner', design: { width: 5, height: 8, font: 'helvetica', fontSize: 11, spacing: 1,
  frame: 'single', alignment: 'top', logoMode: 'occ', logoData: '', logoWidth: 1.4, title: '', footer: '',
  sections: [{ heading: 'FIRST COURSE', body: 'Salad\nSeasonal vegetables (GF)' }] } });
const response = () => ({ code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
const handler = (method, path) => router.stack.find((layer) => layer.route?.path === path && layer.route.methods[method]).route.stack.at(-1).handle;

test('menu cards preserve print dimensions, logo options, editable sections and ignore injected ownership', () => {
  for (const [width, height] of [[4, 6], [5, 7], [5, 8], [4, 9], [8.5, 11], [7, 5]]) {
    const input = sample(); Object.assign(input.design, { width, height });
    const result = normalizeMenuCard({ ...input, eventId: 'other', revision: 90 });
    assert.deepEqual(result, input);
  }
  const input = sample(); input.design.logoMode = 'none'; input.design.sections[0].body = 'A\r\nB';
  assert.equal(normalizeMenuCard(input).design.sections[0].body, 'A\nB');
  assert.equal(normalizeMenuCard(input).design.logoMode, 'none');
});

test('menu card validation rejects unsafe logos, invalid choices, oversized content and missing revisions', () => {
  for (const patch of [{ width: 0 }, { height: Infinity }, { frame: 'unknown' }, { font: 'script' }, { fontSize: 30 },
    { sections: [] }, { sections: [{ heading: '', body: 'a'.repeat(5001) }] },
    { logoData: 'https://external.example/logo.png' }, { logoMode: 'client', logoData: '' },
    { logoData: 'data:image/svg+xml;base64,PHN2Zy8+' }, { logoData: 'data:image/png;base64,YmFk' }]) {
    const input = sample(); Object.assign(input.design, patch);
    assert.throws(() => normalizeMenuCard(input), (error) => error.statusCode === 400);
  }
  for (const value of [undefined, null, -1, '0', 0.5]) assert.throws(() => menuCardRevision(value));
  assert.equal(menuCardRevision(0), 0);
  const input = sample(); input.design.logoMode = 'client';
  input.design.logoData = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAADklEQVR4nGNQUlL6D8IACf8CyyctDdQAAAAASUVORK5CYII=';
  assert.equal(normalizeMenuCard(input).design.logoData, input.design.logoData);
});

test('sales users can open menu cards; captains, staff and packers cannot', () => {
  const guard = router.stack[0].handle;
  for (const role of ['sales rep', 'manager', 'admin', 'super admin', 'captain', 'event staff', 'packer']) {
    const res = response(); let allowed = false;
    guard({ auth: { role } }, res, () => { allowed = true; });
    assert.equal(allowed, ['sales rep', 'manager', 'admin', 'super admin'].includes(role));
    if (!allowed) assert.equal(res.code, 403);
  }
});

test('menu routes reject missing or deleted events before loading cards', async (t) => {
  let event = null;
  t.mock.method(Event, 'findById', () => ({ select: () => ({ lean: async () => event }) }));
  const guard = router.stack[1].handle;
  for (event of [null, { status: 'deleted' }]) {
    const res = response(); await guard({ params: { eventId } }, res, () => assert.fail('Must not allow this event'));
    assert.equal(res.code, 404);
  }
  event = { _id: eventId, title: 'Tasting' };
  const req = { params: { eventId } }; let allowed = false;
  await guard(req, response(), () => { allowed = true; });
  assert.equal(allowed, true); assert.equal(req.menuEvent.title, 'Tasting');
});

test('menu list and creation are scoped to the selected event and preserve other cards', async (t) => {
  let query; let created;
  t.mock.method(EventMenuCard, 'find', (filter) => { query = filter; return { sort: () => ({ lean: async () => [{ ...sample(), _id: cardId }] }) }; });
  t.mock.method(EventMenuCard, 'create', async (data) => { created = data; return { _id: cardId, ...data }; });
  const req = { params: { eventId }, menuEvent: { _id: eventId, title: 'Tasting' }, auth: { userId: 'sales-person' }, body: { ...sample(), eventId: 'wrong', revision: 99 } };
  const list = response(); await handler('get', '/')(req, list);
  assert.deepEqual(query, { eventId }); assert.equal(list.body.cards.length, 1);
  const create = response(); await handler('post', '/')(req, create);
  assert.equal(create.code, 201); assert.equal(created.eventId, eventId); assert.equal(created.revision, 0); assert.equal(created.updatedBy, 'sales-person');
});

test('concurrent saves require the current revision and cannot write to another event', async (t) => {
  let update; let filter;
  let revision = 2;
  t.mock.method(EventMenuCard, 'findOneAndUpdate', async (query, mutation) => {
    filter = query; update = mutation;
    if (query.eventId !== eventId || query.revision !== revision) return null;
    revision += 1; return { _id: cardId, ...mutation.$set, revision };
  });
  const req = { params: { eventId, cardId }, auth: { userId: 'sales' }, body: { ...sample(), expectedRevision: 2 } };
  const first = response(); await handler('patch', '/:cardId')(req, first);
  assert.equal(first.code, 200); assert.equal(first.body.card.revision, 3);
  assert.deepEqual(filter, { _id: cardId, eventId, revision: 2 }); assert.deepEqual(update.$inc, { revision: 1 });
  const stale = response(); await handler('patch', '/:cardId')(req, stale);
  assert.equal(stale.code, 409); assert.equal(revision, 3);
  const other = response(); await handler('patch', '/:cardId')({ ...req, params: { eventId: 'other', cardId }, body: { ...sample(), expectedRevision: 3 } }, other);
  assert.equal(other.code, 409); assert.equal(revision, 3);
});
