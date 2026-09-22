import test from 'node:test';
import assert from 'node:assert/strict';
import NotificationState from '../models/NotificationState.js';
import { normalizeNotificationStatePatch } from '../utils/notificationState.js';

test('notification state patches deduplicate ids and preserve explicit read and pin changes', () => {
  assert.deepEqual(normalizeNotificationStatePatch({
    ids: ['event:missing-po', ' event:missing-po ', 'document:rev1'],
    read: true,
    pinned: false,
  }), {
    ids: ['event:missing-po', 'document:rev1'],
    read: true,
    pinned: false,
  });
});

test('notification state patches require ids and at least one supported operation', () => {
  assert.throws(() => normalizeNotificationStatePatch({ ids: [], read: true }), /notification ids/i);
  assert.throws(() => normalizeNotificationStatePatch({ ids: ['one'] }), /read or pinned/i);
});

test('notification state identity is unique per user and notification', () => {
  const uniqueIndex = NotificationState.schema.indexes().find(([fields, options]) => (
    fields.userId === 1 && fields.notificationId === 1 && options.unique === true
  ));
  assert.ok(uniqueIndex);
});
