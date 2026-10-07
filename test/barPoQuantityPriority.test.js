import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePackoutItems } from '../routes/bar.js';
import BeverageItem from '../models/BeverageItem.js';
import CocktailRecipe from '../models/CocktailRecipe.js';
import { runImportedBarItemMergePipeline } from '../utils/barManualItems.js';

const menu = ['APPLE CIDER GIMLET', 'SPICED PEAR SPRITZ'].map((name) => ({ name, section: 'COCKTAIL', scope: 'review', quantity: null, sentQty: 68, cocktailServingsAuto: true }));

test('KM planning yields to PO quantities; later KM and combined imports cannot restore estimates', async (t) => {
  const originals = [BeverageItem.find, CocktailRecipe.find];
  t.after(() => { [BeverageItem.find, CocktailRecipe.find] = originals; });
  const empty = () => ({ select() { return this; }, limit() { return this; }, then(resolve) { return Promise.resolve([]).then(resolve); }, lean: async () => [] });
  BeverageItem.find = empty;
  CocktailRecipe.find = empty;
  const km = await normalizePackoutItems(menu, { guestCount: 52 });
  assert.deepEqual(km.map((i) => i.sentQty), [68, 68]);
  const po = await normalizePackoutItems(menu.map((item, i) => ({ ...item, quantity: [32, 45][i] })), { guestCount: 52 });
  assert.deepEqual(po.map((i) => i.sentQty), [32, 45]);
  assert.ok(po.every((i) => i.cocktailServingsAuto === false));
  const apply = (existingItems, importedItems, documentTypes) => runImportedBarItemMergePipeline({ existingItems, importedItems, documentTypes }).items;
  const firstMenu = apply([], km, ['kitchen_menu']);
  const afterPo = apply(firstMenu, po, ['po']);
  afterPo[0].returnedFullQty = 3;
  afterPo[0].returnConfirmed = true;
  const laterMenu = apply(afterPo, km, ['kitchen_menu']);
  assert.deepEqual(laterMenu.map((i) => i.sentQty), [32, 45]);
  assert.equal(laterMenu[0].returnedFullQty, 3);
  assert.equal(laterMenu[0].returnConfirmed, true);
  assert.ok(laterMenu.every((i) => !i.cocktailServingsAuto));
  for (const combined of [[...km, ...po], [...po, ...km]]) {
    assert.deepEqual(apply([], combined, ['po', 'kitchen_menu']).map((i) => i.sentQty), [32, 45]);
  }
  const updatedPo = po.map((item, i) => ({ ...item, sentQty: [0, 20][i], sentQtyText: String([0, 20][i]) }));
  assert.deepEqual(apply(laterMenu, updatedPo, ['po']).map((i) => i.sentQty), [0, 20]);
});

test('a Kitchen Menu pending bottle row cannot erase a confirmed PO quantity', () => {
  const result = runImportedBarItemMergePipeline({
    existingItems: [{ name: 'Grey Goose', scope: 'alcohol', sentQty: 2, sentQtyText: '2', cocktailServingsAuto: false }],
    importedItems: [{ name: 'Grey Goose', scope: 'alcohol', sentQty: 0, sentQtyPending: true }], documentTypes: ['kitchen_menu'],
  });
  assert.equal(result.items[0].sentQty, 2);
  assert.equal(result.items[0].sentQtyPending, false);
});
