const clean = (value, maxLength = 1000) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
const normalized = (value) => clean(value).toLowerCase();

const FIELD_MAP = Object.freeze({
  type: 'fsType',
  fstype: 'fsType',
  fsname: 'station',
  fsptextarea: 'prepArea',
  preparea: 'prepArea',
  category: 'category',
  rentalitem: 'rentalItem',
  vendor: 'vendor',
});

const normalizedField = (value) => FIELD_MAP[normalized(value).replace(/[^a-z0-9]/g, '')] || '';

const parseConditions = (row) => {
  const conditions = [];
  const unsupported = [];
  [1, 2, 3].forEach((index) => {
    const expression = clean(row?.[`Condition${index}`], 1000);
    if (!expression) return;
    const matches = [...expression.matchAll(/\b([A-Za-z][A-Za-z0-9]*)\s*(=|<>|!=)\s*'([^']*)'/g)];
    if (!matches.length || /\bOR\b/i.test(expression)) {
      unsupported.push(expression);
      return;
    }
    matches.forEach((match) => {
      const field = normalizedField(match[1]);
      if (!field) unsupported.push(expression);
      else conditions.push({ field, operator: match[2] === '=' ? 'equals' : 'not_equals', value: clean(match[3], 300) });
    });
  });
  return { conditions, unsupported };
};

const documentTypeFor = (conditions) => (
  conditions.some((condition) => condition.field === 'fsType'
    && condition.operator === 'equals'
    && normalized(condition.value) === 'food')
    ? 'kitchen_packout'
    : 'po'
);

export const normalizeCatereasePrintTemplates = (rows = []) => (Array.isArray(rows) ? rows : [])
  .filter((row) => normalized(row?.PrintKind) === 'evtreq')
  .map((row) => {
    const { conditions, unsupported } = parseConditions(row);
    const uid = clean(row?.UID, 120);
    const groupBy = [1, 2, 3].map((index) => normalizedField(row?.[`GroupBy${index}`])).filter(Boolean);
    const headerFields = [];
    for (let index = 1; index <= 35; index += 1) {
      const field = clean(row?.[`Field${index}`], 200);
      if (!field) break;
      headerFields.push(field);
    }
    return {
      key: uid ? `print-${uid}` : '',
      sourceId: uid,
      label: clean(row?.Title, 200) || 'Pack Out',
      documentType: documentTypeFor(conditions),
      printKind: clean(row?.PrintKind, 80),
      printType: clean(row?.PrintType, 80),
      sortOrder: Number.isFinite(Number(row?.SortOrder)) ? Number(row.SortOrder) : 9999,
      shared: row?.Shared === true,
      separateSubEvents: row?.SEGroup === true,
      groupBy: groupBy.length ? groupBy : ['station'],
      conditions,
      unsupportedConditions: [...new Set(unsupported)],
      supported: unsupported.length === 0,
      fsFormat: clean(row?.FSFormat, 500),
      headerFields,
      headers: {
        left: clean(row?.LHeader, 4000),
        center: clean(row?.CHeader, 4000),
        right: clean(row?.RHeader, 4000),
      },
      topNotes: clean(row?.TopNotes, 12000),
      bottomNotes: clean(row?.BotNotes, 12000),
      text: Array.from({ length: 10 }, (_, index) => clean(row?.[`Text${index + 1}`], 4000)).filter(Boolean),
      revised: clean(row?.Revised, 80),
    };
  })
  .filter((template) => template.key)
  .sort((left, right) => left.sortOrder - right.sortOrder || left.label.localeCompare(right.label));

// Legacy fallback for old snapshots only. New snapshots carry the live
// location templates returned by /v1/printtemplate.
export const CATEREASE_PACK_OUT_TEMPLATES = Object.freeze([
  Object.freeze({ key: 'kitchen_pack_out', label: 'Kitchen Pack Out', documentType: 'kitchen_packout', groupBy: Object.freeze(['station']), conditions: Object.freeze([]) }),
  Object.freeze({ key: 'pack_out', label: 'Pack Out', documentType: 'po', groupBy: Object.freeze(['station']), conditions: Object.freeze([{ field: 'fsType', operator: 'equals', value: 'Equipment' }]) }),
]);

const templateList = (templates) => Array.isArray(templates) ? templates : CATEREASE_PACK_OUT_TEMPLATES;

export const catereasePackOutTemplate = (templateKey, templates) => (
  templateList(templates).find((template) => template.key === clean(templateKey, 120)) || null
);

const matchesCondition = (row, condition) => {
  const actual = normalized(row?.[condition.field]);
  const expected = normalized(condition.value);
  return condition.operator === 'not_equals' ? actual !== expected : actual === expected;
};

export const catereasePackOutTemplateRows = (rows = [], templateKey, templates) => {
  const template = catereasePackOutTemplate(templateKey, templates);
  if (!template || template.supported === false) return [];
  const values = Array.isArray(rows) ? rows : [];
  const conditions = Array.isArray(template.conditions)
    ? template.conditions
    : template.filter ? [{ field: template.filter.field, operator: 'equals', value: template.filter.equals }] : [];
  return conditions.length ? values.filter((row) => conditions.every((condition) => matchesCondition(row, condition))) : values;
};

export const buildCatereasePackOutTemplateSummaries = (rows = [], printTemplateRows) => {
  const templates = Array.isArray(printTemplateRows)
    ? normalizeCatereasePrintTemplates(printTemplateRows)
    : CATEREASE_PACK_OUT_TEMPLATES;
  return templates.map((template) => ({
    ...template,
    groupBy: [...template.groupBy],
    conditions: (template.conditions || []).map((condition) => ({ ...condition })),
    rowCount: catereasePackOutTemplateRows(rows, template.key, templates).length,
  }));
};
