import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { findDropboxEventMatch } from '../utils/dropboxDocuments.js';
import {
  parseDropboxKitchenBarItems,
  parseDropboxDocxMetadataText,
  readDropboxDocxMetadata,
} from '../utils/dropboxDocxMetadata.js';

test('shared Prada PO with two dates retains Panna and Pellegrino and matches the first service day', async () => {
  const zip = new JSZip();
  const paragraph = (text) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
  const cell = (text) => `<w:tc>${paragraph(text)}</w:tc>`;
  const row = (cells) => `<w:tr>${cells.map(cell).join('')}</w:tr>`;
  zip.file('word/document.xml', `<w:document xmlns:w="urn:test"><w:body>
    <w:tbl>${row(['Event: Prada Saks 5th Ave. Beverage Service - Day 1 and Day 2', 'Event Date: Thursday, October 1, 2026 Friday, October 2, 2026'])}
    ${row(['Event Number: E22975', 'Date PO Modified: 9/29/2026 (10:22 am)'])}</w:tbl>
    <w:tbl>${row(['Name', 'Qty', 'Notes/Comments', 'Delivered', 'Returned'])}
    ${row(['WATER'])}${row(['Panna', '12'])}${row(['Pellegrino', '16'])}</w:tbl>
    </w:body></w:document>`);
  const result = await readDropboxDocxMetadata(await zip.generateAsync({ type: 'nodebuffer' }));
  assert.equal(result.eventDate, '2026-10-01');
  assert.equal(result.documentType, 'po');
  assert.deepEqual(result.barItems.map((item) => [item.name, item.quantity, item.returnRequired]), [['Panna', 12, true], ['Pellegrino', 16, true]]);
  const matched = findDropboxEventMatch({ ...result, inferredDate: result.eventDate }, [
    { _id: 'day1', externalId: 'E22975 - S63087', date: '2026-10-01' },
    { _id: 'day2', externalId: 'E22976 - S63089', date: '2026-10-02' },
  ]);
  assert.equal(matched.status, 'matched');
  assert.equal(matched.event._id, 'day1');
});

test('multi-date menu metadata handles month/year boundaries and refuses invalid or uncertain dates', () => {
  const date = (value) => parseDropboxDocxMetadataText(`Event Date: ${value}`).eventDate;
  assert.equal(date('Thursday, December 31, 2026 and Friday, January 1, 2027'), '2026-12-31');
  assert.equal(date('October 2, 2026 – October 1, 2026'), '2026-10-01');
  assert.equal(date('February 30, 2026 March 1, 2026'), '');
  assert.equal(date('October 1, 2026 or October 2, 2026'), '');
  assert.equal(date('Thursday, October 1, 2026'), '2026-10-01');
  assert.equal(date('10/01/2026'), '2026-10-01');
});

test('Kitchen Menu treats mixed-case cocktail recipes as one cocktail, not alcohol inventory', () => {
  const result = parseDropboxKitchenBarItems([
    'BEVERAGE',
    'SPECIALTY COCKTAILS',
    'Hibiscus Honey Margarita',
    'Tequila, Hibiscus Flower, Fresh Lime Juice, Orange Blossom Honey',
  ].join('\n'));

  assert.equal(result.length, 1);
  assert.equal(result[0].name, 'Hibiscus Honey Margarita');
  assert.equal(result[0].preparedBeverageType, 'cocktail');
  assert.equal(result[0].returnRequired, false);
  assert.match(result[0].notes, /Tequila, Hibiscus Flower/);
});

test('Kitchen Menu ignores recipe and service comments containing spirit names', () => {
  const result = parseDropboxKitchenBarItems([
    'BEVERAGE',
    'SPECIALTY COCKTAILS',
    'Tequila, Hibiscus Flower, Fresh Lime Juice, Orange Blossom Honey',
    'Please pour vodka into the labeled batch container',
  ].join('\n'));

  assert.deepEqual(result, []);
});

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
