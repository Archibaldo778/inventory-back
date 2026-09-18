import test from 'node:test';
import assert from 'node:assert/strict';
import {
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
    Extra2: 'Rev1',
    Extra8: 'Yes',
    Extra20: 'Yes',
    Revised: '2026-04-20T14:56:06.483',
  }, {
    sr: { value: 'Rev2', updatedBy: 'Sales User', updatedAt: '2026-09-18T12:00:00Z' },
    km: { value: '' },
    po: { value: 'Yes' },
  });
  assert.equal(event.externalId, 'E21964');
  assert.equal(event.date, '2026-09-18');
  assert.equal(event.status, '.Lost');
  assert.equal(event.meta.guestCount, 200);
  assert.deepEqual(event.meta.calendarReport, { sr: 'Yes', km: 'Rev1', po: 'Yes' });
  assert.equal(event.meta.calendarReportAudit.sr.updatedBy, 'Sales User');
});

test('Caterease calendar does not infer sent-document status from operational rows', () => {
  const event = normalizeCatereaseCalendarEvent({ EvtNum: 'event-a', EventNum: 'E1', PartyName: 'Test' });
  assert.deepEqual(event.meta.calendarReport, { sr: '', km: '', po: '' });
});

test('Caterease live SR KM and PO fields take precedence and manual status only fills blanks', () => {
  const event = normalizeCatereaseCalendarEvent({
    EvtNum: 'event-a',
    EventNum: 'E1',
    PartyName: 'Test',
    Extra8: 'Rev3',
    Extra2: '',
    Extra20: 'Yes',
  }, {
    sr: { value: 'Rev1' },
    km: { value: 'Rev2' },
    po: { value: '' },
  });
  assert.deepEqual(event.meta.calendarReport, { sr: 'Rev3', km: 'Rev2', po: 'Yes' });
});
