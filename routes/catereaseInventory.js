import { Router } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { previewInventorySync, enableInventorySync, retryRejectedInventoryJobs } from '../utils/catereaseInventorySync.js';
import { InventorySyncSettings } from '../models/CatereaseInventorySync.js';
const router = Router();
router.use(requireAuth, requireAdmin);
router.get('/preview', async (_req, res) => {
  try { res.json(await previewInventorySync()); }
  catch (e) { res.status(e.statusCode || 502).json({ message: e.message }); }
});
router.post('/enable', async (req, res) => {
  try { await enableInventorySync(req.body.destination, req.auth?.sub); res.json({ enabled: true }); }
  catch (e) { res.status(e.statusCode || 502).json({ message: e.message }); }
});
router.post('/retry', async (_req, res) => {
  try { res.json(await retryRejectedInventoryJobs()); }
  catch (e) { res.status(e.statusCode || 502).json({ message: e.message }); }
});
router.post('/pause', async (_req, res) => {
  await InventorySyncSettings.updateOne({ _id: 'inventory' }, { $set: { enabled: false } });
  res.json({ enabled: false });
});
export default router;
