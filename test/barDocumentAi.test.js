import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { barDocumentLines, validateBarAiResult, generateBarDocument } from '../utils/barDocumentAi.js';
import { extractDropboxDocxLines, readDropboxDocxMetadata } from '../utils/dropboxDocxMetadata.js';
import { blockUnverifiedBarImport } from '../utils/barImportReview.js';
import { requireBarAiOwner, saveBarAiSettings } from '../routes/barAi.js';
import BarAiSettings from '../models/BarAiSettings.js';
const row = (id, kind, name = '', quantity = null, quantityRow = null, quantityText = '') => ({ row: id, kind, name, quantity, quantityRow, quantityText });
const fixture = () => ({
  lines: barDocumentLines('Name\tQty\nGARNISH\nWhite Burgundy (Les Vergelesses)\t9\nRed Bordeaux (Chateau Gloria)\t5\nSIGNATURE COCKTAIL\t20\nNEW YORK 45\nMAINS\t195\nBaby greens with aged sherry shallot vinaigrette\t20'),
  rows: [row(1, 'heading'), row(2, 'heading'), row(3, 'alcohol', 'White Burgundy (Les Vergelesses)', 9, 3, '9'), row(4, 'alcohol', 'Red Bordeaux (Chateau Gloria)', 5, 4, '5'), row(5, 'heading'), row(6, 'cocktail', 'NEW YORK 45', 20, 5, '20'), row(7, 'heading'), row(8, 'food')],
});
test('AI keeps wines under garnish and cocktail heading quantity, excludes food and headings', () => {
  const { lines, rows } = fixture();
  const result = validateBarAiResult({ rows, issues: [] }, { lines, documentType: 'po' });
  assert.equal(result.status, 'verified', result.issues.join(';'));
  assert.deepEqual(result.items.map(({ name, quantity }) => [name, quantity]), [['White Burgundy (Les Vergelesses)', 9], ['Red Bordeaux (Chateau Gloria)', 5], ['NEW YORK 45', 20]]);
});
test('missing rows, invented quantities, recipe numbers, food and duplicate quantity sources require review', () => {
  for (const mutate of [
    (rows) => rows.pop(),
    (rows) => { rows[2].quantity = 99; },
    (rows) => { rows[2].quantityRow = 4; },
    (rows) => { rows[5].quantity = 45; rows[5].quantityRow = 6; },
    (rows) => { rows[7] = row(8, 'alcohol', 'Baby greens with aged sherry shallot vinaigrette', 20, 8, '20'); },
    (rows) => { rows[2].quantity = null; },
    (rows) => { rows[3] = row(4, 'cocktail', 'Red Bordeaux (Chateau Gloria)', 20, 5, '20'); },
  ]) {
    const { lines, rows } = fixture(); mutate(rows);
    assert.equal(validateBarAiResult({ rows, issues: [] }, { lines, documentType: 'po' }).status, 'needs_review');
  }
});
test('KM never establishes sent quantity and retains known recipe ingredients', () => {
  const result = validateBarAiResult({ rows: [row(1, 'cocktail', 'NEW YORK 45', 45, 1, '45')], issues: [] }, {
    lines: ['NEW YORK 45'], documentType: 'kitchen_menu', baseline: [{ name: 'NEW YORK 45', ingredients: ['Gin', 'Lemon'] }],
  });
  assert.equal(result.status, 'verified'); assert.equal(result.items[0].quantity, null);
  assert.equal(result.items[0].sentQtyPending, true); assert.equal(result.items[0].cocktailServingsAuto, false);
  assert.deepEqual(result.items[0].ingredients, ['Gin', 'Lemon']);
});
test('deterministic parser disagreement prevents silently omitting a known drink', () => {
  const result = validateBarAiResult({ rows: [row(1, 'note')], issues: [] }, { lines: ['Dry Sherry\t3'], documentType: 'po', baseline: [{ name: 'Dry Sherry', scope: 'alcohol', quantity: 3 }] });
  assert.equal(result.status, 'needs_review'); assert.match(result.issues.join(' '), /Dry Sherry/);
});
test('AI retries a failed completeness check and receives saved teaching rules on both attempts', async () => {
  const { lines, rows } = fixture(); let calls = 0;
  const result = await generateBarDocument({ text: lines.join('\n'), documentType: 'po', rules: 'White Burgundy is a wine.', apiKey: 'test', fetchImpl: async (_url, options) => {
    const request = JSON.parse(options.body); assert.match(request.instructions, /White Burgundy is a wine/); assert.equal(request.store, false);
    calls += 1;
    if (calls === 2) assert.match(request.input, /every source line/);
    return new Response(JSON.stringify({ status: 'completed', output_text: JSON.stringify({ rows: calls === 1 ? rows.slice(1) : rows, issues: [] }) }));
  } });
  assert.equal(calls, 2); assert.equal(result.status, 'verified');
});
test('DOCX AI failure preserves document metadata but blocks partial bar rows', async () => {
  const zip = new JSZip(); zip.file('word/document.xml', '<w:document><w:body><w:p><w:r><w:t>Event Number: E22914</w:t></w:r></w:p></w:body></w:document>');
  const result = await readDropboxDocxMetadata(await zip.generateAsync({ type: 'nodebuffer' }), { documentType: 'po', inspectBar: async () => { throw new Error('AI unavailable'); } });
  assert.equal(result.eventId, 'E22914'); assert.equal(result.barReview.status, 'needs_review'); assert.deepEqual(result.barItems, []);
});
test('failed automatic import writes only review metadata, never items or returned quantities', async () => {
  let update;
  assert.equal(await blockUnverifiedBarImport({ _id: 'event', title: 'Dinner' }, [{ fileName: 'PO.docx', barReview: { status: 'needs_review', issues: ['Missing wine'] } }], { updateOne: async (filter, changes) => { assert.deepEqual(filter, { linkedEventId: 'event' }); update = changes; } }), true);
  assert.deepEqual(Object.keys(update.$set), ['importReview']); assert.equal(update.$set.importReview.issues[0], 'PO.docx: Missing wine');
  assert.equal(await blockUnverifiedBarImport({}, [{ barReview: { status: 'verified' } }], { updateOne: () => assert.fail('no write') }), false);
});
test('only verified owner account IDs can teach AI, never captain account or matching name', () => {
  for (const [auth, allowed] of [[{ userId: '68c70548aea053de74d25b22' }, true], [{ userId: '68c7047faea053de74d25b15' }, true], [{ userId: '6ac51f12caed1c8144b1f327', username: 'Iurie', role: 'admin' }, false], [{ username: 'Ivan', role: 'super admin' }, false]]) {
    let passed = false; let status;
    requireBarAiOwner({ auth }, { status: (code) => { status = code; return { json: () => {} }; } }, () => { passed = true; });
    assert.equal(passed, allowed); if (!allowed) assert.equal(status, 403);
  }
});
test('teaching edits use revision checks and retain actor and rule text in audit', async (t) => {
  t.mock.method(BarAiSettings, 'findOneAndUpdate', async (filter, update) => {
    assert.deepEqual(filter, { _id: 'bar', revision: 2 }); assert.equal(update.$inc.revision, 1);
    assert.equal(update.$push.audit.$each[0].userId, 'owner'); assert.equal(update.$push.audit.$each[0].rules, 'Exclude food.');
    return null;
  });
  let status;
  await saveBarAiSettings({ auth: { userId: 'owner' }, body: { rules: 'Exclude food.', expectedRevision: 2 } }, { status: (value) => { status = value; return { json: () => {} }; } }, (error) => { throw error; });
  assert.equal(status, 409);
});

test('Qty column is found by header and Delivered or Returned cannot become sent quantities', () => {
  const lines = ['Name\tDelivered\tQty\tReturned', 'Dry Sherry\t2\t9\t1'];
  assert.equal(validateBarAiResult({ rows: [row(1, 'heading'), row(2, 'alcohol', 'Dry Sherry', 9, 2, '9')], issues: [] }, { lines, documentType: 'po' }).status, 'verified');
  assert.equal(validateBarAiResult({ rows: [row(1, 'heading'), row(2, 'alcohol', 'Dry Sherry', 2, 2, '2')], issues: [] }, { lines, documentType: 'po' }).status, 'needs_review');
});
test('truncated provider response cannot be imported', async () => {
  await assert.rejects(generateBarDocument({ text: 'Wine\t2', documentType: 'po', apiKey: 'test', fetchImpl: async () => new Response(JSON.stringify({ status: 'incomplete', output_text: '{}' })) }), /incomplete/);
});

test('AI quantities survive normalization and KM missing quantities never become guest estimates', async (t) => {
  const { normalizePackoutItems } = await import('../routes/bar.js');
  const { default: BeverageItem } = await import('../models/BeverageItem.js');
  const { default: CocktailRecipe } = await import('../models/CocktailRecipe.js');
  t.mock.method(BeverageItem, 'find', () => ({ select: async () => [] }));
  t.mock.method(CocktailRecipe, 'find', () => ({ select: () => ({ lean: async () => [] }) }));
  const ai = validateBarAiResult({ rows: [row(1, 'cocktail', 'NEW YORK 45')], issues: [] }, { lines: ['NEW YORK 45'], documentType: 'kitchen_menu' });
  const items = await normalizePackoutItems(ai.items, { guestCount: 195 });
  assert.equal(items.length, 1); assert.equal(items[0].scope, 'bar_support');
  assert.equal(items[0].sentQtyPending, true); assert.equal(items[0].sentQty, 0); assert.equal(items[0].cocktailServingsAuto, false);
});

test('generic KM water description and staff supply do not block tracked PO water', () => {
  const menu = validateBarAiResult({ rows: [row(1, 'water', 'Flat and sparkling water')], issues: [] }, { lines: ['Flat and sparkling water'], documentType: 'kitchen_menu' });
  assert.equal(menu.status, 'verified'); assert.deepEqual(menu.items, []);
  const po = validateBarAiResult({ rows: [row(1, 'water', 'Staff water', 40, 1, '40'), row(2, 'water', 'Panna', 16, 2, '16'), row(3, 'water', 'Pellegrino', 10, 3, '10')], issues: [] }, { lines: ['Staff water\t40', 'Panna\t16', 'Pellegrino\t10'], documentType: 'po' });
  assert.equal(po.status, 'verified'); assert.deepEqual(po.items.map((item) => [item.name, item.quantity]), [['Panna', 16], ['Pellegrino', 10]]);
  const uncertain = validateBarAiResult({ rows: [row(1, 'water', 'Flat and sparkling water', 20, 1, '20')], issues: [] }, { lines: ['Flat and sparkling water\t20'], documentType: 'po' });
  assert.equal(uncertain.status, 'needs_review');
});


test('ice supplier note does not block a verified PO, genuine baseline drinks remain protected', () => {
  const lines = ['ICE\t2', 'Standard from United', 'White Burgundy\t9'];
  const rows = [row(1, 'ingredient'), row(2, 'note'), row(3, 'alcohol', 'White Burgundy', 9, 3, '9')];
  const baseline = [{ name: 'Standard from United', scope: 'alcohol' }, { name: 'White Burgundy', scope: 'alcohol' }];
  const result = validateBarAiResult({ rows, issues: [] }, { lines, documentType: 'po', baseline });
  assert.equal(result.status, 'verified');
  assert.deepEqual(result.items.map((item) => [item.name, item.quantity]), [['White Burgundy', 9]]);
  const missingWine = validateBarAiResult({ rows: [...rows.slice(0, 2), row(3, 'note')], issues: [] }, { lines, documentType: 'po', baseline });
  assert.equal(missingWine.status, 'needs_review');
  assert.match(missingWine.issues.join(';'), /White Burgundy/);
});

test('generic menu service and client supply notes no longer disagree with legacy false positives', () => {
  const lines = ['Client provide champagne, wine, and for cocktail the Mezcal and Aperol', 'PASSED: Champagne, Wine & Water', '187887-78287200', 'Dry Sherry'];
  const baseline = [{ name: 'Client provide champagne, wine,', scope: 'alcohol' }, { name: 'PASSED: Champagne, Wine & Water', scope: 'alcohol' }, { name: 'Dry Sherry', scope: 'alcohol' }];
  const rows = [row(1, 'note'), row(2, 'note'), row(3, 'note'), row(4, 'alcohol', 'Dry Sherry')];
  const result = validateBarAiResult({ rows, issues: [] }, { lines, documentType: 'kitchen_menu', baseline });
  assert.equal(result.status, 'verified', result.issues.join('; '));
  assert.deepEqual(result.items.map((item) => item.name), ['Dry Sherry']);
  const omitted = validateBarAiResult({ rows: [...rows.slice(0, 3), row(4, 'note')], issues: [] }, { lines, documentType: 'kitchen_menu', baseline });
  assert.equal(omitted.status, 'needs_review');
  assert.match(omitted.issues.join('; '), /Parser disagreement: Dry Sherry/);
});

test('food headings and units cannot become cocktails, but real drinks retain their PO counts', () => {
  const lines = ["PASSED HORS D'OEUVRES\t52", 'SPECIALTY COCKTAILS\t1', 'case', 'WHISKEY SOUR\t70'];
  const baseline = lines.slice(0, 3).map((line) => ({ name: line.split('\t')[0], scope: 'review', section: 'COCKTAIL' }));
  const rows = [row(1, 'heading'), row(2, 'heading'), row(3, 'note'), row(4, 'cocktail', 'WHISKEY SOUR', 70, 4, '70')];
  const result = validateBarAiResult({ rows, issues: [] }, { lines, documentType: 'po', baseline });
  assert.equal(result.status, 'verified', result.issues.join('; '));
  assert.deepEqual(result.items.map((item) => [item.name, item.quantity]), [['WHISKEY SOUR', 70]]);
  assert.equal(validateBarAiResult({ rows: [row(1, 'cocktail', "PASSED HORS D'OEUVRES", 52, 1, '52'), ...rows.slice(1)], issues: [] }, { lines, documentType: 'po', baseline }).status, 'needs_review');
});

test('a supply note mentioning the same wine does not excuse dropping its separate inventory row', () => {
  const result = validateBarAiResult({ rows: [row(1, 'note'), row(2, 'note')], issues: [] }, {
    lines: ['Client provides Dry Sherry', 'Dry Sherry'], documentType: 'kitchen_menu', baseline: [{ name: 'Dry Sherry', scope: 'alcohol' }],
  });
  assert.equal(result.status, 'needs_review');
  assert.match(result.issues.join('; '), /Parser disagreement: Dry Sherry/);
});

test('malformed service times remain notes while adjacent PO drink quantities still require evidence', () => {
  const lines = ['Service time: 5:145PM', 'White Burgundy\t9'];
  const rows = [row(1, 'note'), row(2, 'alcohol', 'White Burgundy', 9, 2, '9')];
  const result = validateBarAiResult({ rows, issues: [] }, { lines, documentType: 'po' });
  assert.equal(result.status, 'verified');
  assert.deepEqual(result.items.map((item) => [item.name, item.quantity]), [['White Burgundy', 9]]);
  assert.equal(validateBarAiResult({ rows: [rows[0], row(2, 'alcohol', 'White Burgundy', 5, 1, '5')], issues: [] }, { lines, documentType: 'po' }).status, 'needs_review');
});


test('DOCX empty Qty cannot shift Returned into sent quantity through AI inspection', async () => {
  const tableRow = (cells) => '<w:tr>' + cells.map((text) => `<w:tc><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`).join('') + '</w:tr>';
  for (const [qty, claimed, expected] of [['', 4, 'needs_review'], ['12', 12, 'verified']]) {
    const xml = `<w:document><w:body><w:tbl>${tableRow(['Item', 'Qty', 'Returned'])}${tableRow(['Dry Sherry', qty, '4'])}</w:tbl></w:body></w:document>`;
    const zip = new JSZip(); zip.file('word/document.xml', xml);
    const result = await readDropboxDocxMetadata(await zip.generateAsync({ type: 'nodebuffer' }), {
      documentType: 'po', inspectBar: async ({ text, documentType }) => {
        const lines = barDocumentLines(text);
        assert.deepEqual(lines[1].split('\t'), ['Dry Sherry', qty, '4']);
        return validateBarAiResult({ rows: [row(1, 'heading'), row(2, 'alcohol', 'Dry Sherry', claimed, 2, String(claimed))], issues: [] }, { lines, documentType });
      },
    });
    assert.equal(result.barReview.status, expected);
    assert.deepEqual(result.barItems.map((item) => item.quantity), expected === 'verified' ? [12] : []);
  }
});
test('AI source lines preserve leading and trailing empty table cells', () => {
  assert.deepEqual(barDocumentLines('  \n\tDry Sherry\t\t4\t\n'), ['\tDry Sherry\t\t4\t']);
  assert.deepEqual(extractDropboxDocxLines('<w:tbl><w:tr><w:tc/><w:tc></w:tc></w:tr></w:tbl>'), []);
});
test('Returned-only table cannot provide sent quantity', () => {
  const result = validateBarAiResult({ rows: [row(1, 'heading'), row(2, 'alcohol', 'Dry Sherry', 4, 2, '4')], issues: [] }, { lines: ['Item\tReturned', 'Dry Sherry\t4'], documentType: 'po' });
  assert.equal(result.status, 'needs_review');
});

test('DOCX AI sees separate paragraphs and hard breaks without changing kitchen extraction', async () => {
  for (const separator of ['</w:t></w:r></w:p><w:p><w:r><w:t>', '</w:t><w:br/><w:t>']) {
    const xml = `<w:document><w:body><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Grey Goose${separator}Patron Silver</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>`;
    assert.deepEqual(extractDropboxDocxLines(xml), ['Grey Goose Patron Silver']);
    const zip = new JSZip(); zip.file('word/document.xml', xml);
    const result = await readDropboxDocxMetadata(await zip.generateAsync({ type: 'nodebuffer' }), {
      documentType: 'kitchen_menu', inspectBar: async ({ text, documentType }) => {
        const lines = barDocumentLines(text);
        assert.deepEqual(lines, ['Grey Goose\u2028Patron Silver']);
        return validateBarAiResult({ rows: [row(1, 'alcohol', 'Grey Goose'), row(1, 'alcohol', 'Patron Silver')], issues: [] }, {
          lines, documentType, baseline: [{ name: 'Grey Goose Patron Silver', scope: 'alcohol' }],
        });
      },
    });
    assert.equal(result.barReview.status, 'verified', result.barReview.issues.join(';'));
    assert.deepEqual(result.barItems.map(({ name, quantity }) => [name, quantity]), [['Grey Goose', null], ['Patron Silver', null]]);
  }
});
test('multiline PO quantities stay aligned with each drink and cannot be swapped or shared', () => {
  const lines = ['Name\tQty\tReturned', 'Grey Goose\u2028Patron Silver\t3\u20285\t1\u20282'];
  const rows = [row(1, 'heading'), row(2, 'alcohol', 'Grey Goose', 3, 2, '3'), row(2, 'alcohol', 'Patron Silver', 5, 2, '5')];
  const result = validateBarAiResult({ rows, issues: [] }, { lines, documentType: 'po' });
  assert.equal(result.status, 'verified', result.issues.join(';'));
  assert.deepEqual(result.items.map((item) => item.quantity), [3, 5]);
  for (const invalid of [
    [row(1, 'heading'), row(2, 'alcohol', 'Grey Goose', 5, 2, '5'), row(2, 'alcohol', 'Patron Silver', 3, 2, '3')],
    [row(1, 'heading'), row(2, 'alcohol', 'Grey Goose', 1, 2, '1'), row(2, 'alcohol', 'Patron Silver', 2, 2, '2')],
  ]) assert.equal(validateBarAiResult({ rows: invalid, issues: [] }, { lines, documentType: 'po' }).status, 'needs_review');
  const shared = ['Name\tQty', 'Grey Goose\u2028Patron Silver\t8'];
  assert.equal(validateBarAiResult({ rows: [row(1, 'heading'), row(2, 'alcohol', 'Grey Goose', 8, 2, '8'), row(2, 'alcohol', 'Patron Silver', 8, 2, '8')], issues: [] }, { lines: shared, documentType: 'po' }).status, 'needs_review');
});
test('splitting a multiline cell cannot excuse a missing known drink or duplicate classification', () => {
  const lines = ['Grey Goose\u2028Patron Silver'];
  const baseline = [{ name: 'Grey Goose Patron Silver', scope: 'alcohol' }];
  for (const rows of [[row(1, 'alcohol', 'Grey Goose')], [row(1, 'alcohol', 'Grey Goose'), row(1, 'alcohol', 'Grey Goose')]]) {
    assert.equal(validateBarAiResult({ rows, issues: [] }, { lines, documentType: 'kitchen_menu', baseline }).status, 'needs_review');
  }
  assert.equal(validateBarAiResult({ rows: [row(1, 'alcohol', 'Grey Goose'), row(1, 'note')], issues: [] }, { lines: ['Grey Goose'], documentType: 'kitchen_menu' }).status, 'needs_review');
});
test('a wrapped wine name remains one item with its original PO quantity', () => {
  const result = validateBarAiResult({ rows: [row(1, 'heading'), row(2, 'alcohol', 'Champagne, Louis Roederer Brut Collection', 12, 2, '12')], issues: [] }, {
    lines: ['Name\tQty', 'Champagne, Louis Roederer\u2028Brut Collection\t12'], documentType: 'po', baseline: [{ name: 'Champagne, Louis Roederer Brut Collection', scope: 'alcohol' }],
  });
  assert.equal(result.status, 'verified', result.issues.join(';'));
  assert.equal(result.items.length, 1); assert.equal(result.items[0].quantity, 12);
});


test('empty leading DOCX cells do not turn client supply notes into parser disagreements', () => {
  for (const name of ['Client provide champagne, wine,', 'PASSED: Champagne, Wine & Water']) {
    const result = validateBarAiResult({ rows: [row(1, 'note')], issues: [] }, {
      lines: [`\t${name}\t\t`], documentType: 'kitchen_menu', baseline: [{ name, scope: 'alcohol' }],
    });
    assert.equal(result.status, 'verified', result.issues.join(';'));
    assert.deepEqual(result.items, []);
  }
});
test('cutlery after wine and buckets of water cannot block or enter the bar packout', () => {
  const lines = ['Name\tQty\tNotes/Comments\tDelivered\tReturned', 'Croix Canon, Saint-Emilion Grand Cru 2018\t32\t\t\t', 'Ivory Handled Steak Knives\t130\tBACK UP\t\t', '5 Gallon Buckets of Water\t3\t\t\t'];
  const baseline = [{ name: 'Croix Canon, Saint-Emilion Grand Cru 2018', scope: 'alcohol' }, { name: 'Ivory Handled Steak Knives', scope: 'alcohol' }];
  for (const supplyKind of ['equipment', 'water']) {
    const rows = [row(1, 'heading'), row(2, 'alcohol', baseline[0].name, 32, 2, '32'), row(3, 'equipment'), row(4, supplyKind, '5 Gallon Buckets of Water', 3, 4, '3')];
    const result = validateBarAiResult({ rows, issues: [] }, { lines, documentType: 'po', baseline });
    assert.equal(result.status, 'verified', result.issues.join(';'));
    assert.deepEqual(result.items.map((item) => [item.name, item.quantity]), [[baseline[0].name, 32]]);
    rows[1] = row(2, 'equipment');
    assert.equal(validateBarAiResult({ rows, issues: [] }, { lines, documentType: 'po', baseline }).status, 'needs_review');
  }
});
