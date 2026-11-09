import test from 'node:test';
import assert from 'node:assert/strict';
import { eventDigestPayload } from '../utils/eventReportDigest.js';

test('digest email converts AI headings, emphasis, paragraphs and lists into email HTML', () => {
  const summary = '# Management Summary\n\n**Event:** Dinner\n\n## Overall Outcome\nGuests were happy.\nService finished on time.\n\n## Equipment\n- Missing towels\n  were borrowed.\n- Limited power.\n\n## Follow-up\n1. Check stock.\n2. Confirm power.';
  const payload = eventDigestPayload({ event: { title: 'Dinner', date: '2026-11-05' }, summary, recipients: ['office@example.com'] });
  assert.match(payload.html, /<h2[^>]*>Overall Outcome<\/h2>/);
  assert.match(payload.html, /<strong>Event:<\/strong>/);
  assert.match(payload.html, /Guests were happy\. Service finished on time\./);
  assert.match(payload.html, /<li[^>]*>Missing towels were borrowed\.<\/li>/);
  assert.match(payload.html, /<ul /); assert.match(payload.html, /<ol /);
  assert.doesNotMatch(payload.html, /##|\*\*|white-space:pre-wrap/);
  assert.ok(payload.text.includes(summary));
});

test('email formatting escapes untrusted HTML even inside headings and bold text', () => {
  const payload = eventDigestPayload({ event: { title: '<script>bad</script>' }, summary: '# <img src=x onerror=bad>\n\n**<script>bad</script>**\n\nNormal & safe.', recipients: [] });
  assert.doesNotMatch(payload.html, /<script|<img/);
  assert.match(payload.html, /&lt;img/);
  assert.match(payload.html, /<strong>&lt;script&gt;bad&lt;\/script&gt;<\/strong>/);
  assert.match(payload.html, /Normal &amp; safe/);
});
