import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {
  matchTransportationToEvents,
  parseTransportationWorkbook,
  transportationFileName,
} from '../utils/dropboxTransportation.js';

const workbookFixture = async () => {
  const zip = new JSZip();
  const strings = [
    'Dr #', 'Event #', 'Event Name:', 'First:', 'Last:', 'Phone:', 'Call time:', 'Vehicle:',
    'Departure Time:', 'On site arrival:', 'Pick Up:', 'Notes:', 'Address:',
    'Akris Cocktail Party', 'Roman', 'Kokorin', '646-581-4973', 'Edge (N18)', '07:30 PM', '9 White St',
  ];
  zip.file('xl/sharedStrings.xml', `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${strings.map((value) => `<si><t>${value}</t></si>`).join('')}</sst>`);
  zip.file('xl/workbook.xml', '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Transportation" sheetId="1" r:id="rId1"/></sheets></workbook>');
  zip.file('xl/_rels/workbook.xml.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>');
  const sharedCell = (reference, index) => `<c r="${reference}" t="s"><v>${index}</v></c>`;
  zip.file('xl/worksheets/sheet1.xml', `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1"/><c r="B1"/>${['C','D','E','F','G','H','I','J','K','L','M','N','O'].map((column, index) => sharedCell(`${column}1`, index)).join('')}</row><row r="2"><c r="A2"><v>1</v></c><c r="B2"/>${sharedCell('E2', 13)}${sharedCell('F2', 14)}${sharedCell('G2', 15)}${sharedCell('H2', 16)}<c r="I2"><v>0.25</v></c>${sharedCell('J2', 17)}<c r="K2"><v>0.6145833333333334</v></c><c r="L2" t="inlineStr"><is><t>03:00 PM</t></is></c>${sharedCell('M2', 18)}<c r="N2"/>${sharedCell('O2', 19)}</row></sheetData></worksheet>`);
  return zip.generateAsync({ type: 'nodebuffer' });
};

test('transportation workbook parser reads the source sheet and formats Excel times', async () => {
  const rows = await parseTransportationWorkbook(await workbookFixture());
  assert.deepEqual(rows, [{
    eventName: 'Akris Cocktail Party',
    driver: 'Roman Kokorin',
    phone: '646-581-4973',
    callTime: '6:00 AM',
    vehicle: 'Edge (N18)',
    departureTime: '2:45 PM',
    arrivalTime: '03:00 PM',
    pickupTime: '07:30 PM',
    notes: '',
    address: '9 White St',
  }]);
});

test('transportation matching combines delivery and pickup rows for the same driver', () => {
  const rows = [
    { eventName: 'Hermes Williamsburg Cocktail', driver: 'Attilio Campos', phone: '917-478-3110', vehicle: 'Green', callTime: '12:00 PM', departureTime: '1:00 PM', arrivalTime: '2:00 PM', pickupTime: 'Roman', notes: '', address: '' },
    { eventName: 'Hermes Williamsburg Cocktail', driver: 'Attilio Campos', phone: '917-478-3110', vehicle: 'Green', callTime: '12:00 PM', departureTime: 'n/a', arrivalTime: 'Roman', pickupTime: '8:30 PM', notes: 'Return truck', address: '' },
  ];
  const result = matchTransportationToEvents(rows, [{ _id: 'event-1', title: 'Hermes Williamsburg Opening Welcome Cocktail' }]);
  assert.equal(result.matches.length, 1);
  assert.deepEqual(result.matches[0].drivers[0], {
    name: 'Attilio Campos', phone: '917-478-3110', callTime: '12:00 PM', vehicle: 'Green',
    departureTime: '1:00 PM', arrivalTime: '2:00 PM', pickupTime: '8:30 PM', notes: 'Return truck',
    address: '', delivery: true, pickup: true, role: 'Delivery & Pickup',
  });
});

test('transportation matching ignores Caterease operational suffixes absent from the driver sheet', () => {
  const rows = [{
    eventName: 'Hermes Williamsburg Opening',
    driver: 'Roman Kokorin',
    phone: '646-581-4973',
    vehicle: 'Edge (N18)',
    callTime: '6:00 AM',
    departureTime: '7:15 AM',
    arrivalTime: '8:00 AM',
    pickupTime: '',
    notes: '',
    address: '',
  }];
  const result = matchTransportationToEvents(rows, [{
    _id: 'event-hermes-private-day',
    title: 'Hermes Williamsburg Opening Beverage Service - Private Day - Staffing 9/18',
  }]);

  assert.equal(result.unmatched.length, 0);
  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].sourceEventName, 'Hermes Williamsburg Opening');
  assert.equal(result.matches[0].drivers[0].name, 'Roman Kokorin');
});

test('transportation filename follows the dated Dropbox convention', () => {
  assert.equal(transportationFileName('2026-09-17'), '09-17-2026 Trans.xlsx');
});

test('transportation matching never assigns two source groups to one event', () => {
  const result = matchTransportationToEvents([
    { eventName: 'Akris Cocktail Party', driver: 'Driver One' },
    { eventName: 'Akris Cocktail', driver: 'Driver Two' },
  ], [{ _id: 'event-1', title: 'Akris Inc. Cocktail Party' }]);
  assert.equal(result.matches.length, 1);
  assert.equal(result.unmatched.length, 1);
});
