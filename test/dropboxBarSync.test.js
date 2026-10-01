import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDropboxBarSourceChecksum,
  hasAppliedDropboxBarSourceChecksum,
  resolveDropboxSharedSeriesDocuments,
  selectDropboxBarSourceDocuments,
} from '../utils/dropboxBarSync.js';

test('Dropbox bar checksum is stable across document ordering and changes with parsed items', () => {
  const left = { sourceId: 'a', sourceRevision: '1', type: 'po', barItems: [{ name: 'Gin', quantity: 2 }] };
  const right = { sourceId: 'b', sourceRevision: '1', type: 'kitchen_menu', barItems: [{ name: 'Spritz' }] };
  assert.equal(buildDropboxBarSourceChecksum([left, right]), buildDropboxBarSourceChecksum([right, left]));
  assert.notEqual(
    buildDropboxBarSourceChecksum([left, right]),
    buildDropboxBarSourceChecksum([{ ...left, barItems: [{ name: 'Gin', quantity: 3 }] }, right])
  );
});

test('a single Day 1 PO is assigned to the final day of a two-day Dropbox series', () => {
  const sharedPo = {
    sourceProvider: 'dropbox', sourceId: 'shared-po', type: 'po',
    fileName: 'Prada Saks Day 1 and Day 2 PO.docx',
    barItems: [{ name: 'LA Caravelle Champagne 1 Case', sentQty: 1 }],
  };
  const dayTwoKm = {
    sourceProvider: 'dropbox', sourceId: 'day-two-km', type: 'kitchen_menu',
    fileName: 'Prada Saks Day 2 KM.docx', barItems: [{ name: 'Spritz' }],
  };
  const events = [
    { _id: 'day-one', title: 'Prada Saks 5th Ave. Beverage Service - Day 1', date: '2026-10-01', client: 'Prada', documents: [sharedPo] },
    { _id: 'day-two', title: 'Prada Saks 5th Ave. Beverage Service - Day 2', date: '2026-10-02', client: 'Prada', documents: [dayTwoKm] },
  ];

  const result = resolveDropboxSharedSeriesDocuments(events, 'day-two');

  assert.deepEqual(result.eventIds, ['day-one', 'day-two']);
  assert.equal(result.sourceEventId, 'day-one');
  assert.deepEqual(result.documents.map((document) => document.sourceId).sort(), ['day-two-km', 'shared-po']);
  assert.equal(resolveDropboxSharedSeriesDocuments(events, 'day-one'), null);
});

test('Dropbox bar sync uses one published copy of a mirrored PO', () => {
  const wine = [{ name: 'Sancerre, Romain Reverdy (White)', sentQty: 1 }];
  const documents = [
    {
      sourceProvider: 'dropbox', sourceId: 'documents-copy', type: 'po',
      fileName: '10-01-26 Hermes Madison Cocktail PO.docx',
      sourcePath: '/Events/10-01-26 Hermes Madison Cocktail/Documents/10-01-26 Hermes Madison Cocktail PO.docx',
      barItems: wine,
    },
    {
      sourceProvider: 'dropbox', sourceId: 'leadership-copy', type: 'po',
      fileName: '10-01-26 Hermes Madison Cocktail PO.docx',
      sourcePath: '/Events/10-01-26 Hermes Madison Cocktail/Leadership File/10-01-26 Hermes Madison Cocktail PO.docx',
      barItems: wine,
    },
  ];
  const selected = selectDropboxBarSourceDocuments(documents);
  assert.equal(selected.length, 1);
  assert.equal(selected[0].sourceId, 'leadership-copy');
  assert.equal(selected[0].barItems[0].sentQty, 1);
});

test('Dropbox checksum is current only when Dropbox is the latest source sync', () => {
  const checksum = 'dropbox-checksum';
  assert.equal(hasAppliedDropboxBarSourceChecksum({
    audit: [{ action: 'dropbox_documents_synced', details: { checksum } }],
  }, checksum), true);
  assert.equal(hasAppliedDropboxBarSourceChecksum({
    audit: [
      { action: 'dropbox_documents_synced', details: { checksum } },
      { action: 'caterease_operations_synced', details: { checksum: 'caterease-checksum' } },
    ],
  }, checksum), false);
});
