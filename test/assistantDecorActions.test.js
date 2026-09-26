import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  assistantDecorActionKind,
  currentMessageInventoryCodes,
  isExplicitDecorAddCommand,
  selectAssistantDecorProduct,
} from '../utils/assistantDecorActions.js';

const assistantRouteSource = await readFile(new URL('../routes/assistant.js', import.meta.url), 'utf8');

test('assistant exact decor selection uses OCC codes from only the current message', () => {
  assert.deepEqual(currentMessageInventoryCodes('Add OCC00292 now'), ['OCC00292']);
  assert.deepEqual(currentMessageInventoryCodes('add the bucket'), []);
  const oldProduct = { inventoryCode: 'OCC00721', name: 'Old context item' };
  const currentProduct = { inventoryCode: 'OCC00292', name: 'Current item' };
  const selected = selectAssistantDecorProduct({
    message: 'Add OCC00292 now', exactInventory: [oldProduct, currentProduct], inventoryCandidates: [oldProduct, currentProduct],
  });
  assert.equal(selected.product, currentProduct);
  assert.equal(selected.exactCurrentCode, true);
  assert.equal(assistantDecorActionKind(selected.exactCurrentCode), 'add_decor');
});

test('assistant single-candidate fallback requires an explicit non-question add command', () => {
  const product = { inventoryCode: 'OCC00292', name: 'Champagne bucket' };
  assert.equal(isExplicitDecorAddCommand('add the champagne bucket'), true);
  assert.equal(isExplicitDecorAddCommand('can you add the champagne bucket?'), false);
  assert.equal(isExplicitDecorAddCommand('почему OCC123 не добавился?'), false);
  assert.equal(selectAssistantDecorProduct({ message: 'why add this?', inventoryCandidates: [product] }).product, null);
  const selected = selectAssistantDecorProduct({ message: 'add the champagne bucket', inventoryCandidates: [product] });
  assert.equal(selected.product, product);
  assert.equal(selected.exactCurrentCode, false);
  assert.equal(assistantDecorActionKind(selected.exactCurrentCode), 'preview_add_decor');
});

test('assistant route uses the explicit non-question command guard before creating decor actions', () => {
  assert.match(assistantRouteSource, /const addRequested = isExplicitDecorAddCommand\(message\)/);
  assert.doesNotMatch(assistantRouteSource, /const addRequested = \/\(\?:\\badd/);
});
