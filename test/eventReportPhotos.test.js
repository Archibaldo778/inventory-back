import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { validateReportPhotos, sendReportPhoto } from '../utils/eventReportPhotos.js';
import { completedReportPdf } from '../utils/eventReportFiles.js';
import { sendEventReportEmail } from '../utils/eventReportEmail.js';
import publicRouter from '../routes/publicEventReports.js';
import EventReport from '../models/EventReport.js';
import { issueEventGuestAccess } from '../utils/eventGuestAccess.js';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const response = () => ({ statusCode: 200, headers: {}, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; }, send(value) { this.body = value; return this; }, setHeader(k, v) { this.headers[k] = v; }, type(v) { this.contentType = v; } });

test('report photo validation accepts real photos, normalizes metadata and rejects excessive or disguised uploads', async () => {
  const result = await validateReportPhotos([{ data: png, fileName: '<script>.svg', contentType: 'text/html' }]);
  assert.deepEqual(result.photos, [{ fileName: 'photo-1.png', contentType: 'image/png', size: Buffer.from(png, 'base64').length }]);
  assert.deepEqual(result.photoData, [png]);
  for (const input of [null, {}, Array(6).fill({ data: png }), [{ data: Buffer.from('<svg/>').toString('base64') }], [{ data: 'not base64' }]]) {
    await assert.rejects(validateReportPhotos(input));
  }
  await assert.rejects(validateReportPhotos([{ data: 'a'.repeat(2 * 1024 * 1024) }]), { statusCode: 413 });
  const huge = Buffer.from(png, 'base64'); huge.writeUInt32BE(100000, 16); huge.writeUInt32BE(100000, 20);
  await assert.rejects(validateReportPhotos([{ data: huge.toString('base64') }]));
  assert.deepEqual(await validateReportPhotos(), { photos: [], photoData: [] });
});

test('photos appear in captain and kitchen email attachments and completed PDF pages', async (t) => {
  const previous = process.env.RESEND_API_KEY; process.env.RESEND_API_KEY = 'test-only';
  t.after(() => { if (previous === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = previous; });
  for (const reportType of ['captain', 'kitchen']) {
    const report = { status: 'submitted', eventTitle: 'Dinner', reportType, answers: {}, ...await validateReportPhotos([{ data: png }]) };
    let payload;
    await sendEventReportEmail({ report, event: { meta: { eventReportTest: true } }, generateBrief: async () => ({ summary: 'Service completed.', attention: [] }),
      fetchImpl: async (_url, options) => { payload = JSON.parse(options.body); return { ok: true, json: async () => ({ id: 'mock-only' }) }; } });
    assert.deepEqual(payload.attachments, [{ filename: 'photo-1.png', content: png, content_type: 'image/png' }]);
    const bytes = await completedReportPdf(report, { convert: async () => { const pdf = await PDFDocument.create(); pdf.addPage(); return pdf.save(); } });
    assert.equal((await PDFDocument.load(bytes)).getPageCount(), 2);
    const res = response(); await sendReportPhoto(res, report, '0');
    assert.deepEqual(res.body, Buffer.from(png, 'base64'));
    assert.equal(res.headers['Cache-Control'], 'private, no-store');
    await assert.rejects(sendReportPhoto(response(), report, '1'), { statusCode: 404 });
    await assert.rejects(sendReportPhoto(response(), report, '__proto__'), { statusCode: 404 });
  }
});

test('public photo downloads require the correct event token and select only that reporter', async (t) => {
  const previous = process.env.JWT_SECRET; process.env.JWT_SECRET = 'photo-test-secret';
  t.after(() => { if (previous === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = previous; });
  const eventId = '507f1f77bcf86cd799439011';
  const token = issueEventGuestAccess({ eventIds: [eventId], subjectId: 'slack-captain', capability: 'event:report' });
  const handler = publicRouter.stack.find((l) => l.route?.path === '/:eventId/photos/:index').route.stack.at(-1).handle;
  const fields = await validateReportPhotos([{ data: png }]);
  let reads = 0;
  t.mock.method(EventReport, 'findOne', async (filter) => {
    reads += 1; assert.deepEqual(filter, { eventId, slackUserId: 'slack-captain' });
    return { eventId, reportType: 'captain', ...fields };
  });
  const res = response(); await handler({ params: { eventId, index: '0' }, query: { access: token } }, res);
  assert.equal(res.statusCode, 200); assert.deepEqual(res.body, Buffer.from(png, 'base64'));
  for (const req of [
    { params: { eventId, index: '0' }, query: {} },
    { params: { eventId: '507f1f77bcf86cd799439012', index: '0' }, query: { access: token } },
  ]) { const denied = response(); await handler(req, denied); assert.equal(denied.statusCode, 401); }
  assert.equal(reads, 1);
});

test('stored photo bytes are loaded only for the authorized report, including later PDF downloads', async (t) => {
  const fields = await validateReportPhotos([{ data: png }]);
  t.mock.method(EventReport, 'findById', (id) => {
    assert.equal(id, 'authorized-report');
    return { select: (selection) => {
      assert.equal(selection, '+photoData');
      return { lean: async () => ({ photoData: fields.photoData }) };
    } };
  });
  const report = { _id: 'authorized-report', status: 'submitted', photos: fields.photos };
  const res = response(); await sendReportPhoto(res, report, '0');
  assert.deepEqual(res.body, Buffer.from(png, 'base64'));
  const bytes = await completedReportPdf(report, { convert: async () => { const pdf = await PDFDocument.create(); pdf.addPage(); return pdf.save(); } });
  assert.equal((await PDFDocument.load(bytes)).getPageCount(), 2);
});
