import test from 'node:test';
import assert from 'node:assert/strict';
import router, { requireVenueEditor } from '../routes/venues.js';
import Venue from '../models/Venue.js';
import VenueNote from '../models/VenueNote.js';
import { requireAdmin } from '../middleware/auth.js';

const venueId = '507f1f77bcf86cd799439011'; const noteId = '507f1f77bcf86cd799439012';
const response = () => ({ code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
const handler = (path, method) => router.stack.find((layer) => layer.route?.path === path && layer.route.methods[method]).route.stack.at(-1).handle;
const auth = { role: 'admin', username: 'Admin A' };
const body = { category: 'boh', kind: 'concern', status: 'resolved', resolution: 'Venue confirmed a larger BOH', expectedRevision: 2 };

test('venue read access excludes captains and packers; department admins can read but cannot modify', () => {
  for (const role of ['captain', 'packer', 'user']) {
    const res = response(); requireAdmin({ auth: { role } }, res, () => assert.fail('Must be denied')); assert.equal(res.code, 403);
  }
  for (const role of ['kitchen admin', 'staffing admin']) {
    let allowed = false; requireAdmin({ auth: { role } }, response(), () => { allowed = true; }); assert.equal(allowed, true);
    const res = response(); requireVenueEditor({ auth: { role } }, res, () => assert.fail('Must be denied')); assert.equal(res.code, 403);
  }
  let allowed = false; requireVenueEditor({ auth: { role: 'user', jobTitle: 'team manager' } }, response(), () => { allowed = true; }); assert.equal(allowed, true);
});

test('review updates are scoped to the venue and revision and never change source text', async (t) => {
  let filter; let update;
  t.mock.method(VenueNote, 'findOneAndUpdate', async (query, changes) => { filter = query; update = changes; return { _id: noteId, ...changes.$set }; });
  const res = response();
  await handler('/:id/notes/:noteId', 'patch')({ params: { id: venueId, noteId }, auth, body: { ...body, text: 'overwrite original', source: 'manual', sourceReportId: noteId } }, res);
  assert.equal(res.code, 200); assert.deepEqual(filter, { _id: noteId, venueId, revision: 2 });
  assert.equal(update.$set.text, undefined); assert.equal(update.$set.source, undefined);
  assert.equal(update.$inc.revision, 1); assert.equal(update.$push.history.actor, 'Admin A');
  assert.equal(update.$push.history.status, 'resolved');
});

test('concurrent stale edits fail with 409 instead of overwriting a review', async (t) => {
  t.mock.method(VenueNote, 'findOneAndUpdate', async () => null);
  const res = response(); await handler('/:id/notes/:noteId', 'patch')({ params: { id: venueId, noteId }, auth, body }, res);
  assert.equal(res.code, 409);
});

test('venue identity updates preserve all notes and require the current revision', async (t) => {
  let filter; let update;
  t.mock.method(Venue, 'findOneAndUpdate', async (query, changes) => { filter = query; update = changes; return { _id: venueId }; });
  const res = response(); await handler('/:id', 'patch')({ params: { id: venueId }, auth, body: { name: 'N Hall', address: '10 Main Street', aliases: ['Venue N'], expectedRevision: 3, notes: [] } }, res);
  assert.equal(res.code, 200); assert.equal(filter.revision, 3); assert.equal(update.$set.notes, undefined);
  assert.deepEqual(update.$set.identityKeys.sort(), ['n hall|10 main street', 'venue n|10 main street']);
  const missing = response(); await handler('/:id', 'patch')({ params: { id: venueId }, body: { name: 'N' } }, missing); assert.equal(missing.code, 400);
});

test('duplicate venue names at the same address return a conflict and do not create a second venue', async (t) => {
  t.mock.method(Venue, 'create', async () => { throw Object.assign(Error('duplicate'), { code: 11000 }); });
  const res = response(); await handler('/', 'post')({ auth, body: { name: 'N Hall', address: '10 Main Street' } }, res);
  assert.equal(res.code, 409);
});

test('manual notes can preserve positive Caterease feedback without pretending to be an imported captain report', async (t) => {
  t.mock.method(Venue, 'exists', async () => ({ _id: venueId }));
  let saved; t.mock.method(VenueNote, 'create', async (payload) => { saved = payload; return payload; });
  const res = response(); await handler('/:id/notes', 'post')({ params: { id: venueId }, auth, body: {
    text: 'The freight elevator works very well.', source: 'caterease', sourceLabel: 'Venue record', category: 'access', kind: 'positive', status: 'active', sourceReportId: noteId,
  } }, res);
  assert.equal(res.code, 201); assert.equal(saved.kind, 'positive'); assert.equal(saved.source, 'caterease');
  assert.equal(saved.sourceReportId, undefined); assert.equal(saved.history[0].actor, 'Admin A');
});
