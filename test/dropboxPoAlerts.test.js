import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { extractDropboxPoItems } from '../utils/dropboxPoItems.js';
import { readDropboxDocxMetadata } from '../utils/dropboxDocxMetadata.js';
import { findAutomationMatches } from '../utils/automationAlerts.js';
import { planDropboxPoAlert, deliverDropboxPoAlert, loadPoAlertItems, poDeliverySignature, runDropboxPoAlerts } from '../utils/dropboxPoAlerts.js';
import Policy from '../models/AutomationAlertPolicy.js';
import Rule from '../models/AutomationAlertRule.js';
import Delivery from '../models/AutomationAlertDelivery.js';
import Document from '../models/DropboxDocument.js';
import Integration from '../models/DropboxIntegration.js';
import Event from '../models/Event.js';
import alertsRouter from '../routes/automationAlerts.js';

const activatedAt = new Date('2026-10-01T12:00:00Z');
const event = { _id: 'event-1', title: 'Dinner', date: '2026-10-04', status: 'active', documents: [{ type: 'po', sourceProvider: 'dropbox', sourceId: 'dbx-1' }] };
const rule = { _id: 'rule-1', enabled: true, name: 'PO Scanner', department: 'Operations', matchTerms: ['White Gloves', 'Steamer'], recipients: ['ops@example.com'] };
const doc = { _id: 'doc-1', dropboxId: 'dbx-1', importedEventId: event._id, documentType: 'po', status: 'imported', isLatestRevision: true,
  path: '/Proposals/2026/October/Dinner/PO.docx', sourceOrigin: 'external', rev: 'r1', contentInspectedRev: 'r1', contentInspectionError: '', firstSeenAt: new Date('2026-10-02T14:00:00Z'),
  poAlertParserVersion: 1, poAlertItems: [{ itemName: 'White Gloves', quantity: 10 }] };
const plan = (overrides) => planDropboxPoAlert({ event, documents: [doc], activatedAt, now: new Date('2026-10-02T14:01:00Z'), ...overrides });
const sent = (stage, time) => ({ source: 'dropbox_po', eventDate: event.date, stage, status: 'sent', sentAt: new Date(time) });

test('new PO sends immediately and again at 08:00 New York the day before, not on every scan', () => {
  assert.equal(plan({}), 'arrival');
  const deliveries = [sent('arrival', '2026-10-02T14:02:00Z')];
  assert.equal(plan({ deliveries }), null);
  assert.equal(plan({ deliveries, now: new Date('2026-10-03T11:59:59Z') }), null);
  assert.equal(plan({ deliveries, now: new Date('2026-10-03T12:00:00Z') }), 'packing');
  deliveries.push(sent('packing', '2026-10-03T12:00:00Z'));
  assert.equal(plan({ deliveries, now: new Date('2026-10-03T18:00:00Z') }), null);
  assert.equal(plan({ deliveries, now: new Date('2026-10-04T14:00:00Z') }), null);
});

test('PO arriving the day before (before or after 08:00), or on event day, uses one delivery key', () => {
  for (const time of ['2026-10-03T10:00:00Z', '2026-10-03T17:00:00Z', '2026-10-04T17:00:00Z']) {
    const documents = [{ ...doc, firstSeenAt: new Date(time) }];
    assert.equal(plan({ documents, now: new Date(time) }), 'packing');
    assert.equal(plan({ documents, now: new Date(time), deliveries: [sent('packing', time)] }), null);
  }
  assert.equal(plan({ now: new Date('2026-10-03T12:00:00Z'), deliveries: [sent('arrival', '2026-10-03T10:00:00Z')] }), null);
});

test('rollout never bulk-sends existing POs, but still reminds for a future event on packing day', () => {
  const documents = [{ ...doc, firstSeenAt: new Date('2026-09-01T12:00:00Z') }];
  assert.equal(plan({ documents }), null);
  assert.equal(plan({ documents, now: new Date('2026-10-03T12:00:00Z') }), 'packing');
  assert.equal(plan({ documents, now: new Date('2026-10-04T12:00:00Z') }), null);
  assert.equal(plan({ now: new Date('2026-10-05T12:00:00Z') }), null);
  const legacy = { status: 'sent', sentAt: new Date('2026-10-02T12:00:00Z') };
  assert.equal(plan({ deliveries: [legacy] }), null);
  assert.equal(plan({ deliveries: [legacy], now: new Date('2026-10-03T12:00:00Z') }), 'packing');
  assert.equal(plan({ deliveries: [{ ...legacy, sentAt: new Date('2026-10-03T10:00:00Z') }], now: new Date('2026-10-03T12:00:00Z') }), null);
});

test('08:00 scheduling uses New York calendar dates across DST and year boundaries', () => {
  const documents = [{ ...doc, firstSeenAt: new Date('2025-01-01T12:00:00Z') }];
  for (const [date, before, due] of [
    ['2026-03-09', '2026-03-08T11:59:00Z', '2026-03-08T12:00:00Z'],
    ['2026-11-02', '2026-11-01T12:59:00Z', '2026-11-01T13:00:00Z'],
    ['2027-01-01', '2026-12-31T12:59:00Z', '2026-12-31T13:00:00Z'],
  ]) {
    assert.equal(plan({ event: { ...event, date }, documents, now: new Date(before) }), null);
    assert.equal(plan({ event: { ...event, date }, documents, now: new Date(due) }), 'packing');
  }
});

test('deleted, cancelled, undated events and unconfirmed, superseded, generated or Notes documents never mail', () => {
  for (const patch of [{ status: 'deleted' }, { status: 'cancelled' }, { status: 'lost' }, { meta: { nowsta: { excluded: true } } }, { date: '' }, { date: '2026-02-30' }, { catereaseOperations: { eventStatus: 'Canceled' } }]) assert.equal(plan({ event: { ...event, ...patch } }), null);
  for (const patch of [{ documentType: 'kitchen_menu' }, { status: 'review' }, { status: 'deleted' }, { isLatestRevision: false },
    { sourceOrigin: 'occ_generated' }, { path: '/Event/Notes/PO.docx' }, { contentInspectionError: 'parse failed' }, { rev: 'r2' }]) {
    assert.equal(plan({ documents: [{ ...doc, ...patch }] }), null);
  }
});

test('REV files and renames do not add deliveries; a rescheduled event has its own packing date', () => {
  const deliveries = [sent('arrival', '2026-10-02T14:02:00Z')];
  assert.equal(plan({ documents: [{ ...doc, rev: 'r2', contentInspectedRev: 'r2' }], deliveries }), null);
  assert.equal(poDeliverySignature(event, rule, 'arrival'), poDeliverySignature({ ...event, title: 'Renamed' }, rule, 'arrival'));
  const moved = { ...event, date: '2026-10-05' };
  assert.notEqual(poDeliverySignature(event, rule, 'packing'), poDeliverySignature(moved, rule, 'packing'));
  assert.equal(plan({ event: moved, deliveries, now: new Date('2026-10-03T12:00:00Z') }), null);
  assert.equal(plan({ event: moved, deliveries, now: new Date('2026-10-04T12:00:00Z') }), 'packing');
});

test('uncertain arrival retries its original stage and never starts a second stage or retries after 23 hours', () => {
  const pending = { source: 'dropbox_po', eventDate: event.date, stage: 'arrival', status: 'failed', firstAttemptAt: new Date('2026-10-02T15:00:00Z') };
  assert.equal(plan({ deliveries: [pending], now: new Date('2026-10-03T12:00:00Z') }), 'arrival');
  assert.equal(plan({ deliveries: [pending], now: new Date('2026-10-03T14:01:00Z') }), null);
});

const xml = '<w:document><w:body><w:tbl>' + [
  ['Name', 'Qty', 'Notes/Comments', 'Delivered', 'Returned'], ['STAFF HOLDING'], ['White Gloves', '10', '', '', ''],
  ['Steamer', '2', 'Backstage', '', ''], ['Milk Steamer', '1', '', '', ''], ['Steamer', '0', '', '', ''],
  ['Set Up Shirts', '', 'Quantity to be confirmed', '', ''],
].map((cells) => `<w:tr>${cells.map((cell) => `<w:tc><w:p><w:r><w:t>${cell}</w:t></w:r></w:p></w:tc>`).join('')}</w:tr>`).join('') + '</w:tbl></w:body></w:document>';
const docx = async () => { const zip = new JSZip(); zip.file('word/document.xml', xml); return zip.generateAsync({ type: 'nodebuffer' }); };

test('real DOCX table path extracts non-bar equipment, preserves blank quantity, excludes zero and Milk Steamer', async () => {
  const items = extractDropboxPoItems(xml);
  assert.equal(items.find((row) => row.itemName === 'White Gloves').quantity, 10);
  assert.equal(items.find((row) => row.itemName === 'Set Up Shirts').quantity, null);
  assert.equal(items.find((row) => row.itemName === 'Set Up Shirts').notes, 'Quantity to be confirmed');
  const parsed = await readDropboxDocxMetadata(await docx(), { documentType: 'po' });
  assert.deepEqual(parsed.poAlertItems, items);
  assert.deepEqual(findAutomationMatches({ packOut: items }, ['White Gloves', 'Steamer']).map((row) => [row.itemName, row.quantity]), [['White Gloves', 10], ['Steamer', 2]]);
});

test('older PO data is read only when due, cached by current revision, and never overwrites a changed document', async () => {
  let reads = 0; let filter;
  const read = async () => { reads += 1; return docx(); };
  const Model = { updateOne: async (query) => { filter = query; return { matchedCount: 1 }; } };
  await loadPoAlertItems(doc, read, Model); assert.equal(reads, 0);
  await loadPoAlertItems({ ...doc, poAlertParserVersion: 0 }, read, Model);
  assert.equal(reads, 1); assert.equal(filter.rev, 'r1'); assert.equal(filter.status, 'imported');
  await assert.rejects(loadPoAlertItems({ ...doc, poAlertParserVersion: 0 }, read, { updateOne: async () => ({ matchedCount: 0 }) }), /changed/);
});

const deliveryStore = () => {
  const jobs = [];
  const model = {
    async updateOne(key, mutation) {
      if (!jobs.some((job) => job.signature === key.signature)) {
        const job = structuredClone(mutation.$setOnInsert); job.save = async () => job; jobs.push(job);
      }
    },
    findOneAndUpdate(query, mutation) {
      const job = jobs.find((job) => job.signature === query.signature && query.status.$in.includes(job.status)
        && job.firstAttemptAt > query.firstAttemptAt.$gt && (!job.lockedUntil || job.lockedUntil <= query.$or[1].lockedUntil.$lte));
      if (job) { Object.assign(job, mutation.$set); job.attempts += 1; }
      return { select: async () => job || null };
    },
  };
  return { jobs, model };
};

test('the historical backfill endpoint cannot bypass Dropbox scheduling or send old POs', async (t) => {
  const before = process.env.EVENT_DOCUMENT_SOURCE;
  process.env.EVENT_DOCUMENT_SOURCE = 'dropbox';
  t.after(() => { if (before === undefined) delete process.env.EVENT_DOCUMENT_SOURCE; else process.env.EVENT_DOCUMENT_SOURCE = before; });
  const handler = alertsRouter.stack.find((layer) => layer.route?.path === '/backfill').route.stack.at(-1).handle;
  const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  await handler({ body: { from: '2026-09-01', to: '2026-09-30' } }, res);
  assert.equal(res.code, 409); assert.match(res.body.message, /Historical bulk sending is disabled/);
});

test('parallel sends atomically claim one email; uncertain retry reuses its exact payload and provider key', async () => {
  const store = deliveryStore(); const requests = [];
  const input = { event, rule, matches: [{ itemName: 'White Gloves', quantity: 10 }], stage: 'arrival', now: new Date('2026-10-02T14:00:00Z'), Delivery: store.model, apiKey: 'test',
    fetchImpl: async (_url, options) => { requests.push(options); throw new Error('Connection lost after accept'); } };
  await Promise.all([deliverDropboxPoAlert(input), deliverDropboxPoAlert(input)]);
  assert.equal(requests.length, 1);
  await deliverDropboxPoAlert({ ...input, matches: [{ itemName: 'Changed PO' }], fetchImpl: async (_url, options) => { requests.push(options); return { ok: true, json: async () => ({ id: 'accepted' }) }; } });
  assert.equal(requests.length, 2); assert.equal(requests[0].body, requests[1].body);
  assert.equal(requests[0].headers['Idempotency-Key'], requests[1].headers['Idempotency-Key']);
  await deliverDropboxPoAlert(input); assert.equal(requests.length, 2);
  assert.equal(store.jobs[0].status, 'sent');
  assert.deepEqual(JSON.parse(requests[0].body).to, rule.recipients);
});

test('changed recipients cancel an uncertain email instead of mailing removed users', async () => {
  const store = deliveryStore(); let sentCount = 0;
  const input = { event, rule, stage: 'packing', matches: [{ itemName: 'White Gloves' }], Delivery: store.model, apiKey: 'test',
    fetchImpl: async () => { sentCount += 1; throw new Error('timeout'); } };
  await deliverDropboxPoAlert(input);
  assert.equal(await deliverDropboxPoAlert({ ...input, rule: { ...rule, recipients: ['changed@example.com'] } }), 'cancelled');
  assert.equal(sentCount, 1);
});

test('worker reads valid attached Dropbox POs despite broken copies, and respects its cross-process lease', async (t) => {
  const savedEnv = { RESEND_API_KEY: process.env.RESEND_API_KEY, EVENT_DOCUMENT_SOURCE: process.env.EVENT_DOCUMENT_SOURCE };
  process.env.RESEND_API_KEY = 'test'; process.env.EVENT_DOCUMENT_SOURCE = 'dropbox';
  t.after(() => { for (const [key, value] of Object.entries(savedEnv)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  let locked = false;
  t.mock.method(Policy, 'findOneAndUpdate', async (query) => {
    if (!query.$or) return { activatedAt };
    if (locked) return null; locked = true; return { activatedAt };
  });
  t.mock.method(Policy, 'updateOne', async (_query, mutation) => { if (mutation.$set.lockedUntil === null) locked = false; return { matchedCount: 1 }; });
  const now = new Date('2026-10-02T14:05:00Z');
  const connection = { enabled: true, namespaceId: 'ns', refreshToken: { ciphertext: 'test' }, lastSyncStartedAt: new Date(+now - 2000), lastSyncCompletedAt: new Date(+now - 1000) };
  t.mock.method(Integration, 'findOne', () => ({ select: () => ({ lean: async () => connection }) }));
  t.mock.method(Rule, 'findOneAndUpdate', async () => rule);
  t.mock.method(Rule, 'find', () => ({ lean: async () => [rule] }));
  t.mock.method(Rule, 'findById', () => ({ lean: async () => rule }));
  const documents = [doc,
    { ...doc, _id: 'broken-copy', contentInspectionError: 'Dropbox download failed (409)', poAlertItems: [{ itemName: 'Steamer', quantity: 99 }] },
    { ...doc, _id: 'detached-copy', dropboxId: 'dbx-detached', poAlertItems: [{ itemName: 'Steamer', quantity: 98 }] },
  ];
  t.mock.method(Document, 'find', () => ({ lean: async () => documents, select: () => ({ lean: async () => documents }) }));
  t.mock.method(Document, 'countDocuments', async () => 1);
  t.mock.method(Event, 'findById', () => ({ select: () => ({ lean: async () => event }) }));
  const store = deliveryStore();
  t.mock.method(Delivery, 'find', () => ({ select: () => ({ lean: async () => store.jobs }) }));
  t.mock.method(Delivery, 'updateOne', store.model.updateOne);
  t.mock.method(Delivery, 'findOneAndUpdate', store.model.findOneAndUpdate);
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (_url, options) => { requests.push(JSON.parse(options.body)); return { ok: true, json: async () => ({ id: 'email' }) }; });
  const results = await Promise.all([runDropboxPoAlerts({ now }), runDropboxPoAlerts({ now })]);
  assert.equal(results.filter((result) => result.busy).length, 1);
  assert.equal(requests.length, 1); assert.match(requests[0].text, /White Gloves · Qty 10/);
  assert.doesNotMatch(requests[0].text, /Steamer/);
  await runDropboxPoAlerts({ now }); assert.equal(requests.length, 1);
  connection.lastSyncError = 'Dropbox offline';
  assert.deepEqual(await runDropboxPoAlerts({ now }), { waitingForDropbox: true });
});
