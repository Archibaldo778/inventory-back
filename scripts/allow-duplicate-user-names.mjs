// Run only after deploying the ambiguous-name login guard. Dry run by default.
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { allowDuplicateUserNames } from '../utils/userNameIndex.js';

dotenv.config({ path: '.env.production', quiet: true });
dotenv.config({ path: '.env', quiet: true });
try {
  await mongoose.connect(process.env.MONGO_URI, {
    ...(process.env.MONGO_DB_NAME ? { dbName: process.env.MONGO_DB_NAME } : {}),
    autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 10000,
  });
  const collection = mongoose.connection.collection('users');
  const result = await allowDuplicateUserNames(collection, { apply: process.argv.includes('--apply') });
  const verified = await allowDuplicateUserNames(collection);
  if (result.apply && verified.usernameIndexes.length) throw new Error('Username index removal was not verified');
  console.log(JSON.stringify(result));
} catch {
  console.error('User-name index update failed; check the unique email index and database connection');
  process.exitCode = 1;
} finally { await mongoose.disconnect(); }
