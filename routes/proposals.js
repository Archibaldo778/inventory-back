import { Router } from 'express';
import mongoose from 'mongoose';
import Proposal, { PROPOSAL_SOURCES, PROPOSAL_STATUSES } from '../models/Proposal.js';

const router = Router();

const STATUS_SET = new Set(PROPOSAL_STATUSES);
const SOURCE_SET = new Set(PROPOSAL_SOURCES);

const trimStr = (value) => {
  if (value === undefined || value === null) return '';
  return String(value).trim();
};

const parseBoolean = (value, fallback = false) => {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
};

const parseStringArray = (value) => {
  if (value === undefined || value === null || value === '') return [];
  if (Array.isArray(value)) {
    return value.map((entry) => trimStr(entry)).filter(Boolean);
  }
  const str = trimStr(value);
  if (!str) return [];
  if (str.startsWith('[') && str.endsWith(']')) {
    try {
      const parsed = JSON.parse(str);
      if (Array.isArray(parsed)) {
        return parsed.map((entry) => trimStr(entry)).filter(Boolean);
      }
    } catch {
      return [];
    }
  }
  return str
    .split(',')
    .map((entry) => trimStr(entry))
    .filter(Boolean);
};

const parseNumber = (value, fallback = 0) => {
  if (value === undefined || value === null || value === '') return fallback;
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return num;
};

const parseStatus = (value, fallback = undefined) => {
  const normalized = trimStr(value).toLowerCase();
  if (!normalized) return fallback;
  if (!STATUS_SET.has(normalized)) return fallback;
  return normalized;
};

const parseSourceType = (value, fallback = 'custom') => {
  const normalized = trimStr(value).toLowerCase();
  if (!normalized) return fallback;
  if (!SOURCE_SET.has(normalized)) return fallback;
  return normalized;
};

const parseObject = (value) => {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string') return {};
  const trimmed = value.trim();
  if (!trimmed) return {};
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const parsePageNumbers = (value) => {
  if (value === undefined || value === null || value === '') return [];
  const arr = Array.isArray(value) ? value : String(value).split(',');
  const unique = new Set();
  arr.forEach((entry) => {
    const parsed = Number(entry);
    if (!Number.isFinite(parsed)) return;
    const rounded = Math.trunc(parsed);
    if (rounded < 1) return;
    unique.add(rounded);
  });
  return Array.from(unique).sort((a, b) => a - b);
};

const buildProposalBasePayload = (body = {}, { partial = false } = {}) => {
  const payload = {};

  if (!partial || body.title !== undefined || body.name !== undefined) {
    const title = trimStr(body.title ?? body.name);
    if (!partial && !title) throw new Error('title is required');
    if (title) payload.title = title;
    if (partial && !title && (body.title !== undefined || body.name !== undefined)) {
      throw new Error('title is required');
    }
  }

  if (body.eventId !== undefined) {
    const eventId = trimStr(body.eventId);
    if (!eventId) {
      payload.eventId = null;
    } else if (mongoose.Types.ObjectId.isValid(eventId)) {
      payload.eventId = eventId;
    } else {
      throw new Error('invalid eventId');
    }
  }

  if (body.eventTitle !== undefined || body.eventName !== undefined) {
    payload.eventTitle = trimStr(body.eventTitle ?? body.eventName);
  }

  if (body.client !== undefined) payload.client = trimStr(body.client);
  if (body.notes !== undefined) payload.notes = trimStr(body.notes);
  if (body.createdBy !== undefined) payload.createdBy = trimStr(body.createdBy);
  if (body.updatedBy !== undefined) payload.updatedBy = trimStr(body.updatedBy);

  if (body.status !== undefined) {
    const status = parseStatus(body.status);
    if (!status) throw new Error('invalid status');
    payload.status = status;
  }

  if (body.selectedTemplatePages !== undefined || body.templatePages !== undefined) {
    payload.selectedTemplatePages = parsePageNumbers(body.selectedTemplatePages ?? body.templatePages);
  }

  if (body.meta !== undefined) {
    payload.meta = parseObject(body.meta);
  }

  return payload;
};

const buildProposalItemPayload = (input = {}, { partial = false } = {}) => {
  const payload = {};

  if (!partial || input.name !== undefined || input.title !== undefined) {
    const name = trimStr(input.name ?? input.title);
    if (!partial && !name) throw new Error('item name is required');
    if (name) payload.name = name;
    if (partial && !name && (input.name !== undefined || input.title !== undefined)) {
      throw new Error('item name is required');
    }
  }

  if (input.sourceType !== undefined) payload.sourceType = parseSourceType(input.sourceType);
  if (input.sourceId !== undefined) payload.sourceId = trimStr(input.sourceId);
  if (input.description !== undefined) payload.description = trimStr(input.description);
  if (input.image !== undefined) payload.image = trimStr(input.image);
  if (input.sectionCategory !== undefined || input.section !== undefined) payload.sectionCategory = trimStr(input.sectionCategory ?? input.section);
  if (input.subCategory !== undefined || input.subcategory !== undefined || input.sub_category !== undefined) {
    payload.subCategory = trimStr(input.subCategory ?? input.subcategory ?? input.sub_category);
  }
  if (input.guestLimit !== undefined || input.guest_limit !== undefined) {
    payload.guestLimit = trimStr(input.guestLimit ?? input.guest_limit);
  }
  if (input.unitPrice !== undefined || input.unit_price !== undefined) {
    payload.unitPrice = parseNumber(input.unitPrice ?? input.unit_price, null);
  }
  if (input.priceUnit !== undefined || input.price_unit !== undefined) {
    payload.priceUnit = trimStr(input.priceUnit ?? input.price_unit).toLowerCase() || 'flat';
  }
  if (input.pricingNote !== undefined || input.pricing_note !== undefined) {
    payload.pricingNote = trimStr(input.pricingNote ?? input.pricing_note);
  }
  if (input.allSeason !== undefined || input.all_season !== undefined) {
    payload.allSeason = parseBoolean(input.allSeason ?? input.all_season);
  }
  if (input.qty !== undefined) payload.qty = Math.max(0, parseNumber(input.qty, 1));
  if (input.note !== undefined) payload.note = trimStr(input.note);
  if (input.position !== undefined) payload.position = Math.max(0, parseNumber(input.position, 0));
  if (input.dietary !== undefined) payload.dietary = parseStringArray(input.dietary);
  if (input.categories !== undefined) payload.categories = parseStringArray(input.categories);
  if (input.snapshotMeta !== undefined || input.snapshot_meta !== undefined) {
    payload.snapshotMeta = parseObject(input.snapshotMeta ?? input.snapshot_meta);
  }

  return payload;
};

const serializeProposal = (doc) => {
  if (!doc) return null;
  const obj = typeof doc.toObject === 'function' ? doc.toObject() : doc;
  return {
    ...obj,
    itemCount: Array.isArray(obj.items) ? obj.items.length : 0,
  };
};

router.get('/', async (req, res) => {
  try {
    const query = {};
    const status = parseStatus(req.query.status);
    if (status) query.status = status;

    const eventId = trimStr(req.query.eventId);
    if (eventId) {
      if (!mongoose.Types.ObjectId.isValid(eventId)) {
        return res.status(400).json({ error: 'invalid eventId' });
      }
      query.eventId = eventId;
    }

    const search = trimStr(req.query.q);
    if (search) {
      const regex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      query.$or = [{ title: regex }, { eventTitle: regex }, { client: regex }];
    }

    const limitRaw = parseNumber(req.query.limit, 100);
    const limit = Math.min(Math.max(1, Math.trunc(limitRaw)), 300);

    const items = await Proposal.find(query).sort({ updatedAt: -1 }).limit(limit);
    res.json(items.map(serializeProposal));
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to list proposals' });
  }
});

router.post('/', async (req, res) => {
  try {
    const payload = buildProposalBasePayload(req.body || {}, { partial: false });
    const items = Array.isArray(req.body?.items)
      ? req.body.items.map((item) => buildProposalItemPayload(item, { partial: false }))
      : [];
    payload.items = items;
    if (!payload.status) payload.status = 'draft';

    const created = await Proposal.create(payload);
    res.status(201).json(serializeProposal(created));
  } catch (err) {
    res.status(400).json({ error: err.message || 'Failed to create proposal' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const doc = await Proposal.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Not found' });
    res.json(serializeProposal(doc));
  } catch (err) {
    res.status(400).json({ error: err.message || 'Failed to load proposal' });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const updates = buildProposalBasePayload(req.body || {}, { partial: true });
    if (req.body?.lastExportedAt !== undefined) {
      const parsed = req.body.lastExportedAt ? new Date(req.body.lastExportedAt) : null;
      updates.lastExportedAt = parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
    }
    const updated = await Proposal.findByIdAndUpdate(req.params.id, updates, { new: true });
    if (!updated) return res.status(404).json({ error: 'Not found' });
    res.json(serializeProposal(updated));
  } catch (err) {
    res.status(400).json({ error: err.message || 'Failed to update proposal' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const deleted = await Proposal.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Failed to delete proposal' });
  }
});

router.post('/:id/duplicate', async (req, res) => {
  try {
    const existing = await Proposal.findById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Not found' });

    const clone = existing.toObject();
    delete clone._id;
    delete clone.createdAt;
    delete clone.updatedAt;
    clone.title = `${clone.title || 'Proposal'} (copy)`;
    clone.status = 'draft';
    clone.lastExportedAt = null;
    if (Array.isArray(clone.items)) {
      clone.items = clone.items.map((item) => {
        const next = { ...item };
        delete next._id;
        return next;
      });
    }

    const created = await Proposal.create(clone);
    res.status(201).json(serializeProposal(created));
  } catch (err) {
    res.status(400).json({ error: err.message || 'Failed to duplicate proposal' });
  }
});

router.post('/:id/items', async (req, res) => {
  try {
    const itemPayload = buildProposalItemPayload(req.body || {}, { partial: false });
    const proposal = await Proposal.findById(req.params.id);
    if (!proposal) return res.status(404).json({ error: 'Not found' });

    proposal.items.push(itemPayload);
    await proposal.save();
    const createdItem = proposal.items[proposal.items.length - 1];
    res.status(201).json(createdItem);
  } catch (err) {
    res.status(400).json({ error: err.message || 'Failed to add proposal item' });
  }
});

router.patch('/:id/items/:itemId', async (req, res) => {
  try {
    const updates = buildProposalItemPayload(req.body || {}, { partial: true });
    const proposal = await Proposal.findById(req.params.id);
    if (!proposal) return res.status(404).json({ error: 'Not found' });

    const item = proposal.items.id(req.params.itemId);
    if (!item) return res.status(404).json({ error: 'Item not found' });

    Object.entries(updates).forEach(([key, value]) => {
      item[key] = value;
    });

    await proposal.save();
    res.json(item);
  } catch (err) {
    res.status(400).json({ error: err.message || 'Failed to update proposal item' });
  }
});

router.delete('/:id/items/:itemId', async (req, res) => {
  try {
    const proposal = await Proposal.findById(req.params.id);
    if (!proposal) return res.status(404).json({ error: 'Not found' });
    const item = proposal.items.id(req.params.itemId);
    if (!item) return res.status(404).json({ error: 'Item not found' });
    item.deleteOne();
    await proposal.save();
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Failed to delete proposal item' });
  }
});

export default router;
