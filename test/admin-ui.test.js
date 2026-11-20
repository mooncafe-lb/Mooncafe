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
  const now = () => new Date('2026-11-02T05:00:00Z');   // fixed clock: Monday 07:00 in Beirut, so results never depend on when the tests run
  const pub = createPublicRouter({ db, config, now }); const adm = createAdminRouter({ db, config, now });
  const jar = {};
  const calls = [];
  const slow = { upload: 0 };
  const fetchImpl = async (url, opts = {}) => {
    const isAdmin = url.startsWith('/api/admin');
    const router = isAdmin ? adm : pub;
    const body = typeof opts.body === 'string' ? JSON.parse(opts.body) : (opts.body && opts.body.buf ? opts.body.buf : opts.body);   // a File carries its bytes in .buf here
    if (isAdmin && url.startsWith('/api/admin/images') && slow.upload) await flush(slow.upload);
    const res = await dispatch(router, { method: opts.method || 'GET', url: url.slice(isAdmin ? 10 : 4), body, headers: opts.headers || {}, cookies: { ...jar } });
    calls.push({ method: opts.method || 'GET', url, status: res.statusCode });
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
  return { db, dom, root: dom.root, app, api, core, calls, slow };
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
  const inputs = byTag(root, 'input'); // token, full name, email, password, repeat
  type(inputs[0], 'setup-token-123'); type(inputs[1], 'Owner Name'); type(inputs[2], 'owner@moon.cafe'); type(inputs[3], PW); type(inputs[4], PW);
  btn(root, 'إنشاء حساب المدير').click(); await until(() => byClass(root, 'tab').length > 0);
}

test('first run: setup screen creates the admin and opens the dashboard; wrong login is refused', async () => {
  const ctx = await boot(); const { root } = ctx;
  await setupAndLogin(ctx);
  assert.deepEqual(byClass(root, 'tab').map((t) => t.dataset.tab), ['orders', 'staff', 'menu', 'store', 'brand', 'content', 'whatsapp', 'texts', 'account']);
  assert.ok(root.textContent.includes('الطلبات'));
  btn(root, 'خروج').click(); await until(() => root.textContent.includes('تسجيل الدخول'));
  const inputs = byTag(root, 'input'); type(inputs[0], 'owner@moon.cafe'); type(inputs[1], 'wrong password');
  btn(root, 'تسجيل الدخول').click(); await until(() => root.textContent.includes('البريد أو كلمة المرور غير صحيحة'));
  type(byTag(root, 'input')[1], PW); btn(root, 'تسجيل الدخول').click(); await until(() => byClass(root, 'tab').length === 9);
});

test('weak or mismatched setup passwords are stopped before reaching the server; missing SETUP_TOKEN is explained', async () => {
  const ctx = await boot(); const inputs = byTag(ctx.root, 'input');
  type(inputs[0], 'setup-token-123'); type(inputs[1], 'Owner Name'); type(inputs[2], 'a@b.co'); type(inputs[3], 'short'); type(inputs[4], 'short');
  btn(ctx.root, 'إنشاء حساب المدير').click(); await flush(30);
  assert.ok(ctx.root.textContent.includes('10 أحرف'));
  type(byTag(ctx.root, 'input')[3], PW); btn(ctx.root, 'إنشاء حساب المدير').click(); await flush(30);
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
  assert.ok(row.textContent.includes(`#${made.body.order.number}`) && row.textContent.includes('Sara Haddad') && row.textContent.includes('طلب جديد') && row.textContent.includes(made.body.order.date));
  row.click(); await flush(40);
  const s = sheetEl(dom);
  assert.ok(s.textContent.includes('Mango (كبير) × 2') && s.textContent.includes('Sibline road') && s.textContent.includes('650,000'));
  all(s, (n) => n.tagName === 'BUTTON' && n.dataset.status === 'confirmed')[0].click(); await flush(80);
  assert.equal((await db.query('SELECT status FROM orders')).rows[0].status, 'confirmed');
  assert.ok(byClass(root, 'order-row')[0].textContent.includes('تم قبول الطلب'));
  const sel = inputOf(root, 'الحالة'); sel.value = 'cancelled'; sel.dispatchEvent({ type: 'change', bubbles: true, target: sel }); await flush(60);
  assert.equal(byClass(root, 'order-row').length, 0);

  tab(root, 'account').click();
  const pw = byTag(root, 'input'); type(pw[0], PW); type(pw[1], 'a brand new password'); type(pw[2], 'a brand new password');
  btn(root, 'حفظ').click(); await until(() => byTag(root, 'input')[0].value === '');          // the form clears itself once the server accepted the change
  btn(root, 'خروج').click(); await until(() => root.textContent.includes('تسجيل الدخول'));
  const i = byTag(root, 'input'); type(i[0], 'owner@moon.cafe'); type(i[1], PW); btn(root, 'تسجيل الدخول').click(); await until(() => root.textContent.includes('البريد أو كلمة المرور غير صحيحة'));
  type(byTag(root, 'input')[1], 'a brand new password'); btn(root, 'تسجيل الدخول').click(); await until(() => byClass(root, 'tab').length === 9);
});

test('the dashboard switches to English and left-to-right', async () => {
  const ctx = await boot(); await setupAndLogin(ctx);
  btn(ctx.root, 'English').click();
  assert.equal(ctx.dom.doc.documentElement.dir, 'ltr');
  assert.ok(ctx.root.textContent.includes('Orders') && ctx.root.textContent.includes('Sign out'));
});

// ------------------------------------------------------------ staff and roles in the dashboard
const users = require('../server/lib/users');
const orders = require('../server/lib/orders');
const { loadAll } = require('../server/lib/settings');
const auth = require('../server/lib/auth');
const bossOf = async (db) => auth.publicAdmin((await db.query('SELECT id, email, username, full_name, role FROM admins WHERE id = 1')).rows[0]);
const placeOrder = async (db) => {
  const mango = (await db.query("SELECT p.id, s.id AS sid FROM products p JOIN product_sizes s ON s.product_id=p.id WHERE p.name_en='Mango' AND s.name_en='Large'")).rows[0];
  const res = await orders.createOrder(db, await loadAll(db), { customer_name: 'Sara Haddad', phone: '71123456', fulfillment: 'delivery', address: 'Sibline road', items: [{ product_id: mango.id, size_id: mango.sid, quantity: 1 }] }, new Date(), { tracking: true, baseUrl: 'https://moon.test' });
  return { ...res.order, id: res.internal_id, code: `#${res.order.number}` };
};
async function signIn(root, login, password = PW) {
  btn(root, 'خروج').click(); await until(() => root.textContent.includes('تسجيل الدخول') && !root.textContent.includes('خروج'));
  const i = byTag(root, 'input'); type(i[0], login); type(i[1], password); btn(root, 'تسجيل الدخول').click();
  await until(() => byClass(root, 'tab').length > 0);
}

test('Super Admin adds an employee in the Staff tab; the employee signs in with the username and sees only Orders', async () => {
  const ctx = await boot(); const { root, dom, db } = ctx;
  await setupAndLogin(ctx);
  tab(root, 'staff').click(); await until(() => root.textContent.includes('+ مستخدم جديد'));
  btn(root, '+ مستخدم جديد').click();
  const s = sheetEl(dom);
  type(inputOf(s, 'الاسم الكامل'), 'Ahmad Khalil'); type(inputOf(s, 'اسم المستخدم'), 'ahmad'); type(inputOf(s, 'كلمة المرور'), PW);
  inputOf(s, 'الدور').value = 'staff';
  all(s, (n) => n.dataset && n.dataset.act === 'save-user')[0].click();
  await until(() => sheetEl(dom) === undefined);
  const row = (await db.query("SELECT username, full_name, role, created_by FROM admins WHERE username = 'ahmad'")).rows[0];
  assert.deepEqual([row.full_name, row.role, row.created_by], ['Ahmad Khalil', 'staff', 1]);
  assert.ok(byClass(root, 'list-row').some((r) => r.textContent.includes('Ahmad Khalil') && r.textContent.includes('موظف')));

  const order = await placeOrder(db);
  await signIn(root, 'ahmad');
  assert.deepEqual(byClass(root, 'tab').map((t) => t.dataset.tab), ['orders', 'account']);        // no Menu, Settings, Staff or Brand for an employee
  assert.ok(root.textContent.includes('Ahmad Khalil'));
  await until(() => byClass(root, 'order-row').length === 1);
  assert.ok(byClass(root, 'order-row')[0].textContent.includes('بدون موظف'));
  byClass(root, 'order-row')[0].click(); await until(() => sheetEl(dom));
  assert.ok(sheetEl(dom).textContent.includes('الموظف المسؤول: بدون موظف'));
  assert.ok(all(sheetEl(dom), (n) => n.dataset && n.dataset.status === 'preparing')[0].disabled);   // cannot change status before receiving the order
  all(sheetEl(dom), (n) => n.dataset && n.dataset.act === 'claim')[0].click();
  await until(() => byClass(root, 'order-row')[0].textContent.includes('الموظف المسؤول: Ahmad Khalil'));
  assert.equal((await db.query('SELECT assigned_name, status FROM orders')).rows[0].status, 'confirmed');
  byClass(root, 'order-row')[0].click(); await until(() => sheetEl(dom));
  all(sheetEl(dom), (n) => n.dataset && n.dataset.status === 'preparing')[0].click();
  await until(() => byClass(root, 'order-row')[0].textContent.includes('قيد التحضير'));
  byClass(root, 'order-row')[0].click(); await until(() => sheetEl(dom));
  const log = byClass(sheetEl(dom), 'log-row').map((r) => r.textContent);
  assert.equal(log.length, 3);
  assert.ok(log[0].includes('تم إنشاء الطلب') && log[1].includes('استلم الطلب الموظف: Ahmad Khalil') && log[2].includes('قيد التحضير — بواسطة Ahmad Khalil'), log.join(' | '));
  assert.ok(sheetEl(dom).textContent.includes('الموظف المسؤول: Ahmad Khalil'));
  assert.ok(order.code);
});

test('Manager sees the staff dashboard and orders; cannot add managers, change settings or see the menu tabs', async () => {
  const ctx = await boot(); const { root, dom, db } = ctx;
  await setupAndLogin(ctx);
  const boss = await bossOf(db);
  await users.createUser(db, boss, { full_name: 'Mona Manager', username: 'mona', role: 'manager', password: PW });
  const created = await users.createUser(db, boss, { full_name: 'Ahmad Khalil', username: 'ahmad', role: 'staff', password: PW });
  const ahmad = auth.publicAdmin((await db.query('SELECT id, email, username, full_name, role FROM admins WHERE id = $1', [created.id])).rows[0]);
  const o1 = await placeOrder(db); await placeOrder(db);
  await orders.claimOrder(db, o1.id, ahmad); await orders.updateOrderStatus(db, o1.id, 'preparing', '', ahmad);
  await signIn(root, 'mona');
  assert.deepEqual(byClass(root, 'tab').map((t) => t.dataset.tab), ['orders', 'staff', 'account']);
  tab(root, 'staff').click(); await until(() => byClass(root, 'staff-card').length > 0);
  assert.ok(root.textContent.includes('طلبات بانتظار الاستلام: 1'));
  const card = byClass(root, 'staff-card').find((c) => c.textContent.includes('Ahmad Khalil'));
  assert.ok(card.textContent.includes('طلبات حالية: 1') && card.textContent.includes('طلبات تابعها: 1') && card.textContent.includes('قيد التحضير'));
  btn(card, 'التفاصيل').click(); await until(() => sheetEl(dom));
  assert.ok(sheetEl(dom).textContent.includes('الطلبات السابقة') && sheetEl(dom).textContent.includes(o1.code) && sheetEl(dom).textContent.includes('آخر الإجراءات'));
  dom.doc.body.children.filter((c) => c.classList.contains('backdrop')).forEach((b) => b.remove());
  btn(root, '+ مستخدم جديد').click();
  assert.equal(inputOf(sheetEl(dom), 'الدور').children.length, 1);        // a manager can only create staff
  assert.ok(root.textContent.includes('Mona Manager'));
});


// ------------------------------------------------------------------ product image upload from the dashboard
const sharp = require('sharp');
const fileOf = (name, type, buf, size) => ({ name, type, size: size === undefined ? buf.length : size, buf });
const choose = (input, file) => { input.files = [file]; input.dispatchEvent({ type: 'change', bubbles: true, target: input }); };
const pickerOf = (sheet) => all(sheet, (n) => n.tagName === 'INPUT' && n.getAttribute('type') === 'file')[0];
const statusOf = (sheet) => byClass(sheet, 'img-status')[0];
const openEspresso = async (ctx) => {
  tab(ctx.root, 'menu').click();
  const row = all(ctx.root, (n) => n.classList.contains('list-row') && n.textContent.includes('Espresso'))[0];
  btn(row, 'تعديل').click();
  type(inputOf(sheetEl(ctx.dom), 'السعر (ل.ل.)'), '95000');
  return sheetEl(ctx.dom);
};
const jpegBytes = (w = 1200, h = 900) => sharp({ create: { width: w, height: h, channels: 3, background: { r: 200, g: 120, b: 40 } } }).jpeg().toBuffer();
const savedToast = (dom) => byClass(dom.doc.body, 'toast').some((x) => x.textContent === 'تم الحفظ');

test('image upload from the dashboard: appears in the admin list, in the customer menu, loads from its URL, survives a refresh', async () => {
  const ctx = await boot(); const { dom, root, api, calls, db } = ctx; await setupAndLogin(ctx);
  const sheet = await openEspresso(ctx);
  choose(pickerOf(sheet), fileOf('espresso.jpg', 'image/jpeg', await jpegBytes()));
  await until(() => statusOf(sheet).textContent === 'تم رفع الصورة ✓');
  btn(sheet, 'حفظ').click();
  await until(() => savedToast(dom) && sheetEl(dom) === undefined);
  const menu = await api('GET', '/menu');
  const espresso = menu.categories[0].products.find((p) => p.name_en === 'Espresso');
  assert.match(espresso.thumb_url, /^\/api\/images\/\d+\?v=thumb$/); assert.equal(espresso.orderable, true);
  const adminRow = all(root, (n) => n.classList.contains('list-row') && n.textContent.includes('Espresso'))[0];
  assert.equal(byTag(adminRow, 'img')[0].getAttribute('src'), espresso.thumb_url);               // visible in the admin list at once
  const imageCall = calls.find((c) => c.url.startsWith(espresso.thumb_url.split('?')[0]) && c.method === 'GET');
  assert.ok(imageCall && imageCall.status === 200);                                              // the browser could load it
  const fresh = await boot({ db });                                                              // a "refresh": new page, same database
  assert.equal((await fresh.api('GET', '/menu')).categories[0].products.find((p) => p.name_en === 'Espresso').thumb_url, espresso.thumb_url);
  assert.equal((await db.query('SELECT count(*) AS n FROM images')).rows[0].n, 1);
});

test('a failed upload shows a clear error, blocks saving, and never says Saved', async () => {
  const ctx = await boot(); const { dom, calls } = ctx; await setupAndLogin(ctx);
  const sheet = await openEspresso(ctx);
  choose(pickerOf(sheet), fileOf('notes.jpg', 'image/jpeg', Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)])));   // starts like a JPEG, is corrupt
  await until(() => statusOf(sheet).textContent.includes('ليس صورة صالحة'));
  assert.ok(statusOf(sheet).className.includes('err'));
  btn(sheet, 'حفظ').click(); await flush(60);
  assert.ok(sheet.textContent.includes('ليس صورة صالحة'));
  assert.ok(!savedToast(dom)); assert.equal(calls.filter((c) => c.method === 'PUT' && c.url.includes('/products/')).length, 0);
  assert.ok(sheetEl(dom));                                                                          // the editor stays open
});

test('pressing Save while the image is still uploading is blocked, then works once it finished', async () => {
  const ctx = await boot(); const { dom, slow } = ctx; await setupAndLogin(ctx);
  const sheet = await openEspresso(ctx);
  slow.upload = 120;
  choose(pickerOf(sheet), fileOf('espresso.jpg', 'image/jpeg', await jpegBytes()));
  await flush(20);
  btn(sheet, 'حفظ').click(); await flush(20);
  assert.ok(sheet.textContent.includes('انتظر حتى ينتهي رفع الصورة')); assert.ok(!savedToast(dom));
  await until(() => statusOf(sheet).textContent === 'تم رفع الصورة ✓');
  btn(sheet, 'حفظ').click(); await until(() => savedToast(dom));
});

test('a file that is far too large is refused immediately with a clear message (no upload, no Saved)', async () => {
  const ctx = await boot(); const { calls } = ctx; await setupAndLogin(ctx);
  const sheet = await openEspresso(ctx);
  choose(pickerOf(sheet), fileOf('huge.jpg', 'image/jpeg', Buffer.from('x'), 70 * 1024 * 1024));
  await flush(20);
  assert.ok(statusOf(sheet).textContent.includes('كبير جداً'));
  assert.equal(calls.filter((c) => c.url.startsWith('/api/admin/images')).length, 0);
});


// ------------------------------------------------------------- orders: number, date, time, search, tracking link
const byId = (el, id) => all(el, (n) => n.attrs && n.attrs.get('id') === id)[0];
const orderAt = async (db, { now, fulfillment, name, phone }) => {
  const mango = (await db.query("SELECT p.id, s.id AS sid FROM products p JOIN product_sizes s ON s.product_id=p.id WHERE p.name_en='Mango' AND s.name_en='Large'")).rows[0];
  return orders.createOrder(db, await loadAll(db), { customer_name: name, phone, fulfillment, address: fulfillment === 'delivery' ? 'Sibline road' : '', items: [{ product_id: mango.id, size_id: mango.sid, quantity: 1 }] }, new Date(now), { tracking: true, baseUrl: 'https://moon.test' });
};

test('Admin orders on a phone-sized list: number + date + time, search, date filter, tracking link, stages by order type', async () => {
  const ctx = await boot(); const { root, dom, db } = ctx;
  await setupAndLogin(ctx);
  const pick = await orderAt(db, { now: '2026-11-04T11:45:00Z', fulfillment: 'pickup', name: 'Sara Haddad', phone: '71123456' });
  await orderAt(db, { now: '2026-11-05T07:20:00Z', fulfillment: 'delivery', name: 'Karim Nader', phone: '03987654' });
  tab(root, 'orders').click(); await until(() => byClass(root, 'order-row').length === 2);
  const rows = () => byClass(root, 'order-row');
  assert.ok(rows()[0].textContent.includes('#1') && rows()[0].textContent.includes('05/11/2026') && rows()[0].textContent.includes('09:20 ص') && rows()[0].textContent.includes('Karim Nader'));
  assert.ok(rows()[1].textContent.includes('#1') && rows()[1].textContent.includes('04/11/2026') && rows()[1].textContent.includes('01:45 م'));   // both are number 1, on different days
  const search = byId(root, 'order-search'); const day = byId(root, 'order-day');
  type(search, 'sara'); await until(() => rows().length === 1 && rows()[0].textContent.includes('Sara Haddad'));
  type(search, '0398'); await until(() => rows().length === 1 && rows()[0].textContent.includes('Karim Nader'));          // phone typed locally
  type(search, '04/11/2026'); await until(() => rows().length === 1 && rows()[0].textContent.includes('Sara Haddad'));      // by date
  type(search, ''); await until(() => rows().length === 2);
  day.value = '2026-11-05'; day.dispatchEvent({ type: 'change', bubbles: true, target: day }); await until(() => rows().length === 1);
  day.value = ''; day.dispatchEvent({ type: 'change', bubbles: true, target: day }); await until(() => rows().length === 2);
  const sel = inputOf(root, 'الحالة'); sel.value = 'confirmed'; sel.dispatchEvent({ type: 'change', bubbles: true, target: sel }); await until(() => rows().length === 0);
  sel.value = ''; sel.dispatchEvent({ type: 'change', bubbles: true, target: sel }); await until(() => rows().length === 2);

  rows()[1].click(); await until(() => sheetEl(dom));                                   // the pickup order
  const s = sheetEl(dom);
  assert.ok(s.textContent.includes('#1') && s.textContent.includes('04/11/2026') && s.textContent.includes('01:45 م'));
  const statuses = () => all(sheetEl(dom), (n) => n.dataset && n.dataset.status).map((n) => n.dataset.status);
  assert.deepEqual(statuses(), ['whatsapp_prepared', 'confirmed', 'preparing', 'ready', 'completed', 'cancelled']);        // pickup stages
  const token = (await db.query('SELECT tracking_token FROM orders WHERE id = $1', [pick.internal_id])).rows[0].tracking_token;
  assert.equal(byId(s, 'open-tracking').getAttribute('href'), `https://moon.test/track/${token}`);
  all(s, (n) => n.dataset && n.dataset.status === 'ready')[0].click(); await until(() => sheetEl(dom) === undefined);
  assert.equal((await db.query('SELECT status FROM orders WHERE id = $1', [pick.internal_id])).rows[0].status, 'ready');
  rows()[0].click(); await until(() => sheetEl(dom));                                   // the delivery order
  assert.deepEqual(statuses(), ['whatsapp_prepared', 'confirmed', 'preparing', 'out_for_delivery', 'completed', 'cancelled']);
  assert.ok(sheetEl(dom).textContent.includes('مع المندوب') && !sheetEl(dom).textContent.includes('جاهز للاستلام'));
});
