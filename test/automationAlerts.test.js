import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LEGACY_PO_SCANNER_RECIPIENTS,
  LEGACY_PO_SCANNER_TERMS,
  automationAlertLegacySignature,
  findAutomationMatches,
  processAutomationAlerts,
  sendAutomationAlertEmail,
} from '../utils/automationAlerts.js';

test('migrated PO Scanner retains all Power Automate products and recipients', () => {
  assert.equal(LEGACY_PO_SCANNER_TERMS.length, 15);
  assert.deepEqual(LEGACY_PO_SCANNER_RECIPIENTS, [
    'ivan@ocnyc.com', 'iurie@ocnyc.com', 'vladimir@ocnyc.com', 'opsinventory@ocnyc.com',
  ]);
});

test('automation alert matches Pack Out products without unrelated partial matches', () => {
  const matches = findAutomationMatches({ packOut: [
    { itemName: 'White Setup Gloves - Large', quantity: 4, zoneName: 'Loading' },
    { itemName: 'Commercial Steamer', quantity: 1, zoneName: 'Kitchen' },
    { itemName: 'Milk Steamer', quantity: 1, zoneName: 'Coffee Equipment' },
    { itemName: 'White dinner plates', quantity: 50 },
  ] }, LEGACY_PO_SCANNER_TERMS);
  assert.deepEqual(matches.map(({ itemName }) => itemName), ['White Setup Gloves - Large', 'Commercial Steamer']);
});

test('automation email sends only configured event and Pack Out details', async () => {
  const previousKey = process.env.RESEND_API_KEY;
  const previousAlertFrom = process.env.PACKOUT_ALERT_FROM;
  const previousReportFrom = process.env.EVENT_REPORT_FROM;
  process.env.RESEND_API_KEY = 'test-key';
  process.env.PACKOUT_ALERT_FROM = 'OCC Staffing & Service <reports@reports.occdecks.com>';
  process.env.EVENT_REPORT_FROM = 'OCC Staffing & Service <reports@reports.occdecks.com>';
  let request;
  try {
    const result = await sendAutomationAlertEmail({
      event: { title: 'Prada Dinner', date: '2026-10-02' },
      rule: { name: 'Kitchen equipment', department: 'Kitchen', subjectPrefix: 'ACTION REQUIRED', recipients: ['chef@ocnyc.com'] },
      matches: [{ itemName: 'Heat Lamp', quantity: 2, unit: 'ea', zone: 'Kitchen' }],
      fetchImpl: async (url, options) => {
        request = { url, body: JSON.parse(options.body) };
        return { ok: true, json: async () => ({ id: 'email-1' }) };
      },
    });
    assert.equal(result.status, 'sent');
    assert.equal(request.body.from, 'OCC Operations <reports@reports.occdecks.com>');
    assert.deepEqual(request.body.to, ['chef@ocnyc.com']);
    assert.match(request.body.subject, /Prada Dinner/);
    assert.match(request.body.text, /Heat Lamp · Qty 2 ea · Kitchen/);
  } finally {
    if (previousKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = previousKey;
    if (previousAlertFrom === undefined) delete process.env.PACKOUT_ALERT_FROM;
    else process.env.PACKOUT_ALERT_FROM = previousAlertFrom;
    if (previousReportFrom === undefined) delete process.env.EVENT_REPORT_FROM;
    else process.env.EVENT_REPORT_FROM = previousReportFrom;
  }
});

test('parallel forced alert processing atomically claims one delivery', async () => {
  const previousKey = process.env.RESEND_API_KEY;
  process.env.RESEND_API_KEY = 'test-key';
  const rule = {
    _id: 'rule-1', name: 'Operations equipment', department: 'Operations',
    subjectPrefix: 'ACTION REQUIRED', recipients: ['ops@ocnyc.com'], matchTerms: ['Heat Lamp'],
  };
  const ruleModel = { find: () => ({ lean: async () => [rule] }) };
  let storedDelivery = null;
  const asStoredData = (value) => ({
    ruleId: value.ruleId,
    eventId: value.eventId,
    signature: value.signature,
    signatureVersion: value.signatureVersion,
    status: value.status,
    recipients: value.recipients,
    matchedItems: value.matchedItems,
    error: value.error,
    lastAttemptAt: value.lastAttemptAt,
    attempts: value.attempts,
    providerId: value.providerId,
    sentAt: value.sentAt,
  });
  const deliveryModel = {
    findOne: () => ({ lean: async () => (storedDelivery ? asStoredData(storedDelivery) : null) }),
    findOneAndUpdate: async () => null,
    create: async (data) => {
      await Promise.resolve();
      if (storedDelivery) {
        const duplicate = new Error('duplicate delivery');
        duplicate.code = 11000;
        throw duplicate;
      }
      storedDelivery = {
        ...data,
        async save() {
          storedDelivery = this;
          return this;
        },
      };
      return storedDelivery;
    },
  };
  let fetchCount = 0;
  try {
    const input = {
      event: { _id: 'event-1', title: 'Test Event', date: '2026-09-26' },
      snapshot: { checksum: 'new', packOut: [{ itemName: 'Heat Lamp', quantity: 2 }] },
      previousSnapshot: null,
      previousChecksum: 'old',
      force: true,
      ruleModel,
      deliveryModel,
      ensureDefaultRule: async () => {},
      fetchImpl: async () => {
        fetchCount += 1;
        return { ok: true, json: async () => ({ id: `email-${fetchCount}` }) };
      },
    };
    const outcomes = await Promise.all([
      processAutomationAlerts(input),
      processAutomationAlerts(input),
    ]);
    assert.equal(fetchCount, 1);
    assert.deepEqual(outcomes.flat().map(({ status }) => status).sort(), ['pending', 'sent']);
  } finally {
    if (previousKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = previousKey;
  }
});

test('renaming or rescheduling an event sends one updated alert and then stays idempotent', async () => {
  const previousKey = process.env.RESEND_API_KEY;
  process.env.RESEND_API_KEY = 'test-key';
  const rule = {
    _id: 'rule-1', name: 'Operations equipment', department: 'Operations',
    subjectPrefix: 'ACTION REQUIRED', recipients: ['ops@ocnyc.com'], matchTerms: ['Heat Lamp'],
  };
  const ruleModel = { find: () => ({ lean: async () => [rule] }) };
  const deliveries = [];
  const matchesQuery = (delivery, query) => Object.entries(query).every(([key, value]) => (
    String(delivery?.[key] || '') === String(value || '')
  ));
  const deliveryModel = {
    findOne: (query) => ({
      lean: async () => deliveries.find((delivery) => matchesQuery(delivery, query)) || null,
    }),
    findOneAndUpdate: async () => null,
    create: async (data) => {
      if (deliveries.some((delivery) => (
        String(delivery.ruleId) === String(data.ruleId)
        && String(delivery.eventId) === String(data.eventId)
        && delivery.signature === data.signature
      ))) {
        const duplicate = new Error('duplicate delivery');
        duplicate.code = 11000;
        throw duplicate;
      }
      const delivery = {
        ...data,
        async save() { return this; },
      };
      deliveries.push(delivery);
      return delivery;
    },
  };
  let fetchCount = 0;
  const fetchImpl = async () => {
    fetchCount += 1;
    return { ok: true, json: async () => ({ id: `email-${fetchCount}` }) };
  };
  const snapshot = { checksum: 'same-items', packOut: [{ itemName: 'Heat Lamp', quantity: 2 }] };
  const baseInput = {
    snapshot,
    previousSnapshot: snapshot,
    previousChecksum: snapshot.checksum,
    ruleModel,
    deliveryModel,
    ensureDefaultRule: async () => {},
    fetchImpl,
  };

  try {
    const first = await processAutomationAlerts({
      ...baseInput,
      event: { _id: 'event-1', title: 'Original Event', date: '2026-09-26' },
      force: true,
    });
    const updated = await processAutomationAlerts({
      ...baseInput,
      event: { _id: 'event-1', title: 'Renamed Event', date: '2026-09-27' },
    });
    const repeated = await processAutomationAlerts({
      ...baseInput,
      event: { _id: 'event-1', title: 'Renamed Event', date: '2026-09-27' },
    });

    assert.equal(first[0].status, 'sent');
    assert.equal(updated[0].status, 'sent');
    assert.equal(repeated[0].status, 'already_sent');
    assert.equal(fetchCount, 2);
    assert.equal(deliveries.length, 2);
  } finally {
    if (previousKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = previousKey;
  }
});

test('a delivery created with the legacy signature is not resent after deployment', async () => {
  const rule = {
    _id: 'rule-1', name: 'Operations equipment', department: 'Operations',
    recipients: ['ops@ocnyc.com'], matchTerms: ['Heat Lamp'],
  };
  const event = { _id: 'event-1', title: 'Renamed after legacy send', date: '2026-09-27' };
  const snapshot = { checksum: 'same-items', packOut: [{ itemName: 'Heat Lamp', quantity: 2 }] };
  const matches = findAutomationMatches(snapshot, rule.matchTerms);
  const legacyDelivery = {
    ruleId: rule._id,
    eventId: event._id,
    signature: automationAlertLegacySignature({ event, rule, matches }),
    status: 'sent',
  };
  const deliveryModel = {
    findOne: (query) => ({
      lean: async () => Object.entries(query).every(([key, value]) => String(legacyDelivery[key]) === String(value))
        ? legacyDelivery
        : null,
    }),
  };
  let fetchCount = 0;

  const result = await processAutomationAlerts({
    event,
    snapshot,
    previousSnapshot: snapshot,
    previousChecksum: snapshot.checksum,
    ruleModel: { find: () => ({ lean: async () => [rule] }) },
    deliveryModel,
    ensureDefaultRule: async () => {},
    fetchImpl: async () => {
      fetchCount += 1;
      return { ok: true, json: async () => ({ id: 'must-not-send' }) };
    },
  });

  assert.equal(result[0].status, 'already_sent');
  assert.equal(fetchCount, 0);
});
