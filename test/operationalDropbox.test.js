import test from 'node:test';
import assert from 'node:assert/strict';

import {
  dropboxFileBelongsToEvent,
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

test('event file access rejects a file belonging to another event', () => {
  const event = {
    _id: 'giulia', externalId: 'E22943 - S62982', title: 'Giulia Beverage Only', date: '2026-09-26',
  };
  assert.equal(dropboxFileBelongsToEvent({
    event,
    filePath: '/Proposals/2026/September/09-01-2026 Bensadoun/Leadership File/PO/09-01-26 Bensadoun PO.docx',
    fileName: '09-01-26 Bensadoun PO.docx',
  }), false);
  assert.equal(dropboxFileBelongsToEvent({
    event,
    filePath: '/Proposals/2026/September/09-26-2026 Giulia Beverage Only/Leadership File/PO/09-26-26 Giulia PO.docx',
    fileName: '09-26-26 Giulia PO.docx',
  }), true);
});
