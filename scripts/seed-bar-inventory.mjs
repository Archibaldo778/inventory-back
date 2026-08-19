import dotenv from 'dotenv';
import mongoose from 'mongoose';

import BeverageItem from '../models/BeverageItem.js';

dotenv.config({ path: '.env.development' });
dotenv.config({ path: '.env' });

const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const production = args.has('--production');

if (!production) {
  throw new Error('Refusing to run without the explicit --production target');
}

const mongoUri = String(process.env.MONGO_URI_PROD || '').trim();
if (!mongoUri) throw new Error('MONGO_URI_PROD is required');

const rows = [
  { sku: 'BAR-LIQ-001', name: "Tito's Handmade Vodka", brand: "Tito's", category: 'Hard Liquors', subCategory: 'Vodka', size: 1000, cost: 27.60, aliases: ['TITOS VODKA (1 L)', 'Titos Vodka 1L'] },
  { sku: 'BAR-LIQ-002', name: 'Beefeater Gin', brand: 'Beefeater', category: 'Hard Liquors', subCategory: 'Gin', size: 750, cost: 23.95, aliases: ['BEEFEATER GIN (750 ML)'] },
  { sku: 'BAR-LIQ-003', name: 'Espolòn Blanco Tequila', brand: 'Espolòn', category: 'Hard Liquors', subCategory: 'Tequila', size: 1000, cost: 33.98, aliases: ['ESPOLON BLANCO (1 L)', 'Espolon Blanco 1L'] },
  { sku: 'BAR-LIQ-004', name: 'Bacardi Superior Rum', brand: 'Bacardi', category: 'Hard Liquors', subCategory: 'Rum', size: 750, cost: 15.28, aliases: ['BACARDI SURPERIOR RUM (750 ML)', 'Bacardi Surperior Rum 750ml'] },
  { sku: 'BAR-LIQ-005', name: 'Johnnie Walker Red Label', brand: 'Johnnie Walker', category: 'Hard Liquors', subCategory: 'Whiskey', size: 750, cost: 27.03, aliases: ['JOHNIE WALKER RED (750 ML)', 'Johnie Walker Red 750ml'] },
  { sku: 'BAR-LIQ-006', name: "Brother's Bond Bourbon", brand: "Brother's Bond", category: 'Hard Liquors', subCategory: 'Whiskey', size: 750, cost: 35.28, aliases: ['BROTHERS BOND (750 ML)', 'Brothers Bond 750ml'] },
  { sku: 'BAR-LIQ-007', name: 'Pierre Ferrand Dry Curaçao', brand: 'Pierre Ferrand', category: 'Hard Liquors', subCategory: 'Liqueur', size: 375, cost: 17.14, aliases: ['PIERRE FERRAND CURACAO (375 ML)', 'Pierre Ferrand Curacao 375ml'] },
  { sku: 'BAR-LIQ-008', name: 'Sweet Vermouth', brand: '', category: 'Hard Liquors', subCategory: 'Vermouth', size: 375, cost: 6.16, aliases: ['SWEET VERMOUTH (375 ML)'] },
  { sku: 'BAR-LIQ-009', name: 'Dry Vermouth', brand: '', category: 'Hard Liquors', subCategory: 'Vermouth', size: 375, cost: 6.16, aliases: ['DRY VERMOUTH (375 ML)'] },
  { sku: 'BAR-LIQ-010', name: 'Campari', brand: 'Campari', category: 'Hard Liquors', subCategory: 'Aperitif', size: 1000, cost: 37.60, aliases: ['CAMPARI (1 L)', 'Campari 1L'] },
  { sku: 'BAR-LIQ-011', name: 'Campari', brand: 'Campari', category: 'Hard Liquors', subCategory: 'Aperitif', size: 750, cost: 28.80, aliases: ['CAMPARI (750 ML)', 'Campari 750ml'] },
  { sku: 'BAR-LIQ-012', name: 'Aperol', brand: 'Aperol', category: 'Hard Liquors', subCategory: 'Aperitif', size: 1000, cost: 31.20, aliases: ['APEROL (1 L)', 'Aperol 1L'] },
  { sku: 'BAR-LIQ-013', name: 'Aperol', brand: 'Aperol', category: 'Hard Liquors', subCategory: 'Aperitif', size: 750, cost: 25.60, aliases: ['APEROL (750 ML)', 'Aperol 750ml'] },
  { sku: 'BAR-WIN-001', name: 'Pinot Blanc Schlumberger', brand: 'Schlumberger', category: 'Wine', subCategory: 'White Wine', size: null, cost: 12.67, aliases: ['PINOT BLANC SCHLUMBERGER'] },
  { sku: 'BAR-WIN-002', name: 'Côtes du Rhône, Delas', brand: 'Delas', category: 'Wine', subCategory: 'Red Wine', size: null, cost: 9.67, aliases: ['COTES DU RHONE, DELAS', 'Cotes du Rhone Delas'] },
  { sku: 'BAR-SPK-001', name: 'FIOL Prosecco', brand: 'FIOL', category: 'Wine', subCategory: 'Sparkling Wine', size: null, cost: 14.00, aliases: ['PROSSECO FIOL', 'Prosecco Fiol'] },
  { sku: 'BAR-WAT-001', name: 'Acqua Panna Water', brand: 'Acqua Panna', category: 'Water', subCategory: 'Still Water', size: null, cost: 2.55, aliases: ['PANNA WATER', 'Panna Water', 'Panna'] },
  { sku: 'BAR-WAT-002', name: 'S.Pellegrino Sparkling Water', brand: 'S.Pellegrino', category: 'Water', subCategory: 'Sparkling Water', size: null, cost: 2.55, aliases: ['PELLIGRINO SPARKLING', 'Pellegrino Sparkling', 'Pellegrino'] },
  { sku: 'BAR-SPC-001', name: 'Specialty Cocktail', brand: '', category: 'Specialty', subCategory: 'Cocktail', size: null, cost: 3.00, unitType: 'unit', aliases: ['COCKTAIL'] },
  { sku: 'BAR-SPC-002', name: 'Specialty Mocktail', brand: '', category: 'Specialty', subCategory: 'Mocktail', size: null, cost: 1.50, unitType: 'unit', aliases: ['MOCKTAIL'] },
];

const normalize = (value) => String(value || '')
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

const sizeFromName = (value) => {
  const text = String(value || '');
  const ml = text.match(/\b(\d{3,4})\s*m?l\b/i);
  if (ml) return Number(ml[1]);
  const liters = text.match(/\b(\d+(?:\.\d+)?)\s*l\b/i);
  return liters ? Number(liters[1]) * 1000 : null;
};

const baseName = (value) => normalize(
  String(value || '')
    .replace(/\(\s*\d+(?:\.\d+)?\s*(?:m?l|liter|litre)s?\s*\)/gi, ' ')
    .replace(/\b\d+(?:\.\d+)?\s*(?:m?l|liter|litre)s?\b/gi, ' ')
);

const identity = (value, size) => `${baseName(value)}::${Number(size || sizeFromName(value) || 0)}`;

await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 15000 });

try {
  const existing = await BeverageItem.find()
    .select('+purchaseCost +stockOnHand +inventoryMovements aliases tags image supplier')
    .lean();
  const byIdentity = new Map();
  existing.forEach((item) => {
    byIdentity.set(identity(item.name, item.bottleSizeMl), item);
    (Array.isArray(item.aliases) ? item.aliases : []).forEach((alias) => {
      byIdentity.set(identity(alias, item.bottleSizeMl), item);
    });
  });

  let inserted = 0;
  let updated = 0;
  for (const row of rows) {
    const current = byIdentity.get(identity(row.name, row.size))
      || row.aliases.map((alias) => byIdentity.get(identity(alias, row.size))).find(Boolean);
    const payload = {
      name: row.name,
      brand: row.brand,
      category: row.category,
      subCategory: row.subCategory,
      categories: [row.category],
      isAlcohol: !['Water'].includes(row.category) && row.subCategory !== 'Mocktail',
      sku: row.sku,
      unitType: row.unitType || 'bottle',
      purchaseCost: row.cost,
      bottleSizeMl: row.size,
      aliases: [...new Set([...(current?.aliases || []), ...row.aliases])],
      active: true,
    };

    if (!apply) {
      console.log(`${current ? 'UPDATE' : 'INSERT'} ${row.sku} ${row.name}`);
      continue;
    }
    if (current) {
      await BeverageItem.updateOne({ _id: current._id }, { $set: payload }, { runValidators: true });
      updated += 1;
    } else {
      await BeverageItem.create({
        ...payload,
        stockOnHand: 0,
        reorderLevel: 0,
        inventoryMovements: [],
      });
      inserted += 1;
    }
  }
  console.log(apply
    ? `Bar inventory seed complete: ${inserted} inserted, ${updated} updated.`
    : `Dry run complete: ${rows.length} rows. Re-run with --apply to write.`);
} finally {
  await mongoose.disconnect();
}
