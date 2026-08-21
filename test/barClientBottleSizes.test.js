import test from 'node:test';
import assert from 'node:assert/strict';
import BarEvent from '../models/BarEvent.js';

test('bar cocktail items persist only supported client bottle sizes', () => {
  const valid = new BarEvent({
    name: 'Bottle size event',
    items: [{
      name: 'Specialty Cocktail',
      clientProvidedIngredients: ['Vodka'],
      clientProvidedBottleSizes: [{ ingredient: 'Vodka', bottleSizeMl: 750 }],
    }],
  });
  assert.equal(valid.validateSync(), undefined);

  const invalid = new BarEvent({
    name: 'Invalid bottle size event',
    items: [{
      name: 'Specialty Cocktail',
      clientProvidedBottleSizes: [{ ingredient: 'Vodka', bottleSizeMl: 500 }],
    }],
  });
  assert.match(invalid.validateSync()?.message || '', /clientProvidedBottleSizes/);
});
