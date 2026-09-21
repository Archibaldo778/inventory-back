const FINANCIAL_WORDS = new Set([
  'budget',
  'budgets',
  'billing',
  'estimate',
  'estimates',
  'financial',
  'financials',
  'payment',
  'payments',
  'pricing',
  'quotation',
  'quotations',
  'quote',
  'quotes',
  'receipt',
  'receipts',
  'revenue',
]);

export const isFinancialEventDocument = (value) => {
  const raw = String(value || '').normalize('NFKD').toLowerCase();
  if (!raw) return false;
  if (/(?:invoice|proposal)/i.test(raw)) return true;
  const words = raw.replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (words.some((word) => FINANCIAL_WORDS.has(word))) return true;
  const normalized = ` ${words.join(' ')} `;
  return normalized.includes(' cost sheet ')
    || normalized.includes(' price sheet ')
    || normalized.includes(' profit loss ')
    || normalized.includes(' profit and loss ');
};
