import crypto from 'node:crypto';
import { getPreparedBeverageType, isFoodMenuItem } from './barPackoutScope.js';

const LOCKED_STATUSES = new Set(['submitted', 'reviewed', 'closed']);
const clean = (value) => String(value || '').trim();

export const barItemsHaveRecordedReturns = (barEvent) => (
  LOCKED_STATUSES.has(clean(barEvent?.status).toLowerCase())
  || (Array.isArray(barEvent?.items) && barEvent.items.some((item) => (
    // Imported cocktails (and legacy food headings) are automatically confirmed.
    // Actual quantities still protect an item even if its classification changed.
    ['returnedFullQty', 'returnedOpenQty', 'lostDamagedQty'].some((field) => Number(item?.[field]) > 0)
    || (item?.returnConfirmed === true && !getPreparedBeverageType(item) && !isFoodMenuItem(item))
  )))
);

export const visibleBarSourceChangeAfterReturns = (barEvent) => (
  barItemsHaveRecordedReturns(barEvent) ? barEvent?.sourceChangedAfterReturns : null
);

export const buildBarImportChecksum = (source) => crypto
  .createHash('sha256')
  .update(JSON.stringify(source ?? null))
  .digest('hex');

export const recordBarSourceChangeAfterReturns = (barEvent, { source, checksum, at = new Date() }) => {
  if (!barItemsHaveRecordedReturns(barEvent)) {
    // Clear legacy false warnings when the normal source import is saved.
    if (barEvent?.sourceChangedAfterReturns) barEvent.sourceChangedAfterReturns = undefined;
    return { locked: false, changed: false };
  }
  const nextSource = clean(source).slice(0, 120);
  const nextChecksum = clean(checksum).slice(0, 200);
  const previous = barEvent?.sourceChangedAfterReturns || {};
  const changed = clean(previous.source) !== nextSource || clean(previous.checksum) !== nextChecksum;
  if (!changed) return { locked: true, changed: false };
  barEvent.sourceChangedAfterReturns = { at, source: nextSource, checksum: nextChecksum };
  barEvent.audit = [...(Array.isArray(barEvent.audit) ? barEvent.audit : []), {
    action: 'bar_source_changed_after_returns',
    username: nextSource,
    at,
    details: { source: nextSource, checksum: nextChecksum },
  }].slice(-200);
  barEvent.revision = Number(barEvent.revision || 0) + 1;
  return { locked: true, changed: true };
};
