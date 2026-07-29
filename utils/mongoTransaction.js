import mongoose from 'mongoose';

const isTransactionUnsupported = (error) => {
  const message = String(error?.message || '').toLowerCase();
  return (
    message.includes('transaction numbers are only allowed on a replica set member or mongos')
    || message.includes('transactions are not supported')
    || Number(error?.code) === 20
  );
};

export const runWithTransactionFallback = async (transactionWork, fallbackWork) => {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await transactionWork(session);
    });
    return result;
  } catch (error) {
    if (!isTransactionUnsupported(error)) throw error;
    return await fallbackWork();
  } finally {
    await session.endSession();
  }
};
