import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTransportationRoutes } from '../utils/transportationSchedule.js';

test('transportation routes retain spreadsheet planning fields and derive assignment status', () => {
  const [route] = normalizeTransportationRoutes([{
    eventId: 'event-1',
    eventTitle: 'Prada Day 1',
    driverSource: 'operations',
    driverId: 'driver-72',
    driverName: 'Oleksandr Stupak',
    vehicle: 'Edge (N19)',
    callTime: '08:00',
    departureTime: '08:30',
    onSiteTime: '10:00',
    pickupTime: '17:00',
    notes: 'Pickup next day',
    address: '724 Fifth Ave',
  }]);
  assert.equal(route.status, 'assigned');
  assert.equal(route.vehicle, 'Edge (N19)');
  assert.equal(route.onSiteTime, '10:00');
});

test('transportation routes may be saved before a driver is assigned', () => {
  const [route] = normalizeTransportationRoutes([{ eventTitle: 'Future event', callTime: 'bad time' }]);
  assert.equal(route.status, 'unassigned');
  assert.equal(route.callTime, '');
});

test('transportation routes retain a no-delivery decision', () => {
  const [route] = normalizeTransportationRoutes([{
    eventTitle: 'No delivery event',
    deliveryRequired: false,
  }]);
  assert.equal(route.deliveryRequired, false);
  assert.equal(route.status, 'not_required');
});
