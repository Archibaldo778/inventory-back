import test from 'node:test';
import assert from 'node:assert/strict';
import { convertPackoutCasesToBottles, parseCaseCount } from '../utils/barCaseQuantities.js';

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

test('a case with no configured size stays visibly pending instead of counting as one bottle', () => {
  assert.deepEqual(convertPackoutCasesToBottles({ quantity: 1, quantityText: '1 case', caseSize: null }), {
    quantity: 1,
    quantityText: '1 case · case size missing',
    pending: true,
  });
});
