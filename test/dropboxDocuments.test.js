import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyDropboxEntry,
  inferDropboxDocumentType,
  inferDropboxPathDate,
  nyToday,
} from '../utils/dropboxDocuments.js';

test('Dropbox document names identify PO and Kitchen Menu files conservatively', () => {
  assert.equal(inferDropboxDocumentType('E22500 PO.docx'), 'po');
  assert.equal(inferDropboxDocumentType('Kitchen_Menu E22500.docx'), 'kitchen_menu');
  assert.equal(inferDropboxDocumentType('Event documents.docx'), 'review');
});

test('Dropbox proposal paths recognize ISO and US dates', () => {
  assert.equal(inferDropboxPathDate('/Proposals/2026/September/09-18-2026 Event/PO.docx'), '2026-09-18');
  assert.equal(inferDropboxPathDate('/Proposals/2026/2026-10-02 Event/KM.docx'), '2026-10-02');
});

test('Dropbox discovery never queues files before the current New York date', () => {
  const oldEntry = {
    '.tag': 'file', id: 'id:old', name: 'PO.docx', path_display: '/Proposals/2026/August/08-31-2026 Event/PO.docx',
  };
  const futureEntry = {
    '.tag': 'file', id: 'id:new', name: 'KM.docx', path_display: '/Proposals/2026/September/09-18-2026 Event/KM.docx',
  };
  assert.equal(classifyDropboxEntry(oldEntry, { today: '2026-09-04' }).status, 'skipped_old');
  assert.equal(classifyDropboxEntry(futureEntry, { today: '2026-09-04' }).status, 'discovered');
});

test('Dropbox discovery sends missing dates to review instead of importing', () => {
  const entry = {
    '.tag': 'file', id: 'id:review', name: 'PO.docx', path_display: '/Proposals/2026/September/George/Event/PO.docx',
  };
  const result = classifyDropboxEntry(entry, { today: '2026-09-04' });
  assert.equal(result.status, 'review');
  assert.match(result.reason, /date/i);
  assert.match(nyToday(new Date('2026-09-04T15:00:00Z')), /^2026-09-04$/);
});
