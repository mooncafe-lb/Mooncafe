'use strict';
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
const auth = require('../server/lib/auth');
const users = require('../server/lib/users');
const orders = require('../server/lib/orders');
const staff = require('../server/lib/staff');
const { can, normalizeRole } = require('../server/lib/permissions');
const { createAdminRouter } = require('../server/lib/adminRouter');
const { loadAll } = require('../server/lib/settings');

const config = { sessionSecret: 's'.repeat(40), setupToken: 'setup-token-123', isProd: false };
const PW = 'correct horse battery';
const H = { 'x-requested-with': 'mc-admin' };

async function team() {
  const db = await freshDb();
  await auth.setupFirstAdmin(db, config, { token: 'setup-token-123', email: 'owner@moon.cafe', full_name: 'Rita Owner', password: PW });
  const actor = async (id) => auth.publicAdmin((await db.query('SELECT id, email, username, full_name, role FROM admins WHERE id = $1', [id])).rows[0]);
  const boss = await actor(1);
  const mk = async (full_name, username, role) => actor((await users.createUser(db, boss, { full_name, username, role, password: PW })).id);
  const manager = await mk('Mona Manager', 'mona', 'manager');
  const ahmad = await mk('Ahmad Khalil', 'ahmad', 'staff');
  const mohamad = await mk('Mohamad Saad', 'mohamad', 'staff');
  const place = async () => {
    const mango = (await db.query("SELECT p.id, s.id AS sid FROM products p JOIN product_sizes s ON s.product_id=p.id WHERE p.name_en='Mango' AND s.name_en='Large'")).rows[0];
    const r = await orders.createOrder(db, await loadAll(db), { customer_name: 'Sara Haddad', phone: '71123456', fulfillment: 'delivery', address: 'Sibline road', items: [{ product_id: mango.id, size_id: mango.sid, quantity: 1 }] });
    return r.order.id;
  };
  return { db, boss, manager, ahmad, mohamad, place, actor };
}
const code = async (p) => { try { await p; return 'ok'; } catch (e) { return e.code; } };

test('role matrix: Super Admin everything, Manager orders+staff, Staff only their own work', () => {
  assert.equal(normalizeRole('owner'), 'super_admin');
  for (const p of ['menu.manage', 'settings.manage', 'users.manage_all', 'orders.update']) assert.equal(can('super_admin', p), true);
  assert.equal(can('owner', 'settings.manage'), true);                      // accounts created before roles existed keep full access
  for (const p of ['orders.view', 'orders.assign', 'staff.view', 'users.manage_staff']) assert.equal(can('manager', p), true);
  for (const p of ['menu.manage', 'settings.manage', 'users.manage_all']) assert.equal(can('manager', p), false);
  for (const p of ['orders.view', 'orders.claim', 'orders.update_own']) assert.equal(can('staff', p), true);
  for (const p of ['orders.update', 'orders.assign', 'staff.view', 'users.view', 'menu.manage', 'settings.manage']) assert.equal(can('staff', p), false);
  assert.equal(can('nonsense', 'settings.manage'), false);                  // unknown roles fall back to the lowest role
});

test('users: Super Admin creates accounts with username + real name; login works by username or email', async () => {
  const { db } = await team();
  const r = await auth.login(db, config, { login: 'AHMAD', password: PW });
  assert.equal(r.admin.name, 'Ahmad Khalil'); assert.equal(r.admin.role, 'staff'); assert.ok(!r.admin.permissions.includes('settings.manage'));
  const viaEmail = await auth.login(db, config, { login: 'owner@moon.cafe', password: PW });
  assert.equal(viaEmail.admin.role, 'super_admin'); assert.equal(viaEmail.admin.name, 'Rita Owner');
  await assert.rejects(auth.login(db, config, { login: 'ahmad', password: 'wrong password!' }), (e) => e.status === 401);
});

test('users: duplicate usernames, validation, and manager limits', async () => {
  const { db, boss, manager, ahmad } = await team();
  assert.equal(await code(users.createUser(db, boss, { full_name: 'Other', username: 'Ahmad', password: PW })), 'username_taken');
  assert.equal(await code(users.createUser(db, boss, { full_name: 'X', username: 'ab', password: 'short' })), 'validation');
  assert.equal(await code(users.createUser(db, manager, { full_name: 'New Staff', username: 'newstaff', password: PW })), 'ok');            // manager may add staff
  assert.equal(await code(users.createUser(db, manager, { full_name: 'New Boss', username: 'newboss', role: 'manager', password: PW })), 'forbidden');
  assert.equal(await code(users.createUser(db, manager, { full_name: 'New Boss', username: 'newboss2', role: 'super_admin', password: PW })), 'forbidden');
  assert.equal(await code(users.createUser(db, ahmad, { full_name: 'Sneaky', username: 'sneaky', password: PW })), 'forbidden');              // staff cannot add anyone
  const staffId = ahmad.id;
  assert.equal(await code(users.updateUser(db, manager, staffId, { full_name: 'Ahmad K', username: 'ahmad' })), 'ok');                         // manager edits staff
  assert.equal(await code(users.updateUser(db, manager, boss.id, { full_name: 'Hacked', username: 'rita' })), 'forbidden');                    // but not the owner
  assert.equal(await code(users.updateUser(db, manager, manager.id, { full_name: 'Mona', username: 'mona', role: 'super_admin' })), 'forbidden');
  assert.equal(await code(users.deleteUser(db, manager, staffId)), 'forbidden');                                                               // only Super Admin deletes
  assert.equal(await code(users.deleteUser(db, boss, staffId)), 'ok');
});

test('users: disable and password reset sign the person out; the last Super Admin is protected', async () => {
  const { db, boss, mohamad } = await team();
  const session = await auth.login(db, config, { login: 'mohamad', password: PW });
  assert.ok(await auth.sessionAdmin(db, config, session.token));
  await users.updateUser(db, boss, mohamad.id, { full_name: 'Mohamad Saad', username: 'mohamad', is_active: false });
  assert.equal(await auth.sessionAdmin(db, config, session.token), null);
  await assert.rejects(auth.login(db, config, { login: 'mohamad', password: PW }), (e) => e.status === 401);
  await users.updateUser(db, boss, mohamad.id, { full_name: 'Mohamad Saad', username: 'mohamad', is_active: true, password: 'a brand new password' });
  assert.ok((await auth.login(db, config, { login: 'mohamad', password: 'a brand new password' })).token);
  assert.equal(await code(users.updateUser(db, boss, boss.id, { full_name: 'Rita', username: 'rita', is_active: false })), 'cannot_disable_self');
  assert.equal(await code(users.deleteUser(db, boss, boss.id)), 'cannot_delete_self');
  const second = await users.createUser(db, boss, { full_name: 'Second Boss', username: 'boss2', role: 'super_admin', password: PW });
  const secondActor = auth.publicAdmin((await db.query('SELECT id, email, username, full_name, role FROM admins WHERE id=$1', [second.id])).rows[0]);
  assert.equal(await code(users.updateUser(db, secondActor, boss.id, { full_name: 'Rita', username: 'rita', role: 'staff' })), 'ok');         // allowed: another Super Admin remains
  assert.equal(await code(users.updateUser(db, secondActor, secondActor.id, { full_name: 'Second', username: 'boss2', role: 'staff' })), 'last_super_admin');
  const rita = auth.publicAdmin((await db.query('SELECT id, email, username, full_name, role FROM admins WHERE id=$1', [boss.id])).rows[0]);       // fresh role from the database, as every request does
  assert.equal(await code(users.deleteUser(db, rita, 999)), 'forbidden');                                                                       // Rita is staff now
});

test('an order is linked to the employee: claim, who works on it, full activity log with names', async () => {
  const { db, ahmad, mohamad, manager, place } = await team();
  const id = await place();
  assert.equal((await orders.getOrder(db, id)).order.assigned_name, '');
  assert.equal(await code(orders.updateOrderStatus(db, id, 'preparing', '', ahmad)), 'claim_first');          // must receive the order first
  await orders.claimOrder(db, id, ahmad);
  let o = (await orders.getOrder(db, id)).order;
  assert.deepEqual([o.assigned_to, o.assigned_name, o.status], [ahmad.id, 'Ahmad Khalil', 'confirmed']); assert.ok(o.assigned_at);
  assert.equal(await code(orders.claimOrder(db, id, mohamad)), 'already_assigned');
  assert.equal(await code(orders.updateOrderStatus(db, id, 'preparing', '', mohamad)), 'not_your_order');     // another employee cannot touch it
  await orders.updateOrderStatus(db, id, 'preparing', 'no sugar', ahmad);
  await orders.assignOrder(db, id, mohamad.id, manager);                                                     // the manager hands it over
  o = (await orders.getOrder(db, id)).order; assert.equal(o.assigned_name, 'Mohamad Saad');
  assert.equal(await code(orders.updateOrderStatus(db, id, 'ready', '', ahmad)), 'not_your_order');          // Ahmad lost access
  await orders.updateOrderStatus(db, id, 'ready', '', mohamad);
  await orders.updateOrderStatus(db, id, 'out_for_delivery', '', mohamad);
  await orders.updateOrderStatus(db, id, 'completed', '', mohamad);
  assert.equal(await code(orders.claimOrder(db, id, ahmad)), 'order_closed');

  const { history } = await orders.getOrder(db, id);
  assert.deepEqual(history.map((h) => [h.event, h.status, h.actor_name, h.target_name]), [
    ['status', 'whatsapp_prepared', '', ''],                 // created by the customer (no employee)
    ['claimed', 'confirmed', 'Ahmad Khalil', ''],
    ['status', 'preparing', 'Ahmad Khalil', ''],
    ['assigned', 'preparing', 'Mona Manager', 'Mohamad Saad'],
    ['status', 'ready', 'Mohamad Saad', ''],
    ['status', 'out_for_delivery', 'Mohamad Saad', ''],
    ['status', 'completed', 'Mohamad Saad', ''],
  ]);
  assert.ok(history.every((h) => h.created_at)); assert.equal(history[2].note, 'no sugar');
  assert.deepEqual(history.slice(1).map((h) => h.changed_by), [ahmad.id, ahmad.id, manager.id, mohamad.id, mohamad.id, mohamad.id]);
});

test('release: the assignee or a manager can return an order; staff cannot release someone else\'s', async () => {
  const { db, ahmad, mohamad, manager, place } = await team();
  const id = await place(); await orders.claimOrder(db, id, ahmad);
  assert.equal(await code(orders.releaseOrder(db, id, mohamad)), 'forbidden');
  await orders.releaseOrder(db, id, ahmad);
  let o = (await orders.getOrder(db, id)); assert.deepEqual([o.order.assigned_to, o.order.assigned_name], [null, '']); assert.equal(o.history.at(-1).event, 'released');
  await orders.claimOrder(db, id, mohamad);
  await orders.releaseOrder(db, id, manager);
  assert.equal((await orders.getOrder(db, id)).order.assigned_to, null);
  assert.equal(await code(orders.releaseOrder(db, id, manager)), 'not_assigned');
  assert.equal(await code(orders.assignOrder(db, id, 9999, manager)), 'validation');
});

test('staff dashboard: current orders, handled orders, last activity, waiting orders', async () => {
  const { db, ahmad, mohamad, boss, place } = await team();
  const a = await place(); const b = await place(); const c = await place(); await place();               // 4 orders
  await orders.claimOrder(db, a, ahmad); await orders.updateOrderStatus(db, a, 'preparing', '', ahmad);
  await orders.claimOrder(db, b, ahmad); await orders.updateOrderStatus(db, b, 'completed', '', ahmad);
  await orders.claimOrder(db, c, mohamad);
  const d = await staff.staffDashboard(db);
  const by = (name) => d.staff.find((s) => s.name === name);
  assert.equal(d.waiting_orders, 1);
  assert.deepEqual([by('Ahmad Khalil').active_orders, by('Ahmad Khalil').handled_orders, by('Ahmad Khalil').current_orders.map((o) => o.status)], [1, 2, ['preparing']]);
  assert.deepEqual([by('Mohamad Saad').active_orders, by('Mohamad Saad').handled_orders], [1, 1]);
  assert.ok(by('Ahmad Khalil').last_activity_at); assert.equal(by('Rita Owner').role, 'super_admin'); assert.equal(by('Rita Owner').handled_orders, 0);
  const h = await staff.staffHistory(db, ahmad.id);
  assert.equal(h.user.name, 'Ahmad Khalil'); assert.equal(h.orders.length, 2); assert.equal(h.activity.length, 4);
  assert.ok(h.activity.every((x) => x.public_code && x.created_at));
  await assert.rejects(staff.staffHistory(db, 9999), (e) => e.status === 404);
});

test('deleting an employee keeps their orders and log lines readable (names are stored with the record)', async () => {
  const { db, boss, ahmad, place } = await team();
  const id = await place(); await orders.claimOrder(db, id, ahmad); await orders.updateOrderStatus(db, id, 'preparing', '', ahmad);
  await users.deleteUser(db, boss, ahmad.id);
  const { order, history } = await orders.getOrder(db, id);
  assert.deepEqual([order.assigned_to, order.assigned_name], [null, 'Ahmad Khalil']);
  assert.deepEqual(history.slice(1).map((h) => [h.changed_by, h.actor_name]), [[null, 'Ahmad Khalil'], [null, 'Ahmad Khalil']]);
});

// ------------------------------------------------------------------- through the HTTP layer
async function client(db, login) {
  const adm = createAdminRouter({ db, config });
  const r = await dispatch(adm, { method: 'POST', url: '/login', headers: H, body: { login, password: PW } });
  assert.equal(r.statusCode, 200);
  const cookies = { mc_session: r.cookiesSet.mc_session.value };
  return (method, url, body) => dispatch(adm, { method, url, body, headers: H, cookies });
}

test('HTTP permissions: staff cannot reach menu, settings, users or the staff dashboard; they can claim and update their own order', async () => {
  const { db, place } = await team(); const id = await place();
  const s = await client(db, 'ahmad');
  const boot = (await s('GET', '/bootstrap')).body;
  assert.equal(boot.me.role, 'staff'); assert.equal(boot.settings, null); assert.deepEqual(boot.categories, []);       // no menu or site settings are even sent
  for (const [m, u, b] of [['PUT', '/settings/store', { name_en: 'x' }], ['POST', '/categories', { name_ar: 'x', name_en: 'x' }], ['POST', '/products', {}], ['DELETE', '/products/1'],
    ['GET', '/users'], ['POST', '/users', { full_name: 'x y', username: 'xyz', password: PW }], ['DELETE', '/users/2'], ['GET', '/staff'], ['POST', `/orders/${id}/assign`, { admin_id: 2 }]]) {
    assert.equal((await s(m, u, b)).statusCode, 403, `${m} ${u}`);
  }
  assert.equal((await s('GET', '/orders')).statusCode, 200);
  assert.equal((await s('POST', `/orders/${id}/claim`)).statusCode, 200);
  assert.equal((await s('PUT', `/orders/${id}/status`, { status: 'preparing' })).statusCode, 200);
  const mine = (await s('GET', '/orders?assigned=me')).body; assert.equal(mine.total, 1); assert.equal(mine.orders[0].assigned_name, 'Ahmad Khalil');
  assert.equal((await s('GET', '/orders?assigned=none')).body.total, 0);
  const other = await client(db, 'mohamad');
  const r = await other('PUT', `/orders/${id}/status`, { status: 'ready' }); assert.equal(r.statusCode, 403); assert.equal(r.body.error, 'not_your_order'); assert.equal(r.body.assigned_name, 'Ahmad Khalil');
  assert.equal((await other('POST', `/orders/${id}/claim`)).statusCode, 409);
});

test('HTTP permissions: manager sees staff and orders, adds staff, but cannot change site settings, menu, roles or delete users', async () => {
  const { db, place } = await team(); const id = await place();
  const m = await client(db, 'mona');
  assert.equal((await m('GET', '/staff')).statusCode, 200); assert.equal((await m('GET', '/users')).body.users.length, 4);
  assert.equal((await m('POST', '/users', { full_name: 'New Cashier', username: 'cashier1', password: PW })).statusCode, 201);
  assert.equal((await m('POST', '/users', { full_name: 'New Manager', username: 'mgr2', role: 'manager', password: PW })).statusCode, 403);
  assert.equal((await m('DELETE', '/users/2')).statusCode, 403);
  for (const [meth, url, body] of [['PUT', '/settings/branding', { primary_color: '#000000' }], ['POST', '/categories', { name_ar: 'x', name_en: 'x' }], ['PUT', '/settings/whatsapp', { number: '71000111' }]]) {
    assert.equal((await m(meth, url, body)).statusCode, 403, `${meth} ${url}`);
  }
  assert.equal((await m('POST', `/orders/${id}/assign`, { admin_id: 3 })).statusCode, 200);                               // manager assigns Ahmad
  assert.equal((await m('PUT', `/orders/${id}/status`, { status: 'preparing' })).statusCode, 200);                         // and may update any order
  assert.equal((await m('GET', '/orders/' + id)).body.order.assigned_name, 'Ahmad Khalil');
});

test('HTTP: Super Admin can do everything; a disabled employee is locked out immediately', async () => {
  const { db, boss } = await team();
  const o = await client(db, 'owner@moon.cafe');
  assert.equal((await o('PUT', '/settings/store', { name_en: 'Moon Cafe', name_ar: 'مون' })).statusCode, 200);
  assert.equal((await o('GET', '/bootstrap')).body.categories.length, 5);
  const s = await client(db, 'ahmad');
  assert.equal((await s('GET', '/orders')).statusCode, 200);
  assert.equal((await o('PUT', '/users/3', { full_name: 'Ahmad Khalil', username: 'ahmad', is_active: false })).statusCode, 200);
  assert.equal((await s('GET', '/orders')).statusCode, 401);
  assert.equal((await o('DELETE', `/users/${boss.id}`)).statusCode, 409);
});
