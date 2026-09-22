import express from 'express';
import NotificationState from '../models/NotificationState.js';
import { sendApiError } from '../utils/apiErrors.js';
import { normalizeNotificationStatePatch } from '../utils/notificationState.js';

const router = express.Router();

const serializeState = (row) => ({
  notificationId: String(row?.notificationId || ''),
  readAt: row?.readAt || null,
  pinned: Boolean(row?.pinned),
});

router.get('/state', async (req, res) => {
  try {
    const rows = await NotificationState.find({ userId: req.auth.userId })
      .select('notificationId readAt pinned')
      .sort({ pinned: -1, updatedAt: -1 })
      .limit(2500)
      .lean();
    return res.json({ items: rows.map(serializeState) });
  } catch (error) {
    return sendApiError(res, error, {
      context: 'Notification state load failed',
      fallbackMessage: 'Failed to load notification state',
    });
  }
});

router.patch('/state', async (req, res) => {
  try {
    const patch = normalizeNotificationStatePatch(req.body);
    const now = new Date();
    const set = { updatedAt: now };
    if (typeof patch.read === 'boolean') set.readAt = patch.read ? now : null;
    if (typeof patch.pinned === 'boolean') set.pinned = patch.pinned;
    await NotificationState.bulkWrite(patch.ids.map((notificationId) => ({
      updateOne: {
        filter: { userId: req.auth.userId, notificationId },
        update: {
          $set: set,
          $setOnInsert: { userId: req.auth.userId, notificationId, createdAt: now },
        },
        upsert: true,
      },
    })), { ordered: false });
    const rows = await NotificationState.find({
      userId: req.auth.userId,
      notificationId: { $in: patch.ids },
    }).select('notificationId readAt pinned').lean();
    return res.json({ items: rows.map(serializeState) });
  } catch (error) {
    return sendApiError(res, error, {
      context: 'Notification state update failed',
      fallbackMessage: 'Failed to update notification state',
      defaultStatus: Number(error?.statusCode) || 500,
    });
  }
});

export default router;
