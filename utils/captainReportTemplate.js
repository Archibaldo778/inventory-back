import EventReportTemplate from '../models/EventReportTemplate.js';
import EventReport from '../models/EventReport.js';
import { DEFAULT_CAPTAIN_TEMPLATE } from './captainReportTemplateDefaults.js';
import { DEFAULT_KITCHEN_TEMPLATE } from './kitchenReportTemplateDefaults.js';
import { createApiError } from './apiErrors.js';

export const defaultCaptainTemplate = () => structuredClone(DEFAULT_CAPTAIN_TEMPLATE);
export const defaultReportTemplate = (type) => structuredClone(type === 'kitchen' ? DEFAULT_KITCHEN_TEMPLATE : DEFAULT_CAPTAIN_TEMPLATE);
export const reportTemplate = (report) => report?.templateSnapshot || defaultReportTemplate(report?.reportType);
export const reportCaptainTemplate = (report) => report?.templateSnapshot || defaultCaptainTemplate();
export const templateFields = (template) => template.sections.flatMap((section) => section.fields);
const text = (value, max) => typeof value === 'string' && value.trim().length <= max ? value.trim() : null;
const validKey = (key) => typeof key === 'string' && /^[a-z][a-zA-Z0-9_]{1,79}$/.test(key) && !['constructor', 'prototype'].includes(key);

export const validateReportTemplate = (body = {}, reportType = 'captain') => {
  const builtins = new Map(defaultReportTemplate(reportType).sections.flatMap((section) => section.fields).map((field) => [field.key, field]));
  if (!Number.isInteger(body.expectedRevision) || body.expectedRevision < 0) throw createApiError(400, 'Reload the current template before saving');
  const introduction = text(body.introduction, 1500);
  if (introduction === null || !Array.isArray(body.sections) || !body.sections.length || body.sections.length > 15) throw createApiError(400, 'Use 1 to 15 sections and an introduction up to 1,500 characters');
  const sectionKeys = new Set(); const fieldKeys = new Set();
  const sections = body.sections.map((section) => {
    if (!validKey(section?.key) || sectionKeys.has(section.key) || !text(section.title, 200) || text(section.description || '', 1000) === null
      || !Array.isArray(section.fields) || !section.fields.length) throw createApiError(400, 'Each section needs a unique identifier, a title and at least one question');
    sectionKeys.add(section.key);
    const fields = section.fields.map((field) => {
      if (!validKey(field?.key) || fieldKeys.has(field.key) || !text(field.label, 1000) || !['text', 'textarea', 'choice', 'checkbox'].includes(field.type)
        || (!builtins.has(field.key) && !/^custom_[a-zA-Z0-9_]+$/.test(field.key))) throw createApiError(400, 'Each question needs a unique identifier, text and a supported answer type');
      fieldKeys.add(field.key);
      const builtin = builtins.get(field.key);
      if (builtin && builtin.type !== field.type) throw createApiError(400, 'Existing questions keep their answer type. Add a new question to use a different type.');
      const result = { key: field.key, label: field.label.trim(), type: field.type, required: field.required === true };
      if (field.type === 'choice') {
        if (!Array.isArray(field.options) || field.options.length < 2 || field.options.length > 15
          || field.options.some((option) => !text(option, 200))) throw createApiError(400, 'Choice questions need 2 to 15 non-empty answers');
        result.options = field.options.map((option) => option.trim());
        if (new Set(result.options).size !== result.options.length) throw createApiError(400, 'Answer choices must be unique');
        if (field.key === 'rerunsOrPurchases' && JSON.stringify(result.options) !== JSON.stringify(builtin.options)) throw createApiError(400, 'Keep the standard re-run choices so operational summaries remain accurate');
      }
      if (field.inputMode === 'numeric' && field.type === 'text') result.inputMode = 'numeric';
      return result;
    });
    return { key: section.key, title: section.title.trim(), description: String(section.description || '').trim(), fields };
  });
  if (fieldKeys.size > 100) throw createApiError(400, 'Use up to 100 questions');
  return { introduction, sections };
};
export const validateCaptainTemplate = (body) => validateReportTemplate(body, 'captain');

export const loadReportTemplate = async (type, Templates = EventReportTemplate) => {
  const saved = await Templates.findById(type).lean();
  return saved ? { revision: saved.revision, introduction: saved.introduction, sections: saved.sections } : defaultReportTemplate(type);
};
export const loadCaptainTemplate = (Templates = EventReportTemplate) => loadReportTemplate('captain', Templates);

export const pinReportTemplate = async (report, { Reports = EventReport, loadTemplate = loadReportTemplate } = {}) => {
  if (report.status !== 'pending' || report.templateSnapshot) return report;
  const hasDraftAnswers = Object.values(report.answers || {}).some(value => value === true || (typeof value === 'string' && value.trim()));
  const snapshot = hasDraftAnswers ? defaultReportTemplate(report.reportType)
    : await loadTemplate(report.reportType === 'kitchen' ? 'kitchen' : 'captain');
  const pinned = await Reports.findOneAndUpdate({ _id: report._id, status: 'pending', templateSnapshot: null },
    { $set: { templateSnapshot: snapshot } }, { new: true });
  if (pinned) return pinned;
  const current = await Reports.findById(report._id);
  if (!current) throw createApiError(404, 'Report was not found');
  return current;
};
export const pinCaptainTemplate = (report, options) => report.reportType === 'kitchen' ? report : pinReportTemplate(report, options);

export const captainTemplateAnswers = (template, input = {}) => {
  const values = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const answers = {};
  for (const field of templateFields(template)) {
    const value = field.type === 'checkbox' ? values[field.key] === true : String(values[field.key] ?? '').trim().slice(0, 5000);
    if (field.required && (field.type === 'checkbox' ? !value : !value.length)) throw createApiError(400, `Complete the required question: ${field.label}`);
    if (field.type === 'choice' && value && !field.options.includes(value)) throw createApiError(400, `Choose a listed answer: ${field.label}`);
    answers[field.key] = value;
  }
  return answers;
};
