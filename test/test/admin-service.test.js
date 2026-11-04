'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { freshDb } = require('./helpers/fixtures');
const svc = require('../server/lib/adminService');
const settingsLib = require('../server/lib/settings');
const { loadMenu } = require('../server/lib/catalog');

const rows = async (db, sql, p) => (await db.query(sql, p)).rows;

test('create product with sizes and a required choice group; public menu shows it', async () => {
  const db = await freshDb();
  const cat = (await rows(db, "SELECT id FROM categories WHERE name_en='Coffee'"))[0].id;
  const { id } = await svc.createProduct(db, {
    category_id: cat, name_ar: 'قهوة تركية', name_en: 'Turkish Coffee', description_en: 'Strong', sizes: [{ name_ar: 'عادي', name_en: 'Regular', price_lbp: 120000 }],
    groups: [{ name_ar: 'السكر', name_en: 'Sugar', is_required: true, choices: [{ name_ar: 'سادة', name_en: 'Plain' }, { name_ar: 'وسط', name_en: 'Medium', price_delta_lbp: 0 }] }],
  });
  const menu = await loadMenu(db);
  const p = menu.find((c) => c.name_en === 'Coffee').products.find((x) => x.id === id);
  assert.equal(p.orderable, true); assert.equal(p.sizes[0].price_lbp, 120000); assert.equal(p.groups[0].required, true); assert.equal(p.groups[0].choices.length, 2);
  assert.equal(p.name_ar, 'قهوة تركية'); assert.equal(p.image_url, null);
});

test('editing keeps ids of rows sent back, adds new rows and deletes removed ones', async () => {
  const db = await freshDb();
  const admin = await loadMenu(db, { admin: true });
  const latte = admin.find((c) => c.name_en === 'Latte').products.find((p) => p.name_en === 'Latte');
  const medium = latte.sizes.find((s) => s.name_en === 'Medium'); const temp = latte.groups.find((g) => g.name_en === 'Temperature'); const hot = temp.choices[0];
  const body = {
    category_id: latte.category_id, name_ar: latte.name_ar, name_en: 'Latte (new name)', description_ar: '', description_en: 'Smooth', image_id: null, is_visible: true, is_available: true,
    sizes: [{ id: medium.id, name_ar: 'وسط', name_en: 'Medium', price_lbp: 275000, is_available: true }, { name_ar: 'صغير', name_en: 'Small', price_lbp: 200000 }],
    groups: [{ id: temp.id, name_ar: temp.name_ar, name_en: temp.name_en, selection: 'single', is_required: true, choices: [{ id: hot.id, name_ar: 'ساخن', name_en: 'Hot' }, { name_ar: 'دافئ', name_en: 'Warm' }] }],
  };
  await svc.updateProduct(db, latte.id, body);
  const after = (await loadMenu(db, { admin: true })).find((c) => c.name_en === 'Latte').products.find((p) => p.id === latte.id);
  assert.equal(after.name_en, 'Latte (new name)');
  assert.deepEqual(after.sizes.map((s) => [s.name_en, s.price_lbp]), [['Medium', 275000], ['Small', 200000]]);
  assert.equal(after.sizes[0].id, medium.id);                         // kept
  assert.equal(after.groups.length, 1);                                // the Flavor group was removed
  assert.deepEqual(after.groups[0].choices.map((c) => c.name_en), ['Hot', 'Warm']); assert.equal(after.groups[0].choices[0].id, hot.id);
  assert.equal((await rows(db, 'SELECT count(*) AS n FROM option_choices WHERE group_id NOT IN (SELECT id FROM option_groups)'))[0].n, 0);
});

test('Admin can set a Coffee price later and the product becomes orderable', async () => {
  const db = await freshDb();
  const coffee = (await loadMenu(db, { admin: true })).find((c) => c.name_en === 'Coffee').products.find((p) => p.name_en === 'Espresso');
  assert.equal((await loadMenu(db)).find((c) => c.name_en === 'Coffee').products.find((p) => p.name_en === 'Espresso').orderable, false);
  await svc.updateProduct(db, coffee.id, { category_id: coffee.category_id, name_ar: 'Espresso', name_en: 'Espresso', sizes: [{ id: coffee.sizes[0].id, name_ar: 'عادي', name_en: 'Regular', price_lbp: 90000 }] });
  assert.equal((await loadMenu(db)).find((c) => c.name_en === 'Coffee').products.find((p) => p.name_en === 'Espresso').orderable, true);
});

test('product validation: needs a size, price above zero, a real category', async () => {
  const db = await freshDb();
  const cat = (await rows(db, 'SELECT id FROM categories LIMIT 1'))[0].id;
  const err = async (b) => { try { await svc.createProduct(db, b); return null; } catch (e) { return e.extra.errors; } };
  assert.ok((await err({ category_id: cat, name_ar: 'x', name_en: 'x', sizes: [] })).sizes);
  assert.ok((await err({ category_id: cat, name_ar: 'x', name_en: 'x', sizes: [{ name_ar: 'a', name_en: 'a', price_lbp: 0 }] }))['sizes[0].price_lbp']);
  assert.ok((await err({ category_id: 9999, name_ar: 'x', name_en: 'x', sizes: [{ name_ar: 'a', name_en: 'a', price_lbp: 5 }] })).category_id);
  assert.ok((await err({ category_id: cat, name_ar: '', name_en: 'x', sizes: [{ name_ar: 'a', name_en: 'a', price_lbp: 5 }] })).name_ar);
});

test('categories: create, rename, hide, protect non-empty delete, reorder', async () => {
  const db = await freshDb();
  const { id } = await svc.createCategory(db, { name_ar: 'شاي', name_en: 'Tea' });
  assert.equal((await loadMenu(db)).some((c) => c.name_en === 'Tea'), false);        // empty categories are not shown
  await svc.updateCategory(db, id, { name_ar: 'شاي ساخن', name_en: 'Hot Tea', is_visible: true });
  assert.equal((await loadMenu(db, { admin: true })).find((c) => c.id === id).name_en, 'Hot Tea');
  const coffee = (await rows(db, "SELECT id FROM categories WHERE name_en='Coffee'"))[0].id;
  await assert.rejects(svc.deleteCategory(db, coffee, false), (e) => e.status === 409 && e.extra.products === 5);
  await svc.deleteCategory(db, id, false);
  const all = (await rows(db, 'SELECT id FROM categories ORDER BY sort_order')).map((r) => r.id);
  await svc.reorder(db, 'categories', { ids: [...all].reverse() });
  assert.deepEqual((await rows(db, 'SELECT id FROM categories ORDER BY sort_order')).map((r) => r.id), [...all].reverse());
  await svc.deleteCategory(db, coffee, true);
  assert.equal((await rows(db, 'SELECT count(*) AS n FROM products'))[0].n, 29);
});

test('products: reorder inside a category, hide, sold-out, delete', async () => {
  const db = await freshDb();
  const smoothie = (await rows(db, "SELECT id FROM categories WHERE name_en='Smoothie'"))[0].id;
  const ids = (await rows(db, 'SELECT id FROM products WHERE category_id=$1 ORDER BY sort_order', [smoothie])).map((r) => r.id);
  await svc.reorder(db, 'products', { category_id: smoothie, ids: [...ids].reverse() });
  assert.equal((await loadMenu(db)).find((c) => c.id === smoothie).products[0].id, ids[4]);
  await db.query('UPDATE products SET is_visible=false WHERE id=$1', [ids[4]]);
  assert.equal((await loadMenu(db)).find((c) => c.id === smoothie).products.length, 4);
  await db.query('UPDATE products SET is_available=false WHERE id=$1', [ids[0]]);
  const sold = (await loadMenu(db)).find((c) => c.id === smoothie).products.find((p) => p.id === ids[0]);
  assert.equal(sold.orderable, false); assert.equal(sold.available, false);
  await svc.deleteProduct(db, ids[1]);
  await assert.rejects(svc.deleteProduct(db, ids[1]), (e) => e.status === 404);
});

test('settings: validated, merged with legacy keys, defaults fill the gaps', async () => {
  const db = await freshDb();
  const saved = await settingsLib.save(db, 'store', { name_en: 'Moon Cafe', name_ar: 'مون كافيه', tagline_ar: '', tagline_en: '', address: 'Sibline', address_ar: 'صبلين', phone: '78 964 984' });
  assert.equal(saved.hours, ''); assert.equal(saved.address, 'Sibline');
  await assert.rejects(settingsLib.save(db, 'branding', { primary_color: 'yellow' }), (e) => e.extra.errors.primary_color === 'invalid_format');
  await assert.rejects(settingsLib.save(db, 'branding', { font_en: 'Comic Sans' }), (e) => e.extra.errors.font_en === 'invalid_choice');
  await assert.rejects(settingsLib.save(db, 'whatsapp', { number: '12', enabled: true }), (e) => e.extra.errors.number === 'invalid_phone');
  await assert.rejects(settingsLib.save(db, 'store_status', { mode: 'auto', timezone: 'Mars/Base' }), (e) => e.extra.errors.timezone === 'invalid_timezone');
  await assert.rejects(settingsLib.save(db, 'opening_hours', { mon: [{ open: '09:00', close: '09:00' }] }), (e) => e.status === 400);
  await assert.rejects(settingsLib.save(db, 'opening_hours', { mon: [{ open: '9am', close: '23:00' }] }), (e) => e.status === 400);
  await assert.rejects(settingsLib.save(db, 'nope', {}), (e) => e.status === 404);
  await settingsLib.save(db, 'opening_hours', { mon: [{ open: '08:00', close: '23:00' }], tue: [{ open: '18:00', close: '02:00' }] });
  await settingsLib.save(db, 'content', { hero_title_ar: 'أهلاً', overrides: { 'cart.checkout': { ar: 'إتمام الطلب', en: 'Place order' }, 'bad key!': { ar: 'x', en: 'y' } } });
  const all = await settingsLib.loadAll(db);
  assert.equal(all.opening_hours.mon[0].open, '08:00'); assert.deepEqual(all.opening_hours.wed, []);
  assert.equal(all.content.hero_title_ar, 'أهلاً'); assert.deepEqual(Object.keys(all.content.overrides), ['cart.checkout']);
  assert.equal(all.branding.primary_color, '#FFC000'); assert.equal(all.store.name_ar, 'مون كافيه');
});
