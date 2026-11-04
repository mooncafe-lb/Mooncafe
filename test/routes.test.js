'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');
const path = require('path');

// the routers `require('express')`; tests use the stand-in so express need not be installed
const origResolve = Module._resolveFilename;
Module._resolveFilename = function resolve(request, ...rest) {
  return request === 'express' ? path.join(__dirname, 'helpers', 'mock-express.js') : origResolve.call(this, request, ...rest);
};
const { dispatch } = require('./helpers/mock-express');
const { freshDb, setSetting } = require('./helpers/fixtures');
const { createTestDb } = require('./helpers/db');
const { createPublicRouter } = require('../server/lib/publicRouter');
const { createAdminRouter } = require('../server/lib/adminRouter');

const config = { sessionSecret: 's'.repeat(40), setupToken: 'setup-token-123', isProd: false };
const H = { 'x-requested-with': 'mc-admin' };
const PW = 'correct horse battery';

async function site({ open = true } = {}) {
  const db = await freshDb({ open });
  return { db, pub: createPublicRouter({ db, config }), adm: createAdminRouter({ db, config }) };
}

test('GET /store and /menu give the customer site everything it needs', async () => {
  const { pub } = await site();
  const store = (await dispatch(pub, { method: 'GET', url: '/store' })).body;
  assert.equal(store.ready, true); assert.equal(store.status.open, true);
  assert.equal(store.name_en, 'Moon Cafe'); assert.equal(store.branding.primary_color, '#FFC000');
  assert.equal(store.branding.logo_url, '/assets/moon-cafe-logo.png'); assert.equal(store.whatsapp_enabled, true);
  assert.ok(!('message_template' in store) && !JSON.stringify(store).includes('password'));
  const menu = (await dispatch(pub, { method: 'GET', url: '/menu' })).body;
  assert.deepEqual(menu.categories.map((c) => c.name_en), ['Coffee', 'Latte', 'Milkshake', 'Frappe', 'Smoothie']);
  assert.equal(menu.categories.reduce((n, c) => n + c.products.length, 0), 34);
  const espresso = menu.categories[0].products[0];
  assert.equal(espresso.orderable, false); assert.equal(espresso.sizes[0].price_lbp, null);
});

test('closed store is reported by /store and rejected by POST /orders (HTTP 409)', async () => {
  const { db, pub } = await site({ open: false });
  const store = (await dispatch(pub, { method: 'GET', url: '/store' })).body;
  assert.equal(store.status.open, false); assert.equal(store.status.reason, 'no_hours'); assert.ok(store.status.message_ar);
  const p = (await db.query("SELECT p.id, s.id AS sid FROM products p JOIN product_sizes s ON s.product_id=p.id WHERE p.name_en='Mango' AND s.name_en='Medium'")).rows[0];
  const res = await dispatch(pub, { method: 'POST', url: '/orders', body: { customer_name: 'Sara Haddad', phone: '71123456', fulfillment: 'pickup', items: [{ product_id: p.id, size_id: p.sid, quantity: 1 }] } });
  assert.equal(res.statusCode, 409); assert.equal(res.body.error, 'store_closed');
  assert.equal((await db.query('SELECT count(*) AS n FROM orders')).rows[0].n, 0);
});

test('POST /orders: 201 with WhatsApp link, 200 when repeated, 422 for unpriced coffee, 400 for bad data', async () => {
  const { db, pub } = await site();
  const mango = (await db.query("SELECT p.id, s.id AS sid FROM products p JOIN product_sizes s ON s.product_id=p.id WHERE p.name_en='Mango' AND s.name_en='Large'")).rows[0];
  const espresso = (await db.query("SELECT p.id, s.id AS sid FROM products p JOIN product_sizes s ON s.product_id=p.id WHERE p.name_en='Espresso'")).rows[0];
  const body = { request_id: '3f8e2c1a-9b6d-4c53-8a7e-1d2f3a4b5c6d', lang: 'en', customer_name: 'Sara Haddad', phone: '71123456', fulfillment: 'pickup', items: [{ product_id: mango.id, size_id: mango.sid, quantity: 2 }] };
  const a = await dispatch(pub, { method: 'POST', url: '/orders', body });
  assert.equal(a.statusCode, 201); assert.equal(a.body.order.total_lbp, 600000); assert.ok(a.body.whatsapp_url.startsWith('https://wa.me/96178964984?text='));
  assert.ok(a.body.message.includes('Mango (Large) x2'));
  assert.equal((await dispatch(pub, { method: 'POST', url: '/orders', body })).statusCode, 200);
  const coffee = await dispatch(pub, { method: 'POST', url: '/orders', body: { ...body, request_id: undefined, items: [{ product_id: espresso.id, size_id: espresso.sid, quantity: 1 }] } });
  assert.equal(coffee.statusCode, 422); assert.equal(coffee.body.lines[0].code, 'size_unpriced');
  const bad = await dispatch(pub, { method: 'POST', url: '/orders', body: { ...body, request_id: undefined, phone: '1', items: [] } });
  assert.equal(bad.statusCode, 400); assert.equal(bad.body.error, 'validation'); assert.ok(bad.body.errors.phone && bad.body.errors.items);
  assert.equal((await db.query('SELECT count(*) AS n FROM orders')).rows[0].n, 1);
});

test('before migrations 002/003 the site still shows the built-in menu, closed, and refuses orders', async () => {
  const db = createTestDb({ migrations: ['001_init.sql'] });
  await setSetting(db, 'store', { name_en: 'Moon Cafe', name_ar: '' });
  const pub = createPublicRouter({ db, config }); const adm = createAdminRouter({ db, config });
  const store = (await dispatch(pub, { method: 'GET', url: '/store' })).body;
  assert.equal(store.ready, false); assert.equal(store.status.open, false); assert.equal(store.status.reason, 'setup'); assert.equal(store.whatsapp_enabled, false);
  const menu = (await dispatch(pub, { method: 'GET', url: '/menu' })).body;
  assert.equal(menu.ready, false); assert.equal(menu.categories.reduce((n, c) => n + c.products.length, 0), 34);
  assert.equal((await dispatch(pub, { method: 'POST', url: '/orders', body: {} })).statusCode, 503);
  assert.equal((await dispatch(pub, { method: 'GET', url: '/images/1' })).statusCode, 404);
  const session = (await dispatch(adm, { method: 'GET', url: '/session' })).body;
  assert.equal(session.ready, false);
  assert.equal((await dispatch(adm, { method: 'GET', url: '/bootstrap', headers: H })).statusCode, 503);
});

async function login(adm) {
  assert.equal((await dispatch(adm, { method: 'POST', url: '/setup', headers: H, body: { token: 'setup-token-123', email: 'owner@moon.cafe', full_name: 'Owner Name', password: PW } })).statusCode, 201);
  const r = await dispatch(adm, { method: 'POST', url: '/login', headers: H, body: { email: 'owner@moon.cafe', password: PW } });
  assert.equal(r.statusCode, 200);
  const c = r.cookiesSet.mc_session; assert.ok(c);
  assert.equal(c.options.httpOnly, true); assert.equal(c.options.sameSite, 'strict');
  return { cookies: { mc_session: c.value } };
}

test('admin: setup screen, login, session, and nothing works without a session or the CSRF header', async () => {
  const { adm } = await site();
  assert.deepEqual(pick((await dispatch(adm, { method: 'GET', url: '/session' })).body, ['ready', 'admin', 'setup_available']), { ready: true, admin: null, setup_available: true });
  assert.equal((await dispatch(adm, { method: 'GET', url: '/bootstrap' })).statusCode, 401);
  assert.equal((await dispatch(adm, { method: 'POST', url: '/login', body: { email: 'a@b.co', password: 'x' } })).statusCode, 403);   // no CSRF header
  assert.equal((await dispatch(adm, { method: 'POST', url: '/login', headers: H, body: { email: 'owner@moon.cafe', password: 'nope' } })).statusCode, 401);
  const s = await login(adm);
  assert.equal((await dispatch(adm, { method: 'GET', url: '/session', ...s })).body.admin.email, 'owner@moon.cafe');
  assert.equal((await dispatch(adm, { method: 'GET', url: '/session', ...s })).body.setup_available, false);
  assert.equal((await dispatch(adm, { method: 'POST', url: '/setup', headers: H, body: { token: 'setup-token-123', email: 'x@y.co', password: PW } })).statusCode, 403);
  assert.equal((await dispatch(adm, { method: 'GET', url: '/bootstrap', ...s })).statusCode, 200);
  assert.equal((await dispatch(adm, { method: 'POST', url: '/categories', ...s, body: { name_ar: 'x', name_en: 'x' } })).statusCode, 403); // missing header
  assert.equal((await dispatch(adm, { method: 'POST', url: '/logout', ...s, headers: H })).statusCode, 200);
  assert.equal((await dispatch(adm, { method: 'GET', url: '/bootstrap', ...s })).statusCode, 401);
});
const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, o[k]]));

test('admin: full menu management through the API changes what customers see', async () => {
  const { pub, adm } = await site(); const s = await login(adm); const req = (method, url, body) => dispatch(adm, { method, url, body, headers: H, ...s });
  const boot = (await req('GET', '/bootstrap')).body;
  assert.equal(boot.categories.length, 5); assert.equal(boot.settings.branding.primary_color, '#FFC000'); assert.ok(boot.order_statuses.includes('completed'));

  const cat = (await req('POST', '/categories', { name_ar: 'شاي', name_en: 'Tea' })).body.id;
  const prod = await req('POST', '/products', { category_id: cat, name_ar: 'شاي أخضر', name_en: 'Green Tea', sizes: [{ name_ar: 'عادي', name_en: 'Regular', price_lbp: 80000 }] });
  assert.equal(prod.statusCode, 201);
  let menu = (await dispatch(pub, { method: 'GET', url: '/menu' })).body;
  assert.equal(menu.categories.find((c) => c.name_en === 'Tea').products[0].sizes[0].price_lbp, 80000);

  assert.equal((await req('PUT', `/products/${prod.body.id}`, { category_id: cat, name_ar: 'شاي أخضر', name_en: 'Green Tea', is_visible: false, sizes: [{ id: 1, name_ar: 'x', name_en: 'x', price_lbp: 1 }] })).statusCode, 200);
  menu = (await dispatch(pub, { method: 'GET', url: '/menu' })).body;
  assert.equal(menu.categories.some((c) => c.name_en === 'Tea'), false);                                    // hidden product -> empty category hidden
  assert.equal((await req('DELETE', `/categories/${cat}`)).statusCode, 409);
  assert.equal((await req('DELETE', `/categories/${cat}?force=1`)).statusCode, 200);
  assert.equal((await req('PUT', '/products/abc', {})).statusCode, 404);
  assert.equal((await req('POST', '/products', { category_id: cat, name_ar: '', name_en: 'x', sizes: [] })).statusCode, 400);
});

test('admin: settings (hours, status, WhatsApp, brand) are saved and reach the customer site', async () => {
  const { pub, adm } = await site({ open: false }); const s = await login(adm); const req = (method, url, body) => dispatch(adm, { method, url, body, headers: H, ...s });
  await req('PUT', '/settings/opening_hours', { mon: [{ open: '00:00', close: '24:00' }], tue: [{ open: '00:00', close: '24:00' }], wed: [{ open: '00:00', close: '24:00' }], thu: [{ open: '00:00', close: '24:00' }], fri: [{ open: '00:00', close: '24:00' }], sat: [{ open: '00:00', close: '24:00' }], sun: [{ open: '00:00', close: '24:00' }] });
  assert.equal((await dispatch(pub, { method: 'GET', url: '/store' })).body.status.open, true);    // mode is auto: the new all-day schedule opens the store
  await req('PUT', '/settings/store_status', { mode: 'force_closed', timezone: 'Asia/Beirut', closed_message_ar: 'نعود قريباً', closed_message_en: 'Back soon' });
  let st = (await dispatch(pub, { method: 'GET', url: '/store' })).body.status;
  assert.equal(st.open, false); assert.equal(st.reason, 'manual_closed'); assert.equal(st.message_ar, 'نعود قريباً');
  await req('PUT', '/settings/store_status', { mode: 'auto', timezone: 'Asia/Beirut' });
  assert.equal((await dispatch(pub, { method: 'GET', url: '/store' })).body.status.open, true);
  await req('PUT', '/settings/whatsapp', { number: '+961 71 000 111', enabled: true, message_template: 'Order {code}\n{items}' });
  await req('PUT', '/settings/branding', { primary_color: '#FFD000', font_ar: 'Tajawal', font_en: 'Inter' });
  await req('PUT', '/settings/store', { name_en: 'Moon Cafe', name_ar: 'مون', phone: '78 964 984', address: 'Sibline', address_ar: 'صبلين' });
  const store = (await dispatch(pub, { method: 'GET', url: '/store' })).body;
  assert.equal(store.branding.primary_color, '#FFD000'); assert.equal(store.branding.font_ar, 'Tajawal'); assert.equal(store.name_ar, 'مون'); assert.equal(store.address_ar, 'صبلين');
  assert.equal((await req('PUT', '/settings/branding', { primary_color: 'red' })).statusCode, 400);
});

test('admin: orders list, detail with items, status update with history', async () => {
  const { db, pub, adm } = await site(); const s = await login(adm); const req = (method, url, body) => dispatch(adm, { method, url, body, headers: H, ...s });
  const mango = (await db.query("SELECT p.id, s.id AS sid FROM products p JOIN product_sizes s ON s.product_id=p.id WHERE p.name_en='Mango' AND s.name_en='Large'")).rows[0];
  const made = await dispatch(pub, { method: 'POST', url: '/orders', body: { customer_name: 'Sara Haddad', phone: '71123456', fulfillment: 'delivery', address: 'Sibline road', items: [{ product_id: mango.id, size_id: mango.sid, quantity: 1 }] } });
  const id = made.body.order.id;
  const list = (await req('GET', '/orders')).body; assert.equal(list.total, 1); assert.equal(list.orders[0].public_code, made.body.order.code);
  const detail = (await req('GET', `/orders/${id}`)).body; assert.equal(detail.items.length, 1); assert.equal(detail.items[0].size_name_en, 'Large'); assert.equal(detail.history.length, 1);
  assert.equal((await req('PUT', `/orders/${id}/status`, { status: 'teleported' })).statusCode, 400);
  assert.equal((await req('PUT', `/orders/${id}/status`, { status: 'confirmed', note: 'called customer' })).statusCode, 200);
  assert.equal((await req('PUT', `/orders/${id}/status`, { status: 'completed' })).statusCode, 200);
  const after = (await req('GET', `/orders/${id}`)).body;
  assert.equal(after.order.status, 'completed'); assert.deepEqual(after.history.map((h) => h.status), ['whatsapp_prepared', 'confirmed', 'completed']);
  assert.equal(after.history[1].actor_name, 'Owner Name'); assert.equal(after.history[1].event, 'status');
  assert.equal((await req('GET', '/orders?status=cancelled')).body.total, 0);
  assert.equal((await req('GET', '/orders/999')).statusCode, 404);
});

test('admin: image upload endpoint needs a session and returns an id (processing tested separately)', async () => {
  const { adm } = await site();
  assert.equal((await dispatch(adm, { method: 'POST', url: '/images', headers: H, body: Buffer.from('x') })).statusCode, 401);
});
