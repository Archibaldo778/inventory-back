import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeBoardCanvas } from '../utils/boardSnapshotSanitizer.js';

test('sanitizeBoardCanvas removes undefined values and normalizes tldraw metadata', () => {
  const result = sanitizeBoardCanvas({
    items: [{ id: 'one', optional: undefined }],
    meta: {
      tldrawDocument: {
        store: {
          shape: {
            id: 'shape',
            typeName: 'shape',
            meta: null,
            optional: undefined,
          },
        },
      },
    },
  });

  assert.deepEqual(result.items, [{ id: 'one' }]);
  assert.deepEqual(result.meta.tldrawDocument.store.shape.meta, {});
  assert.equal('optional' in result.meta.tldrawDocument.store.shape, false);
});

test('sanitizeBoardCanvas safely normalizes invalid input', () => {
  assert.deepEqual(sanitizeBoardCanvas(null), {
    meta: { tldrawDocument: null },
  });
});
