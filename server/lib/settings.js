'use strict';
const S = require('./validate');
const { isValidTimezone, DAYS } = require('./hours');
const { normalizePhone } = require('./whatsapp');
const { httpError } = require('./util');

// Fonts the Admin may choose (all are on Google Fonts; a whitelist keeps the CSS link safe).
const FONTS_AR = ['Cairo', 'Tajawal', 'Almarai', 'Changa', 'El Messiri', 'Noto Kufi Arabic'];
const FONTS_EN = ['Poppins', 'Montserrat', 'Inter', 'DM Sans', 'Nunito', 'Playfair Display'];

const DEFAULTS = {
  store: {
    name_en: 'Moon Cafe', name_ar: 'مون كافيه', tagline_ar: 'نحنا والقمر جيران', tagline_en: 'We and the moon are neighbors',
    address: '', address_ar: '', phone: '',
  },
  whatsapp: { number: '+96178964984', enabled: true, message_template: '' },
  delivery: { delivery_enabled: true, pickup_enabled: true, delivery_fee_lbp: 0, min_order_lbp: 0, note_ar: '', note_en: '' },
  branding: {
    primary_color: '#FFC000', secondary_color: '#000000', surface_color: '#121212', page_background: '#000000',
    text_on_dark: '#FFFFFF', text_on_primary: '#000000', font_ar: 'Cairo', font_en: 'Poppins',
    logo_image_id: null, hero_image_id: null,
  },
  store_status: {
    mode: 'auto', timezone: 'Asia/Beirut',
    closed_message_ar: 'نحن مغلقون حالياً. يمكنك تصفح القائمة والطلب عند الافتتاح.',
    closed_message_en: 'We are currently closed. You can browse the menu and order when we open.',
  },
  opening_hours: { sun: [], mon: [], tue: [], wed: [], thu: [], fri: [], sat: [] },
  social: { instagram: '', facebook: '', tiktok: '' },
  content: {
    hero_title_ar: 'نحنا والقمر جيران', hero_title_en: 'We and the moon are neighbors',
    hero_text_ar: 'قهوة، لاتيه، ميلك شيك، فرابيه وسموذي. اختر مشروبك وأرسل طلبك عبر واتساب.',
    hero_text_en: 'Coffee, lattes, milkshakes, frappes and smoothies. Pick your drinks and send your order on WhatsApp.',
    banner_enabled: false, banner_ar: '', banner_en: '',
    footer_ar: '', footer_en: '',
    currency_ar: 'ل.ل.', currency_en: 'LBP',
    overrides: {},
  },
  promotions: { items: [] },
};

const T = (max = 300, opts = {}) => S.str({ max, def: '', ...opts });
const SHAPES = {
  store: S.obj({ name_en: T(80), name_ar: T(80), tagline_ar: T(120), tagline_en: T(120), address: T(200), address_ar: T(200), phone: T(30) }),
  whatsapp: S.obj({
    number: (v, p, e) => {
      const s = S.str({ min: 1, max: 30 })(v, p, e);
      if (s !== undefined && !normalizePhone(s)) e[p] = 'invalid_phone';
      return s;
    },
    enabled: S.bool({ def: true }),
    message_template: T(2000, { trim: false }),
  }),
  delivery: S.obj({
    delivery_enabled: S.bool({ def: true }), pickup_enabled: S.bool({ def: true }),
    delivery_fee_lbp: S.int({ min: 0, max: 100000000, def: 0 }), min_order_lbp: S.int({ min: 0, max: 100000000, def: 0 }),
    note_ar: T(300), note_en: T(300),
  }),
  branding: S.obj({
    primary_color: S.color({ def: '#FFC000' }), secondary_color: S.color({ def: '#000000' }), surface_color: S.color({ def: '#121212' }),
    page_background: S.color({ def: '#000000' }), text_on_dark: S.color({ def: '#FFFFFF' }), text_on_primary: S.color({ def: '#000000' }),
    font_ar: S.oneOf(FONTS_AR, { def: 'Cairo' }), font_en: S.oneOf(FONTS_EN, { def: 'Poppins' }),
    logo_image_id: S.int({ min: 1, nullable: true, def: null }), hero_image_id: S.int({ min: 1, nullable: true, def: null }),
  }),
  store_status: S.obj({
    mode: S.oneOf(['auto', 'force_open', 'force_closed'], { def: 'auto' }),
    timezone: (v, p, e) => {
      const s = S.str({ min: 1, max: 60, def: 'Asia/Beirut' })(v, p, e);
      if (s !== undefined && !isValidTimezone(s)) e[p] = 'invalid_timezone';
      return s;
    },
    closed_message_ar: T(300), closed_message_en: T(300),
  }),
  opening_hours: S.obj(Object.fromEntries(DAYS.map((d) => [d, S.arr(
    (v, p, e) => {
      const iv = S.obj({ open: S.time(), close: S.time() })(v, p, e);
      if (iv && iv.open !== undefined && iv.open === iv.close) e[p] = 'open_equals_close';
      return iv;
    },
    { max: 4, def: [] },
  )]))),
  social: S.obj({ instagram: T(200), facebook: T(200), tiktok: T(200) }),
  content: S.obj({
    hero_title_ar: T(120), hero_title_en: T(120), hero_text_ar: T(400), hero_text_en: T(400),
    banner_enabled: S.bool({ def: false }), banner_ar: T(200), banner_en: T(200),
    footer_ar: T(300), footer_en: T(300), currency_ar: T(12), currency_en: T(12),
    overrides: S.map(/^[a-z0-9_.]{1,60}$/, S.obj({ ar: T(300), en: T(300) })),
  }),
  promotions: S.obj({
    items: S.arr(S.obj({
      id: T(40), title_ar: T(100), title_en: T(100), text_ar: T(300), text_en: T(300), active: S.bool({ def: true }),
    }), { max: 12, def: [] }),
  }),
};
const KEYS = Object.keys(SHAPES);

async function loadAll(db) {
  const { rows } = await db.query('SELECT key, value FROM settings');
  const stored = {};
  for (const r of rows) stored[r.key] = typeof r.value === 'string' ? JSON.parse(r.value) : r.value;
  const out = {};
  for (const key of KEYS) out[key] = { ...DEFAULTS[key], ...(stored[key] || {}) };
  // text fields left empty in the database fall back to the defaults the site needs to look right
  for (const f of ['name_ar', 'tagline_ar', 'tagline_en']) if (!out.store[f]) out.store[f] = DEFAULTS.store[f];
  for (const f of ['closed_message_ar', 'closed_message_en']) if (!out.store_status[f]) out.store_status[f] = DEFAULTS.store_status[f];
  for (const f of ['hero_title_ar', 'hero_title_en', 'hero_text_ar', 'hero_text_en', 'currency_ar', 'currency_en']) {
    if (!out.content[f]) out.content[f] = DEFAULTS.content[f];
  }
  if (!out.branding.primary_color || !/^#[0-9a-f]{6}$/i.test(out.branding.primary_color)) out.branding.primary_color = DEFAULTS.branding.primary_color;
  out.branding = { ...DEFAULTS.branding, ...Object.fromEntries(Object.entries(out.branding).filter(([, v]) => v !== undefined)) };
  out.opening_hours = { ...DEFAULTS.opening_hours, ...out.opening_hours };
  return out;
}

async function save(db, key, raw) {
  if (!KEYS.includes(key)) throw httpError(404, 'unknown_setting');
  const clean = S.parse(SHAPES[key], raw);
  const { rows } = await db.query('SELECT value FROM settings WHERE key = $1', [key]);
  let existing = rows[0] ? rows[0].value : {};
  if (typeof existing === 'string') existing = JSON.parse(existing);
  const merged = { ...existing, ...clean }; // keep legacy keys that are not part of the form
  await db.query(
    `INSERT INTO settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = CURRENT_TIMESTAMP`,
    [key, JSON.stringify(merged)],
  );
  return merged;
}

module.exports = { DEFAULTS, SHAPES, KEYS, FONTS_AR, FONTS_EN, loadAll, save };
