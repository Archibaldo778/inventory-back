import test from 'node:test';
import assert from 'node:assert/strict';
import Event from '../models/Event.js';

test('event stores a versioned Kitchen Menu with parsed dishes', () => {
  const event = new Event({
    title: 'Test Event',
    documents: [{
      type: 'kitchen_menu',
      fileName: 'Kitchen Menu.docx',
      url: 'https://example.test/kitchen-menu.docx',
      version: 2,
      kitchenItems: [{ name: 'Tuna Tartare', normalizedName: 'tuna tartare', section: 'PASSED' }],
    }],
  });
  assert.equal(event.validateSync(), undefined);
  assert.equal(event.documents[0].version, 2);
  assert.equal(event.documents[0].kitchenItems[0].name, 'Tuna Tartare');
});

test('event document rejects unsupported source types', () => {
  const event = new Event({
    title: 'Test Event',
    documents: [{ type: 'invoice', fileName: 'Invoice.docx', url: 'https://example.test/invoice.docx' }],
  });
  assert.ok(event.validateSync()?.errors?.['documents.0.type']);
});
