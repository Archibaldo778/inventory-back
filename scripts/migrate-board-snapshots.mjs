import 'dotenv/config';
import mongoose from 'mongoose';
import Page from '../models/Page.js';
import { sanitizeBoardCanvas } from '../utils/boardSnapshotSanitizer.js';

const areEqualJson = (left, right) => {
  try {
    return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
  } catch {
    return false;
  }
};

const run = async () => {
  const mongoUri = String(process.env.MONGO_URI || '').trim();
  if (!mongoUri) {
    throw new Error('MONGO_URI is required');
  }

  await mongoose.connect(mongoUri);

  let scanned = 0;
  let updated = 0;

  const cursor = Page.find({}, { _id: 1, canvas: 1 }).cursor();
  for await (const page of cursor) {
    scanned += 1;
    const nextCanvas = sanitizeBoardCanvas(page.canvas);
    if (areEqualJson(page.canvas, nextCanvas)) continue;

    await Page.updateOne(
      { _id: page._id },
      { $set: { canvas: nextCanvas } }
    );
    updated += 1;
  }

  console.log(`migrate-board-snapshots: scanned=${scanned}, updated=${updated}`);
  await mongoose.disconnect();
};

run().catch(async (error) => {
  console.error('migrate-board-snapshots failed:', error?.message || error);
  try {
    await mongoose.disconnect();
  } catch {
    // ignore
  }
  process.exit(1);
});
