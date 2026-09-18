import assert from 'node:assert/strict';
import test from 'node:test';
import JSZip from 'jszip';
import { parseKitchenPackOutBlueprint } from '../utils/kitchenPackOutBlueprint.js';
import { operationalRows, renderCatereaseOperationalDocx } from '../utils/catereaseOperations.js';

const cell = (value = '') => `<w:tc><w:p><w:r><w:t>${value}</w:t></w:r></w:p></w:tc>`;
const row = (values) => `<w:tr>${values.map(cell).join('')}</w:tr>`;

test('imports a split Kitchen Pack Out as ordered headings and items', async () => {
  const zip = new JSZip();
  zip.file('word/document.xml', `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:tbl>
    ${row(['', 'Quantity', 'Not Enough', 'Just Enough', 'Too Much'])}
    ${row(['SEATED DINNER'])}
    ${row(['Roasted eggplant'])}
    ${row(['Miso roasted eggplant', '4 qt', '', '', ''])}
    ${row(['Pomegranate seeds', '2 pt', '', '', ''])}
  </w:tbl></w:body></w:document>`);
  const buffer = await zip.generateAsync({ type: 'nodebuffer' });
  const blueprint = await parseKitchenPackOutBlueprint(buffer, '09-18-26_Event KPO_Seated Dinner 1.docx');

  assert.equal(blueprint.name, 'Seated Dinner 1');
  assert.deepEqual(blueprint.rows, [
    { kind: 'heading', label: 'SEATED DINNER' },
    { kind: 'heading', label: 'Roasted eggplant' },
    { kind: 'item', itemName: 'Miso roasted eggplant', quantityText: '4 qt', notEnough: '', justEnough: '', tooMuch: '' },
    { kind: 'item', itemName: 'Pomegranate seeds', quantityText: '2 pt', notEnough: '', justEnough: '', tooMuch: '' },
  ]);
});

test('blueprint selection and rendering use the same requested split document', async () => {
  const blueprints = [{
    _id: 'split-1',
    name: 'Greenroom',
    rows: [
      { kind: 'heading', label: 'GREENROOM' },
      { kind: 'item', itemName: 'Whole roasted chicken', quantityText: '4' },
    ],
  }];
  const rows = operationalRows({}, 'kitchen_packout', 'kpo-blueprint:split-1', '', [], blueprints);
  assert.equal(rows.length, 2);
  assert.equal(rows[1].itemName, 'Whole roasted chicken');

  const buffer = await renderCatereaseOperationalDocx({
    event: { title: 'Test Event', date: '2026-09-18', meta: {} },
    snapshot: {},
    type: 'kitchen_packout',
    zoneKey: 'kpo-blueprint:split-1',
    zoneName: 'Greenroom',
    kitchenPackOutBlueprints: blueprints,
  });
  const rendered = await JSZip.loadAsync(buffer);
  const xml = await rendered.file('word/document.xml').async('string');
  assert.match(xml, /GREENROOM/);
  assert.match(xml, /Whole roasted chicken/);
  assert.match(xml, />4</);
});
