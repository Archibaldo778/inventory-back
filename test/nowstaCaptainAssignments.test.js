import test from 'node:test';
import assert from 'node:assert/strict';
import {
  matchNowstaCaptainUserIds,
  normalizeNowstaPersonName,
} from '../utils/nowstaCaptainAssignments.js';

test('Nowsta captain assignment matches Aidan Collis by email local part', () => {
  const event = {
    meta: {
      nowsta: {
        shifts: [{
          position: 'Server',
          workers: [{ name: 'Aidan Collis', status: 'confirmed' }],
        }],
      },
    },
  };
  const users = [{ _id: 'captain-aidan', username: 'Aidan', email: 'aidancollis@gmail.com' }];
  assert.deepEqual(matchNowstaCaptainUserIds({ event, users }), ['captain-aidan']);
});

test('Nowsta captain assignment includes any confirmed shift and ignores unconfirmed workers', () => {
  const event = {
    meta: {
      nowsta: {
        shifts: [
          { position: 'Bartender', workers: [{ name: 'Aidan Collis', status: 'confirmed' }] },
          { position: 'Captain', workers: [{ name: 'Pending Person', status: 'pending' }] },
        ],
      },
    },
  };
  const users = [
    { _id: 'captain-aidan', nowstaName: 'Aidan Collis' },
    { _id: 'captain-pending', nowstaName: 'Pending Person' },
  ];
  assert.deepEqual(matchNowstaCaptainUserIds({ event, users }), ['captain-aidan']);
  assert.equal(normalizeNowstaPersonName('zz Matrix - Aidan Collis (Agency)'), 'aidan collis');
});
