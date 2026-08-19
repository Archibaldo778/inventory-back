import dotenv from 'dotenv';
import mongoose from 'mongoose';

import BeverageItem from '../models/BeverageItem.js';

dotenv.config({ path: '.env.development' });
dotenv.config({ path: '.env' });

const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const production = args.has('--production');

if (!production) throw new Error('Refusing to run without the explicit --production target');

const mongoUri = String(process.env.MONGO_URI_PROD || '').trim();
if (!mongoUri) throw new Error('MONGO_URI_PROD is required');

const packageTag = 'Beverage Package';
const tier1 = 'Tier 1';
const tier2 = 'Tier 2';

const rows = [
  { name: "Tito's Handmade Vodka", brand: "Tito's", category: 'Hard Liquors', subCategory: 'Vodka', tiers: [tier1], aliases: ["Tito's"], matchNames: ["Tito's Handmade Vodka"] },
  { name: 'Beefeater Gin', brand: 'Beefeater', category: 'Hard Liquors', subCategory: 'Gin', tiers: [tier1], aliases: ['Beefeater'] },
  { name: 'Espolòn Blanco Tequila', brand: 'Espolòn', category: 'Hard Liquors', subCategory: 'Tequila', tiers: [tier1], aliases: ['Espolon Tequila Blanco'], matchNames: ['Espolon Blanco Tequila'] },
  { name: 'Johnnie Walker Red Label Scotch', brand: 'Johnnie Walker', category: 'Hard Liquors', subCategory: 'Scotch Whisky', tiers: [tier1], aliases: ['Johnnie Walker Red Label Scotch'], matchNames: ['Johnnie Walker Red Label'] },
  { name: "Brother's Bond Bourbon", brand: "Brother's Bond", category: 'Hard Liquors', subCategory: 'Bourbon', tiers: [tier1], aliases: ['Brothers Bond Bourbon'], matchNames: ["Brother's Bond Bourbon"] },
  { name: 'Bacardi Superior Rum', brand: 'Bacardi', category: 'Hard Liquors', subCategory: 'Rum', tiers: [tier1], aliases: ['Bacardi Rum'], matchNames: ['Bacardi Superior Rum'] },
  { name: 'Sweet Vermouth', brand: '', category: 'Hard Liquors', subCategory: 'Vermouth', tiers: [tier1, tier2], aliases: ['Sweet Vermouth'] },
  { name: 'Dry Vermouth', brand: '', category: 'Hard Liquors', subCategory: 'Vermouth', tiers: [tier1, tier2], aliases: ['Dry Vermouth'] },
  { name: 'Pierre Ferrand Orange Curaçao', brand: 'Pierre Ferrand', category: 'Hard Liquors', subCategory: 'Liqueur', tiers: [tier1, tier2], aliases: ['Pierre Ferrand Orange Curacao'], matchNames: ['Pierre Ferrand Dry Curacao'] },
  { name: 'Aperol', brand: 'Aperol', category: 'Hard Liquors', subCategory: 'Aperitif', tiers: [tier1], aliases: ['Aperol'] },
  { name: 'Kahlúa', brand: 'Kahlúa', category: 'Hard Liquors', subCategory: 'Liqueur', tiers: [tier1, tier2], aliases: ['Kahlua'] },
  { name: 'Campari', brand: 'Campari', category: 'Hard Liquors', subCategory: 'Aperitif', tiers: [tier1, tier2], aliases: ['Campari'] },
  { name: 'Beer (Assorted)', brand: '', category: 'Beer', subCategory: 'Beer', unitType: 'case', tiers: [tier1, tier2], aliases: ['Beer Assorted'] },
  { name: 'Pinot Blanc, Schlumberger', brand: 'Schlumberger', category: 'Wine', subCategory: 'White Wine', tiers: [tier1], aliases: ['Pinot Blanc, Schlumberger (White)'], matchNames: ['Pinot Blanc Schlumberger'] },
  { name: 'Côtes du Rhône, Delas Frères', brand: 'Delas Frères', category: 'Wine', subCategory: 'Red Wine', tiers: [tier1], aliases: ['Côtes du Rhône, Delas Frères (Red)'], matchNames: ['Cotes du Rhone Delas', 'Côtes du Rhône, Delas'] },
  { name: 'Peyrassol La Croix Provence Rosé', brand: 'Peyrassol', category: 'Wine', subCategory: 'Rosé Wine', tiers: [tier1], aliases: ['Peyrassol, "La Croix" Provence Rosé'] },
  { name: 'FIOL Prosecco', brand: 'FIOL', category: 'Wine', subCategory: 'Sparkling Wine', tiers: [tier1], aliases: ['Prosecco, Fiol'], matchNames: ['FIOL Prosecco'] },
  { name: 'Louis Roederer Brut Collection Champagne', brand: 'Louis Roederer', category: 'Wine', subCategory: 'Champagne', tiers: [tier1, tier2], aliases: ['Champagne, Louis Roederer Brut Collection', 'Louis Roederer Brut Collection Champagne'] },
  { name: 'Belvedere Vodka', brand: 'Belvedere', category: 'Hard Liquors', subCategory: 'Vodka', tiers: [tier2], aliases: ['Belvedere'] },
  { name: 'Grey Goose Vodka', brand: 'Grey Goose', category: 'Hard Liquors', subCategory: 'Vodka', tiers: [tier2], aliases: ['Grey Goose'] },
  { name: "Hendrick's Gin", brand: "Hendrick's", category: 'Hard Liquors', subCategory: 'Gin', tiers: [tier2], aliases: ["Hendrick's"] },
  { name: 'Patrón Silver Tequila', brand: 'Patrón', category: 'Hard Liquors', subCategory: 'Tequila', tiers: [tier2], aliases: ['Patron Silver'] },
  { name: 'Casamigos Blanco Tequila', brand: 'Casamigos', category: 'Hard Liquors', subCategory: 'Tequila', tiers: [tier2], aliases: ['Casamigos Blanco'] },
  { name: "Michter's Rye Whiskey", brand: "Michter's", category: 'Hard Liquors', subCategory: 'Rye Whiskey', tiers: [tier2], aliases: ["Michter's Rye Whiskey"] },
  { name: 'Bulleit Bourbon', brand: 'Bulleit', category: 'Hard Liquors', subCategory: 'Bourbon', tiers: [tier2], aliases: ['Bulleit Bourbon'] },
  { name: 'The Macallan 12 Year Single Malt Scotch', brand: 'The Macallan', category: 'Hard Liquors', subCategory: 'Scotch Whisky', tiers: [tier2], aliases: ['Macallan 12-Year Single Malt Scotch'] },
  { name: 'Johnnie Walker Black Label Scotch', brand: 'Johnnie Walker', category: 'Hard Liquors', subCategory: 'Scotch Whisky', tiers: [tier2], aliases: ['Johnnie Walker Black Label Scotch'] },
  { name: 'El Dorado 12 Year Rum', brand: 'El Dorado', category: 'Hard Liquors', subCategory: 'Rum', tiers: [tier2], aliases: ['El Dorado 12 Yr'] },
  { name: 'Del Maguey Vida Mezcal', brand: 'Del Maguey', category: 'Hard Liquors', subCategory: 'Mezcal', tiers: [tier2], aliases: ['Del Maguey Vida mezcal'] },
  { name: 'Sancerre, Romain Reverdy', brand: 'Romain Reverdy', category: 'Wine', subCategory: 'White Wine', tiers: [tier2], aliases: ['Sancerre, Romain Reverdy (White)'] },
  { name: 'Chablis, Gérard Tremblay', brand: 'Gérard Tremblay', category: 'Wine', subCategory: 'White Wine', tiers: [tier2], aliases: ['Chablis, Gerard Tremblay (White)'] },
  { name: 'Bench Sonoma Coast Pinot Noir', brand: 'Bench', category: 'Wine', subCategory: 'Red Wine', tiers: [tier2], aliases: ['Pinot Noir, Bench Sonoma Coast (Red)'] },
  { name: 'Vieux Château Saint André Bordeaux', brand: 'Vieux Château Saint André', category: 'Wine', subCategory: 'Red Wine', tiers: [tier2], aliases: ['Bordeaux, Vieux Chateau St Andre (Red)'] },
  { name: 'Domaines Ott By.Ott Rosé', brand: 'Domaines Ott', category: 'Wine', subCategory: 'Rosé Wine', tiers: [tier2], aliases: ['By Ott (Rosé)'] },
  { name: 'Laurent-Perrier Champagne', brand: 'Laurent-Perrier', category: 'Wine', subCategory: 'Champagne', tiers: [tier2], aliases: ['Laurent Perrier', 'Champagne, Laurent Perrier'] },
];

const normalize = (value) => String(value || '')
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

const unique = (values) => [...new Set(values.filter(Boolean))];

await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 15000 });

try {
  const existing = await BeverageItem.find()
    .select('+purchaseCost +stockOnHand +inventoryMovements +supplier')
    .lean();
  const byName = new Map();
  existing.forEach((item) => {
    unique([item.name, ...(item.aliases || [])]).forEach((value) => {
      const key = normalize(value);
      if (!key) return;
      const matches = byName.get(key) || [];
      matches.push(item);
      byName.set(key, matches);
    });
  });

  let inserted = 0;
  let updated = 0;
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const lookupNames = unique([row.name, ...(row.aliases || []), ...(row.matchNames || [])]);
    const matches = unique(lookupNames.flatMap((value) => byName.get(normalize(value)) || []));
    const tags = unique([packageTag, ...row.tiers]);

    if (!matches.length) {
      console.log(`INSERT ${row.name} [${row.tiers.join(', ')}]`);
      if (apply) {
        const created = await BeverageItem.create({
          name: row.name,
          brand: row.brand,
          description: `Listed in ${row.tiers.join(' and ')} beverage package.`,
          category: row.category,
          subCategory: row.subCategory,
          categories: [row.category],
          tags,
          aliases: unique(row.aliases || []),
          isAlcohol: true,
          sku: `BAR-PKG-${String(index + 1).padStart(3, '0')}`,
          unitType: row.unitType || 'bottle',
          purchaseCost: 0,
          bottleSizeMl: null,
          stockOnHand: 0,
          reorderLevel: 0,
          inventoryMovements: [],
          active: true,
        });
        inserted += 1;
        unique([created.name, ...(created.aliases || [])]).forEach((value) => {
          const key = normalize(value);
          byName.set(key, [...(byName.get(key) || []), created.toObject()]);
        });
      }
      continue;
    }

    for (const current of matches) {
      console.log(`UPDATE ${current.name} <- ${row.name} [${row.tiers.join(', ')}]`);
      if (!apply) continue;
      await BeverageItem.updateOne({ _id: current._id }, {
        $set: {
          active: true,
          isAlcohol: true,
          category: current.category || row.category,
          subCategory: current.subCategory || row.subCategory,
          categories: unique([current.category || row.category, ...(current.categories || []), row.category]),
          tags: unique([...(current.tags || []), ...tags]),
          aliases: unique([...(current.aliases || []), ...(row.aliases || [])]),
        },
      }, { runValidators: true });
      updated += 1;
    }
  }

  console.log(apply
    ? `Tier package inventory import complete: ${inserted} inserted, ${updated} existing records updated.`
    : `Dry run complete: ${rows.length} unique spreadsheet beverages. Re-run with --apply to write.`);
} finally {
  await mongoose.disconnect();
}
