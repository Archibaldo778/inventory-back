import { Router } from 'express';
import mongoose from 'mongoose';
import NowstaScheduleEntry from '../models/NowstaScheduleEntry.js';
import OperationsPerson from '../models/OperationsPerson.js';
import Staff from '../models/Staff.js';
import { matchStaffByName, normalizePersonName, staffFullName } from '../utils/operationsRoster.js';
import { sendApiError } from '../utils/apiErrors.js';

const router = Router();
const clean = (value, maxLength = 500) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
const cleanList = (value, maxItems = 20) => [...new Set(
  (Array.isArray(value) ? value : []).map((item) => clean(item, 160)).filter(Boolean)
)].slice(0, maxItems);

router.get('/people', async (req, res) => {
  try {
    const includeInactive = String(req.query?.includeInactive || '') === 'true';
    const [people, staff] = await Promise.all([
      OperationsPerson.find(includeInactive ? {} : { active: true }).sort({ fullName: 1 }).lean(),
      Staff.find({}).select('firstName lastName positions active photo').lean(),
    ]);
    const staffNames = new Set(staff.map((person) => normalizePersonName(staffFullName(person))).filter(Boolean));
    return res.json(people.filter((person) => !staffNames.has(normalizePersonName(person.fullName))));
  } catch (error) {
    return sendApiError(res, error, { context: 'Operations people list failed', fallbackMessage: 'Unable to load operations people' });
  }
});

router.patch('/people/:id', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Invalid operations person id' });
    const source = req.body && typeof req.body === 'object' ? req.body : {};
    const updates = {};
    if (Object.prototype.hasOwnProperty.call(source, 'roles')) updates.roles = cleanList(source.roles);
    if (Object.prototype.hasOwnProperty.call(source, 'note')) updates.note = clean(source.note, 2_000);
    if (Object.prototype.hasOwnProperty.call(source, 'email')) updates.email = clean(source.email, 240).toLowerCase();
    if (Object.prototype.hasOwnProperty.call(source, 'phone')) updates.phone = clean(source.phone, 80);
    if (Object.prototype.hasOwnProperty.call(source, 'active')) updates.active = Boolean(source.active);
    const person = await OperationsPerson.findByIdAndUpdate(req.params.id, { $set: updates }, { new: true, runValidators: true });
    if (!person) return res.status(404).json({ message: 'Operations person not found' });
    return res.json(person);
  } catch (error) {
    return sendApiError(res, error, { context: 'Operations person update failed', fallbackMessage: 'Unable to update operations person' });
  }
});

router.get('/events/:nowstaEventId', async (req, res) => {
  try {
    const nowstaEventId = clean(req.params.nowstaEventId, 120);
    const entry = await NowstaScheduleEntry.findOne({ nowstaEventId }).lean();
    if (!entry) return res.status(404).json({ message: 'Operations event not found' });
    const workers = (entry.shifts || []).flatMap((shift) => (shift.workers || []).map((worker) => ({ worker, shift })));
    const workerIds = workers.map(({ worker }) => clean(worker.companyUserId, 120)).filter(Boolean);
    const [staff, operationsPeople] = await Promise.all([
      Staff.find({}).select('firstName lastName positions active photo').lean(),
      OperationsPerson.find({ nowstaCompanyUserId: { $in: workerIds } })
        .select('nowstaCompanyUserId fullName firstName lastName email phone roles active')
        .lean(),
    ]);
    const operationsByNowstaId = new Map(operationsPeople.map((person) => [person.nowstaCompanyUserId, person]));
    const shifts = (entry.shifts || []).map((shift) => ({
      ...shift,
      workers: (shift.workers || []).map((worker) => {
        const staffMatch = matchStaffByName({ name: worker.name }, staff);
        const operationsMatch = operationsByNowstaId.get(clean(worker.companyUserId, 120));
        return {
          ...worker,
          directoryType: staffMatch ? 'staff' : 'operations',
          directoryPerson: staffMatch || operationsMatch || null,
        };
      }),
    }));
    return res.json({ ...entry, shifts });
  } catch (error) {
    return sendApiError(res, error, { context: 'Operations event lookup failed', fallbackMessage: 'Unable to load operations event' });
  }
});

export default router;
