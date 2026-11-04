'use strict';
// Runs the REAL customer app (public/js) in a fake browser, talking to the REAL public router
// and order service on a database built from the real migrations. Everything except an actual
// browser, HTTP, and PostgreSQL is the production code.
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
const { createTestDb } = require('./helpers/db');
const { createPublicRouter } = require('../server/lib/publicRouter');
const { installDom, byClass, byTag, withText, flush, type } = require('./helpers/fake-dom');

let run = 0;
async function boot({ open = true, reducedMotion = true, storage = {}, db: givenDb } = {}) {
  const db = givenDb || await freshDb({ open });
  const pub = createPublicRouter({ db, config: {} });
  const calls = [];
  const fetchImpl = async (url, opts = {}) => {
    const method = opts.method || 'GET';
    const body = opts.body ? JSON.parse(opts.body) : undefined;
    const res = await dispatch(pub, { method, url: url.replace(/^\/api/, ''), body });
    calls.push({ method, url, body, status: res.statusCode });
    return { ok: res.statusCode < 400, status: res.statusCode, json: async () => JSON.parse(JSON.stringify(res.body)) };
  };
  const dom = installDom({ reducedMotion, fetchImpl, storage });
  const app = await import(`../public/js/app.js?run=${++run}`);
  await app.ready;
  return { db, dom, app, calls, root: dom.root };
}

const cardOf = (root, name) => byClass(root, 'card').find((c) => byClass(c, 'card-name')[0].textContent === name);
const button = (el, text) => withText(el, text, 'button')[0];
const sheetEl = (dom) => byClass(dom.doc.body, 'sheet')[0];
const addBtn = (sheet) => byClass(sheet, 'btn').find((b) => b.textContent.includes('أضف إلى الصينية'));
const cups = (app) => app.tray.slots.children.filter((c) => c.classList.contains('cup') && !c.classList.contains('ghost'));

test('the home page is a real site: logo, hero, five categories, 34 drinks, open status', async () => {
  const { dom, root } = await boot();
  assert.equal(dom.doc.documentElement.dir, 'rtl'); assert.equal(dom.doc.documentElement.lang, 'ar');
  assert.ok(byTag(root, 'img').some((i) => i.getAttribute('src') === '/assets/moon-cafe-logo.png'));
  assert.equal(byTag(root, 'h1')[0].textContent, 'نحنا والقمر جيران');
  assert.deepEqual(byClass(root, 'tab').map((t) => t.textContent), ['القهوة', 'لاتيه', 'ميلك شيك', 'فرابيه', 'سموذي']);
  assert.equal(byClass(root, 'card').length, 34);
  assert.equal(byClass(root, 'status')[0].textContent, 'مفتوح الآن');
  assert.equal(dom.doc.documentElement.style['--primary'], '#FFC000');
  assert.ok(!root.textContent.includes('قريباً جداً') && !/coming soon|under construction/i.test(root.textContent));
  const espresso = cardOf(root, 'Espresso');
  assert.equal(byClass(espresso, 'add')[0].disabled, true); assert.equal(byClass(espresso, 'price')[0].textContent, 'السعر قريباً');
  assert.equal(byClass(cardOf(root, 'Mango'), 'price')[0].textContent, '200,000 ل.ل.');                // the selected size (Medium) shows its own price
  assert.equal(byClass(cardOf(root, 'Mango'), 'add')[0].disabled, false);
  assert.equal(byClass(root, 'panel-title').length, 5);
  assert.ok(byClass(root, 'tray').length === 1 && byClass(root, 'tray')[0].classList.contains('is-empty') && root.textContent.includes('صينيتك فاضية حالياً'));
  assert.deepEqual(byClass(cardOf(root, 'Mango'), 'size-chip').map((c) => c.textContent), ['وسط', 'كبير']);
});

test('closed store: clear CLOSED message, Add to Tray and checkout are disabled, menu still browsable', async () => {
  const { dom, root } = await boot({ open: false });
  assert.equal(byClass(root, 'status')[0].textContent, 'مغلق الآن');
  assert.ok(byClass(root, 'notice').some((n) => n.classList.contains('closed') && n.textContent.includes('نحن مغلقون حالياً')));
  assert.equal(byClass(root, 'card').length, 34);
  assert.ok(byClass(root, 'add').every((b) => b.disabled));
  byClass(cardOf(root, 'Mango'), 'card-name')[0].click();
  const sheet = sheetEl(dom);
  assert.ok(sheet.textContent.includes('المقهى مغلق الآن'));
  assert.equal(addBtn(sheet).disabled, true);
});

test('choose size and options, drinks fly into ONE tray and sit side by side', async () => {
  const { dom, root, app } = await boot();
  byClass(cardOf(root, 'Mango'), 'card-name')[0].click();             // the product sheet: size, notes, quantity
  let sheet = sheetEl(dom); assert.ok(sheet);
  button(sheet, 'كبير').click();
  assert.equal(addBtn(sheetEl(dom)).textContent, 'أضف إلى الصينية · 300,000 ل.ل.');
  type(byTag(sheetEl(dom), 'textarea')[0], 'بدون سكر');
  addBtn(sheetEl(dom)).click(); await flush();
  assert.equal(sheetEl(dom), undefined);
  assert.equal(app.cart.items().length, 1);
  assert.deepEqual([app.cart.items()[0].unit_price, app.cart.items()[0].size_en, app.cart.items()[0].instructions], [300000, 'Large', 'بدون سكر']);
  assert.equal(cups(app).length, 1); assert.equal(byClass(app.tray.el, 'cup-qty')[0].textContent, '1');
  assert.ok(byClass(root, 'bar')[0].textContent.includes('300,000 ل.ل.'));                 // the total now lives in the bottom bar and the summary card

  byClass(cardOf(root, 'Latte'), 'card-name')[0].click();             // required Hot/Iced group
  addBtn(sheetEl(dom)).click(); await flush();
  assert.ok(byClass(sheetEl(dom), 'group').some((g) => g.classList.contains('invalid')));
  assert.equal(app.cart.items().length, 1);
  button(sheetEl(dom), 'مثلج').click(); button(sheetEl(dom), 'كراميل').click();
  addBtn(sheetEl(dom)).click(); await flush();
  assert.equal(cups(app).length, 2);                                   // side by side on the same tray
  assert.equal(byClass(root, 'tray').length, 1);
  assert.ok(cups(app)[1].classList.contains('pop'));
  assert.deepEqual(app.cart.items()[1].options.map((o) => o.name_en), ['Iced', 'Caramel']);

  // same drink with same choices merges into one line
  byClass(cardOf(root, 'Latte'), 'card-name')[0].click();
  button(sheetEl(dom), 'مثلج').click(); button(sheetEl(dom), 'كراميل').click(); addBtn(sheetEl(dom)).click(); await flush();
  assert.equal(app.cart.items().length, 2); assert.equal(app.cart.items()[1].qty, 2);
});

test('tray sheet: change quantity, remove, totals; cart survives a page reload', async () => {
  const { dom, root, app } = await boot();
  byClass(cardOf(root, 'Oreo'), 'card-name')[0].click(); addBtn(sheetEl(dom)).click(); await flush();
  byClass(cardOf(root, 'Peach'), 'card-name')[0].click(); button(sheetEl(dom), 'كبير').click(); addBtn(sheetEl(dom)).click(); await flush();
  app.tray.el.click();
  let sheet = sheetEl(dom); assert.equal(byClass(sheet, 'line').length, 2);
  const plus = (i) => button(byClass(sheetEl(dom), 'line')[i], '+');
  plus(0).click(); plus(0).click();
  assert.equal(app.cart.items()[0].qty, 3);
  assert.ok(sheetEl(dom).textContent.includes('1,050,000')); // 3 x 250,000 + 300,000
  button(byClass(sheetEl(dom), 'line')[1], 'حذف').click();
  assert.equal(byClass(sheetEl(dom), 'line').length, 1); assert.equal(cups(app).length, 1);
  const saved = Object.fromEntries(dom.localStorage._mem);
  const again = await boot({ storage: saved });
  assert.equal(again.app.cart.items().length, 1); assert.equal(cups(again.app).length, 1);
});

test('checkout validates, creates the order on the server, clears the tray and opens WhatsApp', async () => {
  const { dom, root, app, db, calls } = await boot();
  byClass(cardOf(root, 'Mango'), 'card-name')[0].click(); button(sheetEl(dom), 'كبير').click(); addBtn(sheetEl(dom)).click(); await flush();
  byClass(cardOf(root, 'Mango'), 'card-name')[0].click(); button(sheetEl(dom), 'كبير').click(); addBtn(sheetEl(dom)).click(); await flush();
  app.tray.el.click();
  button(sheetEl(dom), 'إتمام الطلب').click();
  const form = sheetEl(dom); assert.ok(form.textContent.includes('بيانات الطلب'));
  button(form, 'أرسل الطلب عبر واتساب').click(); await flush();                 // empty form: nothing is sent
  assert.ok(byClass(sheetEl(dom), 'field').filter((f) => f.classList.contains('invalid')).length >= 2);
  assert.equal(calls.filter((c) => c.method === 'POST').length, 0);

  type(byTag(sheetEl(dom), 'input')[0], 'سارة حداد'); type(byTag(sheetEl(dom), 'input')[1], '71 123 456');
  type(byTag(sheetEl(dom), 'textarea')[0], 'مع كاسة ماء');
  button(sheetEl(dom), 'أرسل الطلب عبر واتساب').click(); await flush(40);

  const post = calls.find((c) => c.method === 'POST');
  assert.equal(post.url, '/api/orders'); assert.equal(post.status, 201);
  assert.deepEqual([post.body.fulfillment, post.body.lang, post.body.items[0].quantity, post.body.customer_name], ['pickup', 'ar', 2, 'سارة حداد']);
  assert.ok(!('price' in post.body.items[0]) && !('unit_price' in post.body.items[0]));
  const done = sheetEl(dom); assert.ok(done.textContent.includes('طلبك جاهز للإرسال')); assert.match(byClass(done, 'code')[0].textContent, /^MC-/);
  assert.equal(app.cart.items().length, 0); assert.equal(cups(app).length, 0);
  const nav = dom.location.navigations[0];
  assert.ok(nav.startsWith('https://wa.me/96178964984?text='));
  const msg = decodeURIComponent(nav.split('text=')[1]);
  for (const part of ['Mango', 'x2', '300,000 x 2 = 600,000', '600,000', 'سارة حداد', '+96171123456', 'مع كاسة ماء']) assert.ok(msg.includes(part), part + '\n' + msg);
  const order = (await db.query('SELECT * FROM orders')).rows[0];
  assert.equal(order.total_lbp, 600000); assert.equal(order.status, 'whatsapp_prepared');
  assert.equal(JSON.parse(dom.localStorage.getItem('mc_customer')).name, 'سارة حداد');
});

test('delivery adds the fee and needs an address; the location button stores coordinates', async () => {
  const db = await freshDb();
  const { dom, root, app, calls } = await boot({ db });
  globalThis.navigator.geolocation = { getCurrentPosition: (ok) => ok({ coords: { latitude: 33.4912345, longitude: 35.4123456 } }) };
  byClass(cardOf(root, 'Pistachio'), 'card-name')[0].click(); addBtn(sheetEl(dom)).click(); await flush();
  app.tray.el.click(); button(sheetEl(dom), 'إتمام الطلب').click();
  button(sheetEl(dom), 'توصيل').click();
  assert.ok(sheetEl(dom).textContent.includes('رسوم التوصيل') && sheetEl(dom).textContent.includes('50,000 ل.ل.'));
  type(byTag(sheetEl(dom), 'input')[0], 'Sara'); type(byTag(sheetEl(dom), 'input')[1], '71123456');
  button(sheetEl(dom), 'أرسل الطلب عبر واتساب').click(); await flush();
  assert.ok(byClass(sheetEl(dom), 'field').some((f) => f.classList.contains('invalid') && f.textContent.includes('العنوان')));
  assert.equal(calls.filter((c) => c.method === 'POST').length, 0);
  type(byTag(sheetEl(dom), 'textarea')[0], 'صبلين، وادي الزينة، قرب المدرسة');
  button(sheetEl(dom), 'استخدم موقعي').click();
  assert.ok(sheetEl(dom).textContent.includes('تم تحديد موقعك'));
  button(sheetEl(dom), 'أرسل الطلب عبر واتساب').click(); await flush(40);
  const post = calls.find((c) => c.method === 'POST');
  assert.equal(post.status, 201); assert.equal(post.body.latitude, 33.491234);
  const order = (await db.query('SELECT * FROM orders')).rows[0];
  assert.equal(order.delivery_fee_lbp, 50000); assert.equal(order.total_lbp, 300000); assert.equal(order.latitude, 33.491234);
  assert.ok(decodeURIComponent(dom.location.navigations[0].split('text=')[1]).includes('https://maps.google.com/?q=33.491234,35.412346'));
});

test('if the cafe closes while the customer is checking out, the server refuses and the tray is kept', async () => {
  const { dom, root, app, db, calls } = await boot();
  byClass(cardOf(root, 'Mango'), 'card-name')[0].click(); addBtn(sheetEl(dom)).click(); await flush();
  app.tray.el.click(); button(sheetEl(dom), 'إتمام الطلب').click();
  type(byTag(sheetEl(dom), 'input')[0], 'Sara Haddad'); type(byTag(sheetEl(dom), 'input')[1], '71123456');
  await setSetting(db, 'store_status', { mode: 'force_closed', timezone: 'Asia/Beirut' });        // the owner closes the shop now
  button(sheetEl(dom), 'أرسل الطلب عبر واتساب').click(); await flush(40);
  assert.equal(calls.find((c) => c.method === 'POST').status, 409);
  assert.ok(sheetEl(dom).textContent.includes('المقهى مغلق الآن'));
  assert.equal(app.cart.items().length, 1); assert.equal((await db.query('SELECT count(*) AS n FROM orders')).rows[0].n, 0);
  assert.equal(dom.location.navigations.length, 0);
});

test('language switch flips direction, language and number format', async () => {
  const { dom, root } = await boot();
  button(root, 'English').click();
  assert.equal(dom.doc.documentElement.dir, 'ltr'); assert.equal(dom.doc.documentElement.lang, 'en');
  assert.equal(byTag(dom.root, 'h1')[0].textContent, 'We and the moon are neighbors');
  assert.deepEqual(byClass(dom.root, 'tab').map((t) => t.textContent), ['Coffee', 'Latte', 'Milkshake', 'Frappe', 'Smoothie']);
  assert.equal(byClass(cardOf(dom.root, 'Mango'), 'price')[0].textContent, '200,000 LBP');
  assert.equal(dom.localStorage.getItem('mc_lang'), 'en');
});

test('the fly animation runs when motion is allowed and the drink still lands in the tray', async () => {
  const { dom, root, app } = await boot({ reducedMotion: false });
  byClass(cardOf(root, 'Bounty'), 'card-name')[0].click();
  const pending = (async () => { addBtn(sheetEl(dom)).click(); })();
  await flush(1); assert.ok(byClass(dom.doc.body, 'fly').length >= 1);
  await flush(40); await pending;
  assert.equal(byClass(dom.doc.body, 'fly').length, 0); assert.equal(app.cart.items().length, 1);
});

test('before migrations: setup notice, built-in menu visible, nothing orderable', async () => {
  const db = createTestDb({ migrations: ['001_init.sql'] });
  await setSetting(db, 'store', { name_en: 'Moon Cafe', name_ar: '' });
  const { root } = await boot({ db });
  assert.ok(byClass(root, 'notice').some((n) => n.textContent.includes('نظام الطلبات قيد التجهيز')));
  assert.equal(byClass(root, 'card').length, 34); assert.ok(byClass(root, 'add').every((b) => b.disabled));
  assert.equal(byClass(root, 'status')[0].textContent, 'مغلق الآن');
});

test('stale tray items (removed from the menu) are dropped on load with a notice', async () => {
  const stale = JSON.stringify([{ key: '9999|1||', product_id: 9999, size_id: 1, choice_ids: [], instructions: '', qty: 2, unit_price: 5, name_ar: 'x', name_en: 'x', size_ar: '', size_en: '', options: [], thumb_url: null }]);
  const { dom, app } = await boot({ storage: { mc_cart_v1: stale } });
  assert.equal(app.cart.items().length, 0);
  assert.ok(byClass(dom.doc.body, 'toast').length === 1);
});

test('admin-chosen brand colour, fonts, text overrides and promotions reach the page', async () => {
  const db = await freshDb();
  await setSetting(db, 'branding', { primary_color: '#FFD000', font_ar: 'Tajawal', font_en: 'Inter', logo_image_id: null });
  await setSetting(db, 'content', { hero_title_ar: 'أهلاً بكم', banner_enabled: true, banner_ar: 'خصم اليوم', overrides: { order_now: { ar: 'اطلب هلق', en: 'Order today' } } });
  await setSetting(db, 'promotions', { items: [{ id: 'p1', title_ar: 'عرض الصباح', title_en: 'Morning deal', text_ar: 'لاتيه + كرواسان', text_en: '', active: true }, { id: 'p2', title_ar: 'مخفي', active: false }] });
  await setSetting(db, 'social', { instagram: 'mooncafe.lb', facebook: '', tiktok: '' });
  const { dom, root } = await boot({ db });
  assert.equal(dom.doc.documentElement.style['--primary'], '#FFD000');
  assert.equal(dom.doc.documentElement.style['--font-ar'], "'Tajawal'");
  assert.ok(dom.doc.head.children.some((l) => (l.getAttribute('href') || '').includes('family=Tajawal')));
  assert.equal(byTag(root, 'h1')[0].textContent, 'أهلاً بكم');
  assert.ok(button(root, 'اطلب هلق')); assert.ok(root.textContent.includes('خصم اليوم'));
  assert.equal(byClass(root, 'promo').length, 1); assert.ok(root.textContent.includes('عرض الصباح') && !root.textContent.includes('مخفي'));
  assert.ok(byTag(root, 'a').some((a) => a.getAttribute('href') === 'https://instagram.com/mooncafe.lb'));
});

test('quick add from the card: pick a size chip, press Add to Tray, no sheet needed; bottom bar and summary follow', async () => {
  const { dom, root, app } = await boot();
  assert.ok(byClass(root, 'bar')[0].classList.contains('idle'));                        // empty tray: only the floating WhatsApp button
  assert.ok(byTag(byClass(root, 'bar')[0], 'a')[0].getAttribute('href') === 'https://wa.me/96178964984');
  const mango = cardOf(root, 'Mango');
  button(mango, 'كبير').click();
  assert.equal(byClass(cardOf(root, 'Mango'), 'price')[0].textContent, '300,000 ل.ل.');
  assert.equal(byClass(cardOf(root, 'Mango'), 'size-chip').find((c) => c.textContent === 'كبير').getAttribute('aria-pressed'), 'true');
  byClass(cardOf(root, 'Mango'), 'add')[0].click(); await flush();
  assert.equal(sheetEl(dom), undefined);
  assert.deepEqual(app.cart.items().map((l) => [l.size_en, l.unit_price, l.qty]), [['Large', 300000, 1]]);
  byClass(cardOf(root, 'Smoothie' === 'x' ? 'x' : 'Peach'), 'add')[0].click(); await flush();
  assert.equal(cups(app).length, 2);
  const bar = byClass(root, 'bar')[0]; assert.ok(!bar.classList.contains('idle'));
  assert.ok(bar.textContent.includes('2 مشروب') && bar.textContent.includes('500,000 ل.ل.'));
  assert.equal(byClass(root, 'badge-count')[0].textContent, '2');                          // header tray button badge
  const summary = byClass(root, 'summary')[0];
  assert.ok(summary.textContent.includes('طلبك') && summary.textContent.includes('Mango') && summary.textContent.includes('Peach') && summary.textContent.includes('500,000'));
  button(summary, '×').click();                                                           // remove from the summary card
  assert.equal(app.cart.items().length, 1);
  button(bar, '2 مشروب') || null;
  byClass(root, 'bar-cart')[0].click(); assert.ok(sheetEl(dom).textContent.includes('صينيتك'));
});

test('a drink with a required choice opens the sheet with the size already picked on the card', async () => {
  const { dom, root, app } = await boot();
  button(cardOf(root, 'Latte'), 'كبير').click();
  byClass(cardOf(root, 'Latte'), 'add')[0].click();
  const sheet = sheetEl(dom); assert.ok(sheet);
  assert.equal(byClass(sheet, 'chip').find((c) => c.textContent.startsWith('كبير')).getAttribute('aria-pressed'), 'true');
  assert.equal(app.cart.items().length, 0);
});

test('search filters the menu by Arabic or English name and shows a message when nothing matches', async () => {
  const { root } = await boot();
  const box = () => byTag(root, 'input').find((i) => i.getAttribute('type') === 'search');
  type(box(), 'oreo');
  assert.equal(byClass(root, 'card').length, 1); assert.equal(byClass(root, 'panel-title').length, 1); assert.equal(byClass(root, 'panel-title')[0].textContent, 'ميلك شيك');
  type(box(), 'MANGO');
  assert.deepEqual(byClass(root, 'card').map((c) => byClass(c, 'card-name')[0].textContent).sort(), ['Mango', 'Passion Mango']);
  type(box(), 'zzzz'); assert.equal(byClass(root, 'card').length, 0); assert.ok(root.textContent.includes('لا توجد نتائج مطابقة'));
  type(box(), ''); assert.equal(byClass(root, 'card').length, 34);
});

test('category chips carry icons and mark the active section; the header and menu button work', async () => {
  const { dom, root } = await boot();
  assert.ok(byClass(root, 'tab').every((t) => byTag(t, 'img').length === 1));
  byClass(root, 'tab')[3].click();
  assert.ok(byClass(root, 'tab')[3].classList.contains('active') && !byClass(root, 'tab')[0].classList.contains('active'));
  const [, menuBtn] = byClass(root, 'icon-btn'); menuBtn.click();
  assert.ok(sheetEl(dom).textContent.includes('تواصل معنا'));
});
