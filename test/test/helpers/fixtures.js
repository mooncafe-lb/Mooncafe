'use strict';
const { createTestDb } = require('./db');
const { CATEGORIES } = require('../../server/seed/menu');

// Loads the real menu (same data as migration 003) plus the settings rows migration 001/002 seed.
async function seedMenu(db) {
  let sort = 0;
  for (const cat of CATEGORIES) {
    const cid = (await db.query('INSERT INTO categories (name_ar, name_en, sort_order) VALUES ($1,$2,$3) RETURNING id', [cat.ar, cat.en, ++sort])).rows[0].id;
    let psort = 0;
    for (const p of cat.products) {
      const def = typeof p === 'string' ? { name: p, groups: [] } : p;
      const pid = (await db.query('INSERT INTO products (category_id, name_ar, name_en, sort_order) VALUES ($1,$2,$3,$4) RETURNING id', [cid, def.name, def.name, ++psort])).rows[0].id;
      if (cat.prices) {
        await db.query('INSERT INTO product_sizes (product_id, name_ar, name_en, price_lbp, sort_order) VALUES ($1,$2,$3,$4,0)', [pid, 'وسط', 'Medium', cat.prices[0]]);
        await db.query('INSERT INTO product_sizes (product_id, name_ar, name_en, price_lbp, sort_order) VALUES ($1,$2,$3,$4,1)', [pid, 'كبير', 'Large', cat.prices[1]]);
      } else {
        await db.query('INSERT INTO product_sizes (product_id, name_ar, name_en, price_lbp, sort_order) VALUES ($1,$2,$3,NULL,0)', [pid, 'عادي', 'Regular']);
      }
      let gsort = 0;
      for (const g of def.groups || []) {
        const gid = (await db.query('INSERT INTO option_groups (product_id, name_ar, name_en, selection, is_required, sort_order) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
          [pid, g.ar, g.en, 'single', g.required, ++gsort])).rows[0].id;
        let csort = 0;
        for (const [en, ar] of g.choices) await db.query('INSERT INTO option_choices (group_id, name_ar, name_en, sort_order) VALUES ($1,$2,$3,$4)', [gid, ar, en, ++csort]);
      }
    }
  }
}

async function setSetting(db, key, value) {
  await db.query('INSERT INTO settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', [key, JSON.stringify(value)]);
}

const OPEN_ALL_DAY = Object.fromEntries(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map((d) => [d, [{ open: '00:00', close: '24:00' }]]));

async function freshDb({ open = true } = {}) {
  const db = createTestDb();
  await setSetting(db, 'store', { name_en: 'Moon Cafe', name_ar: '', tagline_ar: 'نحنا والقمر جيران', address: '', phone: '', hours: '' });
  await setSetting(db, 'whatsapp', { number: '+96178964984', enabled: true, message_template: '' });
  await setSetting(db, 'delivery', { delivery_enabled: true, pickup_enabled: true, delivery_fee_lbp: 50000, min_order_lbp: 0, note_ar: '', note_en: '' });
  await setSetting(db, 'branding', { primary_color: '#FFC000', logo_image_id: null });
  await setSetting(db, 'store_status', { mode: open ? 'force_open' : 'auto', timezone: 'Asia/Beirut' });
  await setSetting(db, 'opening_hours', { sun: [], mon: [], tue: [], wed: [], thu: [], fri: [], sat: [] });
  await seedMenu(db);
  return db;
}

module.exports = { freshDb, seedMenu, setSetting, OPEN_ALL_DAY };
