import test from 'node:test';
import assert from 'node:assert/strict';
import { sendBarReturnEmail } from '../utils/barReturnEmail.js';

test('submitted bar returns email Sam from OCC Beverage and copy the captain', async () => {
  const previousKey = process.env.RESEND_API_KEY;
  process.env.RESEND_API_KEY = 'test-key';
  let request;
  try {
    const result = await sendBarReturnEmail({
      event: { name: 'Prada Saks', eventDate: '2026-10-02', submittedBy: 'Captain', items: [{ name: 'Champagne', sentQty: 12, returnedFullQty: 3 }] },
      captainEmail: 'Captain@ocnyc.com',
      fetchImpl: async (_url, options) => { request = JSON.parse(options.body); return { ok: true, json: async () => ({ id: 'bar_email_1' }) }; },
    });
    assert.equal(result.status, 'sent');
    assert.deepEqual(request.to, ['sam@ocnyc.com']);
    assert.deepEqual(request.cc, ['captain@ocnyc.com']);
    assert.match(request.from, /OCC Beverage/);
    assert.match(request.text, /Champagne: sent 12/);
  } finally {
    if (previousKey === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = previousKey;
  }
});

test('return email shows original warehouse counts only when different from sent', async () => {
  const { renderBarReturnEmail, renderBarReturnText } = await import('../utils/barReturnEmail.js');
  const event = { items: [{ name: 'Vodka', sentQty: 10, sentQtyOriginal: 12 }, { name: 'Gin', sentQty: 0, sentQtyPending: true }] };
  assert.match(renderBarReturnEmail(event), /<th>Warehouse sent<\/th>/);
  assert.match(renderBarReturnEmail(event), /Vodka<\/td><td>12<\/td><td>10<\/td>/);
  assert.match(renderBarReturnText(event), /warehouse sent 12/);
  event.items[0].sentQty = 12;
  assert.doesNotMatch(renderBarReturnEmail(event), /Warehouse sent/);
});
