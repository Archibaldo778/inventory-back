const cleanId = (value) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim();

export const normalizeNotificationStatePatch = (body = {}) => {
  const ids = [...new Set((Array.isArray(body?.ids) ? body.ids : [])
    .map(cleanId)
    .filter((id) => id && id.length <= 300))];
  if (!ids.length || ids.length > 250) {
    const error = new Error('Between 1 and 250 notification ids are required');
    error.statusCode = 400;
    throw error;
  }
  const hasRead = typeof body?.read === 'boolean';
  const hasPinned = typeof body?.pinned === 'boolean';
  if (!hasRead && !hasPinned) {
    const error = new Error('A read or pinned update is required');
    error.statusCode = 400;
    throw error;
  }
  return {
    ids,
    ...(hasRead ? { read: body.read } : {}),
    ...(hasPinned ? { pinned: body.pinned } : {}),
  };
};
