const clean = (value) => String(value || '').trim();

export const nyToday = (now = new Date()) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(now);

export const inferDropboxDocumentType = (name) => {
  const normalized = clean(name).replace(/[_-]+/g, ' ');
  const kitchen = /\b(?:kitchen\s*menu|km)\b/i.test(normalized);
  const po = /\b(?:purchase\s*order|pack\s*out|packout|po)\b/i.test(normalized);
  if (kitchen && !po) return 'kitchen_menu';
  if (po && !kitchen) return 'po';
  return 'review';
};

export const inferDropboxPathDate = (path) => {
  const source = clean(path);
  const iso = source.match(/\b(20\d{2})[-_.\/](\d{1,2})[-_.\/](\d{1,2})\b/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  const us = source.match(/\b(\d{1,2})[-_.](\d{1,2})[-_.](20\d{2}|\d{2})\b/);
  if (us) return `${us[3].length === 2 ? `20${us[3]}` : us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`;
  return '';
};

const inferYearMonth = (path) => {
  const parts = clean(path).split('/').filter(Boolean);
  let year = '';
  let month = '';
  for (const part of parts) {
    const yearMatch = part.match(/\b(20\d{2})\b/);
    if (yearMatch) year = yearMatch[1];
    const numericMonth = part.match(/^(?:0?[1-9]|1[0-2])(?:\b|\s|[-_])/);
    if (numericMonth) month = numericMonth[0].match(/\d+/)[0].padStart(2, '0');
    const names = ['january','february','march','april','may','june','july','august','september','october','november','december'];
    const nameIndex = names.findIndex((name) => part.toLowerCase().includes(name));
    if (nameIndex >= 0) month = String(nameIndex + 1).padStart(2, '0');
  }
  return year && month ? `${year}-${month}` : (year ? `${year}` : '');
};

export const classifyDropboxEntry = (entry, { today = nyToday() } = {}) => {
  const tag = clean(entry?.['.tag']);
  const path = clean(entry?.path_display || entry?.path_lower);
  const name = clean(entry?.name);
  if (tag === 'deleted') return { status: 'deleted', reason: 'Removed from Dropbox', inferredDate: '', documentType: 'review' };
  if (tag !== 'file' || !/\.docx$/i.test(name) || /^~\$/i.test(name)) {
    return { status: 'ignored', reason: 'Not a DOCX PO/Kitchen Menu', inferredDate: '', documentType: 'review' };
  }
  const inferredDate = inferDropboxPathDate(path);
  const datePrefix = inferredDate || inferYearMonth(path);
  const todayMonth = today.slice(0, 7);
  if ((inferredDate && inferredDate < today) || (datePrefix.length === 7 && datePrefix < todayMonth) || (datePrefix.length === 4 && datePrefix < today.slice(0, 4))) {
    return { status: 'skipped_old', reason: 'Before the current New York date', inferredDate, documentType: inferDropboxDocumentType(name) };
  }
  const documentType = inferDropboxDocumentType(name);
  if (!inferredDate) return { status: 'review', reason: 'Event date could not be confirmed from the path or filename', inferredDate: '', documentType };
  if (documentType === 'review') return { status: 'review', reason: 'Document type could not be confirmed from the filename', inferredDate, documentType };
  return { status: 'discovered', reason: 'Ready for safe matching', inferredDate, documentType };
};
