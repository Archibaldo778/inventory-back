import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import JSZip from 'jszip';
import router from '../routes/dropboxIntegration.js';
import User from '../models/Users.js';
import AccessRole from '../models/AccessRole.js';
AccessRole.findById = () => ({ select: () => ({ lean: async () => null }) });
import DropboxDocument from '../models/DropboxDocument.js';
import DropboxIntegration from '../models/DropboxIntegration.js';
import Event from '../models/Event.js';
import { encryptDropboxSecret } from '../utils/dropboxApi.js';

const response = () => ({ code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; }, send(body) { this.body = body; return this; }, attachment() {}, setHeader() {} });
const invoke = async (path, method, req, res) => {
  const stack = router.stack.find((layer) => layer.route?.path === path && layer.route.methods[method]).route.stack;
  const run = async (i) => {
    if (!stack[i]) return;
    let next;
    await stack[i].handle(req, res, () => { next = run(i + 1); });
    await next;
  };
  await run(0);
};

test('Dropbox download and transportation sync reject staff and run successfully for admin', async (t) => {
  for (const [key, value] of Object.entries({ JWT_SECRET: 'route-test-secret', DROPBOX_APP_KEY: 'test', DROPBOX_APP_SECRET: 'test', DROPBOX_TOKEN_ENCRYPTION_KEY: 'x'.repeat(32) })) {
    const old = process.env[key]; process.env[key] = value;
    t.after(() => { if (old === undefined) delete process.env[key]; else process.env[key] = old; });
  }
  const zip = new JSZip();
  zip.file('xl/workbook.xml', '<sheets><sheet name="Transportation" r:id="r1"/></sheets>');
  zip.file('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"/></Relationships>');
  zip.file('xl/worksheets/sheet1.xml', '<sheetData><row><c r="A1" t="inlineStr"><is><t>Event Name</t></is></c></row></sheetData>');
  const workbook = await zip.generateAsync({ type: 'nodebuffer' });
  let role = 'captain'; let externalCalls = 0;
  const id = '507f1f77bcf86cd799439011';
  t.mock.method(User, 'findById', () => ({ select: () => ({ lean: async () => ({ _id: id, role, isActive: true, tokenVersion: 0 }) }) }));
  t.mock.method(DropboxDocument, 'findOne', () => ({ lean: async () => { externalCalls++; return { dropboxId: 'id:doc', name: 'PO.docx' }; } }));
  t.mock.method(DropboxIntegration, 'findOne', () => ({ select: async () => { externalCalls++; return { enabled: true, refreshToken: encryptDropboxSecret('test-token') }; } }));
  t.mock.method(Event, 'find', () => ({ select: () => ({ lean: async () => [] }) }));
  t.mock.method(globalThis, 'fetch', async (url) => {
    externalCalls++;
    let payload = {};
    if (url.endsWith('/oauth2/token')) payload = { access_token: 'test' };
    else if (url.endsWith('/users/get_current_account')) payload = { root_info: {} };
    else if (url.endsWith('/files/list_folder')) payload = { entries: [{ '.tag': 'file', id: 'id:transport', name: '10-05-2026 Trans.xlsx' }] };
    else assert.ok(url.endsWith('/files/download'), `Unexpected URL: ${url}`);
    return { ok: true, text: async () => JSON.stringify(payload), arrayBuffer: async () => workbook };
  });
  for (role of ['captain', 'bar captain', 'bartender', 'packer', 'admin', 'super admin']) {
    for (const [path, method] of [['/documents/:dropboxId/download', 'get'], ['/transportation/sync', 'post']]) {
      const before = externalCalls;
      const token = jwt.sign({ sub: id, role, tokenVersion: 0 }, process.env.JWT_SECRET);
      const res = response();
      await invoke(path, method, { method: method.toUpperCase(), originalUrl: `/api/integrations/dropbox${path}`, headers: { authorization: `Bearer ${token}` }, params: { dropboxId: 'id:doc' }, body: { date: '2026-10-05' } }, res);
      const allowed = ['admin', 'super admin'].includes(role);
      assert.equal(res.code, allowed ? 200 : 403, `${role}: ${path}: ${JSON.stringify(res.body)}`);
      if (!allowed) assert.equal(externalCalls, before);
      else assert.ok(externalCalls > before);
    }
  }
});
