import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultCaptainTemplate, validateCaptainTemplate, pinCaptainTemplate, captainTemplateAnswers, reportCaptainTemplate } from '../utils/captainReportTemplate.js';
import templateRouter from '../routes/eventReportTemplates.js';
import publicRouter from '../routes/publicEventReports.js';
import EventReportTemplate from '../models/EventReportTemplate.js';
import EventReport from '../models/EventReport.js';
import Event from '../models/Event.js';
import EventReportSettings from '../models/EventReportSettings.js';
import ReportTeam from '../models/ReportTeam.js';
import User from '../models/Users.js';
import { eventReportAnalysisInput } from '../utils/eventReportAi.js';
import { renderEventReportEmail, renderEventReportText } from '../utils/eventReportEmail.js';
import { eventReportDocx } from '../utils/eventReportFiles.js';
import { captainVenueNotes } from '../utils/venues.js';
import { issueEventGuestAccess } from '../utils/eventGuestAccess.js';
import JSZip from 'jszip';

const snapshot = { revision: 3, introduction: 'Tell us about this venue.', sections: [{ key: 'venue', title: 'Venue notes', description: '', fields: [
  { key: 'custom_loading', label: 'Which loading restrictions should we plan for?', type: 'textarea', required: true },
  { key: 'custom_checked', label: 'Venue rules checked', type: 'checkbox', required: true },
  { key: 'custom_access', label: 'Access', type: 'choice', options: ['Open', 'Restricted'], required: false },
] }] };
const handler = (router, path, method) => router.stack.find((layer) => layer.route?.path === path && layer.route.methods[method]).route.stack.at(-1).handle;
const response = () => ({ code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });

test('template editing allows custom questions but rejects duplicate identifiers, invalid choices and changes to operational field types', () => {
  const body = { ...structuredClone(snapshot), expectedRevision: 3 };
  assert.equal(validateCaptainTemplate(body).sections[0].fields.length, 3);
  const duplicate = structuredClone(body); duplicate.sections[0].fields.push(duplicate.sections[0].fields[0]);
  assert.throws(() => validateCaptainTemplate(duplicate), /unique/);
  const unsafe = structuredClone(body); unsafe.sections[0].fields[0].key = '__proto__'; assert.throws(() => validateCaptainTemplate(unsafe), /unique/);
  const unknown = structuredClone(body); unknown.sections[0].fields[0].key = 'isAdmin'; assert.throws(() => validateCaptainTemplate(unknown), /unique/);
  const arrayKey = structuredClone(body); arrayKey.sections[0].fields[0].key = ['custom_loading']; assert.throws(() => validateCaptainTemplate(arrayKey), /unique/);
  const empty = structuredClone(body); empty.sections[0].fields[2].options = ['Open', '']; assert.throws(() => validateCaptainTemplate(empty), /non-empty/);
  const baseline = { ...defaultCaptainTemplate(), expectedRevision: 0 }; baseline.sections[0].fields[0].type = 'text';
  assert.throws(() => validateCaptainTemplate(baseline), /keep their answer type/);
});

test('template validation preserves re-run answer semantics while allowing wording edits', () => {
  const baseline = { ...defaultCaptainTemplate(), expectedRevision: 0 };
  const reruns = baseline.sections.flatMap((section) => section.fields).find((field) => field.key === 'rerunsOrPurchases');
  reruns.label = 'Tell us whether you know of any re-runs.';
  assert.doesNotThrow(() => validateCaptainTemplate(baseline));
  reruns.options = ['Everything fine', 'Problems']; assert.throws(() => validateCaptainTemplate(baseline), /standard re-run choices/);
});

test('answers are validated against the saved form and unrelated client fields are ignored', () => {
  const answers = captainTemplateAnswers(snapshot, { custom_loading: 'Use the loading dock before 9 AM.', custom_checked: true, custom_access: 'Restricted', role: 'admin' });
  assert.deepEqual(Object.keys(answers), ['custom_loading', 'custom_checked', 'custom_access']);
  assert.throws(() => captainTemplateAnswers(snapshot, { custom_loading: 'Dock', custom_checked: false }), /Venue rules checked/);
  assert.throws(() => captainTemplateAnswers(snapshot, { custom_loading: 'Dock', custom_checked: true, custom_access: 'Invented option' }), /listed answer/);
  assert.throws(() => captainTemplateAnswers(snapshot, null), /required question/);
});

test('first opening pins one version even when another request wins the race', async () => {
  const report = { _id: 'report-1', reportType: 'captain', status: 'pending' };
  const winner = { ...report, templateSnapshot: { ...snapshot, revision: 2 } };
  let query; let update;
  const Reports = { findOneAndUpdate: async (filter, changes) => { query = filter; update = changes; return null; }, findById: async () => winner };
  const result = await pinCaptainTemplate(report, { Reports, loadTemplate: async () => snapshot });
  assert.equal(result.templateSnapshot.revision, 2); assert.deepEqual(query, { _id: 'report-1', status: 'pending', templateSnapshot: null });
  assert.deepEqual(Object.keys(update.$set), ['templateSnapshot']);
});

test('already opened reports, submitted history and Kitchen reports never fetch or adopt a newer captain template', async () => {
  for (const report of [
    { status: 'pending', reportType: 'captain', templateSnapshot: snapshot },
    { status: 'submitted', reportType: 'captain' }, { status: 'pending', reportType: 'kitchen' },
  ]) assert.equal(await pinCaptainTemplate(report, { loadTemplate: async () => assert.fail('Must preserve the original form') }), report);
  assert.equal(reportCaptainTemplate({ status: 'submitted' }).revision, 0);
  const first = defaultCaptainTemplate(); first.sections[0].title = 'Edited'; assert.equal(defaultCaptainTemplate().sections[0].title, 'Staff');
});

test('saved question wording and custom checkbox answers appear in email, AI input and document exports', async () => {
  const report = { reportType: 'captain', status: 'submitted', templateSnapshot: snapshot, eventTitle: 'Dinner', answers: { custom_loading: 'Use narrow carts.', custom_checked: true, custom_access: 'Restricted' } };
  assert.match(renderEventReportEmail(report), /Which loading restrictions should we plan for/);
  assert.match(renderEventReportText(report), /Venue rules checked: Yes/);
  assert.doesNotMatch(renderEventReportText(report), /Staff appearance/);
  const input = eventReportAnalysisInput({ reports: [report] });
  assert.equal(input.reports[0].answers[0].answer, 'Use narrow carts.'); assert.equal(input.reports[0].answers[1].answer, 'Yes');
  const docx = await JSZip.loadAsync(await eventReportDocx(report));
  assert.match(await docx.file('word/document.xml').async('string'), /Use narrow carts/);
});

test('custom text questions in Venue Notes retain their original wording and source in venue history', () => {
  const notes = captainVenueNotes({ _id: 'report-1', eventId: 'event-1', templateSnapshot: snapshot, answers: { custom_loading: 'Loading only before 9 AM.' } });
  assert.equal(notes.length, 1); assert.equal(notes[0].text, 'Loading only before 9 AM.');
  assert.match(notes[0].sourceLabel, /Which loading restrictions/); assert.equal(notes[0].sourceKey, 'captain:report-1:custom_loading');
});

test('publishing requires an allowed administrator and uses optimistic revision locking', async (t) => {
  let filter; let update;
  t.mock.method(EventReportTemplate, 'findOneAndUpdate', async (query, changes) => { filter = query; update = changes; return { revision: 4, ...changes.$set }; });
  const denied = response(); await handler(templateRouter, '/captain', 'put')({ auth: { role: 'kitchen admin' }, body: {} }, denied); assert.equal(denied.code, 403);
  const res = response(); await handler(templateRouter, '/captain', 'put')({ auth: { role: 'staffing admin', username: 'Staffing' }, body: { ...snapshot, expectedRevision: 3 } }, res);
  assert.equal(res.code, 200); assert.deepEqual(filter, { _id: 'captain', revision: 3 }); assert.equal(update.$inc.revision, 1);
  t.mock.method(EventReportTemplate, 'findOneAndUpdate', async () => null);
  const stale = response(); await handler(templateRouter, '/captain', 'put')({ auth: { role: 'admin' }, body: { ...snapshot, expectedRevision: 3 } }, stale); assert.equal(stale.code, 409);
});

test('the first publication recovers a concurrent insert as a conflict instead of replacing a newer template', async (t) => {
  t.mock.method(EventReportTemplate, 'findOneAndUpdate', async (_query, _update, options) => { assert.equal(options.upsert, true); throw Object.assign(Error('Duplicate'), { code: 11000 }); });
  const res = response(); await handler(templateRouter, '/captain', 'put')({ auth: { role: 'admin' }, body: { ...snapshot, expectedRevision: 0 } }, res); assert.equal(res.code, 409);
});

test('a stale public form cannot submit answers under another version or send email', async (t) => {
  const eventId = '507f1f77bcf86cd799439011';
  const previous = process.env.JWT_SECRET; process.env.JWT_SECRET = 'template-test-secret';
  t.after(() => { if (previous === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = previous; });
  t.mock.method(EventReport, 'findOne', async () => ({ _id: eventId, eventId, slackUserId: 'slack-captain', status: 'pending', reportType: 'captain', templateSnapshot: snapshot }));
  t.mock.method(Event, 'findById', () => ({ select: () => ({ lean: async () => ({ title: 'Dinner' }) }) }));
  t.mock.method(EventReport, 'findOneAndUpdate', () => assert.fail('Stale form must not write'));
  t.mock.method(globalThis, 'fetch', () => assert.fail('Stale form must not send'));
  const accessToken = issueEventGuestAccess({ eventIds: [eventId], capability: 'event:report', subjectId: 'slack-captain' });
  const res = response(); await handler(publicRouter, '/:eventId', 'post')({ params: { eventId }, body: { accessToken, templateRevision: 2, answers: {} } }, res);
  assert.equal(res.code, 409);
});

test('public submission saves custom answers with the pinned form and ignores client-supplied template replacements', async (t) => {
  const eventId = '507f1f77bcf86cd799439011';
  for (const [key, value] of [['JWT_SECRET', 'template-submit-secret'], ['RESEND_API_KEY', '']]) {
    const previous = process.env[key]; process.env[key] = value;
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }
  const report = { _id: eventId, eventId, slackUserId: 'slack-captain', status: 'pending', reportType: 'captain', templateSnapshot: structuredClone(snapshot),
    toObject() { return { ...this }; }, save: async () => {} };
  t.mock.method(EventReport, 'findOne', async () => report);
  t.mock.method(Event, 'findById', () => ({ select: () => ({ lean: async () => ({ title: 'Dinner' }) }) }));
  t.mock.method(EventReportSettings, 'findOne', () => ({ lean: async () => null }));
  t.mock.method(ReportTeam, 'find', () => ({ sort: () => ({ lean: async () => [] }) }));
  t.mock.method(User, 'find', () => ({ select: () => ({ lean: async () => [] }) }));
  t.mock.method(globalThis, 'fetch', () => assert.fail('No provider requests in this test'));
  t.mock.method(EventReport, 'findOneAndUpdate', async (filter, update) => {
    assert.deepEqual(filter, { _id: eventId, status: 'pending', 'templateSnapshot.revision': 3 });
    Object.assign(report, update.$set); return report;
  });
  const accessToken = issueEventGuestAccess({ eventIds: [eventId], capability: 'event:report', subjectId: 'slack-captain' });
  const res = response(); await handler(publicRouter, '/:eventId', 'post')({ params: { eventId }, body: { accessToken, templateRevision: 3,
    templateSnapshot: { revision: 99, sections: [] }, answers: { custom_loading: 'Use narrow carts.', custom_checked: true, injected: 'ignored' },
  } }, res);
  assert.equal(res.code, 200); assert.equal(report.status, 'submitted'); assert.equal(report.templateSnapshot.revision, 3);
  assert.equal(res.body.report.answers.custom_loading, 'Use narrow carts.'); assert.equal(res.body.report.answers.injected, undefined);
});
