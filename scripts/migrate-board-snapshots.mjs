import dotenv from 'dotenv';
import mongoose from 'mongoose';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Page from '../models/Page.js';
import { sanitizeBoardCanvas } from '../utils/boardSnapshotSanitizer.js';
import { describeMongoTarget, resolveMongoTarget } from '../utils/mongoSyncSafety.js';

const __filename = fileURLToPath(import.meta.url);
const rootDir = path.dirname(path.dirname(__filename));
const envFile = process.env.NODE_ENV === 'production' ? '.env.production' : '.env.development';
dotenv.config({ path: path.join(rootDir, envFile) });
dotenv.config({ path: path.join(rootDir, '.env') });

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const confirmation = args
  .find((arg) => arg.startsWith('--confirm='))
  ?.slice('--confirm='.length);

const areEqualJson = (left, right) => {
  try {
    return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
  } catch {
    return false;
  }
};

const buildRevisionFilter = (page) => {
  const revision = page?.revision;
  if (Number.isInteger(revision) && revision >= 0) {
    return { revision };
  }
  return { revision: { $exists: false } };
};

const run = async () => {
  const mongoUri = String(process.env.MONGO_URI || '').trim();
  const mongoDbName = String(process.env.MONGO_DB_NAME || '').trim();
  if (!mongoUri) throw new Error('MONGO_URI is required');
  if (apply && confirmation !== 'MIGRATE_BOARD_SNAPSHOTS') {
    throw new Error(
      'Apply mode requires --confirm=MIGRATE_BOARD_SNAPSHOTS. Run without --apply first.'
    );
  }

  const target = resolveMongoTarget(mongoUri, mongoDbName);
  console.log(`target: ${describeMongoTarget(target)}`);
  console.log(`mode: ${apply ? 'APPLY' : 'DRY-RUN'}`);

  const connectOptions = {};
  if (mongoDbName) connectOptions.dbName = mongoDbName;
  await mongoose.connect(mongoUri, connectOptions);

  let scanned = 0;
  let needsUpdate = 0;
  let updated = 0;
  let conflicts = 0;

  try {
    const cursor = Page.find({}, { _id: 1, canvas: 1, revision: 1 }).lean().cursor();
    for await (const page of cursor) {
      scanned += 1;
      const nextCanvas = sanitizeBoardCanvas(page.canvas);
      if (areEqualJson(page.canvas, nextCanvas)) continue;
      needsUpdate += 1;
      if (!apply) continue;

      const result = await Page.updateOne(
        { _id: page._id, ...buildRevisionFilter(page) },
        {
          $set: { canvas: nextCanvas },
          $inc: { revision: 1 },
        },
        { runValidators: true }
      );
      if (result.modifiedCount === 1) updated += 1;
      else conflicts += 1;
    }

    console.log(
      `migrate-board-snapshots: scanned=${scanned}, needsUpdate=${needsUpdate}, `
      + `updated=${updated}, conflicts=${conflicts}`
    );
    if (!apply) {
      console.log(
        'Dry-run complete. To apply: npm run migrate:board-snapshots -- '
        + '--apply --confirm=MIGRATE_BOARD_SNAPSHOTS'
      );
    }
    if (conflicts > 0) {
      throw new Error(
        `${conflicts} page(s) changed during migration and were safely left untouched; rerun dry-run`
      );
    }
  } finally {
    await mongoose.disconnect();
  }
};

run().catch(async (error) => {
  console.error('migrate-board-snapshots failed:', error?.message || error);
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect().catch(() => null);
  }
  process.exitCode = 1;
});
