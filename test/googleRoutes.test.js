import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRouteLegs, OCC_OFFICE_ADDRESS } from '../utils/googleRoutes.js';

test('driver route starts at OCC and continues from the previous delivery', () => {
  const legs = buildRouteLegs({
    date: '2026-09-24',
    routes: [
      { _id: 'one', eventTitle: 'First event', taskType: 'delivery', address: '724 Fifth Ave', departureTime: '08:30' },
      { _id: 'two', eventTitle: 'Second event', taskType: 'delivery', address: '98 Prince St', departureTime: '13:45' },
    ],
  });
  assert.equal(legs[0].origin, OCC_OFFICE_ADDRESS);
  assert.equal(legs[0].destination, '724 Fifth Ave');
  assert.equal(legs[1].origin, '724 Fifth Ave');
  assert.equal(legs[1].destination, '98 Prince St');
});

test('pickup starts at the event and returns to OCC', () => {
  const [leg] = buildRouteLegs({
    date: '2026-09-24',
    routes: [{ eventTitle: 'Pickup event', taskType: 'pickup', address: '176 Duane St', departureTime: '23:30' }],
  });
  assert.equal(leg.origin, '176 Duane St');
  assert.equal(leg.destination, OCC_OFFICE_ADDRESS);
});
