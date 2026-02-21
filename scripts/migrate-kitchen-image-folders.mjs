import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { v2 as cloudinary } from 'cloudinary';
import KitchenItem from '../models/KitchenItem.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');

const envFile = process.env.NODE_ENV === 'production' ? '.env.production' : '.env.development';
dotenv.config({ path: path.join(rootDir, envFile) });
dotenv.config({ path: path.join(rootDir, '.env') });

const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const moveCloudinary = args.has('--move-cloudinary');

const parseLimit = () => {
  for (const arg of args) {
    if (arg.startsWith('--limit=')) {
      const raw = Number(arg.slice('--limit='.length));
      if (Number.isFinite(raw) && raw > 0) return Math.floor(raw);
    }
  }
  return 0;
};

const limit = parseLimit();

const mongoUri = process.env.MONGO_URI;
const mongoDbName = process.env.MONGO_DB_NAME;
if (!mongoUri) {
  console.error('Missing MONGO_URI');
  process.exit(1);
}

const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
const cloudApiKey = process.env.CLOUDINARY_API_KEY;
const cloudApiSecret = process.env.CLOUDINARY_API_SECRET;
const cloudinaryConfigured = Boolean(cloudName && cloudApiKey && cloudApiSecret);
if (cloudinaryConfigured) {
  cloudinary.config({
    cloud_name: cloudName,
    api_key: cloudApiKey,
    api_secret: cloudApiSecret,
    secure: true,
  });
}

const classifyImage = (value) => {
  const src = String(value || '').trim();
  if (!src) return 'empty';
  if (/^https?:\/\/res\.cloudinary\.com\//i.test(src)) {
    if (/\/inventory\/kitchen\//i.test(src)) return 'cloudinary_legacy_folder';
    if (/\/kitchen\//i.test(src)) return 'cloudinary_target_folder';
    return 'cloudinary_other';
  }
  if (/^\/?uploads\//i.test(src) || /\/uploads\//i.test(src)) return 'local_uploads';
  return 'other';
};

const extractCloudinaryPublicId = (url) => {
  try {
    const parsed = new URL(url);
    const marker = '/upload/';
    const idx = parsed.pathname.indexOf(marker);
    if (idx === -1) return '';
    const afterUpload = parsed.pathname.slice(idx + marker.length);
    const parts = afterUpload.split('/').filter(Boolean);
    if (!parts.length) return '';

    let start = 0;
    const versionIndex = parts.findIndex((part) => /^v\d+$/.test(part));
    if (versionIndex >= 0) start = versionIndex + 1;

    const publicPath = parts.slice(start);
    if (!publicPath.length) return '';
    const last = publicPath[publicPath.length - 1];
    publicPath[publicPath.length - 1] = last.replace(/\.[a-z0-9]{2,5}$/i, '');
    return publicPath.join('/');
  } catch {
    return '';
  }
};

const safeString = (value) => String(value || '').trim();

const printHeader = () => {
  console.log('Kitchen image migration');
  console.log(`mode: ${apply ? 'APPLY' : 'DRY-RUN'}`);
  console.log(`move cloudinary assets: ${moveCloudinary ? 'yes' : 'no'}`);
  if (limit > 0) console.log(`limit: ${limit}`);
  console.log('---');
};

const connectOptions = {};
if (mongoDbName) connectOptions.dbName = mongoDbName;

try {
  await mongoose.connect(mongoUri, connectOptions);
} catch (err) {
  console.error(`Mongo connect failed: ${String(err?.message || err)}`);
  process.exit(1);
}

try {
  printHeader();

  const findQuery = { image: { $exists: true, $ne: null } };
  const cursor = KitchenItem.find(findQuery).sort({ createdAt: -1 });
  if (limit > 0) cursor.limit(limit);
  const items = await cursor.lean();

  const counters = {
    total: items.length,
    empty: 0,
    cloudinary_legacy_folder: 0,
    cloudinary_target_folder: 0,
    cloudinary_other: 0,
    local_uploads: 0,
    other: 0,
    migrated: 0,
    skipped: 0,
    failed: 0,
  };

  const localUploads = [];
  const legacyCloudinary = [];

  for (const item of items) {
    const image = safeString(item.image);
    const bucket = classifyImage(image);
    counters[bucket] += 1;
    if (bucket === 'local_uploads') localUploads.push({ id: item._id, name: item.name, image });
    if (bucket === 'cloudinary_legacy_folder') legacyCloudinary.push({ id: item._id, name: item.name, image });
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
    if (legacyCloudinary.length) {
      console.log('Legacy Cloudinary (inventory/kitchen) examples:');
      legacyCloudinary.slice(0, 10).forEach((row) => {
        console.log(`- ${row.id} | ${row.name || ''} | ${row.image}`);
      });
    }
    if (localUploads.length) {
      console.log('Local uploads examples (/uploads):');
      localUploads.slice(0, 10).forEach((row) => {
        console.log(`- ${row.id} | ${row.name || ''} | ${row.image}`);
      });
    }
    console.log('Dry-run complete. Use --apply to write changes.');
    process.exit(0);
  }

  if (moveCloudinary && !cloudinaryConfigured) {
    console.error('Cloudinary credentials are required for --move-cloudinary');
    process.exit(1);
  }

  for (const row of legacyCloudinary) {
    if (!moveCloudinary) {
      counters.skipped += 1;
      continue;
    }

    const oldPublicId = extractCloudinaryPublicId(row.image);
    if (!oldPublicId || !oldPublicId.startsWith('inventory/kitchen/')) {
      console.warn(`skip ${row.id}: cannot parse legacy public_id from URL`);
      counters.skipped += 1;
      continue;
    }

    const newPublicId = oldPublicId.replace(/^inventory\/kitchen\//, 'kitchen/');
    try {
      const renamed = await cloudinary.uploader.rename(oldPublicId, newPublicId, {
        resource_type: 'image',
        type: 'upload',
        overwrite: false,
        invalidate: true,
      });
      const newImage = renamed?.secure_url || renamed?.url || row.image;
      await KitchenItem.updateOne({ _id: row.id }, { $set: { image: newImage } });
      counters.migrated += 1;
    } catch (err) {
      const msg = String(err?.message || err || 'unknown error');
      if (/already exists/i.test(msg) || /409/.test(msg)) {
        try {
          const resource = await cloudinary.api.resource(newPublicId, {
            resource_type: 'image',
            type: 'upload',
          });
          const secureUrl = resource?.secure_url || resource?.url;
          if (secureUrl) {
            await KitchenItem.updateOne({ _id: row.id }, { $set: { image: secureUrl } });
            counters.migrated += 1;
            continue;
          }
        } catch {
          // fall through to failed counter
        }
      }
      console.error(`failed ${row.id}: ${msg}`);
      counters.failed += 1;
    }
  }

  console.log('Apply summary:');
  console.table({
    migrated: counters.migrated,
    skipped: counters.skipped,
    failed: counters.failed,
    legacy_cloudinary_total: legacyCloudinary.length,
    local_uploads_total: localUploads.length,
  });

  if (localUploads.length) {
    console.log('Records with /uploads remain manual (re-upload required):');
    localUploads.slice(0, 20).forEach((row) => {
      console.log(`- ${row.id} | ${row.name || ''} | ${row.image}`);
    });
  }
} finally {
  await mongoose.disconnect();
}
