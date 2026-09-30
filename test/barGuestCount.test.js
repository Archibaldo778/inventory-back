import test from 'node:test';
import assert from 'node:assert/strict';
import { dashboardEventGuestCount } from '../utils/barGuestCount.js';

test('bar guest count accepts Dashboard aliases and formatted values', () => {
  assert.equal(dashboardEventGuestCount({ meta: { numberOfGuests: '1,250 guests' } }), 1250);
  assert.equal(dashboardEventGuestCount({ meta: { pax: 180 } }), 180);
});

test('bar guest count falls back to Caterease when Dashboard contains an empty zero', () => {
  assert.equal(dashboardEventGuestCount({
    meta: { guestCount: 0 },
    catereaseOperations: { guestCount: 220 },
  }), 220);
});
