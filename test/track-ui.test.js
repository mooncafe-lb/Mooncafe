'use strict';
// The real tracking page code (public/js/track.js) in a fake browser, talking to the real public API.
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');
const path = require('path');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function resolve(request, ...rest) {
  return request === 'express' ? path.join(__dirname, 'helpers', 'mock-express.js') : origResolve.call(this, request, ...rest);
};
const { dispatch } = require('./helpers/mock-express');
const { freshDb, setSetting } = require('./helpers/fixtures');
const orders = require('../server/lib/orders');
const { loadAll } = require('../server/lib/settings');
const { createPublicRouter } = require('../server/lib/publicRouter');
const { installDom, all, byClass, byTag, withText, flush } = require('./helpers/fake-dom');

let run = 0;
async function boot({ fulfillment = 'delivery', token: forced, statuses = [] } = {}) {
  const db = await freshDb();
  const pub = createPublicRouter({ db, config: {} });
  const mango = (await db.query("SELECT p.id, s.id AS sid FROM products p JOIN product_sizes s ON s.product_id=p.id WHERE p.name_en='Mango' AND s.name_en='Large'")).rows[0];
  const placed = await orders.createOrder(db, await loadAll(db), { customer_name: 'Sara Haddad', phone: '71123456', fulfillment, address: fulfillment === 'delivery' ? 'Sibline road, Wadi El Zayneh' : '', notes: 'private note', items: [{ product_id: mango.id, size_id: mango.sid, quantity: 2 }] }, new Date('2026-11-04T11:45:00Z'), { tracking: true, baseUrl: 'https://moon.test' });
  const token = (await db.query('SELECT tracking_token FROM orders')).rows[0].tracking_token;
  const owner = { id: 1, name: 'Owner', role: 'super_admin' };
  await db.query("INSERT INTO admins (email, password_hash, full_name, role) VALUES ('o@m.cafe', 'x', 'Owner', 'super_admin')");
  const move = (status) => orders.updateOrderStatus(db, placed.internal_id, status, '', owner);
  const calls = [];
  const fetchImpl = async (url, opts = {}) => {
    const res = await dispatch(pub, { method: opts.method || 'GET', url: url.replace(/^\/api/, ''), body: opts.body ? JSON.parse(opts.body) : undefined });
    calls.push({ method: opts.method || 'GET', url, status: res.statusCode });
    return { ok: res.statusCode < 400, status: res.statusCode, json: async () => JSON.parse(JSON.stringify(res.body === undefined ? null : res.body)) };
  };
  const dom = installDom({ fetchImpl, path: `/track/${forced || token}` });
  const page = await import(`../public/js/track.js?run=${++run}`);
  await page.ready;
  for (const s of statuses) await move(s);
  return { db, dom, root: dom.root, page, move, calls, token };
}
const stages = (root) => byClass(root, 'stage').map((s) => `${s.dataset.stage}:${s.dataset.state}`).join(' ');
const text = (root, id) => { const el = all(root, (n) => n.attrs && n.attrs.get('id') === id)[0]; return el ? el.textContent : null; };

test('tracking page shows the number, full date, exact time, type, items, total, status and the timeline', async () => {
  const { root, dom } = await boot();
  assert.equal(text(root, 'order-number'), '#1'); assert.equal(text(root, 'order-date'), '04/11/2026'); assert.equal(text(root, 'order-time'), '01:45 م');
  assert.equal(text(root, 'order-status'), 'طلب جديد'); assert.equal(text(root, 'order-type'), 'توصيل'); assert.equal(text(root, 'order-total'), '650,000 ل.ل.');
  assert.equal(stages(root), 'whatsapp_prepared:current confirmed:pending preparing:pending out_for_delivery:pending completed:pending');
  assert.ok(root.textContent.includes('Mango × 2') && root.textContent.includes('آخر تحديث'));
  assert.equal(dom.doc.documentElement.dir, 'rtl');
  for (const secret of ['Sara Haddad', '71123456', 'Sibline', 'private note', 'MC-']) assert.ok(!root.textContent.includes(secret), `shown: ${secret}`);
  assert.equal(byClass(root, 'thanks').length, 0);                                    // no review request before delivery
  assert.ok(byTag(root, 'img').some((i) => i.getAttribute('src') === '/assets/moon-cafe-logo.png'));
});

test('the page follows status changes made by the staff (refresh) and can be shown in English', async () => {
  const { root, page, move, dom } = await boot();
  await move('confirmed'); await page.refresh();
  assert.equal(text(root, 'order-status'), 'تم قبول الطلب'); assert.equal(stages(root), 'whatsapp_prepared:done confirmed:current preparing:pending out_for_delivery:pending completed:pending');
  await move('preparing'); await move('out_for_delivery'); await page.refresh();
  assert.equal(text(root, 'order-status'), 'مع المندوب');
  assert.ok(byClass(root, 'stage').filter((s) => s.dataset.state === 'done').every((s) => s.textContent.includes('/2026')));   // finished stages show their time
  withText(root, 'English', 'button')[0].click();
  assert.equal(dom.doc.documentElement.dir, 'ltr'); assert.equal(text(root, 'order-status'), 'Out for Delivery'); assert.equal(text(root, 'order-time'), '01:45 PM');
  assert.deepEqual(byClass(root, 'stage-name').map((n) => n.textContent), ['New Order', 'Accepted', 'Preparing', 'Out for Delivery', 'Delivered']);
});

test('pickup orders show the pickup stages', async () => {
  const { root, page, move } = await boot({ fulfillment: 'pickup', statuses: ['confirmed', 'preparing', 'ready'] });
  await page.refresh();
  assert.equal(text(root, 'order-type'), 'استلام'); assert.equal(text(root, 'order-status'), 'جاهز للاستلام');
  assert.equal(stages(root), 'whatsapp_prepared:done confirmed:done preparing:done ready:current completed:pending');
  await move('completed'); await page.refresh(); assert.equal(text(root, 'order-status'), 'تم التسليم');
});

test('after delivery: Lebanese thank-you, star rating, then the Google Maps link if configured', async () => {
  const { root, page, db, calls } = await boot({ statuses: ['confirmed', 'out_for_delivery', 'completed'] });
  await setSetting(db, 'feedback', { review_url: 'https://maps.app.goo.gl/mooncafe' });
  await page.refresh();
  const box = byClass(root, 'thanks')[0];
  assert.ok(box.textContent.includes('يعطيك العافية يا غالي') && box.textContent.includes('كيف كانت تجربتك'));
  assert.equal(byClass(root, 'star').length, 5); assert.equal(byTag(root, 'a').filter((a) => (a.getAttribute('href') || '').includes('maps.app.goo.gl')).length, 0);   // link only after rating
  byClass(root, 'star')[3].click(); await flush(40);
  assert.equal(calls.filter((c) => c.method === 'POST')[0].status, 201);
  assert.ok(byClass(root, 'thanks')[0].textContent.includes('يسلمو'));
  assert.equal(byClass(root, 'star').filter((s) => s.classList.contains('on')).length, 4); assert.ok(byClass(root, 'star').every((s) => s.disabled));
  assert.equal(byTag(root, 'a').filter((a) => a.getAttribute('href') === 'https://maps.app.goo.gl/mooncafe').length, 1);
  assert.equal((await db.query('SELECT rating FROM orders')).rows[0].rating, 4);
});

test('an invalid or guessed link shows a clear message and no order data', async () => {
  const { root, calls } = await boot({ token: 'x'.repeat(43) });
  assert.ok(root.textContent.includes('رابط التتبع غير صحيح'));
  assert.equal(calls.find((c) => c.url.includes('/api/track/')).status, 404); assert.equal(byClass(root, 'trk-number').length, 0);
});
