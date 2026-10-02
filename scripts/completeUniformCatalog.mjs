// Manual, opt-in catalog completion. Without --apply, prints the proposed additions only.
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import UniformItem from '../models/UniformItem.js';
import Staff from '../models/Staff.js';
import { planUniformCatalog } from '../utils/uniformCatalogSeed.js';

dotenv.config({ path: process.argv.includes('--production') ? '.env.production' : '.env.development', quiet: true });
dotenv.config({ path: '.env', quiet: true });
if (!process.env.MONGO_URI) throw new Error('MONGO_URI is required');
await mongoose.connect(process.env.MONGO_URI, { ...(process.env.MONGO_DB_NAME ? { dbName: process.env.MONGO_DB_NAME } : {}), serverSelectionTimeoutMS: 10000 });
try {
  const [existing, sizes] = await Promise.all([
    UniformItem.find({}).select('name category sizes hidden').lean(),
    Staff.find({}).select('jacketSize shirtSize pantsSize shoeSize -_id').lean(),
  ]);
  const additions = planUniformCatalog(existing, sizes);
  console.log(JSON.stringify({ database: mongoose.connection.name, existingCount: existing.length, mode: process.argv.includes('--apply') ? 'apply' : 'preview', additions: additions.map(({ name, sizes }) => ({ name, sizes: sizes.map((size) => size.label), quantity: 0 })) }, null, 2));
  if (process.argv.includes('--apply')) {
    let inserted = 0;
    for (const item of additions) {
      const result = await UniformItem.updateOne({ name: item.name }, { $setOnInsert: item }, { upsert: true, runValidators: true });
      inserted += result.upsertedCount;
    }
    const remaining = planUniformCatalog(await UniformItem.find({}).select('name category sizes hidden').lean(), sizes);
    if (remaining.length) throw new Error('Catalog verification failed');
    console.log(JSON.stringify({ inserted, remaining: 0 }));
  }
} finally { await mongoose.disconnect(); }
