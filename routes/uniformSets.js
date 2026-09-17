import { Router } from 'express';
import UniformSet from '../models/UniformSet.js';
import { sendApiError } from '../utils/apiErrors.js';

const router = Router();

const cleanText = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

const toNumber = (value, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const normalizeMembers = (value) => (Array.isArray(value) ? value : [])
  .map((entry, index) => {
    const src = cleanText(entry?.src);
    if (!src) return null;
    return {
      productId: entry?.productId || null,
      name: cleanText(entry?.name),
      src,
      offsetX: toNumber(entry?.offsetX),
      offsetY: toNumber(entry?.offsetY),
      width: toNumber(entry?.width),
      height: toNumber(entry?.height),
      rotation: toNumber(entry?.rotation),
      flipX: Boolean(entry?.flipX),
      flipY: Boolean(entry?.flipY),
      order: toNumber(entry?.order, index),
    };
  })
  .filter(Boolean)
  .slice(0, 50);

router.get('/', async (_req, res) => {
  try {
    const sets = await UniformSet.find({}).sort({ name: 1 });
    return res.json(sets);
  } catch (error) {
    return sendApiError(res, error, { context: 'Uniform set list failed', fallbackMessage: 'Failed to list sets' });
  }
});

router.post('/', async (req, res) => {
  try {
    const name = cleanText(req.body?.name);
    const members = normalizeMembers(req.body?.members);
    if (!name) return res.status(400).json({ error: 'Name is required' });
    if (!members.length) return res.status(400).json({ error: 'At least one member is required' });
    const set = await UniformSet.create({
      name,
      anchorWidth: toNumber(req.body?.anchorWidth),
      anchorHeight: toNumber(req.body?.anchorHeight),
      members,
      createdBy: cleanText(req.body?.createdBy),
    });
    return res.status(201).json(set);
  } catch (error) {
    return sendApiError(res, error, { context: 'Uniform set creation failed', fallbackMessage: 'Failed to save set' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const set = await UniformSet.findByIdAndDelete(req.params.id);
    if (!set) return res.status(404).json({ error: 'Set not found' });
    return res.json({ ok: true });
  } catch (error) {
    return sendApiError(res, error, { context: 'Uniform set deletion failed', fallbackMessage: 'Failed to delete set' });
  }
});

export default router;
