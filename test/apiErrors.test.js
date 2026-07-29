import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyApiError } from '../utils/apiErrors.js';

test('API errors preserve safe business statuses', () => {
  assert.deepEqual(
    classifyApiError(Object.assign(new Error('Not found'), { statusCode: 404 })),
    { statusCode: 404, message: 'Not found' }
  );
});

test('API errors sanitize database validation and conflict details', () => {
  assert.deepEqual(
    classifyApiError({ name: 'CastError', path: '_id', value: 'secret-value' }),
    { statusCode: 400, message: 'Invalid _id' }
  );
  assert.deepEqual(
    classifyApiError({
      name: 'ValidationError',
      errors: { role: { message: 'raw internal validation detail' } },
    }),
    { statusCode: 400, message: 'Invalid value for role' }
  );
  assert.deepEqual(
    classifyApiError({ code: 11000, keyPattern: { email: 1 }, keyValue: { email: 'private@example.com' } }),
    { statusCode: 409, message: 'email already exists' }
  );
  assert.deepEqual(
    classifyApiError({ name: 'VersionError', message: 'internal version state' }),
    {
      statusCode: 409,
      message: 'This record was changed by another user. Refresh and try again.',
    }
  );
});

test('API errors hide unknown and server-side details', () => {
  assert.deepEqual(
    classifyApiError(new Error('mongodb://user:password@private-host/database')),
    { statusCode: 500, message: 'Internal server error' }
  );
  assert.deepEqual(
    classifyApiError({ name: 'MongoServerSelectionError', message: 'private-host' }),
    { statusCode: 503, message: 'Database service unavailable' }
  );
});
