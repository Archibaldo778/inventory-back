import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { v2 as cloudinary } from 'cloudinary';
import KitchenItem from '../models/KitchenItem.js';
import {
  classifyKitchenImage,
  extractCloudinaryPublicId,
  getKitchenTargetPublicId,
} from '../utils/cloudinaryImageMigration.js';
import { describeMongoTarget, resolveMongoTarget } from '../utils/mongoSyncSafety.js';

const __filename = fileURLToPath(import.meta.url);
const rootDir = path.dirname(path.dirname(__filename));
const envFile = process.env.NODE_ENV === 'production' ? '.env.production' : '.env.development';
dotenv.config({ path: path.join(rootDir, envFile) });
dotenv.config({ path: path.join(rootDir, '.env') });

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const moveCloudinary = args.includes('--move-cloudinary');
const confirmation = args
  .find((arg) => arg.startsWith('--confirm='))
  ?.slice('--confirm='.length);
const limitArg = args.find((arg) => arg.startsWith('--limit='));
const parsedLimit = limitArg ? Number(limitArg.slice('--limit='.length)) : 0;
if (limitArg && (!Number.isInteger(parsedLimit) || parsedLimit <= 0)) {
  throw new Error('--limit must be a positive integer');
}
const limit = parsedLimit;

const mongoUri = String(process.env.MONGO_URI || '').trim();
const mongoDbName = String(process.env.MONGO_DB_NAME || '').trim();
if (!mongoUri) throw new Error('MONGO_URI is required');
if (apply && !moveCloudinary) {
  throw new Error('--apply requires --move-cloudinary; local upload records are report-only');
}
if (apply && confirmation !== 'MIGRATE_KITCHEN_IMAGES') {
  throw new Error(
    'Apply mode requires --confirm=MIGRATE_KITCHEN_IMAGES. Run without --apply first.'
  );
}

const cloudinaryConfigured = Boolean(
  process.env.CLOUDINARY_CLOUD_NAME
  && process.env.CLOUDINARY_API_KEY
  && process.env.CLOUDINARY_API_SECRET
);
if (apply && !cloudinaryConfigured) {
  throw new Error('Cloudinary credentials are required for apply mode');
}
if (cloudinaryConfigured) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true,
  });
}

const getExistingTarget = async (publicId) => {
  const resource = await cloudinary.api.resource(publicId, {
    resource_type: 'image',
    type: 'upload',
  });
  const image = resource?.secure_url || resource?.url;
  return image ? { image, movedByThisRun: false } : null;
};

const moveOrRecoverTarget = async (oldPublicId, newPublicId) => {
  try {
    const renamed = await cloudinary.uploader.rename(oldPublicId, newPublicId, {
      resource_type: 'image',
      type: 'upload',
      overwrite: false,
      invalidate: true,
    });
    const image = renamed?.secure_url || renamed?.url;
    if (!image) throw new Error('Cloudinary rename returned no image URL');
    return { image, movedByThisRun: true };
  } catch (renameError) {
    try {
      const existing = await getExistingTarget(newPublicId);
      if (existing) return existing;
    } catch {
      // The original rename error is more useful when neither source nor target is available.
    }
    throw renameError;
  }
};

const rollbackCloudinaryMove = async (oldPublicId, newPublicId) => {
  await cloudinary.uploader.rename(newPublicId, oldPublicId, {
    resource_type: 'image',
    type: 'upload',
    overwrite: false,
    invalidate: true,
  });
};

const run = async () => {
  const target = resolveMongoTarget(mongoUri, mongoDbName);
  console.log('Kitchen image migration');
  console.log(`target: ${describeMongoTarget(target)}`);
  console.log(`mode: ${apply ? 'APPLY' : 'DRY-RUN'}`);
  console.log(`move cloudinary assets: ${moveCloudinary ? 'yes' : 'no'}`);
  if (limit > 0) console.log(`limit: ${limit}`);

  const connectOptions = {};
  if (mongoDbName) connectOptions.dbName = mongoDbName;
  await mongoose.connect(mongoUri, connectOptions);

  try {
    const query = KitchenItem.find(
      { image: { $exists: true, $ne: null } },
      { _id: 1, name: 1, image: 1, createdAt: 1 }
    ).sort({ createdAt: -1 }).lean();
    if (limit > 0) query.limit(limit);
    const items = await query;

    const counters = {
      total: items.length,
      empty: 0,
      cloudinary_legacy_folder: 0,
      cloudinary_target_folder: 0,
      cloudinary_other: 0,
      local_uploads: 0,
      other: 0,
      migrated: 0,
      recovered: 0,
      rolledBack: 0,
      conflicts: 0,
      skipped: 0,
      failed: 0,
    };
    const localUploads = [];
    const legacyCloudinary = [];

    for (const item of items) {
      const image = String(item.image || '').trim();
      const bucket = classifyKitchenImage(image);
      counters[bucket] += 1;
      const row = { id: item._id, name: item.name, image };
      if (bucket === 'local_uploads') localUploads.push(row);
      if (bucket === 'cloudinary_legacy_folder') legacyCloudinary.push(row);
    }

    console.log('Current state:');
    console.table({
      total: counters.total,
      cloudinary_target_folder: counters.cloudinary_target_folder,
      cloudinary_legacy_folder: counters.cloudinary_legacy_folder,
      cloudinary_other: counters.cloudinary_other,
      local_uploads: counters.local_uploads,
      other: counters.other,
      empty: counters.empty,
    });

    if (!apply) {
      legacyCloudinary.slice(0, 10).forEach((row) => {
        console.log(`legacy: ${row.id} | ${row.name || ''} | ${row.image}`);
      });
      localUploads.slice(0, 10).forEach((row) => {
        console.log(`local: ${row.id} | ${row.name || ''} | ${row.image}`);
      });
      console.log(
        'Dry-run complete. To apply Cloudinary moves: npm run migrate:kitchen-images -- '
        + '--apply --move-cloudinary --confirm=MIGRATE_KITCHEN_IMAGES'
      );
      return;
    }

    for (const row of legacyCloudinary) {
      const oldPublicId = extractCloudinaryPublicId(row.image);
      const newPublicId = getKitchenTargetPublicId(oldPublicId);
      if (!newPublicId) {
        console.warn(`skip ${row.id}: cannot parse legacy Cloudinary public_id`);
        counters.skipped += 1;
        continue;
      }

      const stillCurrent = await KitchenItem.exists({ _id: row.id, image: row.image });
      if (!stillCurrent) {
        console.warn(`conflict ${row.id}: image changed after scan; left untouched`);
        counters.conflicts += 1;
        continue;
      }

      let targetImage;
      try {
        targetImage = await moveOrRecoverTarget(oldPublicId, newPublicId);
        const update = await KitchenItem.updateOne(
          { _id: row.id, image: row.image },
          { $set: { image: targetImage.image } },
          { runValidators: true }
        );
        if (update.modifiedCount === 1) {
          counters.migrated += 1;
          if (!targetImage.movedByThisRun) counters.recovered += 1;
          continue;
        }

        counters.conflicts += 1;
        console.warn(`conflict ${row.id}: image changed during Cloudinary move`);
      } catch (error) {
        counters.failed += 1;
        console.error(`failed ${row.id}: ${String(error?.message || error)}`);
      }

      if (targetImage?.movedByThisRun) {
        try {
          await rollbackCloudinaryMove(oldPublicId, newPublicId);
          counters.rolledBack += 1;
        } catch (rollbackError) {
          counters.failed += 1;
          console.error(
            `rollback failed ${row.id}: ${String(rollbackError?.message || rollbackError)}`
          );
        }
      }
    }

    console.log('Apply summary:');
    console.table({
      migrated: counters.migrated,
      recovered: counters.recovered,
      rolledBack: counters.rolledBack,
      conflicts: counters.conflicts,
      skipped: counters.skipped,
      failed: counters.failed,
      legacy_cloudinary_total: legacyCloudinary.length,
      local_uploads_total: localUploads.length,
    });

    if (localUploads.length > 0) {
      console.log('Records with /uploads remain manual (re-upload required):');
      localUploads.slice(0, 20).forEach((row) => {
        console.log(`- ${row.id} | ${row.name || ''} | ${row.image}`);
      });
    }
    if (counters.conflicts > 0 || counters.failed > 0) {
      throw new Error(
        `Migration incomplete: conflicts=${counters.conflicts}, failed=${counters.failed}`
      );
    }
  } finally {
    await mongoose.disconnect();
  }
};

run().catch(async (error) => {
  console.error('Kitchen image migration failed:', error?.message || error);
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect().catch(() => null);
  }
  process.exitCode = 1;
});
