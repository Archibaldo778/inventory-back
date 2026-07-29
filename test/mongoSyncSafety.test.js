import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertDistinctMongoTargets,
  describeMongoTarget,
  resolveMongoTarget,
} from '../utils/mongoSyncSafety.js';

test('Mongo sync target parsing never exposes credentials', () => {
  const target = resolveMongoTarget(
    'mongodb://user:secret@db.example:27017/production?retryWrites=true'
  );
  assert.equal(target.dbName, 'production');
  assert.equal(describeMongoTarget(target), 'mongodb://db.example:27017/production');
  assert.doesNotMatch(describeMongoTarget(target), /user|secret/);
});

test('Mongo sync refuses equivalent targets even when host order differs', () => {
  assert.throws(
    () => assertDistinctMongoTargets({
      prodUri: 'mongodb://user:a@db-a:27017,db-b:27017/source',
      devUri: 'mongodb://user:b@db-b:27017,db-a:27017/source',
    }),
    /same target/
  );
});

test('Mongo sync requires an explicit database and permits distinct databases', () => {
  assert.throws(
    () => resolveMongoTarget('mongodb://localhost:27017'),
    /database name/
  );

  const result = assertDistinctMongoTargets({
    prodUri: 'mongodb://localhost:27017/prod',
    devUri: 'mongodb://localhost:27017/dev',
  });
  assert.equal(result.prodTarget.dbName, 'prod');
  assert.equal(result.devTarget.dbName, 'dev');
});
