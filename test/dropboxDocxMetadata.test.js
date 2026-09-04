import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {
  parseDropboxDocxMetadataText,
  readDropboxDocxMetadata,
} from '../utils/dropboxDocxMetadata.js';

test('Dropbox DOCX metadata identifies a Caterease Kitchen Menu', () => {
  assert.deepEqual(parseDropboxDocxMetadataText([
    'Event Name: THSS27 VIP Backstage Catering - Day 6',
    'Date: 09/09/2026',
    'Event Number: E22888 - S62999',
    'Guest Count: 120',
    'MENU',
    'BEVERAGE',
  ].join('\n')), {
    eventId: 'E22888',
    eventTitle: 'THSS27 VIP Backstage Catering - Day 6',
    eventDate: '2026-09-09',
    documentType: 'kitchen_menu',
  });
});

test('Dropbox DOCX metadata identifies a Caterease Pack Out', () => {
  const result = parseDropboxDocxMetadataText([
    'Event: THSS27 VIP Backstage Catering - Day 6',
    'Event Date: 09/09/2026',
    'Event Number: E22888',
    'Date PO Modified: 09/04/2026',
    'Delivery Time: 4:00 PM',
    'Name\tQty\tNotes/Comments',
  ].join('\n'));
  assert.equal(result.eventId, 'E22888');
  assert.equal(result.eventTitle, 'THSS27 VIP Backstage Catering - Day 6');
  assert.equal(result.eventDate, '2026-09-09');
  assert.equal(result.documentType, 'po');
});

test('Dropbox DOCX reader extracts metadata from the Word archive', async () => {
  const zip = new JSZip();
  zip.file('word/document.xml', `<?xml version="1.0"?><w:document xmlns:w="urn:test"><w:body>
    <w:p><w:r><w:t>Event Name: Series Dinner Day 2</w:t></w:r></w:p>
    <w:p><w:r><w:t>Date: 09/05/2026</w:t></w:r></w:p>
    <w:p><w:r><w:t>Event Number: E22002</w:t></w:r></w:p>
    <w:p><w:r><w:t>Guest Count: 80</w:t></w:r></w:p>
    <w:p><w:r><w:t>MENU</w:t></w:r></w:p>
  </w:body></w:document>`);
  const buffer = await zip.generateAsync({ type: 'nodebuffer' });
  const result = await readDropboxDocxMetadata(buffer);
  assert.equal(result.eventTitle, 'Series Dinner Day 2');
  assert.equal(result.eventDate, '2026-09-05');
  assert.equal(result.eventId, 'E22002');
  assert.equal(result.documentType, 'kitchen_menu');
});

test('Dropbox DOCX reader keeps kitchen dishes and bar beverages from one menu', async () => {
  const zip = new JSZip();
  zip.file('word/document.xml', `<?xml version="1.0"?><w:document xmlns:w="urn:test"><w:body>
    <w:p><w:r><w:t>Event Name: Gallery Dinner</w:t></w:r></w:p>
    <w:p><w:r><w:t>Date: 09/10/2026</w:t></w:r></w:p>
    <w:p><w:r><w:t>Guest Count: 40</w:t></w:r></w:p>
    <w:p><w:r><w:t>MENU</w:t></w:r></w:p>
    <w:p><w:r><w:t>FIRST COURSE</w:t></w:r></w:p>
    <w:p><w:r><w:t>Tuna tartare with citrus GF</w:t></w:r></w:p>
    <w:p><w:r><w:t>BEVERAGE</w:t></w:r></w:p>
    <w:p><w:r><w:t>SPECIALTY COCKTAILS</w:t></w:r></w:p>
    <w:p><w:r><w:t>GALLERY MARTINI</w:t></w:r></w:p>
    <w:p><w:r><w:t>Vodka, Vermouth, Lemon</w:t></w:r></w:p>
  </w:body></w:document>`);
  const result = await readDropboxDocxMetadata(await zip.generateAsync({ type: 'nodebuffer' }));

  assert.deepEqual(result.kitchenItems.map((item) => item.normalizedName), ['tuna tartare with citrus']);
  assert.equal(result.barItems.length, 1);
  assert.equal(result.barItems[0].name, 'GALLERY MARTINI');
  assert.equal(result.barItems[0].preparedBeverageType, 'cocktail');
});

test('Dropbox DOCX reader extracts bar rows from a PO table even when the folder is generic', async () => {
  const zip = new JSZip();
  zip.file('word/document.xml', `<?xml version="1.0"?><w:document xmlns:w="urn:test"><w:body>
    <w:p><w:r><w:t>Event: Gallery Dinner</w:t></w:r></w:p>
    <w:p><w:r><w:t>Event Date: 09/10/2026</w:t></w:r></w:p>
    <w:p><w:r><w:t>Date PO Modified: 09/04/2026</w:t></w:r></w:p>
    <w:p><w:r><w:t>Delivery Time: 4:00 PM</w:t></w:r></w:p>
    <w:p><w:r><w:t>ALCOHOL</w:t></w:r></w:p>
    <w:tbl>
      <w:tr><w:tc><w:p><w:r><w:t>Name</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Qty</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Notes</w:t></w:r></w:p></w:tc></w:tr>
      <w:tr><w:tc><w:p><w:r><w:t>Hendrick's Gin</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>4</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>750 ml</w:t></w:r></w:p></w:tc></w:tr>
    </w:tbl>
  </w:body></w:document>`);
  const result = await readDropboxDocxMetadata(await zip.generateAsync({ type: 'nodebuffer' }));

  assert.equal(result.documentType, 'po');
  assert.equal(result.barItems.length, 1);
  assert.equal(result.barItems[0].name, "Hendrick's Gin");
  assert.equal(result.barItems[0].quantity, 4);
});
