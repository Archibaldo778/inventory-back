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
          position: 'Captain',
          workers: [{ name: 'Aidan Collis', status: 'confirmed' }],
        }],
      },
    },
  };
  const users = [{ _id: 'captain-aidan', username: 'Aidan', email: 'aidancollis@gmail.com' }];
  assert.deepEqual(matchNowstaCaptainUserIds({ event, users }), ['captain-aidan']);
});

test('Nowsta captain assignment ignores non-captain shifts and unconfirmed workers', () => {
  const event = {
    meta: {
      nowsta: {
        shifts: [
          { position: 'Bartender', workers: [{ name: 'Aidan Collis', status: 'confirmed' }] },
          { position: 'Lead Server', workers: [{ name: 'Aidan Collis', status: 'pending' }] },
        ],
      },
    },
  };
  const users = [{ _id: 'captain-aidan', nowstaName: 'Aidan Collis' }];
  assert.deepEqual(matchNowstaCaptainUserIds({ event, users }), []);
  assert.equal(normalizeNowstaPersonName('zz Matrix - Aidan Collis (Agency)'), 'aidan collis');
});
