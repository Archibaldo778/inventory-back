import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import User from '../models/Users.js';
import NowstaScheduleEntry from '../models/NowstaScheduleEntry.js';
import UniformPackout from '../models/UniformPackout.js';
import UniformItem from '../models/UniformItem.js';
import Staff from '../models/Staff.js';
import Event from '../models/Event.js';
import Deck from '../models/Deck.js';
import Page from '../models/Page.js';
import router, { saveUniformPackout } from '../routes/uniformPacking.js';
import { requireAuth } from '../middleware/auth.js';
import { buildNowstaScheduleRows } from '../utils/nowstaApi.js';
import { uniformStaffing, buildUniformRoster, validateUniformLines, parseUniformCsv,
  importUniformRoster, uniformRosterCsv, uniformPackerRequestAllowed } from '../utils/uniformPacking.js';

const worker = (id, name, status = 'confirmed') => ({ companyUserId: id, name, status });
const entry = {
  nowstaEventId: '42', externalId: 'E123 - S456', title: 'Example Reception - Staffing', date: '2026-09-28', venue: 'Example Venue',
  shifts: [
    { position: 'Captain', required: 2, startTime: '4:00 PM', endTime: '9:00 PM', workers: [worker('1', 'Alex Smith'), worker('2', 'Pat Jones', 'pending')] },
    { position: 'Bartender', required: 3, startTime: '5:00 PM', endTime: '9:00 PM', workers: [worker('1', 'Alex Smith'), worker('3', 'Sam Brown', 'assigned'), worker('4', 'Declined Person', 'declined')] },
    { position: 'Lead Chef', required: 1, workers: [worker('5', 'Chris Cook')] },
  ],
};
const staff = [{ nowstaCompanyUserId: '1', firstName: 'Alex', lastName: 'Smith', jacketSize: '42L', shirtSize: 'XL', pantsSize: '36x32', shoeSize: '11.5', height: `6'0"` }];
const catalog = [{ _id: '507f1f77bcf86cd799439011', name: 'Black Nehru', sizes: [{ label: 'M' }, { label: 'XL' }] }];
const chain = (value) => ({ select() { return this; }, sort() { return this; }, limit() { return this; }, lean: async () => value });
const handler = (path, method = 'get') => router.stack.find((layer) => layer.route?.path === path && layer.route.methods[method]).route.stack[0].handle;
const response = () => ({ code: 200, headers: {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; }, send(body) { this.body = body; return this; }, setHeader(key, value) { this.headers[key] = value; } });
const csv = 'EVENT:,E123 - S456 Example Reception - Staffing\r\nDATE:,28/09/2026\r\nDRESS:,Black Nehru\r\n\r\n#,POSITION,FIRST,LAST,PAYROLL ID,JACKET,SHIRT,PANTS,SHOES,HEIGHT,CALL,END,IN,OUT\r\n1,Captain,Alex,Smith,00123,44L,L,36x32,11.5,"6\'0""",4PM,9PM,3:45PM,9PM\r\n2,Lead Chef,Chris,Cook,,,,,,,,,,\r\n3,Waiter,Unknown,Worker,,40,M,,,,,,,\r\n';

test('uniform staffing counts unique booked people, open shifts and pending confirmations separately', () => {
  const totals = uniformStaffing(entry);
  assert.equal(totals.staffCount, 2);
  assert.equal(totals.booked, 3);
  assert.equal(totals.pending, 1);
  assert.equal(totals.missing, 2);
  assert.equal(totals.required, 5);
  assert.deepEqual(totals.positions.map((position) => position.missing), [1, 1]);
  assert.equal(uniformStaffing({ shifts: [{ workers: [worker('1', 'A')], unfilled: 2 }] }).missing, 2);
});

test('Nowsta sync retains required slots even when a worker has declined', () => {
  const [row] = buildNowstaScheduleRows({ events: [{ id: 42, name: 'Reception', occurs_at: '2026-09-28T20:00:00Z' }],
    shifts: [{ id: 1, event_id: 42, position_name: 'Waiter', quantity: 3, event_workers: [{ company_user_id: 1, status: 'declined' }] }],
    companyUsers: [{ id: 1, first_name: 'Alex', last_name: 'Smith' }] });
  assert.equal(row.shifts[0].required, 3);
  assert.equal(uniformStaffing(row).missing, 3);
});

test('size roster excludes chefs and unconfirmed OCC staff but includes agency assignments and deduplicates shifts', () => {
  const roster = buildUniformRoster({ ...entry, shifts: [...entry.shifts, { workers: [{ ...worker('9', 'Agency Placeholder'), agency: true }] }] }, staff);
  assert.deepEqual(roster.map((person) => person.name), ['Alex Smith', 'Sam Brown', 'Agency Placeholder']);
  assert.deepEqual(roster[0].positions, ['Captain', 'Bartender']);
  assert.equal(roster[0].jacketSize, '42L');
  assert.equal(roster[0].height, `6'0"`);
  assert.deepEqual(roster[0].missingSizes, []);
  assert.equal(roster[1].missingSizes.length, 4);
});

test('size matching avoids another Nowsta identity and ambiguous names; OCC sizes take precedence over event imports', () => {
  const other = { ...staff[0], nowstaCompanyUserId: 'other' };
  assert.equal(buildUniformRoster(entry, [other])[0].jacketSize, '');
  const ambiguous = [{ ...staff[0], nowstaCompanyUserId: '' }, { ...staff[0], nowstaCompanyUserId: '' }];
  assert.equal(buildUniformRoster(entry, ambiguous)[0].ambiguousMatch, true);
  assert.equal(buildUniformRoster(entry, ambiguous)[0].jacketSize, '');
  const imported = buildUniformRoster(entry, staff, [{ key: 'nowsta:1', jacketSize: '44L' }])[0];
  assert.equal(imported.jacketSize, '42L');
  assert.equal(imported.sizeSources.jacketSize, 'OCC staff');
  assert.equal(imported.shirtSize, 'XL');
});

test('Nowsta CSV import matches this event and preserves leading payroll zeros and quoted heights', () => {
  const imported = importUniformRoster(csv, entry, buildUniformRoster(entry, staff));
  assert.equal(imported.sizes[0].payrollId, '00123');
  assert.equal(imported.sizes[0].height, `6'0"`);
  assert.equal(imported.sizes[0].jacketSize, '44L');
  assert.equal(imported.sizes[0].timeIn, '3:45PM');
  assert.equal(imported.dress, 'Black Nehru');
  assert.deepEqual(imported.unmatched, ['Chris Cook', 'Unknown Worker']);
  assert.equal(imported.sizes.length, 1);
  assert.throws(() => importUniformRoster(csv, { ...entry, date: '2026-09-29' }, []), /different event/);
  assert.throws(() => importUniformRoster(csv, { ...entry, externalId: 'E999' }, []), /different event/);
  assert.throws(() => importUniformRoster(csv, entry, []), /No CSV staff match/);
  assert.throws(() => parseUniformCsv('"unfinished'), /unfinished/);
});

test('download uses Nowsta columns, escapes spreadsheet formulas, quotes and commas, and keeps missing sizes blank', () => {
  const imported = importUniformRoster(csv, entry, buildUniformRoster(entry, staff));
  const roster = buildUniformRoster(entry, staff, imported.sizes);
  const exported = uniformRosterCsv({ ...entry, title: '=HYPERLINK("unsafe")', venue: 'Hall, East' }, roster, 'Black Nehru');
  const rows = parseUniformCsv(exported);
  const header = rows.findIndex((row) => row[0] === '#');
  assert.equal(rows[header].length, 14);
  assert.equal(rows[header + 1][4], '00123');
  assert.equal(rows[header + 1][9], `6'0"`);
  assert.equal(rows[header + 2][5], '');
  assert.equal(rows.find((row) => row[0] === 'LOC:')[1], 'Hall, East');
  const safe = parseUniformCsv(uniformRosterCsv({ ...entry, externalId: '', title: '=SUM(1,2)' }, roster));
  assert.equal(safe[0][1], "'=SUM(1,2)");
});

test('packout accepts catalog sizes and integer quantities, strips zero rows and rejects malformed counts or duplicate sizes', () => {
  const line = { itemId: catalog[0]._id, name: 'client supplied name', size: 'xl', quantity: 4 };
  assert.deepEqual(validateUniformLines([line, { ...line, size: 'M', quantity: 0 }], catalog), [{ ...line, name: 'Black Nehru', size: 'XL' }]);
  for (const quantity of [-1, 1.2, '4', NaN, 10001]) assert.throws(() => validateUniformLines([{ ...line, quantity }], catalog), /whole numbers/);
  assert.throws(() => validateUniformLines([null], catalog), /whole numbers/);
  assert.equal(validateUniformLines([{ ...line, size: 'XXXL' }], catalog)[0].size, 'XXXL');
  assert.throws(() => validateUniformLines([{ ...line, itemId: 'missing' }], catalog), /existing uniform/);
  for (const size of ['', '  ', null, 32, 'x'.repeat(61)]) assert.throws(() => validateUniformLines([{ ...line, size }], catalog), /1–60/);
  assert.throws(() => validateUniformLines([line, { ...line, size: 'XL' }], catalog), /only once/);
});

test('simultaneous first saves and stale revisions never overwrite another packout', async () => {
  let current;
  const model = {
    async create(data) { if (current) throw Object.assign(new Error('duplicate'), { code: 11000 }); current = data; return current; },
    async findOneAndUpdate(filter, update) {
      if (filter.revision !== current.revision || filter.nowstaEventId !== current.nowstaEventId) return null;
      current = { ...current, ...update.$set, revision: current.revision + update.$inc.revision }; return current;
    },
  };
  const results = await Promise.allSettled([saveUniformPackout('42', 0, { lines: [{ quantity: 2 }] }, 'One', model), saveUniformPackout('42', 0, { lines: [] }, 'Two', model)]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.find((result) => result.status === 'rejected').reason.statusCode, 409);
  const saved = await saveUniformPackout('42', 1, { rosterSizes: [{ key: 'nowsta:1', shirtSize: 'L' }] }, 'One', model);
  assert.deepEqual(saved.lines, [{ quantity: 2 }]);
  await assert.rejects(saveUniformPackout('42', 1, { lines: [] }, 'Two', model), { statusCode: 409 });
  assert.equal(current.lines[0].quantity, 2);
  await assert.rejects(saveUniformPackout('42', undefined, {}, 'One', model), { statusCode: 400 });
});

test('uniform packer access permits their workspace and readonly catalogs, blocks reports/admin/general boards and stock changes', () => {
  const auth = { role: 'uniform packer', userId: 'self' };
  for (const [method, originalUrl] of [['GET', '/api/uniform-packing/events?from=2026-09-28'], ['PUT', '/api/uniform-packing/events/42/packout'], ['POST', '/api/uniform-packing/events/42/roster-import'], ['GET', '/api/products?inventoryType=decor'], ['GET', '/api/products/code/ABC'], ['GET', '/api/uniform-items'], ['PUT', '/api/users/self/password']]) {
    assert.equal(uniformPackerRequestAllowed(auth, { method, originalUrl }), true, `${method} ${originalUrl}`);
  }
  for (const [method, originalUrl] of [['GET', '/api/users'], ['GET', '/api/events'], ['GET', '/api/pages/123'], ['GET', '/api/bar/events'], ['GET', '/api/staff'], ['POST', '/api/products'], ['PUT', '/api/uniform-items/123'], ['PUT', '/api/users/other/password']]) {
    assert.equal(uniformPackerRequestAllowed(auth, { method, originalUrl }), false, `${method} ${originalUrl}`);
  }
});

test('real authentication applies the uniform role restriction using current database role', async (t) => {
  const secret = process.env.JWT_SECRET; process.env.JWT_SECRET = 'uniform-tests-only';
  t.after(() => { if (secret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = secret; });
  t.mock.method(User, 'findById', () => chain({ _id: '507f1f77bcf86cd799439011', role: 'uniform packer', isActive: true }));
  const token = jwt.sign({ sub: '507f1f77bcf86cd799439011', role: 'admin', tokenType: 'access' }, process.env.JWT_SECRET);
  for (const [path, allowed] of [['/api/uniform-packing/events', true], ['/api/users', false], ['/api/events', false]]) {
    let passed = false; const res = response();
    await requireAuth({ method: 'GET', originalUrl: path, headers: { authorization: `Bearer ${token}` } }, res, () => { passed = true; });
    assert.equal(passed, allowed);
    if (!allowed) assert.equal(res.code, 403);
  }
});

test('uniform dashboard router admits only administrators and uniform packers', () => {
  for (const role of ['uniform packer', 'admin', 'super admin', 'captain', 'packer', 'event staff', 'user']) {
    let passed = false; const res = response();
    router.stack[0].handle({ auth: { role } }, res, () => { passed = true; });
    assert.equal(passed, ['uniform packer', 'admin', 'super admin'].includes(role));
    if (!passed) assert.equal(res.code, 403);
  }
});

test('event detail returns booked roster and saved quantities without writing to inventory', async (t) => {
  t.mock.method(Event, 'find', () => chain([]));
  t.mock.method(NowstaScheduleEntry, 'findOne', (query) => { assert.equal(query.archived.$ne, true); return chain(entry); });
  t.mock.method(UniformPackout, 'findOne', () => chain({ revision: 3, lines: [{ quantity: 2 }], notes: '' }));
  t.mock.method(Staff, 'find', () => chain(staff));
  t.mock.method(UniformItem, 'find', () => chain(catalog));
  t.mock.method(UniformItem, 'updateOne', () => assert.fail('Viewing or recording a packout must not change stock'));
  const res = response();
  await handler('/events/:id')({ params: { id: '42' } }, res);
  assert.equal(res.code, 200);
  assert.equal(res.body.event.staffCount, 2);
  assert.equal(res.body.packout.revision, 3);
  assert.equal(res.body.roster[0].shirtSize, 'XL');
});

test('save endpoint uses canonical catalog names and a revision lock without deducting stock', async (t) => {
  t.mock.method(UniformPackout, 'findOne', () => chain(null));
  t.mock.method(NowstaScheduleEntry, 'findOne', () => chain(entry));
  t.mock.method(UniformItem, 'find', () => chain(catalog));
  t.mock.method(UniformItem, 'updateOne', () => assert.fail('Packing must not silently deduct inventory'));
  t.mock.method(UniformPackout, 'findOneAndUpdate', async (filter, update) => {
    assert.deepEqual(filter, { nowstaEventId: '42', revision: 2 });
    assert.equal(update.$set.lines[0].name, 'Black Nehru');
    assert.equal(update.$set.lines[0].quantity, 6);
    return { ...update.$set, revision: 3 };
  });
  const res = response();
  await handler('/events/:id/packout', 'put')({ params: { id: '42' }, auth: { username: 'Uniform Packer' },
    body: { expectedRevision: 2, lines: [{ itemId: catalog[0]._id, name: 'Fake', size: 'M', quantity: 6 }], notes: 'Extra jackets' } }, res);
  assert.equal(res.code, 200);
  assert.equal(res.body.revision, 3);
});

test('CSV import keeps existing packing quantities and the download includes imported sizes', async (t) => {
  const packed = { revision: 2, lines: [{ itemId: catalog[0]._id, name: 'Black Nehru', size: 'M', quantity: 6 }], rosterSizes: [], notes: 'Keep these' };
  t.mock.method(NowstaScheduleEntry, 'findOne', () => chain(entry));
  t.mock.method(Staff, 'find', () => chain(staff));
  t.mock.method(UniformPackout, 'findOne', () => chain(packed));
  t.mock.method(UniformPackout, 'findOneAndUpdate', async (_filter, update) => {
    assert.equal(update.$set.lines, undefined);
    assert.equal(update.$set.notes, undefined);
    Object.assign(packed, update.$set, { revision: 3 }); return packed;
  });
  const imported = response();
  await handler('/events/:id/roster-import', 'post')({ params: { id: '42' }, auth: { username: 'Packer' }, body: { csv, expectedRevision: 2 } }, imported);
  assert.equal(imported.code, 200);
  assert.equal(imported.body.packout.lines[0].quantity, 6);
  assert.equal(imported.body.roster[0].jacketSize, '42L');
  const downloaded = response();
  await handler('/events/:id/roster.csv')({ params: { id: '42' } }, downloaded);
  assert.equal(downloaded.code, 200);
  assert.match(downloaded.headers['Content-Type'], /text\/csv/);
  assert.match(downloaded.headers['Content-Disposition'], /attachment/);
  const rows = parseUniformCsv(downloaded.body); const header = rows.findIndex((row) => row[0] === '#');
  assert.equal(rows[header + 1][5], '42L');
});

test('cancelled events cannot be opened, imported, saved or downloaded', async (t) => {
  t.mock.method(NowstaScheduleEntry, 'findOne', () => chain(null));
  for (const [path, method] of [['/events/:id', 'get'], ['/events/:id/packout', 'put'], ['/events/:id/roster-import', 'post'], ['/events/:id/roster.csv', 'get']]) {
    const res = response(); await handler(path, method)({ params: { id: '42' } }, res);
    assert.equal(res.code, 404);
  }
});

test('board download is scoped to the selected event and only decor/uniform decks', async (t) => {
  t.mock.method(NowstaScheduleEntry, 'findOne', () => chain(entry));
  t.mock.method(Event, 'find', (query) => { assert.equal(query['meta.nowsta.apiEventId'], '42'); return chain([{ _id: 'event-one' }]); });
  t.mock.method(Deck, 'find', (query) => {
    assert.equal(query.eventId, 'event-one'); assert.deepEqual(query.type.$in, ['decor', 'uniform']); return chain([{ _id: 'allowed-deck' }]);
  });
  const pageId = '507f1f77bcf86cd799439011';
  t.mock.method(Page, 'findOne', (query) => { assert.deepEqual(query.deckId.$in, ['allowed-deck']); assert.equal(query.deletedAt, null); return chain(null); });
  const res = response(); await handler('/events/:id/boards/:pageId')({ params: { id: '42', pageId } }, res);
  assert.equal(res.code, 404);
});


test('chefs and sanitation do not contribute people, missing sizes, vacancies or uniform requirements', () => {
  const shifts = [
    { position: 'Sanitation', required: 3, workers: [worker('san', 'San Worker')] },
    { position: 'Lead Chef', required: 2, workers: [worker('chef', 'Kitchen Worker')] },
    { position: 'Prep Cook', required: 1, workers: [] },
    { position: 'Sanit', required: 1, workers: [] },
    { position: 'Waiter', required: 3, workers: [worker('waiter', 'Service Worker'), worker('chef', 'Kitchen Worker')] },
  ];
  const result = uniformStaffing({ shifts });
  assert.equal(result.staffCount, 2);
  assert.equal(result.missing, 1);
  assert.deepEqual(result.positions.map(row => row.position), ['Waiter']);
  const roster = buildUniformRoster({ shifts });
  assert.deepEqual(roster.map(row => row.positions), [['Waiter'], ['Waiter']]);
  assert.equal(roster.some(row => row.name === 'San Worker'), false);
});

test('uniform sizes identify each source and fill OCC gaps from CSV or Nowsta without guessing', () => {
  const roster = buildUniformRoster({ shifts: [{ position: 'Waiter', workers: [{ ...worker('1', 'Alex Smith'), sizes: { shirtSize: 'M', pantsSize: '30x32', shoeSize: '10' } }] }] },
    [{ ...staff[0], jacketSize: '42L', shirtSize: '', pantsSize: '', shoeSize: '-' }],
    [{ key: 'nowsta:1', jacketSize: '40L', shirtSize: 'L' }]);
  assert.equal(roster[0].jacketSize, '42L');
  assert.equal(roster[0].shirtSize, 'L');
  assert.equal(roster[0].pantsSize, '30x32');
  assert.equal(roster[0].shoeSize, '10');
  assert.deepEqual(roster[0].sizeSources, { jacketSize: 'OCC staff', shirtSize: 'Event CSV', pantsSize: 'Nowsta roster', shoeSize: 'Nowsta roster', height: 'OCC staff' });
  const totals = uniformStaffing({ shifts: [{ position: 'Waiter', required: 2, workers: [{ name: 'TT', agency: true, status: 'confirmed' }] }] });
  assert.deepEqual(totals.positions[0].agencies, ['TT']);
  assert.equal(totals.staffCount, 1);
});

test('named agency staff appear in the roster and confirmed staff counts without inventing sizes', () => {
  const fabian = { companyUserId: 'tt-fabian', name: 'zz TT - Fabian Abramowitz (Agency)', status: 'confirmed', agency: true };
  const casey = { companyUserId: 'tt-casey', name: 'zz TT - Casey Currin (Agency)', status: 'pending', agency: true };
  const source = { shifts: [{ position: 'Waiter', required: 3, workers: [fabian, casey, { ...fabian, companyUserId: 'cancelled', name: 'Cancelled', status: 'cancelled' }] },
    { position: 'Beverage Attendant', required: 1, workers: [fabian] },
    { position: 'Chef', required: 1, workers: [{ ...fabian, companyUserId: 'chef', name: 'Chef' }] }] };
  const roster = buildUniformRoster(source);
  assert.deepEqual(roster.map((person) => person.name), [fabian.name, casey.name]);
  assert.equal(roster[0].agency, true);
  assert.equal(roster[0].uniformPackingPending, false);
  assert.equal(roster[1].uniformPackingPending, true);
  assert.equal(roster[0].jacketSize, '');
  assert.equal(roster[0].shirtSize, '');
  const totals = uniformStaffing(source);
  assert.equal(totals.staffCount, 1);
  assert.equal(totals.booked, 2);
  assert.equal(totals.pending, 1);
  assert.equal(totals.missing, 2);
});
