// Sort only lightweight keys: event documents can contain large operations snapshots.
export const listEventsNewestFirst = async (Events, filter) => {
  const keys = await Events.find(filter).select('_id createdAt').sort({ createdAt: -1 }).lean();
  if (!keys.length) return [];
  const items = await Events.find({ $and: [filter, { _id: { $in: keys.map(item => item._id) } }] }).select('-documentHistory');
  const byId = new Map(items.map(item => [String(item._id), item]));
  return keys.map(item => byId.get(String(item._id))).filter(Boolean);
};
