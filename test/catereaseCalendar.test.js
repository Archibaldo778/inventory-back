import test from 'node:test';
import assert from 'node:assert/strict';
import {
  catereaseCalendarAvailability,
  normalizeCatereaseCalendarEvent,
} from '../utils/catereaseCalendar.js';

test('Caterease calendar maps the event header without Nowsta data', () => {
  const event = normalizeCatereaseCalendarEvent({
    EvtNum: '00001-00000000021964',
    EventNum: 'E21964              ',
    PartyName: 'Setup for Van Wyck Wedding ',
    Client: 'Van Wyck & Van Wyck',
    EvtDate: '2026-09-18T00:00:00',
    Status: '.Lost',
    Category: 'Set-Up/Breakdown',
    ActGuests: '          ',
    GtdGuests: '200',
    SalesRep: 'Olivier Cheng',
    Revised: '2026-04-20T14:56:06.483',
  }, { sr: true, km: false, po: true });
  assert.equal(event.externalId, 'E21964');
  assert.equal(event.date, '2026-09-18');
  assert.equal(event.status, '.Lost');
  assert.equal(event.meta.guestCount, 200);
  assert.deepEqual(event.meta.calendarReport, { sr: 'Yes', km: '', po: 'Yes' });
});

test('Caterease calendar availability is grouped by raw event id', () => {
  const availability = catereaseCalendarAvailability({
    requiredItems: [{ EvtNum: 'event-a' }],
    foodService: [{ EvtNum: 'event-a' }, { EvtNum: 'event-b' }],
    shifts: [{ EvtNum: 'event-b' }],
  });
  assert.deepEqual(availability.get('event-a'), { po: true, km: true });
  assert.deepEqual(availability.get('event-b'), { km: true, sr: true });
});

