import { parseUniformAssembly, resolveUniformAssembly } from '../utils/uniformAssembly.js';
import { uniformAccessoryFields } from '../utils/uniformAccessoryFields.js';
import { randomUUID } from 'node:crypto';
import { wardrobeColorFields } from '../utils/uniformWardrobeColors.js';
import multer from 'multer';
import { Router } from 'express';
import { Readable } from 'stream';
import { v2 as cloudinary } from 'cloudinary';
import UniformWardrobeAsset from '../models/UniformWardrobeAsset.js';
import { isAllowedImageUpload } from '../utils/imageSignature.js';
import { cleanupManagedImageSafely } from '../utils/managedImageCleanup.js';
import { sendApiError } from '../utils/apiErrors.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 2, fields: 20 } });
const uploadPng = (file) => new Promise((resolve, reject) => {
  const stream = cloudinary.uploader.upload_stream(
    { folder: 'uniform-wardrobe', resource_type: 'image', format: 'png' },
    (error, result) => error ? reject(error) : resolve(result?.secure_url || '')
  );
  Readable.from(file.buffer).pipe(stream);
});
const serialize = (item) => ({ ...item.toObject(), wardrobeAsset: true });

export const createUniformWardrobeRouter = ({ Model = UniformWardrobeAsset, uploadImage = uploadPng } = {}) => {
  const router = Router();
  router.get('/', async (_req, res) => {
    try {
      const items = await Model.find({ archivedAt: null }).sort({ name: 1 });
      return res.json(items.map(serialize));
    } catch (error) {
      return sendApiError(res, error, { context: 'Wardrobe list failed', fallbackMessage: 'Could not load wardrobe' });
    }
  });
  const save = async (req, res) => {
    let image = '';
    let alternateImage = '';
    try {
      const file = req.files?.image?.[0] || req.file;
      const alternateFile = req.files?.alternateImage?.[0];
      const name = String(req.body?.name || '').trim();
      const category = String(req.body?.category || '').trim();
      if (!name || name.length > 120 || !category || category.length > 60) {
        return res.status(400).json({ error: 'Name and category are required (maximum 120 and 60 characters)' });
      }
      const current = req.params.id ? await Model.findOne({ _id: req.params.id, archivedAt: null }) : null;
      if (req.params.id && !current) return res.status(404).json({ error: 'Wardrobe image not found' });
      if ((!current && !file) || (file && !isAllowedImageUpload(file, ['png']))) {
        return res.status(400).json({ error: 'Upload a PNG image with a transparent background' });
      }
      let accessoryFields;
      try { accessoryFields = uniformAccessoryFields(req.body || {}, current); }
      catch (error) { return res.status(400).json({ error: error.message }); }
      let assembly;
      if (req.body?.assembly !== undefined) {
        try {
          if ((accessoryFields.assetType || current?.assetType || 'set') !== 'set') throw new Error('Only sets can contain a composition');
          const choices = parseUniformAssembly(req.body.assembly);
          const parts = await Model.find({ _id: { $in: choices.map((entry) => entry.modelId) }, archivedAt: null });
          assembly = resolveUniformAssembly(choices, parts, accessoryFields.templateKey ?? current?.templateKey);
          if (!file) throw new Error('Upload the preview for this composition');
        } catch (error) { return res.status(400).json({ error: error.message }); }
      }
      let colorFields = {};
      if (req.body?.colorName !== undefined) {
        try { colorFields = wardrobeColorFields(req.body); }
        catch (error) { return res.status(400).json({ error: error.message }); }
        if ((current?.variants || []).some((variant) => variant.colorKey === colorFields.colorKey)) {
          return res.status(409).json({ error: 'This model already has that color' });
        }
      }
      const tieStyle = req.body?.tieStyle || current?.tieStyle;
      const defaultLook = req.body?.defaultLook || current?.defaultLook || 'base';
      const removeAlternate = req.body?.removeAlternate === 'true';
      if ((tieStyle && !['tie', 'no-tie'].includes(tieStyle)) || !['base', 'alternate'].includes(defaultLook)
        || (alternateFile && !isAllowedImageUpload(alternateFile, ['png']))
        || ((alternateFile || (!removeAlternate && current?.alternateImage)) && !tieStyle)
        || (defaultLook === 'alternate' && (removeAlternate || (!alternateFile && !current?.alternateImage)))) {
        return res.status(400).json({ error: 'Choose a valid Tie / No tie option and upload a PNG for the alternate look' });
      }
      if (file) image = await uploadImage(file);
      if (alternateFile) alternateImage = await uploadImage(alternateFile);
      const { colorKey: _colorKey, ...baseColor } = colorFields;
      const fields = { name, category, ...accessoryFields, ...(assembly ? { assembly } : {}), ...(tieStyle ? { tieStyle } : {}), ...(req.body?.defaultLook ? { defaultLook } : {}), ...(alternateImage ? { alternateImage } : removeAlternate ? { alternateImage: '' } : {}), ...baseColor, ...(image ? { image } : {}) };
      let item;
      if (current) {
        Object.assign(current, fields);
        await current.save();
        item = current;
      } else {
        item = await Model.create(fields);
      }
      // Old PNGs remain available to saved boards after replacement or archive.
      return res.status(current ? 200 : 201).json(serialize(item));
    } catch (error) {
      if (image) await cleanupManagedImageSafely(image, 'orphaned wardrobe PNG');
      if (alternateImage) await cleanupManagedImageSafely(alternateImage, 'orphaned wardrobe alternate PNG');
      return sendApiError(res, error, { context: 'Wardrobe save failed', fallbackMessage: 'Could not save wardrobe image' });
    }
  };
  router.post('/', upload.fields([{ name: 'image', maxCount: 1 }, { name: 'alternateImage', maxCount: 1 }]), save);
  router.patch('/:id', upload.fields([{ name: 'image', maxCount: 1 }, { name: 'alternateImage', maxCount: 1 }]), save);
  const saveColor = async (req, res) => {
    let image = '';
    try {
      let fields;
      try { fields = wardrobeColorFields(req.body); }
      catch (error) { return res.status(400).json({ error: error.message }); }
      const current = await Model.findOne({ _id: req.params.id, archivedAt: null });
      if (!current) return res.status(404).json({ error: 'Model not found' });
      const existing = (current.variants || []).find((variant) => variant.id === req.params.variantId);
      if (req.params.variantId && !existing) return res.status(404).json({ error: 'Color not found' });
      if (String(current.colorName || 'Original').toLowerCase() === fields.colorKey
        || (current.variants || []).some((variant) => variant.id !== existing?.id && variant.colorKey === fields.colorKey)) {
        return res.status(409).json({ error: 'This model already has that color' });
      }
      if ((!existing && !req.file) || (req.file && !isAllowedImageUpload(req.file, ['png']))) {
        return res.status(400).json({ error: 'Upload the PNG for this color' });
      }
      if (req.file) image = await uploadImage(req.file);
      const variant = { ...fields, id: existing?.id || randomUUID(), image: image || existing?.image };
      const filter = { _id: req.params.id, archivedAt: null };
      if (existing) filter['variants.id'] = existing.id;
      else filter['variants.colorKey'] = { $ne: fields.colorKey };
      const update = existing ? { $set: { 'variants.$': variant } } : { $push: { variants: variant } };
      const updated = await Model.findOneAndUpdate(filter, update, { new: true, runValidators: true });
      if (!updated) {
        if (image) await cleanupManagedImageSafely(image, 'conflicting wardrobe color');
        return res.status(409).json({ error: 'Model changed. Reload and try again.' });
      }
      return res.status(existing ? 200 : 201).json(serialize(updated));
    } catch (error) {
      if (image) await cleanupManagedImageSafely(image, 'orphaned wardrobe color');
      return sendApiError(res, error, { context: 'Wardrobe color save failed', fallbackMessage: 'Could not save color' });
    }
  };
  router.post('/:id/colors', upload.single('image'), saveColor);
  router.patch('/:id/colors/:variantId', upload.single('image'), saveColor);
  router.delete('/:id/colors/:variantId', async (req, res) => {
    try {
      const updated = await Model.findOneAndUpdate(
        { _id: req.params.id, archivedAt: null, 'variants.id': req.params.variantId },
        { $pull: { variants: { id: req.params.variantId } } }, { new: true }
      );
      if (!updated) return res.status(404).json({ error: 'Color not found' });
      return res.json(serialize(updated));
    } catch (error) {
      return sendApiError(res, error, { context: 'Wardrobe color removal failed', fallbackMessage: 'Could not remove color' });
    }
  });
  router.delete('/:id', async (req, res) => {
    try {
      const item = await Model.findOneAndUpdate({ _id: req.params.id, archivedAt: null }, { $set: { archivedAt: new Date() } });
      if (!item) return res.status(404).json({ error: 'Wardrobe image not found' });
      return res.json({ ok: true });
    } catch (error) {
      return sendApiError(res, error, { context: 'Wardrobe archive failed', fallbackMessage: 'Could not remove wardrobe image' });
    }
  });
  return router;
};
export default createUniformWardrobeRouter();
