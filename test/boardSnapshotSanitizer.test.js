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

test('sanitizeBoardCanvas removes prototype-pollution keys from nested board records', () => {
  const malicious = JSON.parse(`{
    "meta": {
      "tldrawDocument": {
        "store": {
          "shape:malicious": {
            "id": "shape:malicious",
            "typeName": "shape",
            "props": {
              "text": "safe",
              "__proto__": { "onclick": "alert(1)" },
              "constructor": { "prototype": { "onerror": "alert(2)" } }
            }
          }
        }
      }
    }
  }`);

  const result = sanitizeBoardCanvas(malicious);
  const props = result.meta.tldrawDocument.store['shape:malicious'].props;

  assert.equal(props.text, 'safe');
  assert.equal(Object.hasOwn(props, '__proto__'), false);
  assert.equal(Object.hasOwn(props, 'constructor'), false);
  assert.equal(Object.getPrototypeOf(props), Object.prototype);
  assert.equal(props.onclick, undefined);
});

test('sanitizeBoardCanvas bounds deeply nested snapshot values', () => {
  const canvas = { meta: { tldrawDocument: { store: {} } } };
  let cursor = canvas.meta.tldrawDocument.store;
  for (let index = 0; index < 80; index += 1) {
    cursor.next = {};
    cursor = cursor.next;
  }

  const result = sanitizeBoardCanvas(canvas);
  let depth = 0;
  cursor = result.meta.tldrawDocument.store;
  while (cursor?.next && depth < 100) {
    cursor = cursor.next;
    depth += 1;
  }

  assert.ok(depth <= 64);
});
