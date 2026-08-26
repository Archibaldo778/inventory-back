import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeImportedEvent, normalizeImportedMeta } from '../routes/events.js';

test('Nowsta event import sanitizes operational fields and staffing assignments', () => {
  const event = normalizeImportedEvent({
    externalId: ' E22346 - S60940 ',
    title: ' Aston Martin Cocktail - Staffing ',
    date: '2026-08-26',
    client: 'Aston Martin',
    managerId: 'Guillaume Darriet',
    status: 'Scheduled',
    importSource: 'nowsta',
    meta: {
      venue: 'Aston Martin Park Avenue',
      address: '450 Park Ave',
      eventTime: '4:00 PM - 9:00 PM',
      guestCount: 150,
      nowsta: {
        department: 'Staffing and Service',
        staffTotals: '2/3 confirmed',
        shifts: [{
          position: 'Captain - Floor',
          startTime: '3:00 PM',
          endTime: '9:00 PM',
          workers: [{ name: 'Adrain Palmer', status: 'Confirmed', agency: false }],
          unfilled: 1,
        }],
      },
    },
  });

  assert.equal(event.externalId, 'E22346 - S60940');
  assert.equal(event.importSource, 'nowsta');
  assert.equal(event.meta.guestCount, 150);
  assert.equal(event.meta.nowsta.shifts[0].workers[0].status, 'confirmed');
  assert.equal(event.meta.nowsta.shifts[0].unfilled, 1);
});

test('event import rejects arbitrary import sources and missing guest counts', () => {
  const meta = normalizeImportedMeta({ nowsta: { shifts: [] }, guestCount: '' });
  const event = normalizeImportedEvent({ title: 'Dinner', importSource: 'unknown' });
  assert.equal(meta.guestCount, null);
  assert.equal(event.importSource, 'caterease');
});
