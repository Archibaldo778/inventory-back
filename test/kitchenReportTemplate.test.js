import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultReportTemplate, validateReportTemplate, loadReportTemplate, pinReportTemplate, reportTemplate } from '../utils/captainReportTemplate.js';
import router, { canEditReportTemplate } from '../routes/eventReportTemplates.js';
import publicRouter from '../routes/publicEventReports.js';
import EventReportTemplate from '../models/EventReportTemplate.js';
import EventReport from '../models/EventReport.js';
import Event from '../models/Event.js';
import EventReportSettings from '../models/EventReportSettings.js';
import ReportTeam from '../models/ReportTeam.js';
import User from '../models/Users.js';
import { issueEventGuestAccess } from '../utils/eventGuestAccess.js';
import { renderEventReportText, renderEventReportEmail } from '../utils/eventReportEmail.js';
import { eventReportAnalysisInput } from '../utils/eventReportAi.js';
import { eventReportDocx } from '../utils/eventReportFiles.js';
import JSZip from 'jszip';

const snapshot = { revision: 2, introduction: 'Tell us about the kitchen.', sections: [{ key: 'equipment', title: 'Kitchen equipment', description: '', fields: [
  { key: 'custom_ovens', label: 'Which ovens were missing?', type: 'textarea', required: true },
  { key: 'custom_checked', label: 'Equipment checked', type: 'checkbox', required: true },
] }] };
const handler = (r, path, method) => r.stack.find(layer => layer.route?.path === path && layer.route.methods[method]).route.stack.at(-1).handle;
const response = () => ({ code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });

test('captain and kitchen templates load and publish independently with department-scoped edit rights', async (t) => {
  const saved = { captain: { ...snapshot, revision: 4 }, kitchen: snapshot };
  const Templates = { findById: type => ({ lean: async () => saved[type] }) };
  assert.equal((await loadReportTemplate('captain', Templates)).revision, 4);
  assert.equal((await loadReportTemplate('kitchen', Templates)).revision, 2);
  for (const type of ['captain', 'kitchen']) {
    assert.equal(canEditReportTemplate({ role: 'admin' }, type), true);
    assert.equal(canEditReportTemplate({ role: 'captain' }, type), false);
    assert.equal(canEditReportTemplate({ role: 'staffing admin' }, type), type === 'captain');
    assert.equal(canEditReportTemplate({ role: 'kitchen admin' }, type), type === 'kitchen');
  }
  t.mock.method(EventReportTemplate, 'findById', Templates.findById);
  const loaded = response(); await handler(router, '/kitchen', 'get')({ auth: { role: 'staffing admin' } }, loaded);
  assert.equal(loaded.body.canEdit, false); assert.equal(loaded.body.template.revision, 2);
  const denied = response(); await handler(router, '/kitchen', 'put')({ auth: { role: 'staffing admin' }, body: {} }, denied);
  assert.equal(denied.code, 403);
  t.mock.method(EventReportTemplate, 'findOneAndUpdate', async (query, update) => {
    assert.deepEqual(query, { _id: 'kitchen', revision: 2 }); assert.equal(update.$inc.revision, 1);
    return { ...update.$set, revision: 3 };
  });
  const published = response(); await handler(router, '/kitchen', 'put')({ auth: { role: 'kitchen admin' }, body: { ...snapshot, expectedRevision: 2 } }, published);
  assert.equal(published.code, 200); assert.equal(published.body.template.revision, 3);
  t.mock.method(EventReportTemplate, 'findOneAndUpdate', async () => null);
  const conflict = response(); await handler(router, '/kitchen', 'put')({ auth: { role: 'admin' }, body: { ...snapshot, expectedRevision: 2 } }, conflict);
  assert.equal(conflict.code, 409);
});

test('kitchen default questions and required fields can be edited without adopting captain-only questions', () => {
  const draft = { ...defaultReportTemplate('kitchen'), expectedRevision: 0 };
  draft.sections[0].fields[0].label = 'Who arrived late?'; draft.sections[0].fields[0].required = false;
  assert.equal(validateReportTemplate(draft, 'kitchen').sections[0].fields[0].required, false);
  assert.throws(() => validateReportTemplate(draft, 'captain'), /unique identifier/);
  const reruns = draft.sections.flatMap(s => s.fields).find(f => f.key === 'rerunsOrPurchases');
  reruns.options = ['Nothing happened', 'Everything happened'];
  assert.throws(() => validateReportTemplate(draft, 'kitchen'), /standard re-run choices/);
});

test('first kitchen opening pins the kitchen version and never replaces opened, submitted or existing draft answers', async () => {
  const report = { _id: 'report-1', reportType: 'kitchen', status: 'pending' };
  const Reports = { findOneAndUpdate: async (_query, update) => ({ ...report, ...update.$set }) };
  const pinned = await pinReportTemplate(report, { Reports, loadTemplate: async type => { assert.equal(type, 'kitchen'); return snapshot; } });
  assert.equal(pinned.templateSnapshot.revision, 2);
  for (const original of [pinned, { ...report, status: 'submitted' }]) {
    assert.equal(await pinReportTemplate(original, { loadTemplate: () => assert.fail('Must not load a new version') }), original);
  }
  const draft = await pinReportTemplate({ ...report, answers: { foodEnough: 'Existing draft' } }, { Reports, loadTemplate: () => assert.fail('Legacy draft must keep its questions') });
  assert.equal(draft.templateSnapshot.revision, 0);
  assert.equal(reportTemplate({ reportType: 'kitchen', status: 'submitted' }).sections[0].fields[0].key, 'staffLate');
});

test('kitchen custom questions retain their saved wording in email, AI input and document exports', async () => {
  const report = { reportType: 'kitchen', status: 'submitted', eventTitle: 'Dinner', templateSnapshot: snapshot,
    answers: { custom_ovens: 'Two convection ovens.', custom_checked: true } };
  assert.match(renderEventReportText(report), /Which ovens were missing\?: Two convection ovens/);
  assert.match(renderEventReportText(report), /Equipment checked: Yes/);
  assert.match(renderEventReportEmail(report), /Which ovens were missing/);
  assert.equal(eventReportAnalysisInput({ reports: [report] }).reports[0].answers[0].question, 'Which ovens were missing?');
  const doc = await JSZip.loadAsync(await eventReportDocx(report));
  assert.match(await doc.file('word/document.xml').async('string'), /Two convection ovens/);
});

test('kitchen submissions require the pinned revision and required custom answers, then preserve that snapshot', async (t) => {
  for (const [key, value] of [['JWT_SECRET', 'kitchen-template-test'], ['RESEND_API_KEY', '']]) {
    const old = process.env[key]; process.env[key] = value;
    t.after(() => { if (old === undefined) delete process.env[key]; else process.env[key] = old; });
  }
  const eventId = '507f1f77bcf86cd799439011';
  const report = { _id: eventId, eventId, slackUserId: 'chef', reportType: 'kitchen', status: 'pending', templateSnapshot: snapshot,
    toObject() { return { ...this }; }, save: async () => {} };
  t.mock.method(EventReport, 'findOne', async () => report);
  t.mock.method(Event, 'findById', () => ({ select: () => ({ lean: async () => ({ title: 'Dinner' }) }) }));
  t.mock.method(EventReportSettings, 'findOne', () => ({ lean: async () => null }));
  t.mock.method(ReportTeam, 'find', () => ({ sort: () => ({ lean: async () => [] }) }));
  t.mock.method(User, 'find', () => ({ select: () => ({ lean: async () => [] }) }));
  t.mock.method(globalThis, 'fetch', () => assert.fail('No real email or AI requests'));
  let writes = 0;
  t.mock.method(EventReport, 'findOneAndUpdate', async (query, update) => { writes++; assert.equal(query['templateSnapshot.revision'], 2); Object.assign(report, update.$set); return report; });
  const accessToken = issueEventGuestAccess({ eventIds: [eventId], capability: 'event:report', subjectId: 'chef' });
  const request = body => ({ params: { eventId }, body: { accessToken, ...body } });
  const stale = response(); await handler(publicRouter, '/:eventId', 'post')(request({ templateRevision: 1 }), stale);
  assert.equal(stale.code, 409); assert.equal(writes, 0);
  const missing = response(); await handler(publicRouter, '/:eventId', 'post')(request({ templateRevision: 2, answers: {} }), missing);
  assert.equal(missing.code, 400); assert.equal(writes, 0);
  const submitted = response(); await handler(publicRouter, '/:eventId', 'post')(request({ templateRevision: 2, answers: { custom_ovens: 'Two convection ovens.', custom_checked: true, injected: 'ignored' } }), submitted);
  assert.equal(submitted.code, 200); assert.equal(writes, 1); assert.equal(report.templateSnapshot.revision, 2);
  assert.equal(report.answers.injected, undefined); assert.equal(report.status, 'submitted');
});
