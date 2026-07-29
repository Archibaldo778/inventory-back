const isHttpStatus = (value) => {
  const status = Number(value);
  return Number.isInteger(status) && status >= 400 && status <= 599;
};

const getValidationPath = (error) => {
  const paths = Object.keys(error?.errors || {});
  return paths.find((path) => /^[a-zA-Z0-9_.-]+$/.test(path)) || '';
};

const getDuplicateField = (error) => {
  const fields = Object.keys(error?.keyPattern || {});
  return fields.find((field) => /^[a-zA-Z0-9_.-]+$/.test(field)) || '';
};

export const createApiError = (statusCode, message) => (
  Object.assign(new Error(String(message || 'Request failed')), { statusCode })
);

export const classifyApiError = (
  error,
  { defaultStatus = 500, fallbackMessage = 'Internal server error' } = {}
) => {
  if (isHttpStatus(error?.statusCode)) {
    const statusCode = Number(error.statusCode);
    return {
      statusCode,
      message: statusCode < 500
        ? String(error?.message || fallbackMessage)
        : fallbackMessage,
    };
  }

  if (error?.name === 'CastError') {
    const path = /^[a-zA-Z0-9_.-]+$/.test(String(error?.path || ''))
      ? String(error.path)
      : 'identifier';
    return { statusCode: 400, message: `Invalid ${path}` };
  }

  if (error?.name === 'ValidationError') {
    const path = getValidationPath(error);
    return {
      statusCode: 400,
      message: path ? `Invalid value for ${path}` : 'Invalid request data',
    };
  }

  if (Number(error?.code) === 11000) {
    const field = getDuplicateField(error);
    return {
      statusCode: 409,
      message: field ? `${field} already exists` : 'Record already exists',
    };
  }

  if (error?.name === 'VersionError') {
    return {
      statusCode: 409,
      message: 'This record was changed by another user. Refresh and try again.',
    };
  }

  if (/^(Mongo(Network|ServerSelection)|MongooseServerSelection)Error$/.test(String(error?.name || ''))) {
    return { statusCode: 503, message: 'Database service unavailable' };
  }

  const statusCode = isHttpStatus(defaultStatus) ? Number(defaultStatus) : 500;
  return {
    statusCode,
    message: fallbackMessage,
  };
};

export const sendApiError = (
  res,
  error,
  {
    field = 'error',
    context = 'API request failed',
    defaultStatus = 500,
    fallbackMessage = 'Internal server error',
  } = {}
) => {
  const response = classifyApiError(error, { defaultStatus, fallbackMessage });
  if (response.statusCode >= 500) {
    console.error(`${context}:`, error?.message || error);
  }
  return res.status(response.statusCode).json({ [field]: response.message });
};
