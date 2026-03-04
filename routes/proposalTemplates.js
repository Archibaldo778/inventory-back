import { Router } from 'express';
import crypto from 'crypto';
import ProposalTemplate from '../models/ProposalTemplate.js';
import Proposal from '../models/Proposal.js';

const router = Router();

const DEFAULT_TEMPLATE_PAYLOADS = [
  {
    key: 'passed-hors-seafood-select-6',
    title: "Passed Hors D'Oeuvres - Seafood (Select 6)",
    section: 'food',
    subSection: "passed hors d'oeuvres",
    type: 'group',
    sourcePages: [5],
    sourceLabel: 'S/S 2026 p.5',
    defaultSelectCount: 6,
    minSelectCount: 1,
    maxSelectCount: 6,
    tags: ['passed', 'seafood', 'seasonal'],
    sortOrder: 10,
    options: [
      { key: 'crab-cucumber-gazpacho', name: 'Crab, cucumber gazpacho, compressed melon', dietary: ['GF'], defaultSelected: true },
      { key: 'spicy-hamachi-taco', name: 'Spicy hamachi taco, smoked trout roe, yuzu, avocado, fresno chili, taro tortilla', dietary: ['GF', 'NF'], defaultSelected: true },
      { key: 'crab-white-chocolate-caviar', name: 'Crab, white chocolate, caviar, milk bread toast', dietary: ['NF'], defaultSelected: true },
      { key: 'smoked-salmon-bagel', name: 'Smoked salmon mini buckwheat everything bagel', dietary: ['GF', 'NF'], defaultSelected: true },
      { key: 'watermelon-crab', name: 'Compressed watermelon, crab, creme fraiche, finger lime', dietary: ['GF', 'NF'], defaultSelected: true },
      { key: 'garlic-prawns-rice-cake', name: 'Crispy coconut rice cake, garlic prawns, espelette, mango', dietary: ['GF', 'DF', 'NF'], defaultSelected: true },
    ],
  },
  {
    key: 'passed-hors-meat-select-6',
    title: "Passed Hors D'Oeuvres - Meat (Select 6)",
    section: 'food',
    subSection: "passed hors d'oeuvres",
    type: 'group',
    sourcePages: [5],
    sourceLabel: 'S/S 2026 p.5',
    defaultSelectCount: 6,
    minSelectCount: 1,
    maxSelectCount: 6,
    tags: ['passed', 'meat', 'seasonal'],
    sortOrder: 20,
    options: [
      { key: 'truffled-corndog', name: 'Truffled corndog', dietary: ['NF'], defaultSelected: true },
      { key: 'pork-belly-tostada', name: 'Pork belly tostada, pineapple salsa, umami puree', dietary: ['DF', 'GF', 'NF'], defaultSelected: true },
      { key: 'chicken-caesar-salad-bite', name: 'Chicken caesar salad, parmesan shortbread, nasturtium', dietary: ['NF'], defaultSelected: true },
      { key: 'korean-short-rib-bao', name: 'Korean braised short rib, crispy bao bun, kimchi, spicy miso aioli', dietary: ['DF', 'NF'], defaultSelected: true },
      { key: 'beef-tartare-potato', name: 'Beef tartare, crispy potato pave, egg yolk, pickled pearl onion', dietary: ['GF', 'NF'], defaultSelected: true },
      { key: 'wagyu-caviar', name: 'Wagyu beef, horseradish creme fraiche, caviar', dietary: ['NF'], defaultSelected: true, supplementPrice: 4 },
    ],
  },
  {
    key: 'passed-sweets-orchard',
    title: 'Passed Sweets - The Orchard',
    section: 'sweets',
    subSection: 'passed sweets',
    type: 'group',
    sourcePages: [81],
    sourceLabel: 'S/S 2026 p.81',
    defaultSelectCount: 3,
    minSelectCount: 1,
    maxSelectCount: 6,
    tags: ['sweets', 'passed'],
    sortOrder: 30,
    options: [
      { key: 'black-cherry', name: 'The black cherry', dietary: ['NF'], defaultSelected: true },
      { key: 'berry-choux', name: 'Berry choux puff', dietary: ['NF'], defaultSelected: true },
      { key: 'strawberry-opera', name: 'Strawberry lemon opera', defaultSelected: true },
      { key: 'fresh-fruit-skewer', name: 'Fresh fruit skewer', dietary: ['GF', 'Vegan'], defaultSelected: false },
      { key: 'peach-pistachio-tart', name: 'Peach pistachio tart', defaultSelected: false },
      { key: 'almond-joy', name: 'Almond joy', dietary: ['NF'], defaultSelected: false },
    ],
  },
  {
    key: 'placed-sweets-select-3',
    title: 'Placed Sweets (Select 3)',
    section: 'sweets',
    subSection: 'placed sweets',
    type: 'group',
    sourcePages: [82],
    sourceLabel: 'S/S 2026 p.82',
    defaultSelectCount: 3,
    minSelectCount: 1,
    maxSelectCount: 6,
    tags: ['sweets', 'placed'],
    sortOrder: 40,
    options: [
      { key: 'blueberry-cheesecake', name: 'Blueberry white chocolate cheesecake', dietary: ['NF'], defaultSelected: true },
      { key: 'nectarine-brown-butter', name: 'Nectarine brown butter tart', defaultSelected: true },
      { key: 'vegan-strawberry-rhubarb', name: 'Vegan strawberry rhubarb tartlet', dietary: ['NF', 'Vegan'], defaultSelected: true },
      { key: 'almond-joy-placed', name: 'Almond joy', dietary: ['NF'], defaultSelected: false },
      { key: 'peach-pistachio-placed', name: 'Peach pistachio tart', defaultSelected: false },
    ],
  },
  {
    key: 'dessert-make-your-own-sundae-station',
    title: 'Make Your Own Sundae Station',
    section: 'sweets',
    subSection: 'stations',
    type: 'station',
    sourcePages: [84],
    sourceLabel: 'S/S 2026 p.84',
    basePrice: null,
    priceUnit: 'per_person',
    defaultSelectCount: 3,
    minSelectCount: 3,
    maxSelectCount: 8,
    tags: ['sweets', 'station', 'interactive'],
    sortOrder: 50,
    options: [
      { key: 'ice-cream-vanilla', name: 'Ice cream: Vanilla', defaultSelected: true },
      { key: 'ice-cream-milk-chocolate', name: 'Ice cream: Milk chocolate', defaultSelected: true },
      { key: 'ice-cream-strawberry', name: 'Ice cream: Strawberry', defaultSelected: true },
      { key: 'topping-hot-fudge', name: 'Topping: Hot fudge' },
      { key: 'topping-caramel', name: 'Topping: Caramel sauce' },
      { key: 'topping-marshmallow', name: 'Topping: Marshmallow' },
      { key: 'topping-rainbow-sprinkles', name: 'Topping: Rainbow sprinkles' },
    ],
  },
  {
    key: 'dessert-make-your-own-cupcake-station',
    title: 'Make Your Own Cupcake Station',
    section: 'sweets',
    subSection: 'stations',
    type: 'station',
    sourcePages: [85],
    sourceLabel: 'S/S 2026 p.85',
    basePrice: null,
    priceUnit: 'per_person',
    defaultSelectCount: 6,
    minSelectCount: 4,
    maxSelectCount: 12,
    tags: ['sweets', 'station', 'interactive'],
    sortOrder: 51,
    options: [
      { key: 'cupcake-devils-food', name: 'Cake base: Devil’s food', defaultSelected: true },
      { key: 'cupcake-vanilla', name: 'Cake base: Vanilla', defaultSelected: true },
      { key: 'cupcake-carrot', name: 'Cake base: Carrot' },
      { key: 'cupcake-banana', name: 'Cake base: Banana' },
      { key: 'frosting-chocolate', name: 'Frosting: Chocolate', defaultSelected: true },
      { key: 'frosting-vanilla', name: 'Frosting: Vanilla', defaultSelected: true },
      { key: 'frosting-cream-cheese', name: 'Frosting: Cream cheese' },
      { key: 'topping-rainbow-sprinkles-cupcake', name: 'Topping: Rainbow sprinkles' },
      { key: 'topping-mini-mms-cupcake', name: 'Topping: Mini M&M’s' },
      { key: 'topping-chocolate-chip-cupcake', name: 'Topping: Chocolate chips' },
    ],
  },
  {
    key: 'dessert-liege-waffle-station',
    title: 'Liege Waffle Station',
    section: 'sweets',
    subSection: 'stations',
    type: 'station',
    sourcePages: [86],
    sourceLabel: 'S/S 2026 p.86',
    basePrice: null,
    priceUnit: 'per_person',
    defaultSelectCount: 5,
    minSelectCount: 3,
    maxSelectCount: 10,
    tags: ['sweets', 'station', 'interactive'],
    sortOrder: 52,
    options: [
      { key: 'waffle-powdered-sugar', name: 'Powdered sugar', defaultSelected: true },
      { key: 'waffle-whipped-cream', name: 'Whipped cream', defaultSelected: true },
      { key: 'waffle-maple-syrup', name: 'Maple syrup', defaultSelected: true },
      { key: 'waffle-berries', name: 'Berries', defaultSelected: true },
      { key: 'waffle-hot-fudge', name: 'Hot fudge', defaultSelected: true },
      { key: 'waffle-bananas', name: 'Bananas' },
      { key: 'waffle-caramel', name: 'Caramel sauce' },
      { key: 'waffle-nutella', name: 'Nutella' },
    ],
  },
  {
    key: 'dessert-cake-walk',
    title: 'Cake Walk',
    section: 'sweets',
    subSection: 'stations',
    type: 'station',
    sourcePages: [87],
    sourceLabel: 'S/S 2026 p.87',
    basePrice: null,
    priceUnit: 'per_person',
    defaultSelectCount: 6,
    minSelectCount: 4,
    maxSelectCount: 10,
    tags: ['sweets', 'station'],
    sortOrder: 53,
    options: [
      { key: 'cakewalk-banana-cream', name: 'Banana cream pie', defaultSelected: true },
      { key: 'cakewalk-blueberry-crumb', name: 'Blueberry crumb pie', defaultSelected: true },
      { key: 'cakewalk-key-lime', name: 'Key lime pie', defaultSelected: true },
      { key: 'cakewalk-lemon-meringue', name: 'Lemon meringue pie', defaultSelected: true },
      { key: 'cakewalk-smores', name: 'S’mores tartlet', defaultSelected: true },
      { key: 'cakewalk-strawberry-rhubarb', name: 'Strawberry rhubarb pie', defaultSelected: true },
      { key: 'cakewalk-cherry', name: 'Cherry pie' },
      { key: 'cakewalk-peach', name: 'Peach pie' },
    ],
  },
  {
    key: 'dessert-mason-jars-station',
    title: 'Mason Jars Station',
    section: 'sweets',
    subSection: 'stations',
    type: 'station',
    sourcePages: [88],
    sourceLabel: 'S/S 2026 p.88',
    basePrice: null,
    priceUnit: 'per_person',
    defaultSelectCount: 4,
    minSelectCount: 3,
    maxSelectCount: 8,
    tags: ['sweets', 'station'],
    sortOrder: 54,
    options: [
      { key: 'mason-dark-chocolate-pudding', name: 'Dark chocolate pudding, salted caramel whipped cream', defaultSelected: true },
      { key: 'mason-apple-crumble', name: 'Apple crumble pie in a mason jar', defaultSelected: true },
      { key: 'mason-banana-cream', name: 'Banana cream pie', defaultSelected: true },
      { key: 'mason-coconut-tapioca', name: 'Coconut tapioca pudding, passion fruit curd', defaultSelected: true },
      { key: 'mason-butterscotch', name: 'Butterscotch pudding', defaultSelected: false },
      { key: 'mason-lime-cheesecake', name: 'Lime cheesecake', defaultSelected: false },
    ],
  },
  {
    key: 'dessert-magnum-ice-cream-bar',
    title: 'Magnum Make Your Own Ice Cream Bar',
    section: 'sweets',
    subSection: 'stations',
    type: 'station',
    sourcePages: [90],
    sourceLabel: 'S/S 2026 p.90',
    basePrice: null,
    priceUnit: 'per_person',
    defaultSelectCount: 5,
    minSelectCount: 3,
    maxSelectCount: 10,
    tags: ['sweets', 'station', 'interactive'],
    sortOrder: 55,
    options: [
      { key: 'magnum-vanilla-bar', name: 'Ice cream bar: Vanilla', defaultSelected: true },
      { key: 'magnum-chocolate-bar', name: 'Ice cream bar: Chocolate', defaultSelected: true },
      { key: 'magnum-milk-chocolate-dip', name: 'Dip: Milk chocolate', defaultSelected: true },
      { key: 'magnum-dark-chocolate-dip', name: 'Dip: Dark chocolate', defaultSelected: true },
      { key: 'magnum-white-chocolate-dip', name: 'Dip: White chocolate', defaultSelected: true },
      { key: 'magnum-nuts', name: 'Topping: Chopped nuts' },
      { key: 'magnum-sprinkles', name: 'Topping: Sprinkles' },
      { key: 'magnum-coconut', name: 'Topping: Coconut flakes' },
    ],
  },
  {
    key: 'dessert-composed-ice-cream-sundaes',
    title: 'Composed Ice Cream Sundaes',
    section: 'sweets',
    subSection: 'placed sweets',
    type: 'group',
    sourcePages: [91],
    sourceLabel: 'S/S 2026 p.91',
    basePrice: null,
    priceUnit: 'per_person',
    defaultSelectCount: 3,
    minSelectCount: 1,
    maxSelectCount: 6,
    tags: ['sweets', 'composed', 'sundaes'],
    sortOrder: 56,
    options: [
      { key: 'sundae-vanilla-strawberry-shortcake', name: 'Vanilla strawberry shortcake', defaultSelected: true },
      { key: 'sundae-hot-fudge-brownie', name: 'Hot fudge brownie', defaultSelected: true },
      { key: 'sundae-banana-split', name: 'Banana split', defaultSelected: true },
      { key: 'sundae-smore', name: 'S’more sundae', defaultSelected: false },
      { key: 'sundae-salted-caramel', name: 'Salted caramel crunch sundae', defaultSelected: false },
    ],
  },
  {
    key: 'station-farmers-market-55',
    title: "Farmer's Market Station",
    section: 'stations',
    subSection: 'food stations',
    type: 'station',
    sourcePages: [24],
    sourceLabel: 'S/S 2026 p.24',
    basePrice: 55,
    priceUnit: 'per_person',
    defaultSelectCount: 3,
    minSelectCount: 3,
    maxSelectCount: 3,
    tags: ['station', 'food'],
    sortOrder: 60,
    options: [
      { key: 'fm-short-rib', name: 'Black garlic braised short rib, mashed peas, charred radish', supplementPrice: 5, defaultSelected: true, sectionCategory: 'Meat' },
      { key: 'fm-striped-bass', name: 'Striped bass, corn and leek succotash, haricot vert, cherry tomatoes', defaultSelected: true, sectionCategory: 'Fish' },
      { key: 'fm-heirloom-tomato', name: 'Heirloom tomato salad, burrata, herbed croutons', defaultSelected: true, sectionCategory: 'Vegetarian' },
      { key: 'fm-cedar-salmon', name: 'Cedar planked salmon, Meyer lemon salsa verde', supplementPrice: 5, sectionCategory: 'Fish' },
      { key: 'fm-ny-strip', name: 'NY strip steak, chimichurri, chive flowers', sectionCategory: 'Meat' },
    ],
  },
  {
    key: 'station-raw-bar-50',
    title: 'Raw Bar',
    section: 'stations',
    subSection: 'food stations',
    type: 'station',
    sourcePages: [39],
    sourceLabel: 'S/S 2026 p.39',
    basePrice: 50,
    priceUnit: 'per_person',
    defaultSelectCount: 3,
    minSelectCount: 3,
    maxSelectCount: 3,
    tags: ['station', 'seafood'],
    sortOrder: 70,
    options: [
      { key: 'rb-east-west-oysters', name: 'East & west coast oysters', defaultSelected: true, sectionCategory: 'Seafood' },
      { key: 'rb-littleneck-clams', name: 'Little neck clams', defaultSelected: true, sectionCategory: 'Seafood' },
      { key: 'rb-jumbo-shrimp', name: 'Jumbo shrimp cocktail', defaultSelected: true, sectionCategory: 'Seafood' },
      { key: 'rb-lobster-tail', name: 'Poached lobster tail', supplementPrice: 8, sectionCategory: 'Seafood' },
    ],
  },
  {
    key: 'beverage-select-package-45',
    title: 'Select Beverage Package',
    section: 'beverage',
    subSection: 'beverage packages',
    type: 'package',
    sourcePages: [110],
    sourceLabel: 'S/S 2026 p.110',
    basePrice: 45,
    priceUnit: 'per_person',
    additionalHourPrice: 10,
    defaultSelectCount: 1,
    minSelectCount: 1,
    maxSelectCount: 3,
    tags: ['beverage', 'package'],
    sortOrder: 80,
    options: [
      { key: 'bev-signature-cocktail-1', name: '1 Signature Cocktail included', defaultSelected: true },
      { key: 'bev-add-second-cocktail', name: 'Add second signature cocktail', supplementPrice: 12 },
      { key: 'bev-add-mocktail', name: 'Add non-alcoholic mocktail', supplementPrice: 10 },
      { key: 'bev-upgrade-champagne', name: 'Upgrade to Champagne Louis Roederer', supplementPrice: 8 },
    ],
  },
  {
    key: 'beverage-premium-package-60',
    title: 'Premium Beverage Package',
    section: 'beverage',
    subSection: 'beverage packages',
    type: 'package',
    sourcePages: [111],
    sourceLabel: 'S/S 2026 p.111',
    basePrice: 60,
    priceUnit: 'per_person',
    additionalHourPrice: 15,
    defaultSelectCount: 1,
    minSelectCount: 1,
    maxSelectCount: 3,
    tags: ['beverage', 'package', 'premium'],
    sortOrder: 90,
    options: [
      { key: 'premium-two-cocktails', name: '2 Signature Cocktails included', defaultSelected: true },
      { key: 'premium-add-mocktail', name: 'Add signature mocktail', supplementPrice: 10 },
      { key: 'premium-spirits-upgrade', name: 'Premium spirits list', defaultSelected: false },
    ],
  },
  {
    key: 'beverage-select-wine-30',
    title: 'Select Wine Package',
    section: 'beverage',
    subSection: 'wine packages',
    type: 'package',
    sourcePages: [112],
    sourceLabel: 'S/S 2026 p.112',
    basePrice: 30,
    priceUnit: 'per_person',
    additionalHourPrice: 5,
    defaultSelectCount: 2,
    minSelectCount: 1,
    maxSelectCount: 4,
    tags: ['beverage', 'wine'],
    sortOrder: 100,
    options: [
      { key: 'wine-select-sparkling', name: 'Sparkling: Prosecco, Fiol', defaultSelected: true },
      { key: 'wine-select-white', name: 'White: Pinot Blanc, Schlumberger', defaultSelected: true },
      { key: 'wine-select-red', name: 'Red: Cotes du Rhone, Delas Freres' },
      { key: 'wine-select-rose', name: 'Rose: Peyrassol, La Croix Rose' },
      { key: 'wine-select-upgrade-champagne', name: 'Upgrade to Champagne', supplementPrice: 8 },
    ],
  },
  {
    key: 'bar-upgrade-ice',
    title: 'Bar Upgrade - Ice Program',
    section: 'beverage',
    subSection: 'bar upgrades',
    type: 'upgrade',
    sourcePages: [130],
    sourceLabel: 'S/S 2026 p.130',
    defaultSelectCount: 1,
    minSelectCount: 0,
    maxSelectCount: 2,
    tags: ['beverage', 'upgrade'],
    sortOrder: 110,
    options: [
      { key: 'large-square-ice', name: 'Large square ice cubes', supplementPrice: 2.5, priceUnit: 'per_unit', defaultSelected: false },
      { key: 'engraved-ice', name: 'Engraved ice cubes', supplementPrice: 5.5, priceUnit: 'per_unit', defaultSelected: false },
    ],
  },
];

const trimStr = (value) => {
  if (value === undefined || value === null) return '';
  return String(value).trim();
};

const parseNumber = (value, fallback = null) => {
  if (value === undefined || value === null || value === '') return fallback;
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return num;
};

const parseStringArray = (value) => {
  if (value === undefined || value === null || value === '') return [];
  if (Array.isArray(value)) return value.map((entry) => trimStr(entry)).filter(Boolean);
  return String(value)
    .split(',')
    .map((entry) => trimStr(entry))
    .filter(Boolean);
};

const toBool = (value, fallback = false) => {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).toLowerCase().trim();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
};

const sanitizeTemplateOption = (option = {}, index = 0) => ({
  key: trimStr(option.key),
  name: trimStr(option.name),
  description: trimStr(option.description),
  sourceType: trimStr(option.sourceType).toLowerCase() || 'custom',
  sourceRef: trimStr(option.sourceRef),
  dietary: parseStringArray(option.dietary),
  categories: parseStringArray(option.categories),
  sectionCategory: trimStr(option.sectionCategory),
  subCategory: trimStr(option.subCategory),
  supplementPrice: parseNumber(option.supplementPrice, 0) || 0,
  priceUnit: trimStr(option.priceUnit).toLowerCase() || 'per_person',
  defaultSelected: toBool(option.defaultSelected, false),
  sortOrder: parseNumber(option.sortOrder, index) || index,
  meta: option.meta && typeof option.meta === 'object' ? option.meta : {},
});

const sanitizeTemplatePayload = (body = {}, { partial = false } = {}) => {
  const payload = {};
  const setString = (key, value) => {
    if (value === undefined && partial) return;
    payload[key] = trimStr(value);
  };
  if (!partial || body.key !== undefined) setString('key', body.key);
  if (!partial || body.title !== undefined) setString('title', body.title);
  if (!partial || body.section !== undefined) setString('section', body.section);
  if (!partial || body.subSection !== undefined || body.sub_section !== undefined) {
    setString('subSection', body.subSection ?? body.sub_section);
  }
  if (!partial || body.type !== undefined) setString('type', trimStr(body.type).toLowerCase() || 'group');
  if (!partial || body.sourceLabel !== undefined) setString('sourceLabel', body.sourceLabel);
  if (!partial || body.currency !== undefined) setString('currency', body.currency || 'USD');

  if (!partial || body.basePrice !== undefined) payload.basePrice = parseNumber(body.basePrice, null);
  if (!partial || body.additionalHourPrice !== undefined) payload.additionalHourPrice = parseNumber(body.additionalHourPrice, null);
  if (!partial || body.priceUnit !== undefined) payload.priceUnit = trimStr(body.priceUnit).toLowerCase() || 'per_person';
  if (!partial || body.defaultSelectCount !== undefined) payload.defaultSelectCount = Math.max(0, parseNumber(body.defaultSelectCount, 0) || 0);
  if (!partial || body.minSelectCount !== undefined) payload.minSelectCount = Math.max(0, parseNumber(body.minSelectCount, 0) || 0);
  if (!partial || body.maxSelectCount !== undefined) payload.maxSelectCount = Math.max(0, parseNumber(body.maxSelectCount, 0) || 0);
  if (!partial || body.sortOrder !== undefined) payload.sortOrder = parseNumber(body.sortOrder, 0) || 0;

  if (!partial || body.isActive !== undefined) payload.isActive = toBool(body.isActive, true);

  if (!partial || body.sourcePages !== undefined) {
    payload.sourcePages = (Array.isArray(body.sourcePages) ? body.sourcePages : [])
      .map((value) => parseNumber(value, null))
      .filter((value) => Number.isFinite(value) && value > 0)
      .map((value) => Math.trunc(value));
  }

  if (!partial || body.tags !== undefined) payload.tags = parseStringArray(body.tags);

  if (!partial || body.options !== undefined) {
    const options = Array.isArray(body.options) ? body.options : [];
    payload.options = options
      .map((option, index) => sanitizeTemplateOption(option, index))
      .filter((option) => option.name);
  }

  if (!partial || body.meta !== undefined) {
    payload.meta = body.meta && typeof body.meta === 'object' ? body.meta : {};
  }

  if (!partial && !payload.key) throw new Error('key is required');
  if (!partial && !payload.title) throw new Error('title is required');

  return payload;
};

const serializeTemplate = (doc) => {
  const obj = typeof doc?.toObject === 'function' ? doc.toObject() : doc;
  return {
    ...obj,
    optionCount: Array.isArray(obj?.options) ? obj.options.length : 0,
  };
};

router.get('/', async (req, res) => {
  try {
    const query = {};
    const section = trimStr(req.query.section).toLowerCase();
    if (section) query.section = section;
    const type = trimStr(req.query.type).toLowerCase();
    if (type) query.type = type;
    if (req.query.active !== undefined) query.isActive = toBool(req.query.active, true);

    const search = trimStr(req.query.q);
    if (search) {
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      query.$or = [
        { title: { $regex: escaped, $options: 'i' } },
        { section: { $regex: escaped, $options: 'i' } },
        { subSection: { $regex: escaped, $options: 'i' } },
        { tags: { $regex: escaped, $options: 'i' } },
      ];
    }

    const docs = await ProposalTemplate.find(query).sort({ sortOrder: 1, title: 1 });
    res.json(docs.map(serializeTemplate));
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to list templates' });
  }
});

router.post('/seed-defaults', async (_req, res) => {
  try {
    const results = [];
    for (const payload of DEFAULT_TEMPLATE_PAYLOADS) {
      const sanitized = sanitizeTemplatePayload(payload, { partial: false });
      const doc = await ProposalTemplate.findOneAndUpdate(
        { key: sanitized.key },
        sanitized,
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      results.push(serializeTemplate(doc));
    }
    res.json({ ok: true, count: results.length, items: results });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Failed to seed templates' });
  }
});

router.post('/', async (req, res) => {
  try {
    const payload = sanitizeTemplatePayload(req.body || {}, { partial: false });
    const created = await ProposalTemplate.create(payload);
    res.status(201).json(serializeTemplate(created));
  } catch (err) {
    res.status(400).json({ error: err.message || 'Failed to create template' });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const updates = sanitizeTemplatePayload(req.body || {}, { partial: true });
    const updated = await ProposalTemplate.findByIdAndUpdate(req.params.id, updates, { new: true });
    if (!updated) return res.status(404).json({ error: 'Template not found' });
    res.json(serializeTemplate(updated));
  } catch (err) {
    res.status(400).json({ error: err.message || 'Failed to update template' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const deleted = await ProposalTemplate.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ error: 'Template not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Failed to delete template' });
  }
});

router.post('/:id/apply', async (req, res) => {
  try {
    const proposalId = trimStr(req.body?.proposalId);
    if (!proposalId) return res.status(400).json({ error: 'proposalId is required' });

    const template = await ProposalTemplate.findById(req.params.id);
    if (!template) return res.status(404).json({ error: 'Template not found' });

    const proposal = await Proposal.findById(proposalId);
    if (!proposal) return res.status(404).json({ error: 'Proposal not found' });

    const requestedIds = Array.isArray(req.body?.selectedOptionIds)
      ? req.body.selectedOptionIds.map((value) => trimStr(value)).filter(Boolean)
      : [];

    const allOptions = Array.isArray(template.options) ? template.options : [];
    const optionsById = new Map();
    allOptions.forEach((option) => {
      optionsById.set(String(option._id), option);
      if (option.key) optionsById.set(String(option.key), option);
    });

    let selectedOptions = [];
    if (requestedIds.length) {
      selectedOptions = requestedIds
        .map((id) => optionsById.get(String(id)))
        .filter(Boolean);
    }

    if (!selectedOptions.length) {
      selectedOptions = allOptions.filter((option) => option.defaultSelected);
    }

    if (!selectedOptions.length && template.defaultSelectCount > 0) {
      selectedOptions = allOptions.slice(0, template.defaultSelectCount);
    }

    const qty = Math.max(1, parseNumber(req.body?.qty, 1) || 1);
    const groupToken = crypto.randomUUID();
    const now = new Date().toISOString();

    const headerImage = trimStr(template?.meta?.headerImage ?? template?.meta?.header_image);

    const groupItem = {
      sourceType: template.section === 'beverage' ? 'beverage' : 'custom',
      sourceId: `template:${template.key}`,
      name: template.title,
      description: template.sourceLabel || '',
      image: headerImage || '',
      categories: [template.section, template.subSection].filter(Boolean),
      sectionCategory: template.section || '',
      subCategory: template.subSection || '',
      qty,
      unitPrice: template.basePrice,
      priceUnit: template.priceUnit || 'per_person',
      pricingNote: template.additionalHourPrice ? `+${template.additionalHourPrice}/hr` : '',
      snapshotMeta: {
        source: 'proposal-template',
        templateId: String(template._id),
        templateKey: template.key,
        templateType: template.type,
        templatePriceUnit: template.priceUnit,
        templateBasePrice: template.basePrice,
        templateHeaderImage: headerImage || '',
        groupToken,
        createdAt: now,
      },
    };

    proposal.items.push(groupItem);
    const createdItems = [proposal.items[proposal.items.length - 1]];

    selectedOptions.forEach((option, index) => {
      const supplementPrice = parseNumber(option.supplementPrice, 0) || 0;
      const supplementUnit = trimStr(option.priceUnit).toLowerCase() || 'per_person';
      proposal.items.push({
        sourceType: option.sourceType || 'custom',
        sourceId: option.sourceRef || option.key || '',
        name: option.name,
        description: option.description || '',
        dietary: Array.isArray(option.dietary) ? option.dietary : [],
        categories: Array.isArray(option.categories) && option.categories.length
          ? option.categories
          : [template.section, template.subSection].filter(Boolean),
        sectionCategory: option.sectionCategory || template.section || '',
        subCategory: option.subCategory || template.subSection || '',
        qty,
        unitPrice: supplementPrice > 0 ? supplementPrice : null,
        priceUnit: supplementPrice > 0 ? supplementUnit : 'flat',
        pricingNote: supplementPrice > 0 ? 'Supplement' : '',
        position: index,
        snapshotMeta: {
          source: 'proposal-template-option',
          templateId: String(template._id),
          templateKey: template.key,
          optionId: String(option._id),
          optionKey: option.key || '',
          groupToken,
          createdAt: now,
        },
      });
      createdItems.push(proposal.items[proposal.items.length - 1]);
    });

    await proposal.save();

    res.status(201).json({
      ok: true,
      template: serializeTemplate(template),
      addedCount: createdItems.length,
      addedItems: createdItems,
      proposal,
    });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Failed to apply template' });
  }
});

export default router;
