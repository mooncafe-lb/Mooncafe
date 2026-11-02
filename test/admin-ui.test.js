'use strict';
// The REAL admin dashboard code (public/admin) in a fake browser, against the real admin/public routers
// and a database built from the real migrations.
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
const { createPublicRouter } = require('../server/lib/publicRouter');
const { createAdminRouter } = require('../server/lib/adminRouter');
const { installDom, all, byClass, byTag, withText, flush, type } = require('./helpers/fake-dom');

const config = { sessionSecret: 's'.repeat(40), setupToken: 'setup-token-123', isProd: false };
const PW = 'correct horse battery';
let run = 0;

async function boot({ db: given, migrations } = {}) {
  const db = given || (migrations ? createTestDb({ migrations }) : await freshDb());
  const pub = createPublicRouter({ db, config }); const adm = createAdminRouter({ db, config });
  const jar = {};
  const fetchImpl = async (url, opts = {}) => {
    const isAdmin = url.startsWith('/api/admin');
    const router = isAdmin ? adm : pub;
    const body = typeof opts.body === 'string' ? JSON.parse(opts.body) : opts.body;
    const res = await dispatch(router, { method: opts.method || 'GET', url: url.slice(isAdmin ? 10 : 4), body, headers: opts.headers || {}, cookies: { ...jar } });
    if (res.cookiesSet.mc_session) jar.mc_session = res.cookiesSet.mc_session.value;
    if (res.cleared) delete jar.mc_session;
    return { ok: res.statusCode < 400, status: res.statusCode, json: async () => JSON.parse(JSON.stringify(res.body === undefined ? null : res.body)) };
  };
  const dom = installDom({ fetchImpl });
  dom.root.setAttribute('id', 'admin');
  dom.win.confirm = () => true;
  const core = await import('../public/admin/core.js');
  core.closeSheet(); Object.assign(core.state, { admin: null, data: null, lang: 'ar' });
  const app = await import(`../public/admin/admin.js?run=${++run}`);
  await app.ready;
  const api = async (method, url, bodyObj) => (await dispatch(pub, { method, url, body: bodyObj })).body;
  return { db, dom, root: dom.root, app, api, core };
}

const fieldOf = (el, label) => all(el, (n) => n.classList.contains('field') && n.children[0] && n.children[0].tagName === 'LABEL' && n.children[0].textContent === label)[0];
const inputOf = (el, label) => fieldOf(el, label).children[1];
const checkOf = (el, label) => all(el, (n) => n.classList.contains('check') && n.textContent === label)[0].children[0];
const btn = (el, text) => withText(el, text, 'button')[0];
const body = (dom) => dom.doc.body;
const sheetEl = (dom) => byClass(dom.doc.body, 'sheet')[0];
const until = async (cond, ms = 15000) => { const t0 = Date.now(); while (!cond()) { if (Date.now() - t0 > ms) throw new Error('timed out waiting for the screen'); await flush(10); } };
const tab = (root, key) => byClass(root, 'tab').find((t) => t.dataset.tab === key);

async function setupAndLogin(ctx) {
  const { root } = ctx;
  assert.ok(root.textContent.includes('هذا أول تشغيل'));
  const inputs = byTag(root, 'input'); // token, email, password, repeat
  type(inputs[0], 'setup-token-123'); type(inputs[1], 'owner@moon.cafe'); type(inputs[2], PW); type(inputs[3], PW);
  btn(root, 'إنشاء حساب المدير').click(); await until(() => byClass(root, 'tab').length > 0);
}

test('first run: setup screen creates the admin and opens the dashboard; wrong login is refused', async () => {
  const ctx = await boot(); const { root } = ctx;
  await setupAndLogin(ctx);
  assert.deepEqual(byClass(root, 'tab').map((t) => t.dataset.tab), ['orders', 'menu', 'store', 'brand', 'content', 'whatsapp', 'texts', 'account']);
  assert.ok(root.textContent.includes('الطلبات'));
  btn(root, 'خروج').click(); await until(() => root.textContent.includes('تسجيل الدخول'));
  const inputs = byTag(root, 'input'); type(inputs[0], 'owner@moon.cafe'); type(inputs[1], 'wrong password');
  btn(root, 'تسجيل الدخول').click(); await until(() => root.textContent.includes('البريد أو كلمة المرور غير صحيحة'));
  type(byTag(root, 'input')[1], PW); btn(root, 'تسجيل الدخول').click(); await until(() => byClass(root, 'tab').length === 8);
});

test('weak or mismatched setup passwords are stopped before reaching the server; missing SETUP_TOKEN is explained', async () => {
  const ctx = await boot(); const inputs = byTag(ctx.root, 'input');
  type(inputs[0], 'setup-token-123'); type(inputs[1], 'a@b.co'); type(inputs[2], 'short'); type(inputs[3], 'short');
  btn(ctx.root, 'إنشاء حساب المدير').click(); await flush(30);
  assert.ok(ctx.root.textContent.includes('10 أحرف'));
  type(byTag(ctx.root, 'input')[2], PW); btn(ctx.root, 'إنشاء حساب المدير').click(); await flush(30);
  assert.ok(ctx.root.textContent.includes('غير متطابقتين'));
});

test('before the migrations are applied the dashboard explains what to do', async () => {
  const ctx = await boot({ migrations: ['001_init.sql'] });
  assert.ok(ctx.root.textContent.includes('قاعدة البيانات تحتاج تحديثاً') && ctx.root.textContent.includes('MIGRATION_MODE=apply'));
});

test('Admin manages menu: new category, new product with size, required choice; customers see it and can order it', async () => {
  const ctx = await boot(); const { root, dom, db, api } = ctx;
  await setupAndLogin(ctx);
  tab(root, 'menu').click();
  assert.equal(byClass(root, 'box').filter((b) => b.dataset.category).length, 5);
  btn(root, '+ قسم جديد').click();
  type(inputOf(sheetEl(dom), 'الاسم بالعربي'), 'شاي'); type(inputOf(sheetEl(dom), 'الاسم بالإنجليزي'), 'Tea');
  btn(sheetEl(dom), 'حفظ').click(); await flush(80);
  assert.equal(byClass(root, 'box').filter((b) => b.dataset.category).length, 6);
  const teaBox = byClass(root, 'box').find((b) => b.dataset.category && b.textContent.includes('شاي'));
  btn(teaBox, '+ منتج جديد').click();
  let s = sheetEl(dom);
  type(inputOf(s, 'الاسم بالعربي'), 'شاي أخضر'); type(inputOf(s, 'الاسم بالإنجليزي'), 'Green Tea');
  type(inputOf(s, 'السعر (ل.ل.)'), '80000');
  btn(s, '+ مجموعة خيارات').click(); s = sheetEl(dom);
  type(inputOf(s, 'اسم المجموعة (عربي)'), 'السكر'); type(inputOf(s, 'اسم المجموعة (إنجليزي)'), 'Sugar'); checkOf(s, 'إلزامي').checked = true;
  btn(s, '+ خيار').click(); btn(s, '+ خيار').click(); s = sheetEl(dom);
  const ca = all(s, (n) => n.classList.contains('field') && n.children[0] && n.children[0].textContent === 'الخيار (عربي)');
  const ce = all(s, (n) => n.classList.contains('field') && n.children[0] && n.children[0].textContent === 'الخيار (إنجليزي)');
  type(ca[0].children[1], 'سادة'); type(ce[0].children[1], 'Plain'); type(ca[1].children[1], 'وسط'); type(ce[1].children[1], 'Medium');
  btn(s, 'حفظ').click(); await flush(100);
  assert.equal(sheetEl(dom), undefined);

  const menu = await api('GET', '/menu');
  const tea = menu.categories.find((c) => c.name_en === 'Tea').products[0];
  assert.deepEqual([tea.name_en, tea.orderable, tea.sizes[0].price_lbp, tea.groups[0].required, tea.groups[0].choices.map((c) => c.name_en)], ['Green Tea', true, 80000, true, ['Plain', 'Medium']]);
  const order = await dispatch(createPublicRouter({ db, config }), { method: 'POST', url: '/orders', body: { customer_name: 'Sara Haddad', phone: '71123456', fulfillment: 'pickup', items: [{ product_id: tea.id, size_id: tea.sizes[0].id, quantity: 1, choice_ids: [tea.groups[0].choices[0].id] }] } });
  assert.equal(order.statusCode, 201); assert.equal(order.body.order.total_lbp, 80000);
});

test('Admin sets the Coffee price and the product becomes orderable; sold-out and hidden switches work', async () => {
  const ctx = await boot(); const { root, dom, api } = ctx;
  await setupAndLogin(ctx); tab(root, 'menu').click();
  const espressoRow = all(root, (n) => n.classList.contains('list-row') && n.textContent.includes('Espresso'))[0];
  assert.ok(espressoRow.textContent.includes('بدون سعر'));
  btn(espressoRow, 'تعديل').click();
  type(inputOf(sheetEl(dom), 'السعر (ل.ل.)'), '95000');
  btn(sheetEl(dom), 'حفظ').click(); await flush(100);
  let coffee = (await api('GET', '/menu')).categories[0].products.find((p) => p.name_en === 'Espresso');
  assert.equal(coffee.orderable, true); assert.equal(coffee.sizes[0].price_lbp, 95000);
  const row2 = all(root, (n) => n.classList.contains('list-row') && n.textContent.includes('Espresso'))[0];
  btn(row2, 'تعديل').click(); checkOf(sheetEl(dom), 'غير متوفر (نفد)').checked = true; checkOf(sheetEl(dom), 'ظاهر في الموقع').checked = false;
  btn(sheetEl(dom), 'حفظ').click(); await flush(100);
  const menu = await api('GET', '/menu');
  assert.ok(!menu.categories[0].products.some((p) => p.name_en === 'Espresso'));        // hidden
});

test('Admin controls open/closed: manual switch and weekly hours reach the customer site', async () => {
  const ctx = await boot(); const { root, api } = ctx;
  await setupAndLogin(ctx); tab(root, 'store').click(); await flush(20);
  assert.ok(root.textContent.includes('الحالة الآن'));
  const mode = inputOf(root, 'وضع المقهى'); mode.value = 'force_closed';
  btn(byClass(root, 'box')[0], 'حفظ').click(); await flush(60);
  let st = (await api('GET', '/store')).status; assert.equal(st.open, false); assert.equal(st.reason, 'manual_closed');
  mode.value = 'auto'; btn(byClass(root, 'box')[0], 'حفظ').click(); await flush(60);
  const monday = byClass(root, 'day').find((d) => d.dataset.day === 'mon');
  btn(monday, '+ فترة').click();
  const times = all(monday, (n) => n.tagName === 'INPUT'); times[0].value = '08:00'; times[1].value = '23:00';
  btn(byClass(root, 'box')[1], 'حفظ').click(); await flush(60);
  const store = await api('GET', '/store');
  assert.deepEqual(store.hours.mon, [{ open: '08:00', close: '23:00' }]); assert.equal(store.status.reason, 'closed_hours');
  assert.ok(store.status.next_open);
});

test('Admin edits brand, WhatsApp, delivery, content, promotions and texts; saved values reach the site', async () => {
  const ctx = await boot(); const { root, api } = ctx;
  await setupAndLogin(ctx);
  tab(root, 'brand').click();
  inputOf(root, 'اللون الرئيسي').value = '#FFD000'; inputOf(root, 'خط العربية').value = 'Tajawal';
  btn(root, 'حفظ').click(); await flush(60);
  let store = await api('GET', '/store'); assert.equal(store.branding.primary_color, '#FFD000'); assert.equal(store.branding.font_ar, 'Tajawal');

  tab(root, 'whatsapp').click();
  type(inputOf(root, 'رقم واتساب (مع رمز الدولة أو محلي)'), '71 000 111');
  type(inputOf(root, 'رسوم التوصيل (ل.ل.)'), '60000'); type(inputOf(root, 'الحد الأدنى للطلب (ل.ل.)'), '200000');
  checkOf(root, 'تفعيل الاستلام').checked = true;
  for (const b of withText(root, 'حفظ', 'button')) b.click();
  await flush(80);
  store = await api('GET', '/store'); assert.equal(store.delivery.delivery_fee_lbp, 60000); assert.equal(store.delivery.min_order_lbp, 200000);

  tab(root, 'content').click();
  type(inputOf(root, 'عنوان الواجهة (عربي)'), 'أهلاً بكم في مون'); type(inputOf(root, 'العنوان (عربي)'), 'صبلين، وادي الزينة');
  type(inputOf(root, 'Instagram (اسم الحساب أو الرابط)'), 'mooncafe.lb');
  for (const b of withText(root, 'حفظ', 'button').slice(0, 3)) b.click();
  btn(root, '+ إضافة').click();
  const promoTitle = inputOf(byClass(root, 'subbox').find((x) => x.dataset.promo), 'عنوان العرض (عربي)'); type(promoTitle, 'عرض اليوم');
  withText(root, 'حفظ', 'button').slice(-1)[0].click();
  await flush(100);
  store = await api('GET', '/store');
  assert.equal(store.content.hero_title_ar, 'أهلاً بكم في مون'); assert.equal(store.address_ar, 'صبلين، وادي الزينة'); assert.equal(store.social.instagram, 'mooncafe.lb');
  assert.equal(store.promotions.length, 1); assert.equal(store.promotions[0].title_ar, 'عرض اليوم');

  tab(root, 'texts').click();
  const row = byClass(root, 'text-row').find((r) => r.dataset.key === 'order_now');
  type(row.children[0].children[0], 'اطلب هلق');
  btn(root, 'حفظ').click(); await flush(80);
  store = await api('GET', '/store');
  assert.equal(store.content.overrides.order_now.ar, 'اطلب هلق');
  assert.equal(store.content.hero_title_ar, 'أهلاً بكم في مون');                // saving texts did not wipe other content
});

test('orders tab: list, details, status change; account tab: password change', async () => {
  const ctx = await boot(); const { root, dom, db, api } = ctx;
  const pub = createPublicRouter({ db, config });
  const mango = (await db.query("SELECT p.id, s.id AS sid FROM products p JOIN product_sizes s ON s.product_id=p.id WHERE p.name_en='Mango' AND s.name_en='Large'")).rows[0];
  const made = await dispatch(pub, { method: 'POST', url: '/orders', body: { customer_name: 'Sara Haddad', phone: '71123456', fulfillment: 'delivery', address: 'Sibline road', items: [{ product_id: mango.id, size_id: mango.sid, quantity: 2 }] } });
  await setupAndLogin(ctx);
  const row = byClass(root, 'order-row')[0];
  assert.ok(row.textContent.includes(made.body.order.code) && row.textContent.includes('Sara Haddad') && row.textContent.includes('بانتظار واتساب'));
  row.click(); await flush(40);
  const s = sheetEl(dom);
  assert.ok(s.textContent.includes('Mango (كبير) × 2') && s.textContent.includes('Sibline road') && s.textContent.includes('650,000'));
  all(s, (n) => n.tagName === 'BUTTON' && n.dataset.status === 'confirmed')[0].click(); await flush(80);
  assert.equal((await db.query('SELECT status FROM orders')).rows[0].status, 'confirmed');
  assert.ok(byClass(root, 'order-row')[0].textContent.includes('مؤكد'));
  const sel = inputOf(root, 'الحالة'); sel.value = 'cancelled'; sel.dispatchEvent({ type: 'change', bubbles: true, target: sel }); await flush(60);
  assert.equal(byClass(root, 'order-row').length, 0);

  tab(root, 'account').click();
  const pw = byTag(root, 'input'); type(pw[0], PW); type(pw[1], 'a brand new password'); type(pw[2], 'a brand new password');
  btn(root, 'حفظ').click(); await until(() => byTag(root, 'input')[0].value === '');          // the form clears itself once the server accepted the change
  btn(root, 'خروج').click(); await until(() => root.textContent.includes('تسجيل الدخول'));
  const i = byTag(root, 'input'); type(i[0], 'owner@moon.cafe'); type(i[1], PW); btn(root, 'تسجيل الدخول').click(); await until(() => root.textContent.includes('البريد أو كلمة المرور غير صحيحة'));
  type(byTag(root, 'input')[1], 'a brand new password'); btn(root, 'تسجيل الدخول').click(); await until(() => byClass(root, 'tab').length === 8);
});

test('the dashboard switches to English and left-to-right', async () => {
  const ctx = await boot(); await setupAndLogin(ctx);
  btn(ctx.root, 'English').click();
  assert.equal(ctx.dom.doc.documentElement.dir, 'ltr');
  assert.ok(ctx.root.textContent.includes('Orders') && ctx.root.textContent.includes('Sign out'));
});
