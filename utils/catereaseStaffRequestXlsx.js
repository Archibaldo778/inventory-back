import JSZip from 'jszip';
import { catereaseOperationalZoneKey } from './catereaseOperations.js';

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

const formatTime = (value) => {
  const parts = timeParts(value);
  if (!parts) return clean(value, 80);
  return `${parts.hour % 12 || 12}:${String(parts.minute).padStart(2, '0')} ${parts.hour >= 12 ? 'pm' : 'am'}`;
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

const parsedDate = (value) => {
  const match = clean(value, 20).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12) : null;
};

const shortDate = (value) => {
  const date = parsedDate(value);
  return date ? new Intl.DateTimeFormat('en-US').format(date) : clean(value, 40);
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

const cell = (row, column, value, style = 4, numeric = false) => {
  const reference = `${columnName(column)}${row}`;
  if (value === '' || value === null || value === undefined) return `<c r="${reference}" s="${style}"/>`;
  if (numeric && Number.isFinite(Number(value))) return `<c r="${reference}" s="${style}"><v>${Number(value)}</v></c>`;
  return `<c r="${reference}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
};

const sheetRow = (row, values, { styles = [], numeric = [] } = {}) => `<row r="${row}">${values.map((value, column) => (
  cell(row, column, value, styles[column] ?? 4, numeric.includes(column))
)).join('')}</row>`;

const eventNumber = (value) => {
  const match = clean(value, 120).toUpperCase().match(/\bE\s*0*(\d+)\b/);
  return match ? `E${match[1]}` : clean(value, 120);
};

const worksheetXml = ({ event, snapshot, zoneKey = '' }) => {
  const normalizedZone = clean(zoneKey, 300).toLowerCase();
  const rows = (Array.isArray(snapshot?.staffRequest) ? snapshot.staffRequest : [])
    .filter((row) => !normalizedZone || catereaseOperationalZoneKey(row) === normalizedZone);
  const guestCount = Number(event?.meta?.guestCount ?? snapshot?.guestCount);
  const totalStaff = rows.reduce((total, row) => total + (Number(row?.required) || 0), 0);
  const firstStart = rows.find((row) => row?.startTime)?.startTime || '';
  const meta = event?.meta || {};
  const headerRows = [
    sheetRow(1, [`Staff Request Form                                                        Revision ${meta.staffRequestRevision || 1}`, '', '', '', '', '', '', ''], { styles: [1, 1, 1, 1, 1, 1, 1, 1] }),
    sheetRow(2, ['', 'STATUS:', clean(meta.catereaseStatus || meta.status), '', '', '', '', ''], { styles: [4, 3, 4] }),
    sheetRow(3, ['', 'Sales Rep:', clean(meta.salesRep), '', '', '', '', ''], { styles: [4, 3, 4] }),
    sheetRow(4, ['EVENT:', 'Week day:', weekDay(event?.date), '', '', '', '', ''], { styles: [2, 3, 4] }),
    sheetRow(5, ['', 'Event date:', shortDate(event?.date), '', '', '', '', ''], { styles: [4, 3, 4] }),
    sheetRow(6, ['', 'Client name:', clean(event?.title), '', '', '', '', ''], { styles: [4, 3, 4] }),
    sheetRow(7, ['', 'Event type:', clean(meta.eventType || meta.category), '', '', '', '', ''], { styles: [4, 3, 4] }),
    sheetRow(8, ['', 'Guests:', Number.isFinite(guestCount) && guestCount > 0 ? guestCount : '', '', '', '', '', ''], { styles: [4, 3, 4], numeric: [2] }),
    sheetRow(9, ['', 'Staff Arrival Time:', formatTime(meta.staffArrivalTime || firstStart), '', '', '', '', ''], { styles: [4, 3, 4] }),
    sheetRow(10, ['', 'Event time:', clean(meta.eventTime), '', '', '', '', ''], { styles: [4, 3, 4] }),
    sheetRow(11, ['', 'Staff Departure:', formatTime(meta.staffDepartureTime), '', '', '', '', ''], { styles: [4, 3, 4] }),
    sheetRow(12, ['LOCATION:', 'Address:', clean(meta.venue || meta.nowsta?.venue), '', '', '', '', ''], { styles: [2, 3, 4] }),
    sheetRow(13, ['', '', clean(meta.address || meta.nowsta?.address), '', '', '', '', ''], { styles: [4, 3, 4] }),
    sheetRow(14, ['', 'Venue Notes:', clean(meta.venueNotes), '', '', '', '', ''], { styles: [4, 3, 4] }),
    sheetRow(16, ['', 'Service Ent.:', clean(meta.serviceEntrance), '', '', '', '', ''], { styles: [4, 3, 4] }),
    sheetRow(17, ['', 'Meet Location:', clean(meta.meetingPoint), '', '', '', '', ''], { styles: [4, 3, 4] }),
    sheetRow(18, ['STAFF:', 'Notes of Staff Uniform', clean(meta.staffUniformNotes), '', '', '', '', ''], { styles: [2, 3, 4] }),
    sheetRow(19, ['', 'Set Up Attire:', clean(meta.setupAttire), '', '', '', '', ''], { styles: [4, 3, 4] }),
    sheetRow(20, ['', 'Staff Notes:', clean(meta.staffNotes), '', '', '', '', ''], { styles: [4, 3, 4] }),
    sheetRow(21, ['', 'Headshots:', clean(meta.headshots), '', '', '', '', ''], { styles: [4, 3, 4] }),
    sheetRow(22, ['', 'Clean Shaven:', clean(meta.cleanShaven), '', '', '', '', ''], { styles: [4, 3, 4] }),
    sheetRow(23, ['', 'Need sizes:', clean(meta.needSizes), '', '', '', '', ''], { styles: [4, 3, 4] }),
    sheetRow(24, ['', 'Fitting requested:', clean(meta.fittingRequested), '', '', '', '', ''], { styles: [4, 3, 4] }),
    sheetRow(25, ['', 'Event number:', eventNumber(event?.externalId || snapshot?.eventId), '', '', '', '', ''], { styles: [4, 3, 4] }),
  ];
  const tableHeaderRow = 30;
  const staffingRows = rows.map((shift, index) => sheetRow(tableHeaderRow + index + 1, [
    Number(shift?.required) || '',
    clean(shift?.position, 200),
    formatTime(shift?.startTime),
    formatTime(shift?.endTime),
    shiftHours(shift?.startTime, shift?.endTime),
    clean(shift?.uniform, 300),
    '',
    clean(shift?.comments, 1000),
  ], { numeric: [0, 4] }));
  const totalRow = tableHeaderRow + rows.length + 2;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:H${totalRow}"/><sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="18"/><cols><col min="1" max="1" width="10" customWidth="1"/><col min="2" max="2" width="24" customWidth="1"/><col min="3" max="5" width="15" customWidth="1"/><col min="6" max="6" width="32" customWidth="1"/><col min="7" max="8" width="24" customWidth="1"/></cols><sheetData>
${headerRows.join('')}
${sheetRow(tableHeaderRow, ['#', 'Position', 'Start', 'End', 'Hours', 'Uniform', 'Admin Notes', 'Comments'], { styles: [5, 5, 5, 5, 5, 5, 5, 5] })}
${staffingRows.join('')}
${sheetRow(totalRow, [totalStaff, 'TOTAL STAFF NEEDED', '', '', '', '', '', ''], { styles: [6, 6, 6, 6, 6, 6, 6, 6], numeric: [0] })}
</sheetData><mergeCells count="1"><mergeCell ref="A1:H1"/></mergeCells><pageMargins left="0.25" right="0.25" top="0.5" bottom="0.5" header="0.2" footer="0.2"/><pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/></worksheet>`;
};

const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="3"><font><sz val="10"/><name val="Arial"/></font><font><b/><sz val="16"/><name val="Arial"/></font><font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Arial"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF333333"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE7E6E6"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border/><border><left style="thin"><color rgb="FFBFBFBF"/></left><right style="thin"><color rgb="FFBFBFBF"/></right><top style="thin"><color rgb="FFBFBFBF"/></top><bottom style="thin"><color rgb="FFBFBFBF"/></bottom></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="7"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0"><alignment horizontal="center"/></xf><xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFill="1"><alignment vertical="center"/></xf><xf numFmtId="0" fontId="1" fillId="3" borderId="1" xfId="0" applyFill="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="3" borderId="1" xfId="0" applyFill="1"><alignment horizontal="center" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="3" borderId="1" xfId="0" applyFill="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

export const renderCatereaseStaffRequestXlsx = async ({ event, snapshot, zoneKey = '' }) => {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`);
  zip.folder('_rels').file('.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  const xl = zip.folder('xl');
  xl.file('workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Staff Request" sheetId="1" r:id="rId1"/></sheets></workbook>`);
  xl.folder('_rels').file('workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
  xl.folder('worksheets').file('sheet1.xml', worksheetXml({ event, snapshot, zoneKey }));
  xl.file('styles.xml', stylesXml);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
};
