import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveOperationalDropboxFolder } from '../utils/operationalDropbox.js';

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
