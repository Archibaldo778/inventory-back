import JSZip from 'jszip';
import { operationalRows } from './catereaseOperations.js';

const clean = (value, maxLength = 1000) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
const escapeXml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

const timeParts = (value) => {
  const text = clean(value, 80);
  const twentyFourHour = text.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (twentyFourHour) {
    const hour = Number(twentyFourHour[1]);
    const minute = Number(twentyFourHour[2]);
    if (hour >= 0 && hour < 24 && minute >= 0 && minute < 60) return { hour, minute };
  }
  const twelveHour = text.match(/^(\d{1,2}):(\d{2})\s*([ap])\.?m\.?$/i);
  if (!twelveHour) return null;
  const displayHour = Number(twelveHour[1]);
  const minute = Number(twelveHour[2]);
  if (displayHour < 1 || displayHour > 12 || minute < 0 || minute >= 60) return null;
  return { hour: (displayHour % 12) + (twelveHour[3].toLowerCase() === 'p' ? 12 : 0), minute };
};

const shiftHours = (startTime, endTime) => {
  const start = timeParts(startTime);
  const end = timeParts(endTime);
  if (!start || !end) return '';
  const startMinutes = start.hour * 60 + start.minute;
  let endMinutes = end.hour * 60 + end.minute;
  if (endMinutes < startMinutes) endMinutes += 1440;
  const hours = (endMinutes - startMinutes) / 60;
  return Number.isInteger(hours) ? hours : Math.round(hours * 100) / 100;
};

const displayTime = (value) => {
  const parts = timeParts(value);
  if (!parts) return clean(value, 80);
  const suffix = parts.hour >= 12 ? 'pm' : 'am';
  const hour = parts.hour % 12 || 12;
  return `${hour}:${String(parts.minute).padStart(2, '0')} ${suffix}`;
};

const parsedDate = (value) => {
  const match = clean(value, 20).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12) : null;
};

const weekDay = (value) => {
  const date = parsedDate(value);
  return date ? new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(date) : '';
};

const columnName = (index) => {
  let value = index + 1;
  let name = '';
  while (value > 0) {
    value -= 1;
    name = String.fromCharCode(65 + (value % 26)) + name;
    value = Math.floor(value / 26);
  }
  return name;
};

const excelDate = (value) => {
  const date = parsedDate(value);
  return date ? Math.floor((Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - Date.UTC(1899, 11, 30)) / 86_400_000) : '';
};

const excelTime = (value) => {
  const parts = timeParts(value);
  return parts ? ((parts.hour * 60) + parts.minute) / 1440 : '';
};

const cell = (row, column, value, style = 4, numeric = false) => {
  const reference = `${columnName(column)}${row}`;
  if (value === '' || value === null || value === undefined) return `<c r="${reference}" s="${style}"/>`;
  if (numeric && Number.isFinite(Number(value))) return `<c r="${reference}" s="${style}"><v>${Number(value)}</v></c>`;
  return `<c r="${reference}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
};

const richCell = (row, column, runs, style = 1) => {
  const reference = `${columnName(column)}${row}`;
  return `<c r="${reference}" s="${style}" t="inlineStr"><is>${runs.map(({ value, properties = '' }) => (
    `<r>${properties ? `<rPr>${properties}</rPr>` : ''}<t xml:space="preserve">${escapeXml(value)}</t></r>`
  )).join('')}</is></c>`;
};

const sheetRow = (row, values, { styles = [], numeric = [] } = {}) => `<row r="${row}">${values.map((value, column) => (
  cell(row, column, value, styles[column] ?? 4, numeric.includes(column))
)).join('')}</row>`;

const eventNumber = (value) => {
  const match = clean(value, 120).toUpperCase().match(/\bE\s*0*(\d+)\b/);
  return match ? `E${match[1]}` : clean(value, 120);
};

const worksheetXml = ({ event, snapshot, zoneKey = '', manualAdditions = [] }) => {
  const rows = operationalRows(snapshot, 'staff_request', zoneKey, '', manualAdditions);
  const guestCount = Number(event?.meta?.guestCount ?? snapshot?.guestCount);
  const totalStaff = rows.reduce((total, row) => total + (Number(row?.required) || 0), 0);
  const firstStart = rows.find((row) => row?.startTime)?.startTime || '';
  const meta = event?.meta || {};
  const snapshotEventTime = [displayTime(snapshot?.eventStartTime), displayTime(snapshot?.eventEndTime)]
    .filter(Boolean).join(' – ');
  const revision = clean(meta.staffRequestRevision || 1, 20);
  const spacerRun = '<b/><sz val="12"/><color rgb="FF000000"/><rFont val="Helvetica"/><family val="2"/>';
  const revisionRun = '<b/><sz val="16"/><color rgb="FF000000"/><rFont val="Helvetica"/><family val="2"/>';
  const revisionGapRun = '<b/><u/><sz val="16"/><color rgb="FF000000"/><rFont val="Helvetica"/><family val="2"/>';
  const revisionSpacerRun = '<b/><u/><sz val="14"/><color rgb="FF000000"/><rFont val="Helvetica"/><family val="2"/>';
  const revisionValueRun = '<b/><u/><sz val="12"/><color rgb="FF000000"/><rFont val="Helvetica"/><family val="2"/>';
  const titleRow = `<row r="1" spans="1:3" ht="21">${richCell(1, 0, [
    { value: 'Staff Request Form' },
    { value: `${' \u00a0'.repeat(38)} `, properties: spacerRun },
    { value: 'Revision', properties: revisionRun },
    { value: ' ', properties: revisionGapRun },
    { value: '\u00a0', properties: revisionSpacerRun },
    { value: revision, properties: revisionValueRun },
  ])}</row>`;
  const headerRows = [
    sheetRow(2, ['', 'STATUS:', clean(meta.catereaseStatus || meta.status || snapshot?.eventStatus)], { styles: [9, 3, 4] }),
    sheetRow(3, ['', 'Sales Rep:', clean(meta.salesRep || snapshot?.salesRep)], { styles: [9, 4, 4] }),
    sheetRow(4, ['EVENT:', 'Week day:', weekDay(event?.date)], { styles: [4, 3, 4] }),
    sheetRow(5, ['', 'Event date:', excelDate(event?.date)], { styles: [2, 3, 5], numeric: [2] }),
    sheetRow(6, ['', 'Client name:', clean(event?.title)], { styles: [2, 3, 4] }),
    sheetRow(7, ['', 'Event type:', clean(meta.eventType || meta.category || snapshot?.eventType)], { styles: [2, 4, 4] }),
    sheetRow(8, ['', 'Guests:', Number.isFinite(guestCount) && guestCount > 0 ? guestCount : ''], { styles: [2, 4, 4], numeric: [2] }),
    sheetRow(9, ['', 'Staff Arrival Time:', excelTime(meta.staffArrivalTime || firstStart)], { styles: [2, 3, 6], numeric: [2] }),
    sheetRow(10, ['', 'Event time:', clean(snapshotEventTime || meta.eventTime)], { styles: [2, 4, 4] }),
    sheetRow(11, ['', 'Staff Departure:', excelTime(meta.staffDepartureTime)], { styles: [2, 3, 6], numeric: [2] }),
    sheetRow(12, ['LOCATION:', 'Address:', clean(meta.venue || meta.nowsta?.venue)], { styles: [10, 11, 4] }),
    sheetRow(13, ['', '', clean(meta.address || meta.nowsta?.address)], { styles: [10, 11, 4] }),
    sheetRow(14, ['', 'Venue Notes:', clean(meta.venueNotes)], { styles: [4, 3, 4] }),
    sheetRow(15, ['', '', ''], { styles: [4, 3, 4] }),
    sheetRow(16, ['', 'Service Ent.', clean(meta.serviceEntrance)], { styles: [4, 3, 4] }),
    sheetRow(17, ['', 'Meet Location:', clean(meta.meetingPoint)], { styles: [4, 3, 7] }),
    sheetRow(18, ['STAFF:', 'Notes of Staff Uniform', clean(meta.staffUniformNotes)], { styles: [4, 3, 8] }),
    sheetRow(19, ['', 'Set Up Attire:', clean(meta.setupAttire)], { styles: [4, 3, 4] }),
    sheetRow(20, ['', 'Staff Notes: ', clean(meta.staffNotes)], { styles: [2, 4, 4] }),
    sheetRow(21, ['', 'Headshots:', clean(meta.headshots)], { styles: [2, 4, 4] }),
    sheetRow(22, ['', 'Clean Shaven:', clean(meta.cleanShaven)], { styles: [2, 3, 3] }),
    sheetRow(23, ['', 'Need sizes:', clean(meta.needSizes)], { styles: [2, 4, 4] }),
    sheetRow(24, ['', 'Fitting requested:', clean(meta.fittingRequested)], { styles: [2, 4, 4] }),
    sheetRow(25, ['', 'Event number:', eventNumber(event?.externalId || snapshot?.eventId)], { styles: [2, 4, 4] }),
    sheetRow(26, ['', '', ''], { styles: [2, 4, 4] }),
    sheetRow(27, [''], { styles: [12] }),
    sheetRow(28, [''], { styles: [12] }),
    sheetRow(29, [''], { styles: [12] }),
  ];
  const tableHeaderRow = 30;
  const staffingRows = rows.map((shift, index) => sheetRow(tableHeaderRow + index + 1, [
    Number(shift?.required) || '',
    clean(shift?.position, 200),
    excelTime(shift?.startTime),
    excelTime(shift?.endTime),
    shiftHours(shift?.startTime, shift?.endTime),
    clean(shift?.uniform, 300),
    '',
    clean(shift?.comments, 1000),
  ], { styles: [4, 4, 6, 6, 4, 4, 4, 4], numeric: [0, 2, 3, 4] }));
  const totalCountRow = tableHeaderRow + rows.length + 2;
  const totalLabelRow = totalCountRow + 1;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1:H${totalLabelRow}"/><sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetFormatPr baseColWidth="10" defaultRowHeight="16"/><cols><col min="2" max="2" width="19.33203125" customWidth="1"/><col min="5" max="5" width="12" customWidth="1"/><col min="6" max="6" width="28.33203125" customWidth="1"/><col min="7" max="7" width="19.33203125" customWidth="1"/><col min="8" max="8" width="25.33203125" customWidth="1"/></cols><sheetData>
${titleRow}
${headerRows.join('')}
${sheetRow(tableHeaderRow, ['#', 'Position', 'Start', 'End', 'Hours', 'Uniform', 'Admin Notes', 'Comments'], { styles: [3, 3, 3, 3, 3, 3, 3, 3] })}
${staffingRows.join('')}
${sheetRow(totalCountRow, [totalStaff], { styles: [12], numeric: [0] })}
${sheetRow(totalLabelRow, ['TOTAL STAFF NEEDED'], { styles: [12] })}
</sheetData><mergeCells count="3"><mergeCell ref="A2:A3"/><mergeCell ref="A12:A13"/><mergeCell ref="B12:B13"/></mergeCells><pageMargins left="0.25" right="0.25" top="0.35" bottom="0.35" header="0.15" footer="0.15"/><pageSetup paperSize="1" orientation="landscape" fitToWidth="1" fitToHeight="1" pageOrder="downThenOver"/></worksheet>`;
};

const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="12"><font><sz val="12"/><color rgb="FF000000"/><name val="Aptos Narrow"/><family val="2"/></font><font><b/><u/><sz val="12"/><color rgb="FF000000"/><name val="Helvetica"/><family val="2"/></font><font><b/><sz val="12"/><color rgb="FF000000"/><name val="Helvetica"/><family val="2"/></font><font><b/><sz val="16"/><color rgb="FF000000"/><name val="Helvetica"/><family val="2"/></font><font><b/><u/><sz val="16"/><color rgb="FF000000"/><name val="Helvetica"/><family val="2"/></font><font><b/><u/><sz val="14"/><color rgb="FF000000"/><name val="Helvetica"/><family val="2"/></font><font><sz val="11"/><color rgb="FF000000"/><name val="Helvetica"/><family val="2"/></font><font><u/><sz val="11"/><color rgb="FF000000"/><name val="Helvetica"/><family val="2"/></font><font><b/><sz val="11"/><color rgb="FF000000"/><name val="Helvetica"/><family val="2"/></font><font><sz val="11"/><color rgb="FF000000"/><name val="Arial"/><family val="2"/></font><font><b/><u/><sz val="11"/><color rgb="FF000000"/><name val="Helvetica"/><family val="2"/></font><font><b/><sz val="11"/><color rgb="FFFF0000"/><name val="Helvetica"/><family val="2"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFFF00"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="14"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="7" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="8" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="6" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="14" fontId="6" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/><xf numFmtId="18" fontId="6" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/><xf numFmtId="0" fontId="9" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="10" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="7" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="6" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="8" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="11" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="6" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

export const renderCatereaseStaffRequestXlsx = async ({ event, snapshot, zoneKey = '', manualAdditions = [] }) => {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`);
  zip.folder('_rels').file('.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  const xl = zip.folder('xl');
  xl.file('workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets><calcPr calcId="181029"/></workbook>`);
  xl.folder('_rels').file('workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  xl.folder('worksheets').file('sheet1.xml', worksheetXml({ event, snapshot, zoneKey, manualAdditions }));
  xl.file('styles.xml', stylesXml);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
};
