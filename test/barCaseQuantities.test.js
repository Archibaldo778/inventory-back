import test from 'node:test';
import assert from 'node:assert/strict';
import {
  convertPackoutCasesToBottles,
  hasZeroCaseConversion,
  parseCaseCount,
  parseCaseSize,
} from '../utils/barCaseQuantities.js';
import { normalizeOcrCatalogName } from '../utils/barPackoutRecognition.js';

test('case quantities use the matched inventory case size before returns accounting', () => {
  assert.equal(parseCaseCount('1 CASE'), 1);
  assert.equal(parseCaseCount('Case: 2'), 2);
  assert.equal(parseCaseCount('6 bottles'), null);
  assert.deepEqual(convertPackoutCasesToBottles({ quantity: 1, quantityText: '1 case', caseSize: 12 }), {
    quantity: 12,
    quantityText: '12 bottles (1 case × 12)',
    pending: false,
  });
});

test('a case count embedded in a PO item name is recognized and does not remain pending', () => {
  assert.equal(parseCaseCount('No PO yet · LA Caravelle Champagne 1 Case'), 1);
  assert.equal(
    normalizeOcrCatalogName('LA Caravelle Champagne 1 Case'),
    normalizeOcrCatalogName('LA Caravelle Champagne'),
  );
  assert.deepEqual(convertPackoutCasesToBottles({
    quantity: 0,
    quantityText: 'No PO yet · LA Caravelle Champagne 1 Case',
    caseSize: 12,
  }), {
    quantity: 12,
    quantityText: '12 bottles (1 case × 12)',
    pending: false,
  });
});

test('a case with no configured size stays visibly pending instead of counting as one bottle', () => {
  assert.deepEqual(convertPackoutCasesToBottles({ quantity: 1, quantityText: '1 case', caseSize: null }), {
    quantity: 1,
    quantityText: '1 case · case size missing',
    pending: true,
  });
});

test('case size phrases never turn a PO quantity into zero bottles', () => {
  [
    '3 · San Pellegrino (case of 24)',
    '1 · Topo Chico - Case of 24',
    '4 · Coke cans 24/case',
    '24 · Prosecco 12 per case',
    '6 · Case Cellars Cabernet',
  ].forEach((quantityText) => {
    assert.equal(parseCaseCount(quantityText), null, quantityText);
    assert.equal(convertPackoutCasesToBottles({ quantity: 3, quantityText, caseSize: 24 }), null, quantityText);
  });
  assert.equal(parseCaseSize('San Pellegrino (case of 24)'), 24);
  assert.equal(parseCaseSize('Coke cans 24/case'), 24);
  assert.equal(parseCaseSize('Prosecco 12 per case'), 12);
});

test('an explicit case count uses the size stated in the PO when the catalog has none', () => {
  assert.deepEqual(convertPackoutCasesToBottles({ quantity: 2, quantityText: '2 cases · Topo Chico (case of 24)', caseSize: null }), {
    quantity: 48,
    quantityText: '48 bottles (2 cases × 24)',
    pending: false,
  });
  assert.deepEqual(convertPackoutCasesToBottles({ quantity: 24, quantityText: '24 bottles (2 cases × 12) · Prosecco', caseSize: 12 }), {
    quantity: 24,
    quantityText: '24 bottles (2 cases × 12)',
    pending: false,
  });
});

test('events imported with zero-case conversions are detected for re-import', () => {
  assert.equal(hasZeroCaseConversion({ items: [{ sentQtyText: '0 bottles (0 cases × 24)' }] }), true);
  assert.equal(hasZeroCaseConversion({ items: [{ sentQtyText: '24 bottles (2 cases × 12)' }, { sentQtyText: '10' }] }), false);
});
