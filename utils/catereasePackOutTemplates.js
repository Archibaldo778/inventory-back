const normalized = (value) => String(value ?? '').trim().toLowerCase();

export const CATEREASE_PACK_OUT_TEMPLATES = Object.freeze([
  Object.freeze({
    key: 'kitchen_pack_out',
    label: 'Kitchen Pack Out',
    documentType: 'kitchen_packout',
    groupBy: Object.freeze(['station']),
  }),
  Object.freeze({
    key: 'pack_out',
    label: 'Pack Out',
    documentType: 'po',
    groupBy: Object.freeze(['station']),
    filter: Object.freeze({ field: 'fsType', equals: 'Equipment' }),
  }),
  Object.freeze({
    key: 'kitchen_pack_out_testing',
    label: 'Kitchen Pack Out - Testing',
    documentType: 'kitchen_packout',
    groupBy: Object.freeze(['prepArea']),
  }),
  Object.freeze({
    key: 'test_kitchen_pack_out',
    label: 'Test - Kitchen Pack Out',
    documentType: 'kitchen_packout',
    groupBy: Object.freeze(['category', 'station']),
  }),
  Object.freeze({
    key: 'required_items',
    label: 'Required Items',
    documentType: 'po',
    groupBy: Object.freeze([]),
  }),
]);

export const catereasePackOutTemplate = (templateKey) => (
  CATEREASE_PACK_OUT_TEMPLATES.find((template) => template.key === String(templateKey || '').trim()) || null
);

export const catereasePackOutTemplateRows = (rows = [], templateKey) => {
  const template = catereasePackOutTemplate(templateKey);
  if (!template) return [];
  const values = Array.isArray(rows) ? rows : [];
  if (!template.filter) return values;
  return values.filter((row) => normalized(row?.[template.filter.field]) === normalized(template.filter.equals));
};

export const buildCatereasePackOutTemplateSummaries = (rows = []) => (
  CATEREASE_PACK_OUT_TEMPLATES.map((template) => ({
    key: template.key,
    label: template.label,
    documentType: template.documentType,
    groupBy: [...template.groupBy],
    ...(template.filter ? { filter: { ...template.filter } } : {}),
    rowCount: catereasePackOutTemplateRows(rows, template.key).length,
  }))
);
