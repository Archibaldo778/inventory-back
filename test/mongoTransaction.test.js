import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { runWithTransactionFallback } from '../utils/mongoTransaction.js';

test('runWithTransactionFallback commits supported transactions', async () => {
  const originalStartSession = mongoose.startSession;
  const calls = [];
  mongoose.startSession = async () => ({
    withTransaction: async (work) => {
      calls.push('transaction');
      await work();
    },
    endSession: async () => calls.push('end'),
  });

  try {
    const result = await runWithTransactionFallback(
      async () => {
        calls.push('work');
        return 'committed';
      },
      async () => {
        calls.push('fallback');
        return 'fallback';
      }
    );
    assert.equal(result, 'committed');
    assert.deepEqual(calls, ['transaction', 'work', 'end']);
  } finally {
    mongoose.startSession = originalStartSession;
  }
});

test('runWithTransactionFallback uses fallback only when transactions are unsupported', async () => {
  const originalStartSession = mongoose.startSession;
  const calls = [];
  mongoose.startSession = async () => ({
    withTransaction: async () => {
      throw Object.assign(new Error('Transactions are not supported'), { code: 20 });
    },
    endSession: async () => calls.push('end'),
  });

  try {
    const result = await runWithTransactionFallback(
      async () => 'unreachable',
      async () => {
        calls.push('fallback');
        return 'fallback';
      }
    );
    assert.equal(result, 'fallback');
    assert.deepEqual(calls, ['fallback', 'end']);
  } finally {
    mongoose.startSession = originalStartSession;
  }
});
