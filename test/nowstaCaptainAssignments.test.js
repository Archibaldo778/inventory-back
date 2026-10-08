import test from 'node:test';
import assert from 'node:assert/strict';
import {
  matchNowstaCaptainUserIds,
  loadNowstaCaptainAssignments,
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

test('current Nowsta email matches a captain despite a misspelled account name', async () => {
  const user = { _id: 'nemanja', username: 'Nemanja Zbilic', nowstaName: 'Nemanja Zbilic', email: 'nemanja@ocnyc.com' };
  const event = { _id: 'future', meta: { nowsta: { apiEventId: 'nowsta-1', shifts: [{ workers: [{ name: 'Nemanja Zbiljic', status: 'confirmed' }] }] } } };
  const schedule = { nowstaEventId: 'nowsta-1', shifts: [{ position: 'Captain - Bar', workers: [{ name: 'Nemanja Zbiljic', email: 'NEMANJA@ocnyc.com', status: 'confirmed' }] }] };
  let rows = [schedule];
  const Schedules = { find: (query) => { assert.deepEqual(query, { nowstaEventId: { $in: ['nowsta-1'] } }); return { select: () => ({ lean: async () => rows }) }; } };
  assert.deepEqual((await loadNowstaCaptainAssignments([event], [user], { Schedules })).get('future'), ['nemanja']);
  rows = [];
  assert.deepEqual((await loadNowstaCaptainAssignments([event], [user], { Schedules })).get('future'), []);
});

test('authoritative email never falls back to a same-name account and removed assignments grant no access', () => {
  const users = [{ _id: 'wrong', username: 'Nemanja Zbiljic', email: 'other@example.com' }, { _id: 'right', username: 'Nemanja', email: 'nemanja@ocnyc.com' }];
  const worker = { name: 'Nemanja Zbiljic', email: 'nemanja@ocnyc.com', status: 'confirmed' };
  const match = (worker, extra = {}) => matchNowstaCaptainUserIds({ users, schedule: { ...extra, shifts: [{ workers: [worker] }] } });
  assert.deepEqual(match(worker), ['right']);
  assert.deepEqual(match({ ...worker, email: 'unknown@example.com' }), []);
  assert.deepEqual(match({ ...worker, status: 'declined' }), []);
  assert.deepEqual(match({ ...worker, removed_at: '2026-10-08' }), []);
  assert.deepEqual(match(worker, { archived: true }), []);
});

test('legacy name-only assignments remain supported but ambiguous names are not assigned arbitrarily', () => {
  const event = { meta: { nowsta: { shifts: [{ workers: [{ name: 'Same Person', status: 'confirmed' }] }] } } };
  assert.deepEqual(matchNowstaCaptainUserIds({ event, users: [{ _id: 'a', username: 'Same Person' }, { _id: 'b', username: 'Same Person' }] }), []);
});
