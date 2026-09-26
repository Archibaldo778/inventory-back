import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const routeSource = await readFile(new URL('../routes/decorPackouts.js', import.meta.url), 'utf8');
const modelSource = await readFile(new URL('../models/DecorPackout.js', import.meta.url), 'utf8');
const boardSource = await readFile(new URL('../utils/decorPackoutBoard.js', import.meta.url), 'utf8');

test('decor packout items retain their deck zone and target page', () => {
  assert.match(modelSource, /zone: \{ type: String/);
  assert.match(modelSource, /deckId: \{ type: mongoose\.Schema\.Types\.ObjectId, ref: 'Deck'/);
  assert.match(modelSource, /pageId: \{ type: mongoose\.Schema\.Types\.ObjectId, ref: 'Page'/);
});

test('board sync treats the saved Canvas as authoritative and removes an empty packout', () => {
  assert.match(routeSource, /router\.post\('\/:id\/sync-board'/);
  assert.match(routeSource, /grouped\.forEach\(\(value\) =>/);
  assert.match(routeSource, /packout\.items = reconciledItems/);
  assert.match(routeSource, /DecorPackout\.deleteOne\(\{ _id: packout\._id \}\)/);
});

test('Word export groups decor rows by zone before product category', () => {
  assert.match(routeSource, /const exportItems = uniquePackoutItems\(packout\.items, packout\.deckId\)/);
  assert.match(routeSource, /menuGroup: item\.zone \|\| item\.category \|\| 'DECOR'/);
});

test('Canvas products are linked to the shared packout instead of duplicated', () => {
  assert.match(boardSource, /expectedByBoardItemId/);
  assert.match(boardSource, /decorPackoutItemId: itemId/);
});

test('Canvas import never writes the imported packout back over its source board', () => {
  const mergeBody = routeSource.match(/const mergePackoutItemsFromEventBoards[\s\S]+?return packout;\n};/)?.[0] || '';
  assert.match(mergeBody, /removeGeneratedDecorPackoutDuplicates/);
  assert.doesNotMatch(mergeBody, /syncPackoutToBoardSafely\(packout\)/);
});
