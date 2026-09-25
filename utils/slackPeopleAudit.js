const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

const normalizeEmail = (value) => clean(value).toLowerCase();

const normalizeName = (value) => clean(value)
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

export const normalizeNowstaDirectoryUser = (person = {}) => ({
  id: clean(person?.id ?? person?.company_user_id ?? person?.companyUserId),
  name: clean([
    person?.first_name ?? person?.user_first_name ?? person?.firstName,
    person?.last_name ?? person?.user_last_name ?? person?.lastName,
  ].filter(Boolean).join(' '))
    || clean(person?.full_name ?? person?.name ?? person?.nickname)
    || normalizeEmail(person?.email ?? person?.user_email ?? person?.user?.email),
  email: normalizeEmail(person?.email ?? person?.user_email ?? person?.user?.email),
});

export const normalizeSlackDirectoryUser = (user = {}) => ({
  id: clean(user?.id),
  name: clean(user?.profile?.real_name || user?.real_name || user?.profile?.display_name || user?.name),
  email: normalizeEmail(user?.profile?.email),
  deleted: Boolean(user?.deleted),
  isBot: Boolean(user?.is_bot) || user?.id === 'USLACKBOT',
});

const addToIndex = (map, key, value) => {
  if (!key) return;
  const current = map.get(key) || [];
  current.push(value);
  map.set(key, current);
};

export const buildSlackPeopleAudit = ({ nowstaUsers = [], slackUsers = [], linkedStaff = [] } = {}) => {
  const nowsta = nowstaUsers
    .map(normalizeNowstaDirectoryUser)
    .filter((person) => person.id && person.name);
  const slack = slackUsers
    .map(normalizeSlackDirectoryUser)
    .filter((person) => person.id && person.name && !person.deleted && !person.isBot);

  const slackById = new Map(slack.map((person) => [person.id, person]));
  const slackByEmail = new Map();
  const slackByName = new Map();
  slack.forEach((person) => {
    addToIndex(slackByEmail, person.email, person);
    addToIndex(slackByName, normalizeName(person.name), person);
  });
  const linkedByNowstaId = new Map((Array.isArray(linkedStaff) ? linkedStaff : [])
    .map((person) => [clean(person?.nowstaCompanyUserId), clean(person?.slackUserId)])
    .filter(([nowstaId, slackId]) => nowstaId && slackId));

  const rows = nowsta.map((person) => {
    const linkedSlackId = linkedByNowstaId.get(person.id);
    const emailMatches = person.email ? (slackByEmail.get(person.email) || []) : [];
    const nameMatches = slackByName.get(normalizeName(person.name)) || [];
    const slackPerson = (linkedSlackId ? slackById.get(linkedSlackId) : null)
      || (emailMatches.length === 1 ? emailMatches[0] : null)
      || (nameMatches.length === 1 ? nameMatches[0] : null);
    const matchMethod = linkedSlackId && slackPerson ? 'saved_link'
      : emailMatches.length === 1 && slackPerson ? 'email'
        : nameMatches.length === 1 && slackPerson ? 'name'
          : '';
    let status = 'not_found';
    if (slackPerson) {
      if (!person.email || !slackPerson.email) status = 'missing_email';
      else status = person.email === slackPerson.email ? 'email_match' : 'email_mismatch';
    } else if (nameMatches.length > 1 || emailMatches.length > 1) {
      status = 'ambiguous';
    }
    return {
      nowstaId: person.id,
      nowstaName: person.name,
      nowstaEmail: person.email,
      slackUserId: slackPerson?.id || linkedSlackId || '',
      slackName: slackPerson?.name || '',
      slackEmail: slackPerson?.email || '',
      matchMethod,
      status,
    };
  }).sort((a, b) => a.nowstaName.localeCompare(b.nowstaName));

  const counts = rows.reduce((result, row) => {
    result.total += 1;
    result[row.status] += 1;
    return result;
  }, {
    total: 0,
    email_match: 0,
    email_mismatch: 0,
    missing_email: 0,
    not_found: 0,
    ambiguous: 0,
  });

  return { counts, rows };
};
