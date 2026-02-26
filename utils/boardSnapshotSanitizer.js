const isPlainObject = (value) => Boolean(
  value
  && typeof value === 'object'
  && !Array.isArray(value)
);

const stripUndefinedDeep = (value) => {
  if (value === undefined) return undefined;

  if (Array.isArray(value)) {
    let changed = false;
    const nextArray = value.map((entry) => {
      const nextEntry = stripUndefinedDeep(entry);
      if (nextEntry !== entry) changed = true;
      return nextEntry === undefined ? null : nextEntry;
    });
    return changed ? nextArray : value;
  }

  if (!isPlainObject(value)) return value;

  let changed = false;
  const nextObject = {};
  Object.entries(value).forEach(([key, entry]) => {
    const nextEntry = stripUndefinedDeep(entry);
    if (nextEntry === undefined) {
      changed = true;
      return;
    }
    if (nextEntry !== entry) changed = true;
    nextObject[key] = nextEntry;
  });

  return changed ? nextObject : value;
};

const sanitizeRecord = (record) => {
  if (!isPlainObject(record)) return record;
  let nextRecord = stripUndefinedDeep(record);
  if (!isPlainObject(nextRecord)) return record;

  if (typeof nextRecord.typeName === 'string' && !isPlainObject(nextRecord.meta)) {
    nextRecord = {
      ...nextRecord,
      meta: {},
    };
  }

  return nextRecord;
};

export const sanitizeTldrawDocument = (documentSnapshot) => {
  if (!isPlainObject(documentSnapshot)) return null;

  let nextDocument = stripUndefinedDeep(documentSnapshot);
  if (!isPlainObject(nextDocument)) return null;

  if (!isPlainObject(nextDocument.meta)) {
    nextDocument = {
      ...nextDocument,
      meta: {},
    };
  }

  const store = nextDocument.store;
  if (!isPlainObject(store)) return nextDocument;

  let changed = false;
  const nextStore = { ...store };
  Object.entries(store).forEach(([recordId, record]) => {
    const nextRecord = sanitizeRecord(record);
    if (nextRecord !== record) {
      nextStore[recordId] = nextRecord;
      changed = true;
    }
  });

  if (!changed) return nextDocument;
  return {
    ...nextDocument,
    store: nextStore,
  };
};

const coerceTldrawDocument = (value) => {
  if (isPlainObject(value) && isPlainObject(value.store)) {
    return sanitizeTldrawDocument(value);
  }
  if (isPlainObject(value?.document) && isPlainObject(value.document.store)) {
    return sanitizeTldrawDocument(value.document);
  }
  return null;
};

export const sanitizeBoardCanvas = (canvas) => {
  const normalizedCanvas = isPlainObject(canvas) ? stripUndefinedDeep(canvas) : {};
  const nextCanvas = isPlainObject(normalizedCanvas) ? normalizedCanvas : {};
  const nextMeta = isPlainObject(nextCanvas.meta) ? nextCanvas.meta : {};
  const nextTldrawDocument = coerceTldrawDocument(nextMeta.tldrawDocument);

  return {
    ...nextCanvas,
    meta: {
      ...nextMeta,
      tldrawDocument: nextTldrawDocument,
    },
  };
};
