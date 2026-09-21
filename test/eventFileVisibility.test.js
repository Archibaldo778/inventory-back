import assert from 'node:assert/strict';
import test from 'node:test';
import { isFinancialEventDocument } from '../utils/eventFileVisibility.js';

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
});
