import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import router, { createGuestBarDocumentReader } from '../routes/publicBarReturns.js';
import BarEvent from '../models/BarEvent.js';
import BeverageItem from '../models/BeverageItem.js';
import { readDropboxDocxMetadata } from '../utils/dropboxDocxMetadata.js';
const id = '68c70548aea053de74d25b22';
const response = () => ({ code: 200, payload: null, status(code) { this.code = code; return this; }, json(payload) { this.payload = payload; return this; } });
const request = () => ({ params: { eventId: id }, guestAccess: { eventId: id }, file: { originalname: 'PO.docx', buffer: Buffer.from('test') } });

test('guest document route requires a guest session before its handler', () => {
  const guardIndex = router.stack.findIndex((layer) => layer.name === 'requireGuestSession');
  const routeIndex = router.stack.findIndex((layer) => layer.route?.path === '/:eventId/packout/read-document');
  assert.ok(guardIndex >= 0 && routeIndex > guardIndex);
  const res = response();
  router.stack[guardIndex].handle({ get: () => '', headers: {} }, res, () => assert.fail('unauthenticated request allowed'));
  assert.equal(res.code, 401);
});

test('guest AI rejects other events, closed returns and existing packouts without reading or saving', async (t) => {
  for (const event of [
    { _id: '68c7047faea053de74d25b15', status: 'draft', items: [] },
    { _id: id, status: 'submitted', items: [] },
    { _id: id, status: 'draft', items: [{ name: 'Existing wine' }] },
  ]) {
    const stub = t.mock.method(BarEvent, 'findById', async () => event);
    const res = response();
    await createGuestBarDocumentReader({ readMetadata: () => assert.fail('must not invoke AI') })(request(), res);
    assert.equal(res.code, event._id === id ? 409 : 403);
    stub.mock.restore();
  }
});

test('guest AI returns only verified drinks and catalog matches from a DOCX containing food', async (t) => {
  const event = { _id: id, status: 'draft', items: [], save: () => assert.fail('reading must not save') };
  t.mock.method(BarEvent, 'findById', async () => event);
  t.mock.method(BeverageItem, 'find', () => ({ select: () => ({ lean: async () => [{ _id: 'tequila-id', name: 'Tequila', aliases: [] }] }) }));
  const zip = new JSZip();
  zip.file('word/document.xml', '<w:document><w:body><w:p><w:r><w:t>RAW BAR oysters; Tequila 2; SPICY MARGARITA 20</w:t></w:r></w:p></w:body></w:document>');
  const req = request(); req.file.buffer = await zip.generateAsync({ type: 'nodebuffer' });
  const res = response();
  await createGuestBarDocumentReader({ readMetadata: (buffer, options) => readDropboxDocxMetadata(buffer, {
    ...options, inspectBar: async ({ text }) => {
      assert.match(text, /RAW BAR oysters/);
      return { status: 'verified', issues: [], items: [
        { name: 'Tequila', scope: 'alcohol', quantity: 2 },
        { name: 'SPICY MARGARITA', scope: 'cocktail', quantity: 20 },
      ] };
    },
  }) })(req, res);
  assert.equal(res.code, 200);
  assert.deepEqual(res.payload.items.map((item) => [item.name, item.quantity]), [['Tequila', 2], ['SPICY MARGARITA', 20]]);
  assert.equal(String(res.payload.items[0].beverageItemId), 'tequila-id');
  assert.equal(res.payload.review.status, 'verified');
  assert.deepEqual(event.items, []);
});

test('unverified guest document returns Needs review without partial items or writes', async (t) => {
  const event = { _id: id, status: 'draft', items: [], save: () => assert.fail('must not save') };
  t.mock.method(BarEvent, 'findById', async () => event);
  const res = response();
  await createGuestBarDocumentReader({ readMetadata: async () => ({
    barReview: { status: 'needs_review', issues: ['Parser disagreement: missing wine'] }, barItems: [{ name: 'Partial drink' }],
  }) })(request(), res);
  assert.equal(res.code, 422);
  assert.match(res.payload.message, /Needs review: Parser disagreement/);
  assert.equal(res.payload.items, undefined);
  assert.deepEqual(event.items, []);
});

test('guest DOCX upload rejects more than 12 MB before the AI handler', async () => {
  const { PassThrough } = await import('node:stream');
  const body = Buffer.concat([
    Buffer.from('--test-boundary\r\nContent-Disposition: form-data; name="file"; filename="PO.docx"\r\nContent-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document\r\n\r\n'),
    Buffer.alloc(12 * 1024 * 1024 + 1, 65),
    Buffer.from('\r\n--test-boundary--\r\n'),
  ]);
  const req = new PassThrough();
  req.headers = { 'content-type': 'multipart/form-data; boundary=test-boundary', 'content-length': String(body.length) };
  req.ip = 'test-size-limit';
  const res = response();
  const completed = new Promise((resolve) => { res.json = (payload) => { res.payload = payload; resolve(); return res; }; });
  const route = router.stack.find((layer) => layer.route?.path === '/:eventId/packout/read-document').route;
  route.stack[0].handle(req, res, () => assert.fail('oversized file reached AI handler'));
  req.end(body);
  await completed;
  assert.equal(res.code, 413);
  assert.match(res.payload.message, /12 MB/);
});
