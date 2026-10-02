export const UNIFORM_PACKING_ROLES = ['admin', 'super admin', 'uniform packer'];
export const SIZE_FIELDS = ['jacketSize', 'shirtSize', 'pantsSize', 'shoeSize', 'height'];
const clean = (value, max = 200) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const nameKey = (value) => clean(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const confirmed = (worker) => ['confirmed', 'assigned'].includes(clean(worker?.status).toLowerCase()) && !worker?.agency;
export const uniformWorkerKey = (worker) => clean(worker.companyUserId) ? `nowsta:${clean(worker.companyUserId)}` : `name:${nameKey(worker.name)}`;

export const uniformStaffing = (entry) => {
  const people = new Set(); let booked = 0; let pending = 0; let missing = 0;
  const positions = (entry?.shifts || []).map((shift) => {
    const workers = shift.workers || [];
    const filled = workers.filter(confirmed);
    const waiting = workers.filter((worker) => !confirmed(worker) && !['declined', 'removed', 'cancelled', 'canceled'].includes(clean(worker.status).toLowerCase()) && !worker.agency).length;
    const required = Number.isInteger(shift.required) && shift.required >= 0 ? shift.required
      : workers.length + Math.max(0, Number(shift.unfilled) || 0);
    const open = Math.max(0, required - filled.length);
    filled.forEach((worker) => people.add(uniformWorkerKey(worker)));
    booked += filled.length; pending += waiting; missing += open;
    return { position: shift.position, required, booked: filled.length, pending: waiting, missing: open, startTime: shift.startTime, endTime: shift.endTime };
  });
  return { staffCount: people.size, booked, pending, missing, required: booked + missing, positions };
};

export const buildUniformRoster = (entry, staff = [], overrides = []) => {
  const workers = new Map();
  for (const shift of entry?.shifts || []) for (const worker of shift.workers || []) {
    if (!confirmed(worker) || !clean(worker.name)) continue;
    const key = uniformWorkerKey(worker);
    const record = workers.get(key) || { key, name: clean(worker.name), companyUserId: clean(worker.companyUserId), nowstaSizes: worker.sizes || {}, positions: [], calls: [], ends: [] };
    if (shift.position && !record.positions.includes(shift.position)) record.positions.push(shift.position);
    if (shift.startTime && !record.calls.includes(shift.startTime)) record.calls.push(shift.startTime);
    if (shift.endTime && !record.ends.includes(shift.endTime)) record.ends.push(shift.endTime);
    workers.set(key, record);
  }
  return [...workers.values()].map((worker) => {
    let matches = worker.companyUserId ? staff.filter((person) => clean(person.nowstaCompanyUserId) === worker.companyUserId) : [];
    if (!matches.length) matches = staff.filter((person) => (!worker.companyUserId || !clean(person.nowstaCompanyUserId))
      && nameKey(person.nowstaName || `${person.firstName} ${person.lastName}`) === nameKey(worker.name));
    const person = matches.length === 1 ? matches[0] : {};
    const saved = overrides.find((row) => row.key === worker.key) || {};
    const sizes = Object.fromEntries(SIZE_FIELDS.map((field) => [field, clean(saved[field] || person[field] || worker.nowstaSizes[field], 60)]));
    const names = worker.name.split(' ');
    return { ...worker, firstName: person.firstName || names[0], lastName: person.lastName || names.slice(1).join(' '), ...sizes,
      payrollId: clean(saved.payrollId, 60), timeIn: clean(saved.timeIn, 60), timeOut: clean(saved.timeOut, 60),
      missingSizes: SIZE_FIELDS.filter((field) => field !== 'height' && !sizes[field]), ambiguousMatch: matches.length > 1 };
  });
};

export const validateUniformLines = (lines, catalog) => {
  if (!Array.isArray(lines) || lines.length > 500) throw Object.assign(new Error('Enter up to 500 item/size rows'), { statusCode: 400 });
  const seen = new Set();
  return lines.flatMap((line) => {
    if (!line || typeof line.quantity !== 'number' || !Number.isInteger(line.quantity) || line.quantity < 0 || line.quantity > 10000) {
      throw Object.assign(new Error('Quantities must be whole numbers from 0 to 10,000'), { statusCode: 400 });
    }
    if (line.quantity === 0) return [];
    const item = catalog.find((candidate) => String(candidate._id) === String(line.itemId) && !candidate.hidden);
    const size = item?.sizes?.find((candidate) => clean(candidate.label).toLowerCase() === clean(line.size).toLowerCase());
    if (!item || !size) throw Object.assign(new Error('Choose an existing uniform item and size'), { statusCode: 400 });
    const key = `${item._id}:${clean(size.label).toLowerCase()}`;
    if (seen.has(key)) throw Object.assign(new Error('Each item and size can appear only once'), { statusCode: 400 });
    seen.add(key);
    return [{ itemId: item._id, name: item.name, size: size.label, quantity: line.quantity }];
  });
};

export const parseUniformCsv = (text) => {
  if (typeof text !== 'string' || text.length > 2_000_000) throw Object.assign(new Error('Upload a CSV file smaller than 2 MB'), { statusCode: 400 });
  const rows = []; let row = []; let cell = ''; let quoted = false;
  const source = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (char === '"') {
      if (quoted && source[i + 1] === '"') { cell += '"'; i += 1; }
      else quoted = !quoted;
    } else if (char === ',' && !quoted) { row.push(cell); cell = ''; }
    else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && source[i + 1] === '\n') i += 1;
      row.push(cell); rows.push(row); cell = ''; row = [];
    } else cell += char;
  }
  if (quoted) throw Object.assign(new Error('The CSV contains an unfinished quoted field'), { statusCode: 400 });
  if (cell || row.length) { row.push(cell); rows.push(row); }
  if (rows.length > 2000) throw Object.assign(new Error('The roster is too large'), { statusCode: 400 });
  return rows;
};

export const importUniformRoster = (csv, entry, roster) => {
  const rows = parseUniformCsv(csv);
  const metadata = Object.fromEntries(rows.filter((row) => /^(EVENT|DATE|DRESS|TIMES|LOC):$/.test(clean(row[0]))).map((row) => [clean(row[0]).slice(0, -1), clean(row[1], 1000)]));
  const rawDate = metadata.DATE || '';
  const date = /^\d{2}\/\d{2}\/\d{4}$/.test(rawDate) ? rawDate.split('/').reverse().join('-') : rawDate;
  const title = nameKey(entry.title).replace(/ staffing$/, '');
  const externalId = nameKey(entry.externalId);
  const sourceTitle = nameKey(metadata.EVENT);
  if (date !== entry.date || !(externalId ? sourceTitle.startsWith(`${externalId} `) || sourceTitle === externalId : title && sourceTitle.includes(title))) {
    throw Object.assign(new Error('This CSV belongs to a different event or date'), { statusCode: 400 });
  }
  const headerIndex = rows.findIndex((row) => row.includes('FIRST') && row.includes('LAST') && row.includes('JACKET'));
  if (headerIndex < 0) throw Object.assign(new Error('Use the Nowsta Staffing Roster CSV with size columns'), { statusCode: 400 });
  const headers = rows[headerIndex]; const byKey = new Map(); const unmatched = [];
  const columns = { JACKET: 'jacketSize', SHIRT: 'shirtSize', PANTS: 'pantsSize', SHOES: 'shoeSize', HEIGHT: 'height', 'PAYROLL ID': 'payrollId', IN: 'timeIn', OUT: 'timeOut' };
  for (const cells of rows.slice(headerIndex + 1)) {
    const raw = Object.fromEntries(headers.map((header, index) => [header, clean(cells[index], 80)]));
    const name = clean(`${raw.FIRST || ''} ${raw.LAST || ''}`);
    if (!name) continue;
    const matches = roster.filter((worker) => nameKey(worker.name) === nameKey(name));
    if (matches.length !== 1) { unmatched.push(name); continue; }
    const key = matches[0].key;
    const record = byKey.get(key) || { key };
    for (const [column, field] of Object.entries(columns)) if (raw[column]) record[field] = raw[column];
    byKey.set(key, record);
  }
  if (!byKey.size) throw Object.assign(new Error('No CSV staff match the currently booked team'), { statusCode: 400 });
  return { sizes: [...byKey.values()], unmatched, dress: metadata.DRESS || '' };
};

const csvCell = (value) => {
  let text = String(value ?? '');
  if (/^[\s]*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
};
export const uniformRosterCsv = (entry, roster, dress = '') => {
  const rows = [
    ['EVENT:', `${entry.externalId || ''} ${entry.title}`.trim()], ['DATE:', entry.date.split('-').reverse().join('/')],
    ['TIMES:', [...new Set((entry.shifts || []).map((shift) => `${shift.startTime || ''} to ${shift.endTime || ''}`))].join(' / ')],
    ['DRESS:', dress], ['LOC:', entry.venue || ''], ['', entry.address || ''], [],
    ['#', 'POSITION', 'FIRST', 'LAST', 'PAYROLL ID', 'JACKET', 'SHIRT', 'PANTS', 'SHOES', 'HEIGHT', 'CALL', 'END', 'IN', 'OUT'],
    ...roster.map((person, index) => [index + 1, person.positions.join(' / '), person.firstName, person.lastName, person.payrollId,
      person.jacketSize, person.shirtSize, person.pantsSize, person.shoeSize, person.height, person.calls.join(' / '), person.ends.join(' / '), person.timeIn, person.timeOut]),
  ];
  return '\uFEFF' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
};

export const uniformPackerRequestAllowed = (auth, req) => {
  if (auth?.role !== 'uniform packer') return true;
  const path = String(req.originalUrl || '').split('?')[0].replace(/\/$/, '');
  const method = String(req.method || '').toUpperCase();
  if (/^\/api\/uniform-packing\/workspace(?:\/|$)/.test(path)) return ['GET', 'HEAD'].includes(method);
  if (/^\/api\/uniform-packing\/events\/[^/]+\/boards(?:\/|$)/.test(path)) return false;
  if (/^\/api\/uniform-packing(?:\/|$)/.test(path)) return ['GET', 'HEAD', 'PUT', 'POST'].includes(method);
  if (/^\/api\/nowsta-schedule(?:\/preferences)?$/.test(path)) return ['GET', 'HEAD'].includes(method) || (path.endsWith('/preferences') && method === 'PUT');
  if (['GET', 'HEAD'].includes(method)) return /^\/api\/(?:uniform-items|products)(?:\/[^/]+)?$/.test(path)
    || /^\/api\/products\/code\/[^/]+$/.test(path);
  return ['PUT', 'PATCH'].includes(method) && [`/api/users/${auth.userId}/password`, `/users/${auth.userId}/password`].includes(path);
};
