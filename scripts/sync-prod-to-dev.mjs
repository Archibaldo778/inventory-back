import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertDistinctMongoTargets,
  describeMongoTarget,
} from '../utils/mongoSyncSafety.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../.env.development') });
dotenv.config({ path: path.join(__dirname, '../.env') });

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const confirmation = args
  .find((arg) => arg.startsWith('--confirm='))
  ?.slice('--confirm='.length);

const prodUri = String(process.env.MONGO_URI_PROD || '').trim();
const devUri = String(process.env.MONGO_URI_DEV || '').trim();
const prodDbName = String(process.env.MONGO_DB_NAME_PROD || '').trim();
const devDbName = String(process.env.MONGO_DB_NAME_DEV || '').trim();

if (!prodUri || !devUri) {
  throw new Error('MONGO_URI_PROD and MONGO_URI_DEV must both be configured explicitly');
}

const { prodTarget, devTarget } = assertDistinctMongoTargets({
  prodUri,
  prodDbName,
  devUri,
  devDbName,
});

if (apply && confirmation !== 'SYNC_PROD_TO_DEV') {
  throw new Error(
    'Apply mode requires --confirm=SYNC_PROD_TO_DEV. Run without --apply for a dry-run first.'
  );
}

const connect = (uri, dbName) => {
  const options = {};
  if (dbName) options.dbName = dbName;
  return mongoose.createConnection(uri, options).asPromise();
};

const copyableIndexOptions = (index) => {
  const optionNames = [
    'name',
    'unique',
    'sparse',
    'expireAfterSeconds',
    'partialFilterExpression',
    'collation',
    'hidden',
    'wildcardProjection',
  ];
  return Object.fromEntries(
    optionNames
      .filter((name) => index[name] !== undefined)
      .map((name) => [name, index[name]])
  );
};

const copyCollectionAtomically = async ({ prodDb, devDb, name }) => {
  const source = prodDb.collection(name);
  const safeName = name.replace(/[^a-z0-9_.-]/gi, '_').slice(0, 40);
  const tempName = `__prod_sync_${safeName}_${Date.now()}_${process.pid}`;
  let tempCreated = false;

  try {
    await devDb.createCollection(tempName);
    tempCreated = true;
    const target = devDb.collection(tempName);
    const cursor = source.find({}, { readConcern: { level: 'majority' } });
    let batch = [];
    let copied = 0;

    for await (const document of cursor) {
      batch.push(document);
      if (batch.length < 500) continue;
      await target.insertMany(batch, { ordered: true });
      copied += batch.length;
      batch = [];
    }
    if (batch.length > 0) {
      await target.insertMany(batch, { ordered: true });
      copied += batch.length;
    }

    const indexes = await source.indexes();
    for (const index of indexes) {
      if (index.name === '_id_') continue;
      await target.createIndex(index.key, copyableIndexOptions(index));
    }

    const verifiedCount = await target.countDocuments({});
    if (verifiedCount !== copied) {
      throw new Error(
        `Verification failed for ${name}: copied=${copied}, temporary=${verifiedCount}`
      );
    }

    await target.rename(name, { dropTarget: true });
    tempCreated = false;
    return { copied, indexes: indexes.length };
  } catch (error) {
    if (tempCreated) {
      await devDb.collection(tempName).drop().catch(() => null);
    }
    throw error;
  }
};

let prodConnection;
let devConnection;

try {
  console.log(`source: ${describeMongoTarget(prodTarget)}`);
  console.log(`destination: ${describeMongoTarget(devTarget)}`);
  console.log(`mode: ${apply ? 'APPLY' : 'DRY-RUN'}`);

  prodConnection = await connect(prodUri, prodDbName);
  devConnection = await connect(devUri, devDbName);
  const prodDb = prodConnection.db;
  const devDb = devConnection.db;

  const prodCollections = (await prodDb.listCollections({}, { nameOnly: false }).toArray())
    .filter(({ name, type }) => !name.startsWith('system.') && type !== 'view')
    .map(({ name }) => name)
    .sort();
  const devCollections = (await devDb.listCollections({}, { nameOnly: true }).toArray())
    .filter(({ name }) => !name.startsWith('system.'))
    .map(({ name }) => name);
  const prodNames = new Set(prodCollections);
  const extraDevCollections = devCollections.filter((name) => !prodNames.has(name)).sort();

  if (extraDevCollections.length > 0) {
    console.warn(`dev-only collections left untouched: ${extraDevCollections.join(', ')}`);
  }

  for (const name of prodCollections) {
    if (!apply) {
      const [prodCount, devCount] = await Promise.all([
        prodDb.collection(name).estimatedDocumentCount(),
        devCollections.includes(name)
          ? devDb.collection(name).estimatedDocumentCount()
          : Promise.resolve(0),
      ]);
      console.log(`[dry-run] ${name}: prod=${prodCount}, dev=${devCount}`);
      continue;
    }

    const result = await copyCollectionAtomically({ prodDb, devDb, name });
    console.log(`replaced ${name}: documents=${result.copied}, indexes=${result.indexes}`);
  }

  console.log(
    apply
      ? '✅ Sync complete. Production was read-only; each dev collection was replaced after verification.'
      : 'Dry-run complete. To apply: npm run sync:prod-to-dev -- --apply --confirm=SYNC_PROD_TO_DEV'
  );
} finally {
  await Promise.allSettled([
    prodConnection?.close(),
    devConnection?.close(),
  ]);
}
