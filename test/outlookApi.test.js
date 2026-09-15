import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createOutlookDraft,
  createOutlookState,
  decryptOutlookSecret,
  encryptOutlookSecret,
  verifyOutlookState,
} from '../utils/outlookApi.js';

const withEnvironment = async (values, run) => {
  const before = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  Object.entries(values).forEach(([key, value]) => { process.env[key] = value; });
  try { return await run(); } finally {
    Object.entries(before).forEach(([key, value]) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
  }
};

test('Outlook OAuth state is signed, expires, and preserves the return page', async () => {
  await withEnvironment({ JWT_SECRET: 'outlook-state-test-secret' }, async () => {
    const state = createOutlookState({ userId: 'user-123', returnTo: 'https://occdecks.com/events/event-1' });
    assert.deepEqual(
      (({ userId, returnTo }) => ({ userId, returnTo }))(verifyOutlookState(state)),
      { userId: 'user-123', returnTo: 'https://occdecks.com/events/event-1' }
    );
    assert.throws(() => verifyOutlookState(`${state.slice(0, -1)}x`), /Invalid Outlook OAuth state/);
  });
});

test('Outlook refresh tokens are encrypted before storage', async () => {
  await withEnvironment({ OUTLOOK_TOKEN_ENCRYPTION_KEY: 'a-secure-test-key-with-more-than-32-characters' }, async () => {
    const encrypted = encryptOutlookSecret('refresh-token-value');
    assert.notEqual(encrypted.ciphertext, 'refresh-token-value');
    assert.equal(decryptOutlookSecret(encrypted), 'refresh-token-value');
  });
});

test('Outlook sharing creates a draft with attachments and never sends it', async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith('/me/messages')) {
      return { ok: true, status: 201, json: async () => ({ id: 'draft-1' }) };
    }
    if (String(url).includes('/attachments')) {
      return { ok: true, status: 201, json: async () => ({ id: 'attachment-1' }) };
    }
    return { ok: true, status: 200, json: async () => ({ id: 'draft-1', webLink: 'https://outlook.office.com/mail/deeplink/compose/id' }) };
  };
  try {
    const result = await createOutlookDraft({
      accessToken: 'access-token',
      subject: '09-14-26 - Chanel YPO Cocktail - Leadership Files',
      html: '<p>Files attached.</p>',
      attachments: [{ name: 'event_PO.docx', contentType: 'application/test', buffer: Buffer.from('docx') }],
    });
    assert.equal(result.webLink, 'https://outlook.office.com/mail/deeplink/compose/id');
  } finally {
    global.fetch = originalFetch;
  }
  assert.equal(calls.length, 3);
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(JSON.parse(calls[0].options.body).subject, '09-14-26 - Chanel YPO Cocktail - Leadership Files');
  assert.equal(JSON.parse(calls[1].options.body).contentBytes, Buffer.from('docx').toString('base64'));
  assert.equal(calls.some(({ url }) => /\/send(?:\?|$)/.test(url)), false);
});
