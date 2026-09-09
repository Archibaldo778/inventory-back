import test from 'node:test';
import assert from 'node:assert/strict';
import {
  catereaseFileRevision,
  classifyCatereaseFile,
  normalizeCatereaseEventId,
  normalizeCatereaseFile,
} from '../utils/catereaseFiles.js';

test('Caterease event ids are extracted from Nowsta composite event numbers', () => {
  assert.equal(normalizeCatereaseEventId('E22824 - S62561'), 'E22824');
  assert.equal(normalizeCatereaseEventId('e-22824'), 'E22824');
  assert.equal(normalizeCatereaseEventId('S62561'), '');
});

test('Caterease files recognize operational PO and KM names and comments', () => {
  assert.equal(classifyCatereaseFile({ FileName: 'Day 2 KM.docx' }), 'kitchen_menu');
  assert.equal(classifyCatereaseFile({ FileName: 'Leadership document.docx', Comment: 'Beverage PO' }), 'po');
  assert.equal(classifyCatereaseFile({ FileName: 'Invoice.pdf' }), 'review');
});

test('Caterease metadata keeps UID identity and Revised timestamp', () => {
  const file = normalizeCatereaseFile({
    UID: 96,
    FileName: 'Event PO.docx',
    Comment: 'latest',
    Shared: false,
    Revised: '2026-08-14T15:22:41.113Z',
  }, 'E00470');
  assert.equal(file.uid, 96);
  assert.equal(file.catereaseEventId, 'E00470');
  assert.equal(file.documentType, 'po');
  assert.equal(catereaseFileRevision(file), '2026-08-14T15:22:41.113Z');
});

