import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';
import router from '../routes/eventReportFiles.js';
import reportsRouter from '../routes/eventReports.js';
import Event from '../models/Event.js';
import EventReport from '../models/EventReport.js';
import EventReportFile from '../models/EventReportFile.js';
import { completedReportPdf, validateReportPdf, publicReportFile, MAX_REPORT_PDF_BYTES } from '../utils/eventReportFiles.js';
import { analyzeEventReports, eventReportAnalysisIsStale } from '../utils/eventReportAi.js';

const eventId = '507f1f77bcf86cd799439011';
const fileId = '507f1f77bcf86cd799439012';
const handler = (routes, path, method) => routes.stack.find((layer) => layer.route?.path === path && layer.route.methods[method]).route.stack.at(-1).handle;
const response = () => ({ statusCode: 200, headers: {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, send(body) { this.body = body; return this; }, setHeader(key, value) { this.headers[key] = value; }, type(value) { this.contentType = value; }, attachment(value) { this.fileName = value; } });
const pdfBytes = async (pages = 1) => { const doc = await PDFDocument.create(); for (let i = 0; i < pages; i++) doc.addPage(); return Buffer.from(await doc.save()); };

test('PDF upload validates bytes, file size and page count, and keeps content out of metadata', async () => {
  const buffer = await pdfBytes();
  const fields = await validateReportPdf({ originalname: 'kitchen.pdf', buffer });
  assert.equal(fields.pageCount, 1);
  assert.equal(fields.size, buffer.length);
  assert.deepEqual(fields.data, buffer);
  assert.equal(fields.checksum.length, 64);
  const metadata = publicReportFile({ _id: fileId, eventId, ...fields });
  assert.equal(metadata.fileName, 'kitchen.pdf');
  assert.equal(metadata.data, undefined);
  assert.equal(metadata.checksum, undefined);
  for (const file of [undefined, { originalname: 'x.pdf', buffer: Buffer.from('not a PDF') }, { originalname: 'x.txt', buffer }, { originalname: 'x.pdf', buffer: Buffer.from('%PDF-broken') }, { originalname: 'x.pdf', buffer: await pdfBytes(101) }]) {
    await assert.rejects(validateReportPdf(file), { statusCode: 400 });
  }
  await assert.rejects(validateReportPdf({ originalname: 'large.pdf', buffer: Buffer.concat([buffer, Buffer.alloc(MAX_REPORT_PDF_BYTES)]) }), { statusCode: 413 });
});

test('upload stores a PDF under the event once and returns no private bytes', async (t) => {
  const buffer = await pdfBytes();
  t.mock.method(Event, 'exists', async (filter) => { assert.deepEqual(filter, { _id: eventId }); return true; });
  let saved;
  t.mock.method(EventReportFile, 'findOne', async (filter) => { assert.equal(filter.eventId, eventId); return saved; });
  const create = t.mock.method(EventReportFile, 'create', async (fields) => (saved = { _id: fileId, ...fields }));
  for (let i = 0; i < 2; i++) {
    const res = response();
    await handler(router, '/events/:eventId/files', 'post')({ params: { eventId }, auth: { email: 'admin@example.com' }, file: { originalname: 'report.pdf', buffer } }, res);
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.file.id, fileId);
    assert.equal(res.body.file.data, undefined);
  }
  assert.equal(create.mock.callCount(), 1);
  assert.deepEqual(saved.data, buffer);
  assert.equal(saved.uploadedBy, 'admin@example.com');
});

test('PDF downloads and removal are scoped to the event; non-admins cannot access the router', async (t) => {
  for (const role of ['captain', 'bar captain', 'event staff', 'user']) {
    const res = response();
    router.stack[0].handle({ auth: { role } }, res, () => assert.fail('must not grant access'));
    assert.equal(res.statusCode, 403);
  }
  let allowed = false;
  router.stack[0].handle({ auth: { role: 'admin' } }, response(), () => { allowed = true; });
  assert.equal(allowed, true);
  const buffer = await pdfBytes();
  let found = { fileName: 'chef.pdf', data: buffer };
  t.mock.method(EventReportFile, 'findOne', (filter) => {
    assert.deepEqual(filter, { _id: fileId, eventId });
    return { select: (fields) => { assert.equal(fields, '+data'); return Promise.resolve(found); } };
  });
  const req = { params: { eventId, fileId } };
  const res = response();
  await handler(router, '/events/:eventId/files/:fileId', 'get')(req, res);
  assert.deepEqual(res.body, buffer);
  assert.equal(res.contentType, 'application/pdf');
  assert.equal(res.fileName, 'chef.pdf');
  assert.equal(res.headers['Cache-Control'], 'private, no-store');
  found = null;
  const missing = response();
  await handler(router, '/events/:eventId/files/:fileId', 'get')(req, missing);
  assert.equal(missing.statusCode, 404);
  t.mock.method(EventReportFile, 'findOneAndDelete', async (filter) => { assert.deepEqual(filter, { _id: fileId, eventId }); return null; });
  const removed = response();
  await handler(router, '/events/:eventId/files/:fileId', 'delete')(req, removed);
  assert.equal(removed.statusCode, 404);
});

test('completed report export includes captain and kitchen answers, Unicode and long text; drafts cannot be exported', async () => {
  const output = await pdfBytes();
  for (const reportType of ['captain', 'kitchen']) {
    const answerKey = reportType === 'captain' ? 'overallFeedback' : 'foodQuality';
    const report = { reportType, status: 'submitted', eventTitle: 'Dinner & <service>', eventDate: '2026-10-01', reporterName: 'Иван — Chef José', answers: { [answerKey]: 'Long answer '.repeat(200) + 'END', followUpRequired: true } };
    const converted = await completedReportPdf(report, { convert: async ({ fileName, buffer }) => {
      assert.equal(fileName, 'event-report.docx');
      const zip = await JSZip.loadAsync(buffer);
      const xml = await zip.file('word/document.xml').async('string');
      assert.ok(xml.includes('Иван — Chef José'));
      assert.ok(xml.includes('Dinner &amp; &lt;service&gt;'));
      assert.ok(xml.includes('Long answer '.repeat(200) + 'END'));
      assert.ok(xml.includes(reportType === 'kitchen' ? 'KITCHEN REPORT' : "CAPTAIN'S REPORT"));
      return output;
    } });
    assert.deepEqual(converted, output);
  }
  await assert.rejects(completedReportPdf({ status: 'pending' }, { convert: () => assert.fail('do not convert drafts') }), { statusCode: 409 });
});

test('AI sends actual PDF content alongside form answers, including when the PDF is the only report', async () => {
  const data = await pdfBytes();
  for (const reports of [[], [{ reportType: 'captain', reporterName: 'Captain', answers: { overallFeedback: 'Service went well' } }]]) {
    const result = await analyzeEventReports({ apiKey: 'test-key', event: { title: 'Dinner' }, reports, files: [{ fileName: 'chef.pdf', data, pageCount: 1 }], fetchImpl: async (_url, options) => {
      const body = JSON.parse(options.body);
      const [text, pdf] = body.input[0].content;
      assert.equal(JSON.parse(text.text).reports.length, reports.length);
      assert.equal(pdf.type, 'input_file');
      assert.equal(pdf.filename, 'chef.pdf');
      assert.deepEqual(Buffer.from(pdf.file_data.split(',')[1], 'base64'), data);
      assert.equal(body.store, false);
      return { ok: true, json: async () => ({ output_text: JSON.stringify({ summary: 'Dinner completed', problems: [], positives: [], risks: [], recommendations: [] }) }) };
    } });
    assert.equal(result.analysis.summary, 'Dinner completed');
  }
  await assert.rejects(analyzeEventReports({ apiKey: 'key', files: Array(21).fill({ data }), fetchImpl: () => assert.fail('too many PDFs') }), { statusCode: 413 });
  await assert.rejects(analyzeEventReports({ apiKey: 'key', files: [{ data, pageCount: 201 }], fetchImpl: () => assert.fail('too many pages') }), { statusCode: 413 });
});

test('analysis is invalidated by adding/removing a PDF or resubmitting a form', () => {
  const analysis = { reportIds: ['r'], fileIds: ['f'], generatedAt: '2026-10-01T12:00:00Z' };
  const reports = [{ _id: 'r', status: 'submitted', submittedAt: '2026-10-01T11:00:00Z' }];
  assert.equal(eventReportAnalysisIsStale(analysis, reports, [{ _id: 'f' }]), false);
  assert.equal(eventReportAnalysisIsStale(analysis, reports, []), true);
  assert.equal(eventReportAnalysisIsStale(analysis, reports, [{ _id: 'f' }, { _id: 'g' }]), true);
  assert.equal(eventReportAnalysisIsStale(analysis, [{ ...reports[0], submittedAt: '2026-10-01T13:00:00Z' }], [{ _id: 'f' }]), true);
});

test('ordinary event listing includes private PDF metadata and enables analysis without test mode', async (t) => {
  t.mock.method(EventReport, 'find', () => ({ sort: () => ({ limit: () => ({ lean: async () => [] }) }) }));
  t.mock.method(Event, 'findById', () => ({ select: () => ({ lean: async () => ({ _id: eventId, meta: {} }) }) }));
  t.mock.method(EventReportFile, 'find', (filter) => {
    assert.deepEqual(filter, { eventId });
    return { sort: () => ({ lean: async () => [{ _id: fileId, eventId, fileName: 'old-report.pdf', data: Buffer.from('private') }] }) };
  });
  const res = response();
  await handler(reportsRouter, '/', 'get')({ query: { eventId } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ai.enabledForEvent, true);
  assert.equal(res.body.files[0].fileName, 'old-report.pdf');
  assert.equal(res.body.files[0].data, undefined);
});

test('AI endpoint analyzes an ordinary event with only an uploaded PDF and saves its source ID', async (t) => {
  const oldKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'test-key';
  t.after(() => { if (oldKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = oldKey; });
  const data = await pdfBytes();
  t.mock.method(Event, 'findById', () => ({ select: () => ({ lean: async () => ({ _id: eventId, title: 'Ordinary dinner', meta: {} }) }) }));
  t.mock.method(EventReport, 'find', (filter) => {
    assert.deepEqual(filter, { eventId, status: 'submitted' });
    return { sort: () => ({ limit: () => ({ lean: async () => [] }) }) };
  });
  t.mock.method(EventReportFile, 'find', (filter) => {
    assert.deepEqual(filter, { eventId });
    return { select: () => ({ sort: () => ({ limit: async () => [{ _id: fileId, fileName: 'chef.pdf', data, pageCount: 1 }] }) }) };
  });
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    assert.equal(JSON.parse(options.body).input[0].content[1].filename, 'chef.pdf');
    return { ok: true, json: async () => ({ output_text: JSON.stringify({ summary: 'The chef reported successful service' }) }) };
  });
  let saved;
  t.mock.method(Event, 'updateOne', async (filter, update) => { assert.deepEqual(filter, { _id: eventId }); saved = update.$set['meta.eventReportAnalysis']; });
  const res = response();
  await handler(reportsRouter, '/:eventId/analysis', 'post')({ params: { eventId }, auth: { email: 'admin@example.com' } }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(saved.reportCount, 1);
  assert.deepEqual(saved.fileIds, [fileId]);
  assert.deepEqual(saved.reportIds, []);
  assert.equal(saved.summary, 'The chef reported successful service');
});

test('completed report download rejects drafts and missing records before conversion', async (t) => {
  let report = { status: 'pending' };
  t.mock.method(EventReport, 'findById', () => ({ lean: async () => report }));
  const draft = response();
  await handler(router, '/:reportId/pdf', 'get')({ params: { reportId: fileId } }, draft);
  assert.equal(draft.statusCode, 409);
  report = null;
  const missing = response();
  await handler(router, '/:reportId/pdf', 'get')({ params: { reportId: fileId } }, missing);
  assert.equal(missing.statusCode, 404);
});
