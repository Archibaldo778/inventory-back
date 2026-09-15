import assert from 'node:assert/strict';
import test from 'node:test';

import { createEmlDraft } from '../utils/emlDraft.js';

test('EML draft contains Outlook unsent marker, encoded subject, body and attachments', () => {
  const output = createEmlDraft({
    subject: '09-15-26 – Leadership Files',
    html: '<p>Files are attached.</p>',
    attachments: [{
      name: 'Staff Request.xlsx',
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: Buffer.from('workbook-bytes'),
    }],
  }).toString('utf8');
  assert.match(output, /^X-Unsent: 1\r\n/);
  assert.match(output, /Subject: =\?UTF-8\?B\?/);
  assert.match(output, /filename="Staff Request.xlsx"/);
  assert.ok(output.includes(Buffer.from('workbook-bytes').toString('base64')));
  assert.ok(output.includes(Buffer.from('<p>Files are attached.</p>').toString('base64')));
});

test('EML draft strips header injection and requires a real attachment', () => {
  const output = createEmlDraft({
    subject: 'Leadership\r\nBcc: attacker@example.com',
    attachments: [{ name: 'PO.docx', buffer: Buffer.from('doc') }],
  }).toString('utf8');
  assert.doesNotMatch(output, /\r\nBcc:/);
  assert.throws(() => createEmlDraft({ attachments: [] }), /At least one email attachment/);
});
