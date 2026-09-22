import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isFinancialEventDocument,
  isRestrictedEventDocument,
} from '../utils/eventFileVisibility.js';

test('event files hide invoices, proposals, and other financial documents', () => {
  assert.equal(isFinancialEventDocument('Leadership/Invoice_INV113298.pdf'), true);
  assert.equal(isFinancialEventDocument('ProposalREV3.docx'), true);
  assert.equal(isFinancialEventDocument('Client Pricing.xlsx'), true);
  assert.equal(isFinancialEventDocument('Budget/September.xlsx'), true);
  assert.equal(isFinancialEventDocument('Event Cost Sheet.xlsx'), true);
});

test('operational leadership documents remain visible', () => {
  assert.equal(isFinancialEventDocument('Pack Out/Beverage PO.docx'), false);
  assert.equal(isFinancialEventDocument('Kitchen Menu/KM REV1.docx'), false);
  assert.equal(isFinancialEventDocument('Rental Order.xlsx'), false);
  assert.equal(isFinancialEventDocument('Tape Key.pdf'), false);
  assert.equal(isFinancialEventDocument('Staff Request.xlsx'), false);
  assert.equal(isFinancialEventDocument(
    '/Operations/Proposals (1)/2026/09 September/09-23-26 Event/Leadership File/Kitchen/Event KM.docx'
  ), false);
  assert.equal(isFinancialEventDocument(
    '/Operations/Proposals (1)/2026/09 September/09-23-26 Event/Proposals/Event Proposal.pdf'
  ), true);
});

test('event files hide insurance documents and videos', () => {
  assert.equal(isRestrictedEventDocument('9W57-Insurance Requirements & Sample COI-UPDATED 6-1-26 1.pdf'), true);
  assert.equal(isRestrictedEventDocument('25-26 Master COI - Solow Management Corp.pdf'), true);
  assert.equal(isRestrictedEventDocument('Event Videos/load-in.mov'), true);
  assert.equal(isRestrictedEventDocument('walkthrough.mp4'), true);
});

test('restricted file rules keep operational leadership files available', () => {
  assert.equal(isRestrictedEventDocument('Pack Out/Beverage PO.docx'), false);
  assert.equal(isRestrictedEventDocument('Rental Order.xlsx'), false);
  assert.equal(isRestrictedEventDocument('Tape Key.pdf'), false);
});
