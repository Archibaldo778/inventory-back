import { Router } from 'express';
import NowstaScheduleEntry from '../models/NowstaScheduleEntry.js';
import NowstaDepartment from '../models/NowstaDepartment.js';
import User from '../models/Users.js';
import { sendApiError } from '../utils/apiErrors.js';

const router = Router();
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const cleanList = (value, { maxItems = 100, maxLength = 160 } = {}) => [...new Set(
  (Array.isArray(value) ? value : [])
    .map((item) => String(item || '').replace(/\s+/g, ' ').trim().slice(0, maxLength))
    .filter(Boolean)
)].slice(0, maxItems);

const serializePreferences = (source = {}) => ({
  initialized: Boolean(source?.initialized),
  departments: cleanList(source?.departments),
  entryTypes: cleanList(source?.entryTypes, { maxItems: 20, maxLength: 80 }),
  staffingProgress: cleanList(source?.staffingProgress, { maxItems: 20, maxLength: 80 }),
  showArchived: Boolean(source?.showArchived),
  updatedAt: source?.updatedAt || null,
});

const defaultPreferences = async () => {
  const departments = await NowstaScheduleEntry.distinct('departmentName', {
    defaultVisible: true,
    archived: { $ne: true },
  });
  return {
    initialized: false,
    departments: cleanList(departments),
    entryTypes: ['event'],
    staffingProgress: ['fully_staffed', 'incomplete', 'declined', 'empty'],
    showArchived: false,
    updatedAt: null,
  };
};

router.get('/preferences', async (req, res) => {
  try {
    const user = await User.findById(req.auth?.userId).select('schedulePreferences').lean();
    if (!user) return res.status(404).json({ message: 'User not found' });
    const stored = serializePreferences(user.schedulePreferences);
    if (stored.initialized) return res.json(stored);
    return res.json(await defaultPreferences());
  } catch (error) {
    return sendApiError(res, error, {
      context: 'Nowsta schedule preferences failed',
      fallbackMessage: 'Unable to load schedule preferences',
    });
  }
});

router.put('/preferences', async (req, res) => {
  try {
    const source = req.body && typeof req.body === 'object' ? req.body : {};
    const preferences = {
      initialized: true,
      departments: cleanList(source.departments),
      entryTypes: cleanList(source.entryTypes, { maxItems: 20, maxLength: 80 }),
      staffingProgress: cleanList(source.staffingProgress, { maxItems: 20, maxLength: 80 }),
      showArchived: Boolean(source.showArchived),
      updatedAt: new Date(),
    };
    const user = await User.findByIdAndUpdate(
      req.auth?.userId,
      { $set: { schedulePreferences: preferences } },
      { new: true, runValidators: true }
    ).select('schedulePreferences').lean();
    if (!user) return res.status(404).json({ message: 'User not found' });
    return res.json(serializePreferences(user.schedulePreferences));
  } catch (error) {
    return sendApiError(res, error, {
      context: 'Nowsta schedule preferences update failed',
      fallbackMessage: 'Unable to save schedule preferences',
    });
  }
});

router.get('/', async (req, res) => {
  try {
    const from = String(req.query?.from || '').trim();
    const to = String(req.query?.to || '').trim();
    if (!DATE_PATTERN.test(from) || !DATE_PATTERN.test(to) || from > to) {
      return res.status(400).json({ message: 'Valid schedule from and to dates are required' });
    }
    const start = new Date(`${from}T12:00:00Z`);
    const end = new Date(`${to}T12:00:00Z`);
    if (((end - start) / 86_400_000) > 93) {
      return res.status(400).json({ message: 'Schedule range cannot exceed 93 days' });
    }

    const items = await NowstaScheduleEntry.find({ date: { $gte: from, $lte: to } })
      .sort({ date: 1, startsAt: 1, title: 1 })
      .lean();
    const [catalogDepartments, entryDepartments, entryTypes] = await Promise.all([
      NowstaDepartment.distinct('name', { archived: { $ne: true } }),
      NowstaScheduleEntry.distinct('departmentName'),
      NowstaScheduleEntry.distinct('entryType'),
    ]);
    return res.json({
      items,
      filters: {
        departments: cleanList([...catalogDepartments, ...entryDepartments])
          .sort((left, right) => left.localeCompare(right)),
        entryTypes: cleanList(entryTypes, { maxItems: 30, maxLength: 80 }).sort(),
        staffingProgress: ['fully_staffed', 'incomplete', 'declined', 'empty'],
      },
    });
  } catch (error) {
    return sendApiError(res, error, {
      context: 'Nowsta schedule list failed',
      fallbackMessage: 'Unable to load the company schedule',
    });
  }
});

export default router;
