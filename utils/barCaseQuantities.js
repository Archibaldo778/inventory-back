const nonNegative = (value) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
};

export const parseCaseCount = (value) => {
  const text = String(value || '').trim();
  if (!/\bcases?\b/i.test(text)) return null;
  const before = text.match(/(\d+(?:[.,]\d+)?)\s*cases?\b/i);
  const after = text.match(/\bcases?\s*(?:x|:)?\s*(\d+(?:[.,]\d+)?)/i);
  return nonNegative(String(before?.[1] || after?.[1] || '').replace(',', '.'));
};

export const convertPackoutCasesToBottles = ({ quantity, quantityText, caseSize } = {}) => {
  const cases = parseCaseCount(quantityText);
  if (cases === null) return null;
  const bottlesPerCase = nonNegative(caseSize);
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
