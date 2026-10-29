import test from 'node:test';
import assert from 'node:assert/strict';
import { uniformAccessoryFields } from '../utils/uniformAccessoryFields.js';
const id = '123456789012345678901234';
test('legacy set metadata edits do not introduce accessory fields', () => {
 assert.deepEqual(uniformAccessoryFields({}, {}), {});
});
test('addon saves compatibility and layer order and deduplicates bases', () => {
 assert.deepEqual(uniformAccessoryFields({ assetType: 'addon', compatibleSetIds: JSON.stringify([id, id]), layerOrder: '20' }), { assetType: 'addon', compatibleSetIds: [id], layerOrder: 20 });
});
test('reject malformed compatibility missing bases and invalid type or order', () => {
 for (const body of [{ assetType: 'invalid' }, { compatibleSetIds: '{}' }, { compatibleSetIds: '["invalid"]' }, { layerOrder: '-1' }, { layerOrder: 'NaN' }]) assert.throws(() => uniformAccessoryFields(body));
});

test('accessories can be saved without set assignments or a template', () => {
 assert.deepEqual(uniformAccessoryFields({ assetType: 'addon' }), { assetType: 'addon', compatibleSetIds: [], layerOrder: 10 });
});
