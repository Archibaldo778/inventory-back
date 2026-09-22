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
  const raw = String(value || '')
    .normalize('NFKD')
    .toLowerCase()
    .split(/[\\/]/)
    // Dropbox's company-wide source folder is named "Proposals (1)". It is a
    // container, not an event proposal, so it must not hide every file below it.
    .filter((part) => !/^proposals?\s*\(\d+\)$/.test(part.trim()))
    .join('/');
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

export const isInsuranceEventDocument = (value) => {
  const raw = String(value || '').normalize('NFKD').toLowerCase();
  if (/insurance/.test(raw)) return true;
  const words = raw.replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  return words.includes('coi');
};

export const isVideoEventDocument = (value) => {
  const raw = String(value || '').normalize('NFKD').toLowerCase();
  if (/\.(?:3g2|3gp|avi|m4v|mkv|mov|mp4|mpeg|mpg|webm|wmv)$/i.test(raw)) return true;
  const words = raw.replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  return words.includes('video') || words.includes('videos');
};

export const isRestrictedEventDocument = (value) => (
  isFinancialEventDocument(value)
  || isInsuranceEventDocument(value)
  || isVideoEventDocument(value)
);
