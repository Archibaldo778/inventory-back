import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load local env files (dev first, then fallback)
dotenv.config({ path: path.join(__dirname, '../.env.development') });
dotenv.config({ path: path.join(__dirname, '../.env') });

const prodUri = process.env.MONGO_URI_PROD || process.env.MONGO_URI;
const devUri = process.env.MONGO_URI_DEV || process.env.MONGO_URI;
const prodDbName = process.env.MONGO_DB_NAME_PROD;
const devDbName = process.env.MONGO_DB_NAME_DEV || process.env.MONGO_DB_NAME;

if (!prodUri || !devUri) {
  console.error('Missing MONGO_URI_PROD or MONGO_URI_DEV (or MONGO_URI).');
  process.exit(1);
}

const sameTarget = prodUri === devUri && (prodDbName || '') === (devDbName || '');
if (sameTarget) {
  console.error('Refusing to run: prod and dev targets are the same.');
  process.exit(1);
}

const connect = (uri, dbName) => {
  const opts = {};
  if (dbName) opts.dbName = dbName;
  return mongoose.createConnection(uri, opts).asPromise();
};

const prodConn = await connect(prodUri, prodDbName);
const devConn = await connect(devUri, devDbName);

try {
  const prodDb = prodConn.db;
  const devDb = devConn.db;

  const collections = await prodDb.listCollections().toArray();

  for (const { name } of collections) {
    if (name.startsWith('system.')) continue;

    const prodCol = prodDb.collection(name);
    const devCol = devDb.collection(name);

    const docs = await prodCol.find({}).toArray();
    await devCol.deleteMany({});
    if (docs.length) {
      await devCol.insertMany(docs);
    }
    console.log(`Copied ${docs.length} docs -> ${name}`);
  }

  console.log('✅ Sync complete.');
} finally {
  await prodConn.close();
  await devConn.close();
}
