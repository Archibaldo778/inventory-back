import test from 'node:test';
import assert from 'node:assert/strict';

import { eventLeadershipPeople, matchSlackEventWorkers, slackEventChannelName } from '../utils/slackEventChannels.js';

test('Slack event channel names are stable, valid, and short', () => {
  const name = slackEventChannelName({
    date: '2026-09-24',
    title: 'Prada Donna & Uomo Appointments — DAY 1',
    externalId: 'E22847-S62831',
  });
  assert.equal(name, '0924-prada-donna-uomo-appointments-day-1-e22847-s62831');
  assert.match(name, /^[a-z0-9_-]{1,80}$/);
});

test('event leadership includes the sales manager and configured assistants', () => {
  assert.deepEqual(
    eventLeadershipPeople({ managerId: 'Olivier Cheng' }).map((person) => person.name),
    ['Olivier Cheng', 'Ashley', 'Sebastian', 'Heidi']
  );
  assert.deepEqual(
    eventLeadershipPeople({ meta: { salesRep: 'George Smith' } }).map((person) => person.name),
    ['George Smith', 'Megan']
  );
  assert.deepEqual(eventLeadershipPeople({ managerId: 'Guillaume Darriet' }), [{ name: 'Guillaume Darriet' }]);
  assert.deepEqual(eventLeadershipPeople({ managerId: 'Emma' }), [{ name: 'Emma' }]);
});

test('unique first names can match Slack users for configured assistants', () => {
  const result = matchSlackEventWorkers({
    schedule: { shifts: [{ workers: [{ name: 'Ashley', status: 'confirmed' }] }] },
    slackUsers: [
      { id: 'U1', name: 'ashley', profile: { real_name: 'Ashley Smith', email: 'ashley@example.com' } },
    ],
  });
  assert.equal(result.matched[0]?.id, 'U1');
  assert.equal(result.unmatched.length, 0);
});

test('Slack event workers match by email first and unique name second', () => {
  const result = matchSlackEventWorkers({
    schedule: {
      shifts: [{ workers: [
        { name: 'Elvin Veras', email: 'elvin@example.com', status: 'confirmed' },
        { name: 'Attilio Campos', email: '', status: 'assigned' },
        { name: 'Not Confirmed', email: 'no@example.com', status: 'declined' },
        { name: 'Missing Person', email: 'missing@example.com', status: 'confirmed' },
      ] }],
    },
    slackUsers: [
      { id: 'U1', profile: { email: 'elvin@example.com', real_name: 'Different Slack Name' } },
      { id: 'U2', profile: { email: 'attilio@example.com', real_name: 'Attilio Campos' } },
    ],
  });
  assert.deepEqual(result.matched.map((worker) => worker.id), ['U1', 'U2']);
  assert.deepEqual(result.unmatched, [{ name: 'Missing Person', email: 'missing@example.com' }]);
});
