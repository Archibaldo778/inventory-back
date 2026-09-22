import { isStaffRequestNotApplicable } from './operationalDocumentStatus.js';

const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

export const CATEREASE_CALENDAR_EVENT_FIELDS = [
  'EvtNum',
  'EventNum',
  'PartyName',
  'Client',
  'EvtDate',
  'Status',
  'Category',
  'ActGuests',
  'GtdGuests',
  'PlnGuests',
  'SalesRep',
  'Extra2',
  'Extra8',
  'Extra20',
  'Revised',
].join(',');

const eventDate = (value) => {
  const match = clean(value).match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1] || '';
};

const guestCount = (row) => {
  for (const value of [row?.ActGuests, row?.GtdGuests, row?.PlnGuests]) {
    if (clean(value) === '') continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return null;
};

const dropboxReportField = (field = {}) => ({
  value: clean(field?.value),
  updatedAt: field?.updatedAt || null,
  updatedBy: field?.available ? 'Dropbox' : '',
  fileName: clean(field?.fileName),
  available: Boolean(field?.available),
  notApplicable: Boolean(field?.notApplicable),
});

export const normalizeCatereaseCalendarEvent = (row = {}, _manualStatus = {}, dropboxStatus = {}) => {
  const rawEventId = clean(row?.EvtNum);
  const actualGuests = guestCount(row);
  const status = clean(row?.Status);
  const category = clean(row?.Category);
  const salesRep = clean(row?.SalesRep);
  const client = clean(row?.Client);
  const catereaseReport = {
    sr: clean(row?.Extra8),
    km: clean(row?.Extra2),
    po: clean(row?.Extra20),
  };
  const dropboxAudit = {
    sr: dropboxReportField(dropboxStatus?.sr),
    km: dropboxReportField(dropboxStatus?.km),
    po: dropboxReportField(dropboxStatus?.po),
  };
  if (!dropboxAudit.sr.value && isStaffRequestNotApplicable(row)) {
    dropboxAudit.sr.value = 'N/A';
    dropboxAudit.sr.notApplicable = true;
  }
  const resolvedReport = Object.fromEntries(['sr', 'km', 'po'].map((field) => [field, dropboxAudit[field].value]));
  return {
    _id: `caterease:${rawEventId || clean(row?.EventNum)}`,
    externalId: clean(row?.EventNum),
    title: clean(row?.PartyName) || 'Untitled event',
    date: eventDate(row?.EvtDate),
    client,
    managerId: salesRep,
    status,
    importSource: 'caterease',
    meta: {
      guestCount: actualGuests,
      category,
      calendarReport: resolvedReport,
      calendarReportAudit: dropboxAudit,
      calendarReportSource: 'dropbox',
      catereaseCalendarReport: catereaseReport,
      catereaseEventId: rawEventId,
      catereaseRevisedAt: clean(row?.Revised),
    },
    catereaseOperations: {
      eventStatus: status,
      eventType: category,
      guestCount: actualGuests,
      salesRep,
      client,
    },
    documents: [],
  };
};
