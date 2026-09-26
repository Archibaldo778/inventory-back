import crypto from 'node:crypto';
import AutomationAlertRule from '../models/AutomationAlertRule.js';
import AutomationAlertDelivery from '../models/AutomationAlertDelivery.js';

const clean = (value, max = 1000) => String(value ?? '').trim().slice(0, max);
const normalize = (value) => clean(value, 5000)
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();
const escapeHtml = (value) => clean(value, 5000).replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]));

export const LEGACY_PO_SCANNER_TERMS = [
  'Phone Check Boxes', 'Work light kit for Out of Town', 'Portable Power Station',
  'Roll of Floor Paper', 'Blue Tape Rolls', 'Laser Kit', 'Measurement Tape',
  'White setup gloves', 'White Gloves', 'Set Up Shirts', 'Bubble Wrap Roll',
  'Masking Tape', 'Saran wrap', 'Heat Lamp', 'Steamer',
];

export const LEGACY_PO_SCANNER_RECIPIENTS = [
  'ivan@ocnyc.com', 'iurie@ocnyc.com', 'vladimir@ocnyc.com', 'opsinventory@ocnyc.com',
];

const termMatchesProduct = (termKey, productKey) => {
  if (!termKey || !productKey || !productKey.includes(termKey)) return false;
  // The migrated Flow searched for the generic word "Steamer", which also
  // caught the coffee-service Milk Steamer. That item is not an Operations alert.
  if (termKey === 'steamer' && /\bmilk steamer\b/.test(productKey)) return false;
  return true;
};

export const ensureDefaultAutomationRule = () => AutomationAlertRule.findOneAndUpdate(
  { seededKey: 'legacy-po-scanner' },
  { $setOnInsert: {
    name: 'PO Scanner', department: 'Operations / Inventory', source: 'caterease_packout', enabled: true,
    matchTerms: LEGACY_PO_SCANNER_TERMS, recipients: LEGACY_PO_SCANNER_RECIPIENTS,
    subjectPrefix: 'ACTION REQUIRED', seededKey: 'legacy-po-scanner', createdBy: 'Power Automate migration', updatedBy: 'Power Automate migration',
  } },
  { upsert: true, new: true, setDefaultsOnInsert: true },
);

export const findAutomationMatches = (snapshot, matchTerms = []) => {
  const terms = (Array.isArray(matchTerms) ? matchTerms : [])
    .map((term) => ({ label: clean(term, 200), key: normalize(term) })).filter(({ key }) => key);
  const rows = Array.isArray(snapshot?.packOut) ? snapshot.packOut : [];
  return rows.flatMap((row) => {
    const searchable = normalize([row?.itemName, row?.name, row?.description, row?.notes].filter(Boolean).join(' '));
    const matchedTerms = terms.filter(({ key }) => termMatchesProduct(key, searchable)).map(({ label }) => label);
    if (!matchedTerms.length) return [];
    return [{
      itemName: clean(row?.itemName || row?.name || matchedTerms[0], 300),
      quantity: Number.isFinite(Number(row?.quantity ?? row?.qty)) ? Number(row.quantity ?? row.qty) : null,
      unit: clean(row?.unit, 80),
      zone: clean(row?.zoneName || row?.station || row?.sourceSection, 200),
      matchedTerms,
    }];
  });
};

export const automationAlertSignature = ({ event, rule, matches }) => crypto.createHash('sha256').update(JSON.stringify({
  eventId: clean(event?._id || event?.externalId, 100),
  ruleId: clean(rule?._id, 100),
  items: matches.map((item) => ({
    name: normalize(item.itemName), quantity: item.quantity, unit: normalize(item.unit), zone: normalize(item.zone),
  })).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
})).digest('hex');

const itemLine = (item) => [
  item.itemName,
  item.quantity === null ? '' : `Qty ${item.quantity}${item.unit ? ` ${item.unit}` : ''}`,
  item.zone,
].filter(Boolean).join(' · ');

const operationsSender = () => {
  const configured = clean(process.env.PACKOUT_ALERT_FROM, 320);
  const configuredAddress = clean(configured.match(/<([^<>]+)>/)?.[1] || configured, 320);
  const address = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(configuredAddress)
    ? configuredAddress
    : 'reports@reports.occdecks.com';
  return `OCC Operations <${address}>`;
};

export const sendAutomationAlertEmail = async ({ event, rule, matches, fetchImpl = fetch }) => {
  const apiKey = clean(process.env.RESEND_API_KEY, 1000);
  if (!apiKey) return { status: 'failed', error: 'RESEND_API_KEY is not configured' };
  const eventTitle = clean(event?.title, 300) || 'Untitled event';
  const eventDate = clean(event?.date, 40);
  const recipients = Array.isArray(rule?.recipients) ? rule.recipients.map((value) => clean(value, 320).toLowerCase()).filter(Boolean) : [];
  const lines = matches.map(itemLine);
  const response = await fetchImpl('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: operationsSender(),
      to: recipients,
      subject: `${clean(rule?.subjectPrefix, 160) || 'ACTION REQUIRED'} · ${eventTitle}${eventDate ? ` · ${eventDate}` : ''}`,
      html: `<div style="font-family:Arial,sans-serif;color:#222"><h2 style="margin:0 0 8px">${escapeHtml(rule?.name || 'Automated alert')}</h2><p style="margin:0 0 16px"><strong>${escapeHtml(eventTitle)}</strong>${eventDate ? ` · ${escapeHtml(eventDate)}` : ''}</p><p>The following Pack Out items matched the ${escapeHtml(rule?.department || 'department')} rule:</p><ul>${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul></div>`,
      text: `${clean(rule?.name || 'AUTOMATED ALERT').toUpperCase()}\n${eventTitle}${eventDate ? ` · ${eventDate}` : ''}\n\n${lines.map((line) => `- ${line}`).join('\n')}`,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.id) return { status: 'failed', error: clean(payload?.message || `Resend HTTP ${response.status}`, 1000) };
  return { status: 'sent', providerId: clean(payload.id, 200), sentAt: new Date() };
};

export const processAutomationAlerts = async ({
  event,
  snapshot,
  previousSnapshot,
  previousChecksum,
  fetchImpl = fetch,
  force = false,
  ruleIds = [],
}) => {
  await ensureDefaultAutomationRule();
  const ruleQuery = { enabled: true, source: 'caterease_packout' };
  if (Array.isArray(ruleIds) && ruleIds.length) ruleQuery._id = { $in: ruleIds };
  const rules = await AutomationAlertRule.find(ruleQuery).lean();
  const results = [];
  for (const rule of rules) {
    const matches = findAutomationMatches(snapshot, rule.matchTerms);
    if (!matches.length) {
      results.push({ ruleId: rule._id, status: 'no_match' });
      continue;
    }
    const signature = automationAlertSignature({ event, rule, matches });
    if (!force && !previousChecksum) {
      results.push({ ruleId: rule._id, status: 'baseline', matches: matches.length });
      continue;
    }
    const existing = await AutomationAlertDelivery.findOne({ ruleId: rule._id, eventId: event._id, signature }).lean();
    const unchangedSnapshot = String(previousChecksum) === String(snapshot?.checksum || '');
    const pendingIsFresh = existing?.status === 'pending'
      && Date.now() - new Date(existing.lastAttemptAt || existing.updatedAt || 0).getTime() < 10 * 60 * 1000;
    if (existing?.status === 'sent' || pendingIsFresh) {
      results.push({ ruleId: rule._id, status: existing.status === 'sent' ? 'already_sent' : 'pending', matches: matches.length });
      continue;
    }
    if (!force && unchangedSnapshot && existing?.status !== 'failed' && existing?.status !== 'pending') {
      results.push({ ruleId: rule._id, status: 'unchanged', matches: matches.length });
      continue;
    }
    const previousMatches = findAutomationMatches(previousSnapshot, rule.matchTerms);
    const matchesWereAlreadyPresent = previousMatches.length
      && automationAlertSignature({ event, rule, matches: previousMatches }) === signature;
    if (!force && !existing && matchesWereAlreadyPresent) {
      results.push({ ruleId: rule._id, status: 'baseline', matches: matches.length });
      continue;
    }
    const delivery = await AutomationAlertDelivery.findOneAndUpdate(
      { ruleId: rule._id, eventId: event._id, signature },
      { $set: { status: 'pending', recipients: rule.recipients, matchedItems: matches, error: '', lastAttemptAt: new Date() }, $inc: { attempts: 1 } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    const sent = await sendAutomationAlertEmail({ event, rule, matches, fetchImpl });
    delivery.status = sent.status;
    delivery.providerId = sent.providerId || '';
    delivery.error = sent.error || '';
    delivery.sentAt = sent.sentAt || null;
    await delivery.save();
    results.push({ ruleId: rule._id, status: sent.status, matches: matches.length, error: sent.error || '' });
  }
  return results;
};
