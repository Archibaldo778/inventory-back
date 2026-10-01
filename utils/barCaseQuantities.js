const nonNegative = (value) => {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const numeric = Number(String(value).replace(',', '.'));
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
};

// "case of 24", "24/case", "12 per case" describe how many bottles one case
// holds. They are never a count of cases.
const CASE_SIZE_PATTERNS = [
  /\bcases?\s+of\s+(\d+(?:[.,]\d+)?)\b/i,
  /(\d+(?:[.,]\d+)?)\s*(?:bottles?|cans?|ct|count)?\s*(?:\/|per)\s*cases?\b/i,
];

const stripCaseSizePhrases = (text) => CASE_SIZE_PATTERNS
  .reduce((value, pattern) => value.replace(new RegExp(pattern.source, 'gi'), ' '), text);

export const parseCaseSize = (value) => {
  const text = String(value || '');
  for (const pattern of CASE_SIZE_PATTERNS) {
    const size = nonNegative(text.match(pattern)?.[1]);
    if (size !== null && size >= 1) return size;
  }
  return null;
};

// Returns the number of cases only when the text states one explicitly
// ("2 cases", "cases x 2", "case: 2"). Anything else returns null so the
// imported quantity is used unchanged.
export const parseCaseCount = (value) => {
  const text = stripCaseSizePhrases(String(value || '').trim());
  if (!/\bcases?\b/i.test(text)) return null;
  const before = text.match(/(\d+(?:[.,]\d+)?)\s*cases?\b/i)?.[1];
  const after = text.match(/\bcases?\s*(?:x|:)\s*(\d+(?:[.,]\d+)?)/i)?.[1];
  const cases = nonNegative(before ?? after);
  return cases !== null && cases > 0 ? cases : null;
};

export const convertPackoutCasesToBottles = ({ quantity, quantityText, caseSize } = {}) => {
  const cases = parseCaseCount(quantityText);
  if (cases === null) return null;
  const bottlesPerCase = nonNegative(caseSize) ?? parseCaseSize(quantityText);
  if (!bottlesPerCase || bottlesPerCase < 1) {
    return { quantity: nonNegative(quantity) ?? 0, quantityText: `${quantityText} · case size missing`, pending: true };
  }
  const bottles = Math.round(cases * bottlesPerCase * 10000) / 10000;
  return {
    quantity: bottles,
    quantityText: `${bottles} bottles (${cases} case${cases === 1 ? '' : 's'} × ${bottlesPerCase})`,
    pending: false,
  };
};

// Imports made while case parsing turned "case of 24" into zero cases stored
// "0 bottles (0 cases × N)". Such events must be re-imported once.
export const hasZeroCaseConversion = (barEvent) => (
  (Array.isArray(barEvent?.items) ? barEvent.items : [])
    .some((item) => /\b0 bottles \(0 cases? ×/i.test(String(item?.sentQtyText || '')))
);
