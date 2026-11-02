'use strict';
// Built-in copy of the printed Moon Cafe menu. It is used ONLY as a read-only fallback while the
// database migrations 002/003 have not been applied yet (so the site never shows an empty page).
// Once the database is ready, the menu always comes from the database and Admin edits it.
const MEDIUM_LARGE = [{ en: 'Medium', ar: 'وسط' }, { en: 'Large', ar: 'كبير' }];
const TEMPERATURE = { en: 'Temperature', ar: 'الحرارة', required: true, choices: [['Hot', 'ساخن'], ['Iced', 'مثلج']] };
const MOCHA_TYPE = { en: 'Type', ar: 'النوع', required: true, choices: [['Dark', 'داكن'], ['White', 'أبيض']] };

const CATEGORIES = [
  { en: 'Coffee', ar: 'القهوة', prices: null, products: [
    'Espresso', 'Cappuccino', 'Americano',
    { name: 'Mocha', groups: [MOCHA_TYPE] },
    { name: 'Hot Chocolate', groups: [{ en: 'Flavor', ar: 'النكهة', required: true, choices: [['Chocolate', 'شوكولا'], ['Blueberry', 'توت أزرق'], ['Strawberry', 'فراولة']] }] },
  ] },
  { en: 'Latte', ar: 'لاتيه', prices: [250000, 350000], products: [
    { name: 'Latte', groups: [TEMPERATURE, { en: 'Flavor', ar: 'النكهة', required: false, choices: [['Caramel', 'كراميل'], ['Vanilla', 'فانيلا'], ['Hazelnut', 'بندق'], ['Mocha', 'موكا'], ['Tiramisu', 'تيراميسو']] }] },
    ...['Spanish', 'Caramel Macchiato', 'Moon Caramel', 'Blue Vanilla', 'White Berry', 'Chocolate Passion'].map((name) => ({ name, groups: [TEMPERATURE] })),
  ] },
  { en: 'Milkshake', ar: 'ميلك شيك', prices: [250000, 350000], products: [
    'Caramel', 'Crunchy Lotus', 'Double Chocolate',
    { name: 'Matcha', groups: [{ en: 'Flavor', ar: 'النكهة', required: false, choices: [['Passion Fruit', 'باشن فروت'], ['Strawberry', 'فراولة'], ['Mango', 'مانجو'], ['Caramel', 'كراميل']] }] },
    'Snickers', 'Bounty', 'Oreo', 'Nutella', 'Brownie', 'Vanilla', 'Strawberry',
  ] },
  { en: 'Frappe', ar: 'فرابيه', prices: [250000, 350000], products: [
    'Caramel', 'Salted Caramel', 'Vanilla', { name: 'Mocha', groups: [MOCHA_TYPE] }, 'Tiramisu', 'Pistachio',
  ] },
  { en: 'Smoothie', ar: 'سموذي', prices: [200000, 300000], products: [
    'Mango', 'Passion Mango', 'Peach', 'Mixed Berry', 'Tropical Fruit',
  ] },
];

// Public menu shape (same as GET /api/menu), with stable fake ids.
function buildSeedMenu() {
  let pid = 0; let sid = 0; let gid = 0; let cid = 0;
  return CATEGORIES.map((cat) => ({
    id: ++cid,
    name_ar: cat.ar,
    name_en: cat.en,
    image_url: null,
    products: cat.products.map((p) => {
      const def = typeof p === 'string' ? { name: p, groups: [] } : p;
      const sizes = cat.prices
        ? MEDIUM_LARGE.map((s, i) => ({ id: ++sid, name_ar: s.ar, name_en: s.en, price_lbp: cat.prices[i] }))
        : [{ id: ++sid, name_ar: 'عادي', name_en: 'Regular', price_lbp: null }];
      return {
        id: ++pid,
        name_ar: def.name,
        name_en: def.name,
        description_ar: '',
        description_en: '',
        image_url: null,
        thumb_url: null,
        available: true,
        orderable: sizes.some((s) => s.price_lbp != null),
        sizes,
        groups: (def.groups || []).map((g) => ({
          id: ++gid,
          name_ar: g.ar,
          name_en: g.en,
          selection: 'single',
          required: g.required,
          max_choices: null,
          choices: g.choices.map(([en, ar], i) => ({ id: gid * 100 + i + 1, name_ar: ar, name_en: en, price_delta_lbp: 0 })),
        })),
      };
    }),
  }));
}

module.exports = { CATEGORIES, MEDIUM_LARGE, buildSeedMenu };
