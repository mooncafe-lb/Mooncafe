'use strict';
// Daily numbering, dates/times in Asia/Beirut, private tracking, per-type stages, feedback, security.
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');
const path = require('path');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function resolve(request, ...rest) {
  return request === 'express' ? path.join(__dirname, 'helpers', 'mock-express.js') : origResolve.call(this, request, ...rest);
};
const { dispatch } = require('./helpers/mock-express');
const { freshDb } = require('./helpers/fixtures');
const { createTestDb } = require('./helpers/db');
const auth = require('../server/lib/auth');
const orders = require('../server/lib/orders');
const dates = require('../server/lib/dates');
const { loadAll } = require('../server/lib/settings');
const { createPublicRouter } = require('../server/lib/publicRouter');
const { createAdminRouter } = require('../server/lib/adminRouter');
const { createTrackPageRouter } = require('../server/lib/trackPage');
const { buildOrderMessage } = require('../server/lib/whatsapp');

const config = { sessionSecret: 's'.repeat(40), setupToken: 'setup-token-123', isProd: false };
const PW = 'correct horse battery';
const H = { 'x-requested-with': 'mc-admin' };
const BASE = 'https://moon.test';
const at = (iso) => new Date(iso);

async function shop({ legacy = false } = {}) {
  if (!legacy) return build(await freshDb());
  const db = createTestDb({ migrations: ['001_init.sql', '002_menu_structure.sql', '004_admin_security.sql', '005_staff_and_order_tracking.sql'] });
  const { seedMenu, setSetting } = require('./helpers/fixtures');
  await seedMenu(db);
  await setSetting(db, 'store_status', { mode: 'force_open', timezone: 'Asia/Beirut' });
  await setSetting(db, 'whatsapp', { number: '+96178964984', enabled: true, message_template: '' });
  await setSetting(db, 'delivery', { delivery_enabled: true, pickup_enabled: true, delivery_fee_lbp: 50000, min_order_lbp: 0 });
  return build(db);
}
async function build(db) {
  await auth.setupFirstAdmin(db, config, { token: 'setup-token-123', email: 'owner@moon.cafe', full_name: 'Owner', password: PW });
  const pub = createPublicRouter({ db, config }); const adm = createAdminRouter({ db, config });
  const r = await dispatch(adm, { method: 'POST', url: '/login', headers: H, body: { login: 'owner@moon.cafe', password: PW } });
  const cookies = { mc_session: r.cookiesSet.mc_session.value };
  const admin = (method, url, body) => dispatch(adm, { method, url, body, headers: H, cookies });
  const mango = (await db.query("SELECT p.id, s.id AS sid FROM products p JOIN product_sizes s ON s.product_id=p.id WHERE p.name_en='Mango' AND s.name_en='Large'")).rows[0];
  const place = async ({ now = new Date('2026-11-04T11:45:00Z'), fulfillment = 'pickup', lang = 'ar', tracking = true, name = 'Sara Haddad', phone = '71123456' } = {}) =>
    orders.createOrder(db, await loadAll(db), { customer_name: name, phone, fulfillment, lang, address: fulfillment === 'delivery' ? 'Sibline road, Wadi El Zayneh' : '', notes: 'private note', items: [{ product_id: mango.id, size_id: mango.sid, quantity: 2 }] }, now, { tracking, baseUrl: BASE });
  const tokenOf = async (internalId) => (await db.query('SELECT tracking_token FROM orders WHERE id = $1', [internalId])).rows[0].tracking_token;
  const track = (token) => dispatch(pub, { method: 'GET', url: `/track/${token}` });
  return { db, pub, adm, admin, place, tokenOf, track };
}

// ------------------------------------------------------------------------ daily numbering
test('daily numbers: 1,2,3 on one day, restart at 1 the next day, previous days stay saved', async () => {
  const s = await shop();
  const nums = async (iso, n) => { const out = []; for (let i = 0; i < n; i++) out.push((await s.place({ now: at(iso) })).order.number); return out; };
  assert.deepEqual(await nums('2026-11-04T08:00:00Z', 3), [1, 2, 3]);
  assert.deepEqual(await nums('2026-11-05T08:00:00Z', 4), [1, 2, 3, 4]);       // simulated next day starts again at 1
  assert.deepEqual(await nums('2026-11-04T15:00:00Z', 1), [4]);                 // later the same (first) day continues
  const rows = (await s.db.query('SELECT order_date, daily_number, id FROM orders ORDER BY id')).rows;
  assert.equal(rows.length, 8);
  assert.deepEqual(rows.map((r) => `${r.order_date}#${r.daily_number}`), ['2026-11-04#1', '2026-11-04#2', '2026-11-04#3', '2026-11-05#1', '2026-11-05#2', '2026-11-05#3', '2026-11-05#4', '2026-11-04#4']);
  assert.equal(new Set(rows.map((r) => r.id)).size, 8);                         // the repeated numbers belong to different orders (different internal ids)
  assert.deepEqual((await s.db.query('SELECT order_date, last_number FROM order_counters ORDER BY order_date')).rows.map((r) => [r.order_date, r.last_number]), [['2026-11-04', 4], ['2026-11-05', 4]]);
});

test('the day is the Lebanon calendar day (Asia/Beirut), also around midnight and daylight saving changes', async () => {
  const s = await shop();
  const one = async (iso) => { const r = await s.place({ now: at(iso) }); return `${r.order.date} #${r.order.number}`; };
  assert.equal(await one('2026-11-04T21:59:59Z'), '04/11/2026 #1');            // 23:59:59 in Beirut (UTC+2 in November)
  assert.equal(await one('2026-11-04T22:00:00Z'), '05/11/2026 #1');            // 00:00:00 next day in Beirut
  assert.equal(await one('2026-11-04T21:59:59Z'), '04/11/2026 #2');
  assert.equal(await one('2026-07-04T20:59:59Z'), '04/07/2026 #1');            // summer: UTC+3, midnight is 21:00 UTC
  assert.equal(await one('2026-07-04T21:00:00Z'), '05/07/2026 #1');
  assert.equal(await one('2026-03-28T21:59:00Z'), '28/03/2026 #1');            // the night clocks go forward
  assert.equal(await one('2026-03-28T22:00:00Z'), '29/03/2026 #1');
  assert.equal(dates.beirutDate('2026-11-04T22:00:00Z'), '2026-11-05');
});

test('date and exact time are stored once (UTC instant + Beirut date) and shown as 04/11/2026 and 01:45 PM', async () => {
  const s = await shop();
  const r = await s.place({ now: at('2026-11-04T11:45:30Z') });
  assert.deepEqual([r.order.date, r.order.time.en, r.order.time.ar], ['04/11/2026', '01:45 PM', '01:45 م']);
  assert.equal(r.order.placed_at, '2026-11-04T11:45:30.000Z');
  const row = (await s.db.query('SELECT created_at, order_date FROM orders')).rows[0];
  assert.equal(new Date(row.created_at).toISOString(), '2026-11-04T11:45:30.000Z'); assert.equal(row.order_date, '2026-11-04');
  const morning = await s.place({ now: at('2026-11-05T07:20:00Z') });             // 09:20 in Beirut
  assert.deepEqual([morning.order.date, morning.order.time.en, morning.order.time.ar, morning.order.number], ['05/11/2026', '09:20 AM', '09:20 ص', 1]);
  const noon = dates.stamp('2026-11-04T10:00:00Z'); const midnight = dates.stamp('2026-11-04T22:05:00Z');
  assert.deepEqual([noon.time_en, midnight.time_en, midnight.time_ar], ['12:00 PM', '12:05 AM', '12:05 ص']);
});

test('25 orders arriving at the same moment get 25 different numbers (1..25), no duplicates', async () => {
  const s = await shop();
  const results = await Promise.all(Array.from({ length: 25 }, () => s.place({ now: at('2026-11-04T10:00:00Z') })));
  const numbers = results.map((r) => r.order.number).sort((a, b) => a - b);
  assert.deepEqual(numbers, Array.from({ length: 25 }, (_, i) => i + 1));
  assert.equal(new Set(results.map((r) => r.order.tracking_url)).size, 25);
  assert.equal((await s.db.query('SELECT last_number FROM order_counters')).rows[0].last_number, 25);
  // the database itself refuses a repeated (date, number)
  await assert.rejects(s.db.query("INSERT INTO orders (public_code, customer_name, phone, fulfillment, subtotal_lbp, delivery_fee_lbp, total_lbp, order_date, daily_number) VALUES ('MC-DUP999','x','+9617','pickup',1,0,1,'2026-11-04',7)"), /UNIQUE/i);
});

test('numbers are not a count of rows: a failed order does not use a number and deleted rows do not cause reuse', async () => {
  const s = await shop();
  await s.place({ now: at('2026-11-04T10:00:00Z') });
  const broken = { query: s.db.query, withTransaction: (fn) => s.db.withTransaction((c) => fn({ query: async (q, p) => { if (/INSERT INTO order_items/.test(q)) throw new Error('disk full'); return c.query(q, p); } })) };
  const mango = (await s.db.query("SELECT p.id, s.id AS sid FROM products p JOIN product_sizes s ON s.product_id=p.id WHERE p.name_en='Mango' AND s.name_en='Large'")).rows[0];
  await assert.rejects(orders.createOrder(broken, await loadAll(s.db), { customer_name: 'Sara', phone: '71123456', fulfillment: 'pickup', items: [{ product_id: mango.id, size_id: mango.sid, quantity: 1 }] }, at('2026-11-04T10:05:00Z'), { tracking: true, baseUrl: BASE }), /disk full/);
  assert.equal((await s.db.query('SELECT last_number FROM order_counters')).rows[0].last_number, 1);        // rolled back with the order
  assert.equal((await s.place({ now: at('2026-11-04T10:10:00Z') })).order.number, 2);
  await s.db.query('DELETE FROM orders WHERE daily_number = 1');                                              // test database only
  assert.equal((await s.place({ now: at('2026-11-04T10:15:00Z') })).order.number, 3);                         // continues; never recomputed from a count
});

// ------------------------------------------------------------------------ messages and confirmation
test('WhatsApp message carries number, date, time and the private tracking link (Arabic and English)', async () => {
  const s = await shop();
  const ar = await s.place({ now: at('2026-11-04T11:45:00Z') });
  for (const part of ['رقم الطلب: 1', 'التاريخ: 04/11/2026', 'الوقت: 01:45 م', `رابط تتبع الطلب: ${ar.order.tracking_url}`]) assert.ok(ar.message.includes(part), `${part}\n${ar.message}`);
  assert.match(ar.order.tracking_url, /^https:\/\/moon\.test\/track\/[A-Za-z0-9_-]{43}$/);
  assert.ok(!/MC-/.test(ar.message));                                                                         // numeric only, no letters or prefix
  assert.ok(ar.whatsapp_url.includes(encodeURIComponent(ar.order.tracking_url)));
  const en = await s.place({ now: at('2026-11-04T11:46:00Z'), lang: 'en' });
  for (const part of ['Order: 2', 'Date: 04/11/2026', 'Time: 01:46 PM', `Track your order: ${en.order.tracking_url}`]) assert.ok(en.message.includes(part), `${part}\n${en.message}`);
  const custom = buildOrderMessage({ order: { number: 5, date: '04/11/2026', time_ar: '01:45 م', time_en: '01:45 PM', tracking_url: 'https://x.test/track/abc', customer_name: 'S', phone: '+961', fulfillment: 'pickup', subtotal_lbp: 1, delivery_fee_lbp: 0, total_lbp: 1 }, items: [], lang: 'en', template: 'Hi {name}, order {number}' });
  assert.ok(custom.includes('Hi S, order 5') && custom.includes('Track your order: https://x.test/track/abc'));   // a custom template still gets the link
});

test('POST /orders answers with number, date, time and tracking link, and never with database ids', async () => {
  const s = await shop();
  const mango = (await s.db.query("SELECT p.id, s.id AS sid FROM products p JOIN product_sizes s ON s.product_id=p.id WHERE p.name_en='Mango' AND s.name_en='Large'")).rows[0];
  const r = await dispatch(s.pub, { method: 'POST', url: '/orders', body: { customer_name: 'Sara Haddad', phone: '71123456', fulfillment: 'pickup', items: [{ product_id: mango.id, size_id: mango.sid, quantity: 1 }] } });
  assert.equal(r.statusCode, 201);
  const o = r.body.order;
  assert.equal(o.number, 1); assert.match(o.date, /^\d{2}\/\d{2}\/\d{4}$/); assert.match(o.time.en, /^\d{2}:\d{2} (AM|PM)$/); assert.match(o.tracking_url, /^https:\/\/moon\.test\/track\//);
  assert.ok(!('id' in o) && !('internal_id' in r.body) && !('code' in o && o.code));
});

// ------------------------------------------------------------------------ the tracking page and its security
test('tracking API: shows the order, never the customer\'s private data or internal identifiers', async () => {
  const s = await shop();
  const r = await s.place({ fulfillment: 'delivery', now: at('2026-11-04T11:45:00Z') });
  const token = await s.tokenOf(r.internal_id);
  const res = await s.track(token);
  assert.equal(res.statusCode, 200);
  const t = res.body;
  assert.deepEqual([t.number, t.date, t.time.en, t.fulfillment, t.status, t.total_lbp], [1, '04/11/2026', '01:45 PM', 'delivery', 'whatsapp_prepared', 650000]);
  assert.deepEqual(t.items.map((i) => [i.name_en, i.quantity]), [['Mango', 2]]);
  const raw = JSON.stringify(res.body);
  for (const secret of ['Sara Haddad', '71123456', '+9617', 'Sibline', 'Wadi El Zayneh', 'private note', 'MC-', 'public_code', 'tracking_token', 'assigned', 'owner@moon.cafe', 'phone', 'address', 'customer_name', '"id"']) assert.ok(!raw.includes(secret), `leaked: ${secret}`);
  assert.deepEqual(Object.keys(t).sort(), ['cancelled', 'date', 'delivery_fee_lbp', 'feedback', 'fulfillment', 'items', 'last_update', 'number', 'placed_at', 'status', 'status_label', 'stages', 'store', 'subtotal_lbp', 'time', 'total_lbp'].sort());
  assert.equal(res.headers['Cache-Control'], 'no-store'); assert.match(res.headers['X-Robots-Tag'], /noindex/);
});

test('tracking is private: only the long random token works; numbers, ids, guesses and other formats do not', async () => {
  const s = await shop();
  const a = await s.place({ now: at('2026-11-04T10:00:00Z') }); const b = await s.place({ now: at('2026-11-04T10:01:00Z') });
  const ta = await s.tokenOf(a.internal_id); const tb = await s.tokenOf(b.internal_id);
  assert.notEqual(ta, tb); assert.match(ta, /^[A-Za-z0-9_-]{43}$/);
  assert.equal((await s.track(ta)).body.number, 1); assert.equal((await s.track(tb)).body.number, 2);          // each link shows only its own order
  const notFound = JSON.stringify({ error: 'not_found' });
  for (const guess of ['1', '2', String(a.internal_id), 'MC-ABC123', ta.slice(0, 42), `${ta}x`, ta.replace(/.$/, ta.endsWith('A') ? 'B' : 'A'), '..%2Fetc%2Fpasswd', ta.toLowerCase() === ta ? ta.toUpperCase() : ta.toLowerCase()]) {
    const r = await s.track(guess);
    assert.equal(r.statusCode, 404, guess); assert.equal(JSON.stringify(r.body), notFound);                      // same answer for every wrong key
  }
  const rate = await dispatch(s.pub, { method: 'POST', url: '/track/1/rating', body: { rating: 5 } });
  assert.equal(rate.statusCode, 404);
  const tokens = new Set(); for (let i = 0; i < 30; i++) tokens.add((await s.place({ now: at('2026-11-04T10:02:00Z') })).order.tracking_url);
  assert.equal(tokens.size, 30);
});

test('tracking requests are rate limited and the page itself is served without caching and without leaking the link', async () => {
  const s = await shop();
  const r = await s.place(); const token = await s.tokenOf(r.internal_id);
  let blocked = 0; for (let i = 0; i < 130; i++) if ((await s.track(token)).statusCode === 429) blocked += 1;
  assert.ok(blocked >= 5, `blocked ${blocked}`);
  const page = await dispatch(createTrackPageRouter(), { method: 'GET', url: `/${token}` });
  assert.ok(page.sentFile.endsWith(path.join('public', 'track.html')));
  assert.equal(page.headers['Cache-Control'], 'no-store'); assert.equal(page.headers['Referrer-Policy'], 'no-referrer'); assert.match(page.headers['X-Robots-Tag'], /noindex/);
});

test('before migration 006 orders still work (old reference, no tracking) and the tracking endpoints are off', async () => {
  const s = await shop({ legacy: true });
  const r = await s.place({ tracking: false });
  assert.equal(r.order.number, null); assert.match(r.order.code, /^MC-/); assert.equal(r.order.tracking_url, '');
  assert.ok(r.message.includes(r.order.code) && !r.message.includes('/track/'));
  assert.equal((await s.track('a'.repeat(43))).statusCode, 404);
  const list = (await s.admin('GET', '/orders')).body; assert.equal(list.total, 1); assert.equal(list.orders[0].daily_number, undefined);
  assert.equal((await s.admin('GET', '/orders?q=sara')).body.total, 1);
  const boot = (await s.admin('GET', '/bootstrap')).body; assert.equal(boot.features.tracking, false);
});

// ------------------------------------------------------------------------ stages and automatic updates
const stateOf = (t) => t.stages.map((x) => `${x.key}:${x.state}`).join(' ');
const setStatus = async (s, internalId, status) => assert.equal((await s.admin('PUT', `/orders/${internalId}/status`, { status })).statusCode, 200);

test('delivery order: the page follows every change made from the dashboard, with timestamps', async () => {
  const s = await shop();
  const r = await s.place({ fulfillment: 'delivery', now: new Date() }); const token = await s.tokenOf(r.internal_id);
  let t = (await s.track(token)).body;
  assert.equal(stateOf(t), 'whatsapp_prepared:current confirmed:pending preparing:pending out_for_delivery:pending completed:pending');
  assert.deepEqual(t.stages.map((x) => x.label.en), ['New Order', 'Accepted', 'Preparing', 'Out for Delivery', 'Delivered']);
  assert.deepEqual(t.stages.map((x) => x.label.ar), ['طلب جديد', 'تم قبول الطلب', 'قيد التحضير', 'مع المندوب', 'تم التسليم']);
  await setStatus(s, r.internal_id, 'confirmed'); t = (await s.track(token)).body;
  assert.equal(stateOf(t), 'whatsapp_prepared:done confirmed:current preparing:pending out_for_delivery:pending completed:pending');
  assert.ok(t.stages[0].at && t.stages[1].at && !t.stages[2].at); assert.equal(t.status_label.ar, 'تم قبول الطلب');
  await setStatus(s, r.internal_id, 'preparing'); await setStatus(s, r.internal_id, 'out_for_delivery'); t = (await s.track(token)).body;
  assert.equal(stateOf(t), 'whatsapp_prepared:done confirmed:done preparing:done out_for_delivery:current completed:pending');
  assert.equal(t.status_label.ar, 'مع المندوب');
  await setStatus(s, r.internal_id, 'completed'); t = (await s.track(token)).body;
  assert.equal(stateOf(t), 'whatsapp_prepared:done confirmed:done preparing:done out_for_delivery:done completed:done');
  assert.ok(t.last_update.iso >= t.stages[3].at.iso);
  const history = (await s.db.query("SELECT status, created_at FROM order_status_history WHERE order_id = $1 AND event = 'status' ORDER BY id", [r.internal_id])).rows;
  assert.deepEqual(history.map((h) => h.status), ['whatsapp_prepared', 'confirmed', 'preparing', 'out_for_delivery', 'completed']);
  assert.ok(history.every((h) => h.created_at));
});

test('pickup order uses the pickup stages; cancelled and skipped stages are shown honestly', async () => {
  const s = await shop();
  const p = await s.place({ fulfillment: 'pickup' }); const token = await s.tokenOf(p.internal_id);
  let t = (await s.track(token)).body;
  assert.deepEqual(t.stages.map((x) => x.label.en), ['New Order', 'Accepted', 'Preparing', 'Ready for Pickup', 'Delivered']);
  await setStatus(s, p.internal_id, 'confirmed'); await setStatus(s, p.internal_id, 'preparing'); await setStatus(s, p.internal_id, 'ready'); t = (await s.track(token)).body;
  assert.equal(stateOf(t), 'whatsapp_prepared:done confirmed:done preparing:done ready:current completed:pending'); assert.equal(t.status_label.ar, 'جاهز للاستلام');
  assert.equal((await s.admin('PUT', `/orders/${p.internal_id}/status`, { status: 'out_for_delivery' })).statusCode, 400);   // not a pickup stage
  const d = await s.place({ fulfillment: 'delivery' }); const dt = await s.tokenOf(d.internal_id);
  await setStatus(s, d.internal_id, 'confirmed'); await setStatus(s, d.internal_id, 'out_for_delivery');                    // preparing skipped
  t = (await s.track(dt)).body; assert.equal(stateOf(t), 'whatsapp_prepared:done confirmed:done preparing:done out_for_delivery:current completed:pending'); assert.equal(t.stages[2].at, null);
  const c = await s.place({ fulfillment: 'pickup' }); const ct = await s.tokenOf(c.internal_id);
  await setStatus(s, c.internal_id, 'confirmed'); await setStatus(s, c.internal_id, 'cancelled'); t = (await s.track(ct)).body;
  assert.equal(t.cancelled, true); assert.deepEqual(t.status_label, { ar: 'ملغي', en: 'Cancelled' }); assert.equal(stateOf(t), 'whatsapp_prepared:done confirmed:done preparing:pending ready:pending completed:pending');
});

// ------------------------------------------------------------------------ feedback after delivery
test('feedback: no review request before delivery; after delivery one rating, then the Google Maps link', async () => {
  const s = await shop();
  const r = await s.place({ fulfillment: 'delivery' }); const token = await s.tokenOf(r.internal_id);
  const rate = (n, token2 = token, comment) => dispatch(s.pub, { method: 'POST', url: `/track/${token2}/rating`, body: { rating: n, comment } });
  assert.equal((await s.track(token)).body.feedback, null);
  let res = await rate(5); assert.equal(res.statusCode, 409); assert.equal(res.body.error, 'not_delivered');
  await setStatus(s, r.internal_id, 'confirmed'); await setStatus(s, r.internal_id, 'out_for_delivery');
  assert.equal((await s.track(token)).body.feedback, null);                                                    // still on the way
  await setStatus(s, r.internal_id, 'completed');
  assert.deepEqual((await s.track(token)).body.feedback, { rating: null, can_rate: true, review_url: '' });
  assert.equal((await s.admin('PUT', '/settings/feedback', { review_url: 'http://insecure.example/x' })).statusCode, 400);
  assert.equal((await s.admin('PUT', '/settings/feedback', { review_url: 'https://maps.app.goo.gl/mooncafe' })).statusCode, 200);
  assert.equal((await s.track(token)).body.feedback.review_url, 'https://maps.app.goo.gl/mooncafe');
  for (const bad of [0, 6, 2.5, 'x', null]) assert.equal((await rate(bad)).statusCode, 400, String(bad));
  assert.equal((await rate(5, token, 'Great coffee')).statusCode, 201);
  assert.deepEqual((await s.track(token)).body.feedback, { rating: 5, can_rate: false, review_url: 'https://maps.app.goo.gl/mooncafe' });
  res = await rate(1); assert.equal(res.statusCode, 409); assert.equal(res.body.error, 'already_rated');
  const detail = (await s.admin('GET', `/orders/${r.internal_id}`)).body;
  assert.deepEqual([detail.order.rating, detail.order.rating_comment], [5, 'Great coffee']); assert.ok(detail.history.some((h) => h.note === 'Customer rating: 5/5'));
  const other = await s.place({}); assert.equal((await rate(5, await s.tokenOf(other.internal_id))).statusCode, 409);   // another order is unaffected
});

// ------------------------------------------------------------------------ admin: number, date, time, search, tracking link
test('admin orders: number + date + time, search by number / date / customer / phone / status, tracking link, status history', async () => {
  const s = await shop();
  const a = await s.place({ now: at('2026-11-04T08:00:00Z'), name: 'Sara Haddad', phone: '71123456' });
  const b = await s.place({ now: at('2026-11-04T09:00:00Z'), name: 'Karim Nader', phone: '03987654', fulfillment: 'delivery' });
  const c = await s.place({ now: at('2026-11-05T09:20:00Z'), name: 'Layla Aoun', phone: '76555000' });
  await setStatus(s, b.internal_id, 'confirmed');
  const list = async (qs) => (await s.admin('GET', `/orders${qs}`)).body;
  const all = await list('');
  assert.equal(all.total, 3);
  const first = all.orders[0];                                               // newest first
  assert.deepEqual([first.daily_number, first.order_date, first.placed.date, first.placed.time_en, first.placed.time_ar], [1, '2026-11-05', '05/11/2026', '11:20 AM', '11:20 ص']);
  const numbers = async (qs) => (await list(qs)).orders.map((o) => `${o.order_date}#${o.daily_number}`).sort();
  assert.deepEqual(await numbers('?q=2'), ['2026-11-04#2']);                 // by number
  assert.deepEqual(await numbers('?q=%231'), ['2026-11-04#1', '2026-11-05#1']);
  assert.deepEqual(await numbers('?q=04/11/2026'), ['2026-11-04#1', '2026-11-04#2']);   // by date, either notation
  assert.deepEqual(await numbers('?q=2026-11-05'), ['2026-11-05#1']);
  assert.deepEqual(await numbers('?date=2026-11-04&q=1'), ['2026-11-04#1']);            // number on a given day
  assert.deepEqual(await numbers('?q=karim'), ['2026-11-04#2']);                         // by customer
  assert.deepEqual(await numbers('?q=0398'), ['2026-11-04#2']);                          // by phone
  assert.deepEqual(await numbers('?status=confirmed'), ['2026-11-04#2']);                // by status
  assert.deepEqual(await numbers('?q=100%25'), []);                                      // % is a plain character, not a wildcard
  const detail = (await s.admin('GET', `/orders/${b.internal_id}`)).body;
  assert.equal(detail.order.tracking_path, `/track/${await s.tokenOf(b.internal_id)}`);
  assert.deepEqual([detail.order.placed.date, detail.order.placed.time_en], ['04/11/2026', '11:00 AM']);
  assert.deepEqual(detail.history.map((h) => [h.status, h.at.date]), [['whatsapp_prepared', '04/11/2026'], ['confirmed', detail.history[1].at.date]]);
  assert.ok(detail.history.every((h) => h.at && h.at.time_en));
  assert.ok(c.internal_id && a.internal_id);
});

test('settings: the review link must be https', async () => {
  const s = await shop();
  assert.equal((await s.admin('PUT', '/settings/feedback', { review_url: 'javascript:alert(1)' })).statusCode, 400);
  assert.equal((await s.admin('PUT', '/settings/feedback', { review_url: '' })).statusCode, 200);
});
