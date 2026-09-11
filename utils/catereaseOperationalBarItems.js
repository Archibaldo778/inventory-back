import { classifyRecognizedSection } from './barPackoutRecognition.js';

const clean = (value) => String(value ?? '').trim();

const normalizedQuantity = (value) => {
  if (value === null || value === undefined || clean(value) === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

export const catereaseOperationalPackOutToBarItems = (rows) => (
  (Array.isArray(rows) ? rows : []).flatMap((row, index) => {
    const name = clean(row?.itemName);
    if (!name) return [];
    const scope = classifyRecognizedSection(name);
    const quantity = normalizedQuantity(row?.quantity);
    return [{
      id: `caterease-operation:${clean(row?.sourceId) || index + 1}`,
      name,
      section: clean(row?.menuGroup || row?.category),
      scope,
      includedByDefault: scope === 'alcohol' || scope === 'bar_support',
      quantity,
      quantityText: quantity === null ? '' : String(quantity),
      notes: clean(row?.notes),
      delivered: '',
      returned: '',
    }];
  })
);

export const hasAppliedCatereaseOperationalChecksum = (barEvent, checksum) => {
  const expected = clean(checksum);
  if (!expected) return false;
  const audit = Array.isArray(barEvent?.audit) ? barEvent.audit : [];
  for (let index = audit.length - 1; index >= 0; index -= 1) {
    const entry = audit[index];
    if (clean(entry?.action) !== 'caterease_operations_synced') continue;
    return clean(entry?.details?.checksum) === expected;
  }
  return false;
};
