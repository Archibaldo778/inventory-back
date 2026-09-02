import test from 'node:test';
import assert from 'node:assert/strict';
import BarTask from '../models/BarTask.js';
import BarEvent from '../models/BarEvent.js';

test('legacy bar tasks and cocktail prep tasks default to normal priority', async () => {
  const task = new BarTask({ title: 'Order clear ice', scheduledDate: '2026-09-03' });
  await task.validate();
  assert.equal(task.priority, 'normal');

  const event = new BarEvent({
    name: 'Priority test',
    eventDate: '2026-09-03',
    items: [{ name: 'Gin Basil Smash', prepTask: { scheduledDate: '2026-09-02' } }],
  });
  await event.validate();
  assert.equal(event.items[0].prepTask.priority, 'normal');
});

test('bar tasks accept supported priorities and reject unknown values', async () => {
  const urgent = new BarTask({ title: 'Urgent prep', scheduledDate: '2026-09-03', priority: 'urgent' });
  await urgent.validate();
  assert.equal(urgent.priority, 'urgent');

  const invalid = new BarTask({ title: 'Invalid prep', scheduledDate: '2026-09-03', priority: 'later' });
  await assert.rejects(() => invalid.validate(), /priority/);
});
