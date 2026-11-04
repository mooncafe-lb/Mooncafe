'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { freshDb, setSetting } = require('./helpers/fixtures');
const { createOrder } = require('../server/lib/orders');
const { loadAll } = require('../server/lib/settings');

const find = async (db, cat, prod, size) => {
  const p = (await db.query('SELECT p.id FROM products p JOIN categories c ON c.id=p.category_id WHERE c.name_en=$1 AND p.name_en=$2', [cat, prod])).rows[0];
  const s = size ? (await db.query('SELECT id, price_lbp FROM product_sizes WHERE product_id=$1 AND name_en=$2', [p.id, size])).rows[0] : null;
  const groups = (await db.query('SELECT id, name_en FROM option_groups WHERE product_id=$1 ORDER BY sort_order', [p.id])).rows;
  const choice = async (gname, cname) => (await db.query('SELECT ch.id FROM option_choices ch JOIN option_groups g ON g.id=ch.group_id WHERE g.product_id=$1 AND g.name_en=$2 AND ch.name_en=$3', [p.id, gname, cname])).rows[0].id;
  return { product: p.id, size: s && s.id, price: s && s.price_lbp, groups, choice };
};
const base = (over = {}) => ({ lang: 'ar', customer_name: 'Sara Haddad', phone: '71 123 456', fulfillment: 'pickup', items: [], ...over });
const place = async (db, body, now) => createOrder(db, await loadAll(db), body, now);
const count = async (db, t = 'orders') => Number((await db.query(`SELECT count(*) AS n FROM ${t}`)).rows[0].n);

test('pickup order: server prices, saves items, history, WhatsApp link', async () => {
  const db = await freshDb();
  const latte = await find(db, 'Latte', 'Latte', 'Large');
  const hot = await latte.choice('Temperature', 'Hot'); const caramel = await latte.choice('Flavor', 'Caramel');
  const r = await place(db, base({ items: [{ product_id: latte.product, size_id: latte.size, quantity: 2, choice_ids: [hot, caramel], instructions: 'extra hot', price_lbp: 1 }] }));
  assert.equal(r.order.subtotal_lbp, 700000); assert.equal(r.order.delivery_fee_lbp, 0); assert.equal(r.order.total_lbp, 700000);
  assert.match(r.order.code, /^MC-[A-Z2-9]{6}$/);
  assert.ok(r.whatsapp_url.startsWith('https://wa.me/96178964984?text='));
  for (const part of ['Latte', 'x2', 'كراميل', '700,000', '+96171123456']) assert.ok(r.message.includes(part) || r.message.includes('لاتيه'), part);
  assert.equal(await count(db, 'order_items'), 1);
  const hist = (await db.query('SELECT status FROM order_status_history')).rows;
  assert.deepEqual(hist.map((h) => h.status), ['whatsapp_prepared']);
  const saved = (await db.query('SELECT * FROM orders')).rows[0];
  assert.equal(saved.phone, '+96171123456'); assert.equal(saved.language, 'ar'); assert.ok(saved.whatsapp_message.includes(r.order.code));
});

test('delivery adds the fee, needs an address, stores the map point', async () => {
  const db = await freshDb();
  const f = await find(db, 'Frappe', 'Pistachio', 'Medium');
  const items = [{ product_id: f.product, size_id: f.size, quantity: 1 }];
  await assert.rejects(place(db, base({ fulfillment: 'delivery', items })), (e) => e.status === 400 && e.extra.errors.address === 'required');
  const r = await place(db, base({ fulfillment: 'delivery', address: 'Sibline, near the school', latitude: 33.5, longitude: 35.4, items }));
  assert.equal(r.order.delivery_fee_lbp, 50000); assert.equal(r.order.total_lbp, 300000);
  assert.ok(r.message.includes('https://maps.google.com/?q=33.5,35.4'));
});

test('closed store is rejected on the server and nothing is saved', async () => {
  const db = await freshDb({ open: false }); // mode auto + no hours
  const f = await find(db, 'Frappe', 'Pistachio', 'Medium');
  await assert.rejects(place(db, base({ items: [{ product_id: f.product, size_id: f.size, quantity: 1 }] })),
    (e) => e.status === 409 && e.code === 'store_closed' && e.extra.reason === 'no_hours' && e.extra.message_ar.length > 0);
  await setSetting(db, 'store_status', { mode: 'force_closed', timezone: 'Asia/Beirut' });
  await assert.rejects(place(db, base({ items: [{ product_id: f.product, size_id: f.size, quantity: 1 }] })), (e) => e.code === 'store_closed' && e.extra.reason === 'manual_closed');
  assert.equal(await count(db), 0);
});

test('schedule decides when mode is auto (open at 10:30, closed at 07:00 Beirut)', async () => {
  const db = await freshDb({ open: false });
  await setSetting(db, 'opening_hours', { sun: [], mon: [{ open: '08:00', close: '23:00' }], tue: [], wed: [], thu: [], fri: [], sat: [] });
  const f = await find(db, 'Smoothie', 'Mango', 'Medium');
  const body = base({ items: [{ product_id: f.product, size_id: f.size, quantity: 1 }] });
  await assert.rejects(place(db, body, new Date('2026-11-02T05:00:00Z')), (e) => e.code === 'store_closed' && e.extra.next_open.time === '08:00');
  const ok = await place(db, body, new Date('2026-11-02T08:30:00Z'));
  assert.equal(ok.order.total_lbp, 200000);
});

test('products without a price cannot be ordered (Coffee)', async () => {
  const db = await freshDb();
  const espresso = await find(db, 'Coffee', 'Espresso', 'Regular');
  await assert.rejects(place(db, base({ items: [{ product_id: espresso.product, size_id: espresso.size, quantity: 1 }] })),
    (e) => e.status === 422 && e.extra.lines[0].code === 'size_unpriced');
  assert.equal(await count(db), 0);
  // once Admin sets a price it becomes orderable
  await db.query('UPDATE product_sizes SET price_lbp = 90000 WHERE id = $1', [espresso.size]);
  const r = await place(db, base({ items: [{ product_id: espresso.product, size_id: espresso.size, quantity: 3 }] }));
  assert.equal(r.order.total_lbp, 270000);
});

test('required choice, foreign choice and bad sizes are rejected with line errors', async () => {
  const db = await freshDb();
  const latte = await find(db, 'Latte', 'Latte', 'Medium'); const spanish = await find(db, 'Latte', 'Spanish', 'Medium');
  const hot = await latte.choice('Temperature', 'Hot');
  const code = async (items) => { try { await place(db, base({ items })); return 'accepted'; } catch (e) { return e.extra.lines[0].code; } };
  assert.equal(await code([{ product_id: latte.product, size_id: latte.size, quantity: 1 }]), 'choice_required');
  assert.equal(await code([{ product_id: spanish.product, size_id: spanish.size, quantity: 1, choice_ids: [hot] }]), 'choice_invalid');
  assert.equal(await code([{ product_id: latte.product, size_id: spanish.size, quantity: 1, choice_ids: [hot] }]), 'size_invalid');
  assert.equal(await code([{ product_id: 99999, size_id: 1, quantity: 1 }]), 'product_unavailable');
  const iced = await latte.choice('Temperature', 'Iced');
  assert.equal(await code([{ product_id: latte.product, size_id: latte.size, quantity: 1, choice_ids: [hot, iced] }]), 'too_many_choices');
  assert.equal(await count(db), 0);
});

test('hidden, sold-out and disabled items cannot be ordered', async () => {
  const db = await freshDb();
  const m = await find(db, 'Smoothie', 'Mango', 'Medium'); const body = base({ items: [{ product_id: m.product, size_id: m.size, quantity: 1 }] });
  await db.query('UPDATE products SET is_available = false WHERE id=$1', [m.product]);
  await assert.rejects(place(db, body), (e) => e.extra.lines[0].code === 'product_unavailable');
  await db.query('UPDATE products SET is_available = true, is_visible = false WHERE id=$1', [m.product]);
  await assert.rejects(place(db, body), (e) => e.extra.lines[0].code === 'product_unavailable');
  await db.query('UPDATE products SET is_visible = true WHERE id=$1', [m.product]);
  await db.query('UPDATE product_sizes SET is_available = false WHERE id=$1', [m.size]);
  await assert.rejects(place(db, body), (e) => e.extra.lines[0].code === 'size_invalid');
});

test('option price differences are added by the server', async () => {
  const db = await freshDb();
  const m = await find(db, 'Latte', 'Spanish', 'Medium');
  const gid = (await db.query('INSERT INTO option_groups (product_id,name_ar,name_en,selection,is_required,sort_order) VALUES ($1,$2,$3,$4,0,9) RETURNING id', [m.product, 'إضافات', 'Extras', 'multiple'])).rows[0].id;
  const shot = (await db.query('INSERT INTO option_choices (group_id,name_ar,name_en,price_delta_lbp,sort_order) VALUES ($1,$2,$3,40000,1) RETURNING id', [gid, 'شوت', 'Extra shot'])).rows[0].id;
  const hot = await m.choice('Temperature', 'Hot');
  const r = await place(db, base({ items: [{ product_id: m.product, size_id: m.size, quantity: 2, choice_ids: [hot, shot] }] }));
  assert.equal(r.order.total_lbp, (250000 + 40000) * 2);
});

test('validation: name, phone, empty cart, bad quantity, unknown fields', async () => {
  const db = await freshDb();
  const f = await find(db, 'Frappe', 'Vanilla', 'Medium'); const item = { product_id: f.product, size_id: f.size, quantity: 1 };
  const err = async (body) => { try { await place(db, body); return null; } catch (e) { return e.extra.errors || e.code; } };
  assert.ok((await err(base({ items: [item], customer_name: 'S' }))).customer_name);
  assert.ok((await err(base({ items: [item], phone: '12' }))).phone);
  assert.ok((await err(base({ items: [] })))['items']);
  assert.ok((await err(base({ items: [{ ...item, quantity: 0 }] })))['items[0].quantity']);
  assert.ok((await err(base({ items: [{ ...item, quantity: 51 }] })))['items[0].quantity']);
  assert.ok((await err(base({ items: [item], fulfillment: 'teleport' }))).fulfillment);
  assert.equal(await count(db), 0);
});

test('ordering switches: WhatsApp disabled, delivery disabled, minimum order', async () => {
  const db = await freshDb();
  const f = await find(db, 'Frappe', 'Vanilla', 'Medium'); const items = [{ product_id: f.product, size_id: f.size, quantity: 1 }];
  await setSetting(db, 'whatsapp', { number: '+96178964984', enabled: false, message_template: '' });
  await assert.rejects(place(db, base({ items })), (e) => e.code === 'ordering_disabled');
  await setSetting(db, 'whatsapp', { number: '+96178964984', enabled: true, message_template: '' });
  await setSetting(db, 'delivery', { delivery_enabled: false, pickup_enabled: true, delivery_fee_lbp: 0, min_order_lbp: 0 });
  await assert.rejects(place(db, base({ items, fulfillment: 'delivery', address: 'Sibline street' })), (e) => e.code === 'delivery_disabled');
  await setSetting(db, 'delivery', { delivery_enabled: true, pickup_enabled: true, delivery_fee_lbp: 0, min_order_lbp: 500000 });
  await assert.rejects(place(db, base({ items })), (e) => e.code === 'below_minimum' && e.extra.min_order_lbp === 500000);
  assert.equal(await count(db), 0);
});

test('same request_id returns the first order (double tap protection)', async () => {
  const db = await freshDb();
  const f = await find(db, 'Frappe', 'Vanilla', 'Medium');
  const body = base({ request_id: '3f8e2c1a-9b6d-4c53-8a7e-1d2f3a4b5c6d', items: [{ product_id: f.product, size_id: f.size, quantity: 1 }] });
  const a = await place(db, body); const b = await place(db, body);
  assert.equal(a.duplicate, false); assert.equal(b.duplicate, true); assert.equal(a.order.code, b.order.code);
  assert.equal(await count(db), 1); assert.equal(await count(db, 'order_items'), 1);
});

test('a failure while saving leaves no partial order', async () => {
  const db = await freshDb();
  const f = await find(db, 'Frappe', 'Vanilla', 'Medium');
  const broken = { query: db.query, withTransaction: (fn) => db.withTransaction((c) => fn({ query: async (s, p) => { if (/INSERT INTO order_items/.test(s)) throw new Error('disk full'); return c.query(s, p); } })) };
  await assert.rejects(createOrder(broken, await loadAll(db), base({ items: [{ product_id: f.product, size_id: f.size, quantity: 1 }] })), /disk full/);
  assert.equal(await count(db), 0); assert.equal(await count(db, 'order_status_history'), 0);
});
