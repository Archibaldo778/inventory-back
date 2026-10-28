import multer from 'multer';
import { Router } from 'express';
import { Readable } from 'stream';
import { v2 as cloudinary } from 'cloudinary';
import UniformWardrobeAsset from '../models/UniformWardrobeAsset.js';
import { isAllowedImageUpload } from '../utils/imageSignature.js';
import { cleanupManagedImageSafely } from '../utils/managedImageCleanup.js';
import { sendApiError } from '../utils/apiErrors.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 5 } });
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
    try {
      const name = String(req.body?.name || '').trim();
      const category = String(req.body?.category || '').trim();
      if (!name || name.length > 120 || !category || category.length > 60) {
        return res.status(400).json({ error: 'Name and category are required (maximum 120 and 60 characters)' });
      }
      const current = req.params.id ? await Model.findOne({ _id: req.params.id, archivedAt: null }) : null;
      if (req.params.id && !current) return res.status(404).json({ error: 'Wardrobe image not found' });
      if ((!current && !req.file) || (req.file && !isAllowedImageUpload(req.file, ['png']))) {
        return res.status(400).json({ error: 'Upload a PNG image with a transparent background' });
      }
      if (req.file) image = await uploadImage(req.file);
      const fields = { name, category, ...(image ? { image } : {}) };
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
      return sendApiError(res, error, { context: 'Wardrobe save failed', fallbackMessage: 'Could not save wardrobe image' });
    }
  };
  router.post('/', upload.single('image'), save);
  router.patch('/:id', upload.single('image'), save);
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
