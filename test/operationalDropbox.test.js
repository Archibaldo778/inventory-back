import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isUnsafeOperationalDropboxFolder,
  resolveOperationalDropboxFolder,
} from '../utils/operationalDropbox.js';

test('generated documents return to an existing event Dropbox folder', () => {
  assert.deepEqual(resolveOperationalDropboxFolder({
    event: {
      date: '2026-09-18',
      title: 'David Monn Plans a Dinner',
      documents: [{
        sourceProvider: 'dropbox',
        sourcePath: '/Proposals/2026/September/09-18-2026 David Monn/Pack Out/Event PO.docx',
      }],
    },
  }), {
    folderPath: '/Proposals/2026/September/09-18-2026 David Monn',
    existing: true,
  });
});

test('events without source files receive a dated Dropbox folder', () => {
  assert.deepEqual(resolveOperationalDropboxFolder({
    event: { date: '2026-09-18', title: 'David Monn Plans a Dinner' },
    integration: { resolvedRootPath: '/Proposals/2026' },
  }), {
    folderPath: '/Proposals/2026/September/09-18-2026 David Monn Plans a Dinner',
    existing: false,
  });
});

test('a date in the file name is never mistaken for the event folder', () => {
  assert.deepEqual(resolveOperationalDropboxFolder({
    event: {
      date: '2026-09-23',
      title: 'Duo Tasting',
      documents: [{
        sourceProvider: 'dropbox',
        sourcePath: '/Proposals/2026/September/09-28-26 Parent Event/09-23-26 Duo Tasting KM.docx',
      }, {
        sourceProvider: 'dropbox',
        sourcePath: '/Proposals/2026/September/09-28-26 Parent Event/Leadership File/Kitchen/09-23-26 Duo Tasting KPO.docx',
      }],
    },
  }), {
    folderPath: '/Proposals/2026/September/09-28-26 Parent Event',
    existing: true,
  });
});

test('documents from unrelated event folders never collapse to a shared month folder', () => {
  assert.deepEqual(resolveOperationalDropboxFolder({
    event: {
      date: '2026-09-26',
      title: 'Giulia Beverage Only',
      documents: [{
        sourceProvider: 'dropbox',
        sourcePath: '/Proposals/2026/September/09-01-2026 Bensadoun/Leadership File/PO/Event PO.docx',
      }, {
        sourceProvider: 'dropbox',
        sourcePath: '/Proposals/2026/September/09-15-2026 Anjali/SR/Event SR.xlsx',
      }],
    },
    integration: { resolvedRootPath: '/Proposals/2026' },
  }), {
    folderPath: '/Proposals/2026/September/09-26-2026 Giulia Beverage Only',
    existing: false,
  });
});

test('resolved event folders remain valid when names and dates do not mirror the event', () => {
  const cases = [
    '/Proposals/2026/September/09-01-2026 Bensadoun/Leadership File/PO/Event PO.docx',
    '/Proposals/2026/September/BMR/Leadership File/PO/Event PO.docx',
    '/Proposals/2026/September/Undated Client/Leadership File/PO/Event PO.docx',
    '/Proposals/2026/September/Kim/Leadership File/PO/Event PO.docx',
  ];
  cases.forEach((sourcePath) => {
    const result = resolveOperationalDropboxFolder({
      event: {
        date: '2026-09-26', title: 'Bar Mitzvah Reception',
        documents: [{ sourceProvider: 'dropbox', sourcePath }],
      },
    });
    assert.equal(result.existing, true);
    assert.equal(result.folderPath, sourcePath.split('/Leadership File/')[0]);
  });
});

test('Dropbox root, year, and month folders are rejected as unsafe event folders', () => {
  const integration = { resolvedRootPath: '/Proposals' };
  assert.equal(isUnsafeOperationalDropboxFolder('/Proposals', integration), true);
  assert.equal(isUnsafeOperationalDropboxFolder('/Proposals/2026', integration), true);
  assert.equal(isUnsafeOperationalDropboxFolder('/Proposals/2026/September', integration), true);
  assert.equal(isUnsafeOperationalDropboxFolder('/Proposals/2026/09', integration), true);
  assert.equal(isUnsafeOperationalDropboxFolder('/Proposals/2026/September/Kim', integration), false);
});
