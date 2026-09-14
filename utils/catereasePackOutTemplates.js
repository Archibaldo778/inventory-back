const clean = (value, maxLength = 1000) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
const normalized = (value) => clean(value).toLowerCase();
const PACK_OUT_SECTION_HEADINGS = new Set([
  'kitchen equipment',
  'specialty kitchen equipment',
  'sanitation kit',
  'disposable items',
  'trays',
  'ice',
  'water',
  'garnish',
  'staff items',
]);

const isPackOutSectionHeading = (row) => (
  PACK_OUT_SECTION_HEADINGS.has(normalized(row?.itemName))
  && (!Number.isFinite(Number(row?.quantity)) || Number(row.quantity) === 0)
);

const foodServiceGroupKey = (row) => clean(row?.subEvent, 120).toLowerCase()
  || clean(row?.zoneName, 200).toLowerCase();

const foodServiceDishKey = (row, name = row?.itemName) => [
  clean(row?.subEvent, 120).toLowerCase(),
  normalized(name),
].join('|');

const isKitchenPackOutMenuDish = (row) => !/\b(?:staff\s*meal|bar|beverages?|cocktails?|wine|beer|liquor)\b/i.test([
  row?.menuGroup,
  row?.category,
  row?.prepArea,
].filter(Boolean).join(' '));

const isGenericZeroQuantityHeading = (row) => {
  if (Number(row?.quantity) !== 0 || clean(row?.notes, 1000)) return false;
  const letters = clean(row?.itemName, 300).replace(/[^A-Za-z]+/g, '');
  return Boolean(letters) && letters === letters.toUpperCase();
};

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

const documentTypeFor = (conditions, title = '') => {
  if (normalized(title) === 'kitchen pack out') return 'kitchen_packout';
  return conditions.some((condition) => condition.field === 'fsType'
    && condition.operator === 'equals'
    && normalized(condition.value) === 'food')
    ? 'kitchen_packout'
    : 'po';
};

const isOperationalTemplate = (title = '') => [
  'pack out',
  'kitchen pack out',
].includes(normalized(title));

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
    const title = clean(row?.Title, 200) || 'Pack Out';
    return {
      key: uid ? `print-${uid}` : '',
      sourceId: uid,
      label: title,
      documentType: documentTypeFor(conditions, title),
      operationalVisible: isOperationalTemplate(title),
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

export const catereaseOperationalTemplateRows = (snapshot = {}, templateKey, templates) => {
  const template = catereasePackOutTemplate(templateKey, templates);
  if (!template) return [];
  const requiredRows = snapshot?.requiredItems || snapshot?.kitchenPackOut || [];
  const requiredMatches = catereasePackOutTemplateRows(requiredRows, templateKey, templates);
  const foodServiceRows = (snapshot?.foodService || snapshot?.packOut || [])
    .filter((row) => !/\binvoice\b/i.test(clean(row?.zoneName, 200)));
  if (template.documentType === 'kitchen_packout') {
    const kitchenMenuRows = Array.isArray(snapshot?.kitchenMenu) ? snapshot.kitchenMenu : [];
    const kitchenMenuByDish = new Map(kitchenMenuRows.map((row) => [foodServiceDishKey(row), row]));
    const representedFoodServiceIds = new Set(requiredRows
      .map((row) => clean(row?.foodServiceId, 120).toLowerCase())
      .filter(Boolean));
    const representedDishes = new Set(requiredRows
      .map((row) => foodServiceDishKey(row, row?.station))
      .filter((key) => key !== '|'));
    const missingDishRows = catereasePackOutTemplateRows(foodServiceRows, templateKey, templates)
      .filter((row) => !/\bpack\s*out\b/i.test(clean(row?.zoneName, 200)))
      .filter((row) => {
        const foodServiceId = clean(row?.foodServiceId, 120).toLowerCase();
        if (foodServiceId && representedFoodServiceIds.has(foodServiceId)) return false;
        return !representedDishes.has(foodServiceDishKey(row));
      })
      .filter((row) => {
        const kitchenMenuRow = kitchenMenuByDish.get(foodServiceDishKey(row));
        if (kitchenMenuRows.length) return Boolean(kitchenMenuRow) && isKitchenPackOutMenuDish(kitchenMenuRow);
        return Boolean(clean(row?.category, 160))
          && isKitchenPackOutMenuDish(row)
          && !isGenericZeroQuantityHeading(row);
      })
      .map((row) => ({
        ...row,
        station: row.station || row.itemName,
        topLevelFoodService: true,
      }));
    return [...requiredMatches, ...missingDishRows];
  }
  if (template.documentType !== 'po') return requiredMatches;

  const manualPackOutGroups = new Set(foodServiceRows
    .filter((row) => isPackOutSectionHeading(row) || /\bpack\s*out\b/i.test(clean(row?.zoneName, 200)))
    .map(foodServiceGroupKey)
    .filter(Boolean));
  const manualPackOutRows = foodServiceRows.filter((row) => (
    manualPackOutGroups.has(foodServiceGroupKey(row)) && !isPackOutSectionHeading(row)
  ));
  if (manualPackOutRows.length) return manualPackOutRows;

  const foodServiceMatches = catereasePackOutTemplateRows(foodServiceRows, templateKey, templates)
    .filter((row) => !isPackOutSectionHeading(row));
  if (foodServiceMatches.length) return foodServiceMatches;

  // Manually entered event Pack Out lines can have no Type/FSType. Their
  // sub-event description is still preserved by /v1/foodserv.
  const explicitPackOutRows = foodServiceRows.filter((row) => (
    /\bpack\s*out\b/i.test(clean(row?.zoneName, 200)) && !isPackOutSectionHeading(row)
  ));
  return explicitPackOutRows.length ? explicitPackOutRows : requiredMatches;
};

export const buildCatereasePackOutTemplateSummaries = (rows = [], printTemplateRows, foodServiceRows = [], kitchenMenuRows = []) => {
  const templates = Array.isArray(printTemplateRows)
    ? normalizeCatereasePrintTemplates(printTemplateRows)
    : CATEREASE_PACK_OUT_TEMPLATES;
  return templates.map((template) => ({
    ...template,
    groupBy: [...template.groupBy],
    conditions: (template.conditions || []).map((condition) => ({ ...condition })),
    rowCount: catereaseOperationalTemplateRows({ requiredItems: rows, foodService: foodServiceRows, kitchenMenu: kitchenMenuRows }, template.key, templates).length,
  }));
};
