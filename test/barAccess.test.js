import test from 'node:test';
import assert from 'node:assert/strict';

import { canOperateEvent, canViewEvent } from '../routes/bar.js';

const assignedEvent = { assignedUserIds: ['captain-one'] };

test('bar workers can view and operate only events assigned from Nowsta', () => {
  const captain = { userId: 'captain-one', role: 'bar captain' };
  const otherCaptain = { userId: 'captain-two', role: 'bar captain' };
  const bartender = { userId: 'captain-one', role: 'bartender' };
  const otherBartender = { userId: 'bartender-two', role: 'bartender' };

  assert.equal(canViewEvent(assignedEvent, captain), true);
  assert.equal(canOperateEvent(assignedEvent, captain), true);
  assert.equal(canViewEvent(assignedEvent, otherCaptain), false);
  assert.equal(canOperateEvent(assignedEvent, otherCaptain), false);
  assert.equal(canViewEvent(assignedEvent, bartender), true);
  assert.equal(canOperateEvent(assignedEvent, bartender), true);
  assert.equal(canViewEvent(assignedEvent, otherBartender), false);
  assert.equal(canOperateEvent(assignedEvent, otherBartender), false);
});

test('bar managers retain access while workspace viewers cannot modify bar events', () => {
  assert.equal(canViewEvent(assignedEvent, { role: 'bar admin' }), true);
  assert.equal(canOperateEvent(assignedEvent, { role: 'bar admin' }), true);
  assert.equal(canViewEvent(assignedEvent, { role: 'admin' }), true);
  assert.equal(canOperateEvent(assignedEvent, { role: 'admin' }), true);
  assert.equal(canViewEvent(assignedEvent, { role: 'sales rep' }), true);
  assert.equal(canOperateEvent(assignedEvent, { role: 'sales rep' }), false);
});
