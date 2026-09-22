import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildOperationalDocumentStatus,
  inferOperationalStatusType,
  isOperationalDocumentsNotApplicable,
  isStaffRequestNotApplicable,
  RENTAL_FILE_PATTERN,
} from '../utils/operationalDocumentStatus.js';

test('Dropbox operational status recognizes SR KM PO and Rental files', () => {
  assert.equal(RENTAL_FILE_PATTERN.test('PRL_WRI.pdf'), true);
  assert.equal(inferOperationalStatusType('Leadership File/SR/Event Staff Request REV2.xlsx'), 'sr');
  assert.equal(inferOperationalStatusType('Leadership File/KM/Event AKM REV3.docx'), 'km');
  assert.equal(inferOperationalStatusType('Leadership File/PO/Event KPO.docx'), 'po');
  assert.equal(inferOperationalStatusType('Leadership File/Rentals/Event PRL Rev2.pdf'), 'rental');
  assert.equal(inferOperationalStatusType('Leadership File/Rentals/Vendor PackingList.pdf'), 'rental');
  assert.equal(inferOperationalStatusType('Leadership File/Rentals/Event Rental Notes.pdf'), '');
  assert.equal(inferOperationalStatusType('Notes/Rental.xlsx'), '');
  assert.equal(inferOperationalStatusType('Leadership File/Rentals/Event Sample Rentals.pdf'), '');
  assert.equal(inferOperationalStatusType('Leadership File/SR/Event RENTAL CHECK IN SR.xlsx'), 'sr');
});

test('Dropbox operational status uses the highest revision and its update time', () => {
  const status = buildOperationalDocumentStatus([
    { path: '/Event/KM/Event KM REV1.docx', serverModifiedAt: '2026-09-20T10:00:00Z' },
    { path: '/Event/KM/Event KM REV3.docx', serverModifiedAt: '2026-09-21T12:30:00Z' },
    { path: '/Event/PO/Event PO.docx', serverModifiedAt: '2026-09-22T08:00:00Z' },
    { path: '/Event/Rentals/Event PRL REV2.pdf', serverModifiedAt: '2026-09-22T09:00:00Z' },
    { path: '/Event/Rentals/Event Rental Notes REV8.pdf', serverModifiedAt: '2026-09-22T10:00:00Z' },
    { path: '/Event/Rentals', serverModifiedAt: '2026-09-22T11:00:00Z' },
  ]);
  assert.equal(status.km.value, 'Rev3');
  assert.equal(status.km.updatedAt, '2026-09-21T12:30:00.000Z');
  assert.equal(status.po.value, 'Yes');
  assert.equal(status.rental.value, 'Rev2');
});

test('Staff Only, Load In, Load Out, and Rental Check-In default SR KM and PO to N/A until files exist', () => {
  assert.equal(isStaffRequestNotApplicable({ Category: 'Staff Only - Load In' }), true);
  assert.equal(isStaffRequestNotApplicable({ Category: 'Load Out' }), true);
  assert.equal(isStaffRequestNotApplicable({ Category: 'Rental Check-In' }), true);
  assert.equal(isOperationalDocumentsNotApplicable({ Category: 'Rental Check-In' }), true);
  assert.equal(isStaffRequestNotApplicable({ PartyName: 'Chanel Rental Check In' }), true);
  const empty = buildOperationalDocumentStatus([], { operationalDocumentsNotApplicable: true });
  assert.deepEqual({ sr: empty.sr.value, km: empty.km.value, po: empty.po.value, rental: empty.rental.value }, {
    sr: 'N/A', km: 'N/A', po: 'N/A', rental: '',
  });
  const withDocuments = buildOperationalDocumentStatus([
    { path: '/Event/SR/Event Staff Request REV1.xlsx' },
    { path: '/Event/KM/Event Kitchen Menu REV2.docx' },
  ], { operationalDocumentsNotApplicable: true });
  assert.deepEqual({
    sr: withDocuments.sr.value,
    km: withDocuments.km.value,
    po: withDocuments.po.value,
    rental: withDocuments.rental.value,
  }, { sr: 'Rev1', km: 'Rev2', po: 'N/A', rental: '' });
});
