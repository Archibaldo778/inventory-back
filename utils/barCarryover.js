import mongoose from 'mongoose';
import BarEvent from '../models/BarEvent.js';
import Event from '../models/Event.js';
import { buildActiveDashboardBarEventQuery } from './barDashboardSync.js';
import { isBarAccountingItem, requiresBarReturn } from './barPackoutScope.js';
import { barSeriesDayNumber, selectBarPackoutSeries } from './barSeriesCharges.js';

const finalStatuses = new Set(['submitted', 'reviewed', 'closed']);
const id = (value) => String(value?._id || value || '');
const remaining = (item) => Math.round((Number(item.returnedFullQty || 0) + Number(item.returnedOpenQty || 0)) * 10000) / 10000;

export const nextBarCarryoverEvent = (source, candidates) => {
  const day = barSeriesDayNumber(source.name);
  if (!day || source.packout?.seriesRole === 'final') return null;
  const matches = selectBarPackoutSeries(candidates, source).filter((event) => (
    barSeriesDayNumber(event.name) === day + 1 && event.eventDate > source.eventDate
  ));
  const nearest = matches.filter((event) => event.eventDate === matches[0]?.eventDate);
  if (nearest.length > 1) throw new Error('Several events match the next day. A bar admin must review the series.');
  return nearest[0] || null;
};

export const buildBarCarryoverPlan = (source, target, { at = new Date(), by = 'Bar Returns carryover' } = {}) => {
  if (!finalStatuses.has(source.status)) return { status: 'not_submitted', items: [] };
  const sourceItems = (source.items || []).filter((item) => item.included !== false && isBarAccountingItem(item) && requiresBarReturn(item));
  if (sourceItems.some((item) => !item.returnConfirmed)) throw new Error('Confirm all returns before transferring remaining stock.');
  if (sourceItems.some((item) => !Number.isFinite(remaining(item)) || Number(item.returnedFullQty || 0) < 0 || Number(item.returnedOpenQty || 0) < 0)) throw new Error('Remaining stock contains an invalid quantity.');
  const positive = sourceItems.filter((item) => remaining(item) > 0);
  const existing = (target.items || []).filter((item) => item.carryover?.sourceEventId === id(source));
  if (existing.length) {
    const matches = existing.length === positive.length && positive.every((item) => existing.some((row) => (
      row.carryover.sourceItemId === id(item) && row.carryover.quantity === remaining(item)
    )));
    if (!matches) throw new Error('Stock was already transferred and the source count changed. A bar admin must review both days.');
    return { status: 'unchanged', items: [] };
  }
  if (!positive.length) return { status: 'empty', items: [] };
  if (finalStatuses.has(target.status)) throw new Error('The next day already has a submitted report. Its quantities were not changed.');
  return { status: 'ready', items: positive.map((item) => {
    const quantity = remaining(item);
    if (!Number.isFinite(quantity)) throw new Error('Remaining stock contains an invalid quantity.');
    return {
      _id: new mongoose.Types.ObjectId(),
      beverageItemId: item.beverageItemId || null, name: item.name, section: item.section || '',
      scope: item.scope, included: true, entrySource: 'carryover',
      sentQty: quantity, sentQtyText: `${quantity} bottles carried over`, sentQtyPending: false,
      deliveredQty: quantity, returnedFullQty: 0, returnedOpenQty: 0, lostDamagedQty: 0, returnConfirmed: false,
      unitCostSnapshot: item.unitCostSnapshot || 0, bottleSizeMl: item.bottleSizeMl || null,
      notes: `Remaining stock from ${source.name} (${source.eventDate})`,
      carryover: { sourceEventId: id(source), sourceItemId: id(item), sourceEventName: source.name, sourceEventDate: source.eventDate, quantity, transferredAt: at },
      updatedBy: by, updatedAt: at,
    };
  }) };
};

export const barCarryoverWrite = (source, target, plan, { at = new Date(), by = 'Bar Returns carryover' } = {}) => ({
  filter: {
    _id: target._id, revision: target.revision ?? { $exists: false }, __v: target.__v ?? { $exists: false },
    status: { $nin: [...finalStatuses] }, 'items.carryover.sourceEventId': { $ne: id(source) },
  },
  update: {
    ...(target.status === 'draft' ? { $set: { status: 'ready' } } : {}),
    $inc: { revision: 1, __v: 1 },
    $push: {
      items: { $each: plan.items },
      audit: { $each: [{ action: 'stock_carried_over', username: by, at, details: {
        sourceEventId: id(source), sourceEventName: source.name,
        items: plan.items.map((item) => ({ sourceItemId: item.carryover.sourceItemId, targetItemId: id(item), name: item.name, quantity: item.sentQty })),
      } }], $slice: -200 },
    },
  },
});

// Submission has already been saved. A transfer problem must be visible without
// turning that successful submission into an error or resending its email.
export const carryBarReturnsForward = async (source, { at = new Date(), by = 'Bar Returns carryover' } = {}) => {
  try {
    if (!finalStatuses.has(source.status) || !barSeriesDayNumber(source.name)) return { status: 'not_applicable' };
    const end = new Date(`${source.eventDate}T12:00:00Z`);
    if (!Number.isFinite(end.getTime())) return { status: 'not_applicable' };
    end.setUTCDate(end.getUTCDate() + 14);
    const candidates = await BarEvent.find({ eventDate: { $gt: source.eventDate, $lte: end.toISOString().slice(0, 10) } })
      .select('_id linkedEventId name eventDate client').lean();
    const linkedIds = candidates.map((candidate) => candidate.linkedEventId).filter(Boolean);
    const active = linkedIds.length ? await Event.find({ ...buildActiveDashboardBarEventQuery(), _id: { $in: linkedIds } }).select('_id').lean() : [];
    const activeIds = new Set(active.map((event) => id(event)));
    const next = nextBarCarryoverEvent(source, candidates.filter((candidate) => !candidate.linkedEventId || activeIds.has(id(candidate.linkedEventId))));
    if (!next) return { status: 'no_next_day' };
    for (let attempt = 0; attempt < 3; attempt++) {
      const target = await BarEvent.findById(next._id).lean();
      if (!target) throw new Error('The next event was not found.');
      if (!nextBarCarryoverEvent(source, [target])) throw new Error('The next event no longer matches this series.');
      const plan = buildBarCarryoverPlan(source, target, { at, by });
      if (plan.status !== 'ready') return { status: plan.status, targetEventId: id(target), targetEventName: target.name };
      const { filter, update } = barCarryoverWrite(source, target, plan, { at, by });
      const saved = await BarEvent.findOneAndUpdate(filter, update, { new: true, runValidators: true });
      if (saved) return { status: 'transferred', targetEventId: id(target), targetEventName: target.name, quantity: plan.items.reduce((sum, item) => sum + item.sentQty, 0), itemCount: plan.items.length };
    }
    throw new Error('The next event changed during transfer. Please retry the transfer.');
  } catch (error) {
    console.error('Bar stock carryover failed:', error.message);
    return { status: 'failed', message: 'Report saved. Stock transfer needs review; use Retry stock transfer or contact a bar admin.' };
  }
};
