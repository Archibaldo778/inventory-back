import { Router } from 'express';
import mongoose from 'mongoose';
import AutomationAlertRule from '../models/AutomationAlertRule.js';
import AutomationAlertDelivery from '../models/AutomationAlertDelivery.js';
import { sendApiError } from '../utils/apiErrors.js';
import { ensureDefaultAutomationRule } from '../utils/automationAlerts.js';

const router = Router();
const clean = (value, max = 500) => String(value ?? '').trim().slice(0, max);
const validEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const actor = (req) => clean(req.auth?.email || req.auth?.username || req.auth?.userId, 200);
const uniqueLines = (value, maxItems, maxLength) => [...new Set((Array.isArray(value) ? value : String(value || '').split(/[\n,;]/))
  .map((entry) => clean(entry, maxLength)).filter(Boolean))].slice(0, maxItems);

const payload = (body = {}) => {
  const recipients = uniqueLines(body.recipients, 50, 320).map((entry) => entry.toLowerCase());
  const matchTerms = uniqueLines(body.matchTerms, 200, 200);
  if (!clean(body.name, 160)) throw Object.assign(new Error('Rule name is required'), { statusCode: 400 });
  if (!clean(body.department, 120)) throw Object.assign(new Error('Department is required'), { statusCode: 400 });
  if (!matchTerms.length) throw Object.assign(new Error('Add at least one product or phrase'), { statusCode: 400 });
  if (!recipients.length || recipients.some((entry) => !validEmail(entry))) throw Object.assign(new Error('Every recipient must be a valid email address'), { statusCode: 400 });
  return {
    name: clean(body.name, 160), department: clean(body.department, 120),
    source: 'caterease_packout', enabled: body.enabled !== false,
    matchTerms, recipients, subjectPrefix: clean(body.subjectPrefix, 160) || 'ACTION REQUIRED',
  };
};

const serializeRule = (rule) => ({
  id: String(rule._id), name: rule.name, department: rule.department, source: rule.source,
  enabled: rule.enabled, matchTerms: rule.matchTerms || [], recipients: rule.recipients || [],
  subjectPrefix: rule.subjectPrefix, seeded: Boolean(rule.seededKey),
  createdAt: rule.createdAt, updatedAt: rule.updatedAt,
});

router.get('/', async (_req, res) => {
  try {
    await ensureDefaultAutomationRule();
    const [rules, deliveries] = await Promise.all([
      AutomationAlertRule.find({}).sort({ createdAt: 1 }).lean(),
      AutomationAlertDelivery.find({}).sort({ createdAt: -1 }).limit(50).populate('ruleId', 'name department').populate('eventId', 'title date').lean(),
    ]);
    return res.json({
      rules: rules.map(serializeRule),
      deliveries: deliveries.map((entry) => ({
        id: String(entry._id), ruleId: String(entry.ruleId?._id || entry.ruleId || ''),
        ruleName: entry.ruleId?.name || '', department: entry.ruleId?.department || '',
        eventId: String(entry.eventId?._id || entry.eventId || ''), eventTitle: entry.eventId?.title || '', eventDate: entry.eventId?.date || '',
        status: entry.status, recipients: entry.recipients || [], matchedItems: entry.matchedItems || [],
        error: entry.error || '', sentAt: entry.sentAt, createdAt: entry.createdAt,
      })),
    });
  } catch (error) {
    return sendApiError(res, error, { context: 'Automation alerts load failed', fallbackMessage: 'Could not load automated alerts' });
  }
});

router.post('/', async (req, res) => {
  try {
    const rule = await AutomationAlertRule.create({ ...payload(req.body), createdBy: actor(req), updatedBy: actor(req) });
    return res.status(201).json({ rule: serializeRule(rule) });
  } catch (error) {
    return sendApiError(res, error, { context: 'Automation alert create failed', fallbackMessage: 'Could not create the alert rule' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid rule id' });
    const rule = await AutomationAlertRule.findByIdAndUpdate(req.params.id, { ...payload(req.body), updatedBy: actor(req) }, { new: true, runValidators: true });
    if (!rule) return res.status(404).json({ message: 'Alert rule not found' });
    return res.json({ rule: serializeRule(rule) });
  } catch (error) {
    return sendApiError(res, error, { context: 'Automation alert update failed', fallbackMessage: 'Could not update the alert rule' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid rule id' });
    const rule = await AutomationAlertRule.findById(req.params.id);
    if (!rule) return res.status(404).json({ message: 'Alert rule not found' });
    if (rule.seededKey) return res.status(409).json({ message: 'The migrated PO Scanner can be disabled but not deleted' });
    await rule.deleteOne();
    return res.json({ ok: true });
  } catch (error) {
    return sendApiError(res, error, { context: 'Automation alert delete failed', fallbackMessage: 'Could not delete the alert rule' });
  }
});

export default router;
