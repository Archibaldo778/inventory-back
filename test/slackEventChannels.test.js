import test from 'node:test';
import assert from 'node:assert/strict';

import { matchSlackEventWorkers, slackEventChannelName } from '../utils/slackEventChannels.js';

test('Slack event channel names are stable, valid, and short', () => {
  const name = slackEventChannelName({
    date: '2026-09-24',
    title: 'Prada Donna & Uomo Appointments — DAY 1',
    externalId: 'E22847-S62831',
  });
  assert.equal(name, '0924-prada-donna-uomo-appointments-day-1-e22847-s62831');
  assert.match(name, /^[a-z0-9_-]{1,80}$/);
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

