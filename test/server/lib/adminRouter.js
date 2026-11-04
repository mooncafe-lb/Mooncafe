'use strict';
const { wrap, errorMiddleware, rateLimit, httpError } = require('./util');
const { createSchemaChecker } = require('./schema');
const auth = require('./auth');
const svc = require('./adminService');
const settingsLib = require('./settings');
const orders = require('./orders');
const { saveImage } = require('./images');
const users = require('./users');
const staff = require('./staff');
const { can } = require('./permissions');

const toId = (v) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw httpError(404, 'not_found');
  return n;
};

function createAdminRouter({ db, config, now = () => new Date() }) {
  const express = require('express');
  const router = express.Router();
  const schema = createSchemaChecker(db);
  const guard = auth.requireAdmin(db, config);
  const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, key: 'admin-login' });
  const setupLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 10, key: 'admin-setup' });

  const needReady = wrap(async (req, res, next) => {
    const s = await schema();
    if (!s.admin || !s.menu || !s.staff) return res.status(503).json({ error: 'not_ready', menu: s.menu, admin: s.admin, staff: s.staff });
    return next();
  });
  // permission check; the role comes from the database session, never from the browser
  const need = (permission) => (req, res, next) => (can(req.admin.role, permission) ? next() : res.status(403).json({ error: 'forbidden' }));

  // ---- public part: tells the admin page which screen to show
  router.get('/session', wrap(async (req, res) => {
    const s = await schema();
    if (!s.admin || !s.menu || !s.staff) return res.json({ ready: false, menu: s.menu, admin: s.admin, staff: s.staff });
    const admin = await auth.sessionAdmin(db, config, req.cookies && req.cookies[auth.COOKIE], now());
    const none = (await auth.adminCount(db)) === 0;
    return res.json({ ready: true, admin, setup_available: none && !!config.setupToken, setup_token_missing: none && !config.setupToken });
  }));

  router.post('/setup', setupLimiter, needReady, wrap(async (req, res) => {
    if (!auth.checkCsrf(req)) throw httpError(403, 'csrf');
    const admin = await auth.setupFirstAdmin(db, config, req.body);
    res.status(201).json({ ok: true, email: admin.email });
  }));

  router.post('/login', loginLimiter, needReady, wrap(async (req, res) => {
    if (!auth.checkCsrf(req)) throw httpError(403, 'csrf');
    const r = await auth.login(db, config, req.body, { ip: req.ip, ua: req.get('user-agent') }, now());
    res.cookie(auth.COOKIE, r.token, auth.cookieOptions(config, r.maxAge));
    res.json({ ok: true, admin: r.admin });
  }));

  router.post('/logout', wrap(async (req, res) => {
    if (!auth.checkCsrf(req)) throw httpError(403, 'csrf');
    if ((await schema()).admin) await auth.logout(db, config, req.cookies && req.cookies[auth.COOKIE]);
    res.clearCookie(auth.COOKIE, { path: '/' });
    res.json({ ok: true });
  }));

  // ---- everything below needs a valid admin session
  router.use(needReady, guard);

  router.get('/bootstrap', wrap(async (req, res) => { res.json(await svc.bootstrap(db, req.admin)); }));

  router.post('/categories/reorder', need('menu.manage'), wrap(async (req, res) => { await svc.reorder(db, 'categories', req.body); res.json({ ok: true }); }));
  router.post('/categories', need('menu.manage'), wrap(async (req, res) => res.status(201).json(await svc.createCategory(db, req.body))));
  router.put('/categories/:id', need('menu.manage'), wrap(async (req, res) => { await svc.updateCategory(db, toId(req.params.id), req.body); res.json({ ok: true }); }));
  router.delete('/categories/:id', need('menu.manage'), wrap(async (req, res) => {
    await svc.deleteCategory(db, toId(req.params.id), req.query.force === '1');
    res.json({ ok: true });
  }));

  router.post('/products/reorder', need('menu.manage'), wrap(async (req, res) => { await svc.reorder(db, 'products', req.body); res.json({ ok: true }); }));
  router.post('/products', need('menu.manage'), wrap(async (req, res) => res.status(201).json(await svc.createProduct(db, req.body))));
  router.put('/products/:id', need('menu.manage'), wrap(async (req, res) => { await svc.updateProduct(db, toId(req.params.id), req.body); res.json({ ok: true }); }));
  router.delete('/products/:id', need('menu.manage'), wrap(async (req, res) => { await svc.deleteProduct(db, toId(req.params.id)); res.json({ ok: true }); }));

  router.put('/settings/:key', need('settings.manage'), wrap(async (req, res) => {
    const saved = await settingsLib.save(db, req.params.key, req.body);
    res.json({ ok: true, value: saved });
  }));

  router.get('/orders', need('orders.view'), wrap(async (req, res) => {
    const status = orders.ORDER_STATUSES.includes(req.query.status) ? req.query.status : undefined;
    const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 100);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    const a = req.query.assigned;
    const assigned = a === 'me' ? req.admin.id : a === 'none' ? 'none' : (Number.isInteger(Number(a)) && Number(a) > 0 ? Number(a) : undefined);
    res.json(await orders.listOrders(db, { status, assigned, limit, offset }));
  }));
  router.get('/orders/:id', need('orders.view'), wrap(async (req, res) => res.json(await orders.getOrder(db, toId(req.params.id)))));
  router.post('/orders/:id/claim', need('orders.claim'), wrap(async (req, res) => res.json({ ok: true, ...(await orders.claimOrder(db, toId(req.params.id), req.admin)) })));
  router.post('/orders/:id/release', wrap(async (req, res) => { await orders.releaseOrder(db, toId(req.params.id), req.admin); res.json({ ok: true }); }));
  router.post('/orders/:id/assign', need('orders.assign'), wrap(async (req, res) => {
    const target = Number((req.body || {}).admin_id);
    if (!Number.isInteger(target) || target < 1) throw httpError(400, 'validation', { errors: { admin_id: 'required' } });
    await orders.assignOrder(db, toId(req.params.id), target, req.admin);
    res.json({ ok: true });
  }));
  router.put('/orders/:id/status', wrap(async (req, res) => {
    const body = req.body || {};
    await orders.updateOrderStatus(db, toId(req.params.id), body.status, body.note, req.admin);
    res.json({ ok: true });
  }));

  // ---- users and staff
  router.get('/users', need('users.view'), wrap(async (req, res) => res.json({ users: await users.listUsers(db) })));
  router.post('/users', wrap(async (req, res) => res.status(201).json(await users.createUser(db, req.admin, req.body))));
  router.put('/users/:id', wrap(async (req, res) => { await users.updateUser(db, req.admin, toId(req.params.id), req.body); res.json({ ok: true }); }));
  router.delete('/users/:id', wrap(async (req, res) => { await users.deleteUser(db, req.admin, toId(req.params.id)); res.json({ ok: true }); }));
  router.get('/staff', need('staff.view'), wrap(async (req, res) => res.json(await staff.staffDashboard(db))));
  router.get('/staff/:id/history', need('staff.view'), wrap(async (req, res) => res.json(await staff.staffHistory(db, toId(req.params.id)))));

  // image upload: the browser sends the raw file as the request body
  router.post('/images', need('menu.manage'), express.raw({ type: ['image/*', 'application/octet-stream'], limit: '6mb' }), wrap(async (req, res) => {
    const kind = req.query.kind === 'logo' ? 'logo' : 'photo';
    const saved = await saveImage(db, req.body, { kind, name: req.query.name || '' });
    res.status(201).json({ ...saved, url: `/api/images/${saved.id}` });
  }));

  router.post('/change-password', wrap(async (req, res) => {
    await auth.changePassword(db, config, req.admin.id, req.body, req.sessionToken);
    res.json({ ok: true });
  }));

  router.use(errorMiddleware);
  return router;
}

module.exports = { createAdminRouter };
