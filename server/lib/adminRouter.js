'use strict';
const { wrap, errorMiddleware, rateLimit, httpError } = require('./util');
const { createSchemaChecker } = require('./schema');
const auth = require('./auth');
const svc = require('./adminService');
const settingsLib = require('./settings');
const orders = require('./orders');
const { saveImage } = require('./images');

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
    if (!s.admin || !s.menu) return res.status(503).json({ error: 'not_ready', menu: s.menu, admin: s.admin });
    return next();
  });

  // ---- public part: tells the admin page which screen to show
  router.get('/session', wrap(async (req, res) => {
    const s = await schema();
    if (!s.admin || !s.menu) return res.json({ ready: false, menu: s.menu, admin: s.admin });
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

  router.get('/bootstrap', wrap(async (req, res) => { res.json(await svc.bootstrap(db)); }));

  router.post('/categories/reorder', wrap(async (req, res) => { await svc.reorder(db, 'categories', req.body); res.json({ ok: true }); }));
  router.post('/categories', wrap(async (req, res) => res.status(201).json(await svc.createCategory(db, req.body))));
  router.put('/categories/:id', wrap(async (req, res) => { await svc.updateCategory(db, toId(req.params.id), req.body); res.json({ ok: true }); }));
  router.delete('/categories/:id', wrap(async (req, res) => {
    await svc.deleteCategory(db, toId(req.params.id), req.query.force === '1');
    res.json({ ok: true });
  }));

  router.post('/products/reorder', wrap(async (req, res) => { await svc.reorder(db, 'products', req.body); res.json({ ok: true }); }));
  router.post('/products', wrap(async (req, res) => res.status(201).json(await svc.createProduct(db, req.body))));
  router.put('/products/:id', wrap(async (req, res) => { await svc.updateProduct(db, toId(req.params.id), req.body); res.json({ ok: true }); }));
  router.delete('/products/:id', wrap(async (req, res) => { await svc.deleteProduct(db, toId(req.params.id)); res.json({ ok: true }); }));

  router.put('/settings/:key', wrap(async (req, res) => {
    const saved = await settingsLib.save(db, req.params.key, req.body);
    res.json({ ok: true, value: saved });
  }));

  router.get('/orders', wrap(async (req, res) => {
    const status = orders.ORDER_STATUSES.includes(req.query.status) ? req.query.status : undefined;
    const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 100);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    res.json(await orders.listOrders(db, { status, limit, offset }));
  }));
  router.get('/orders/:id', wrap(async (req, res) => res.json(await orders.getOrder(db, toId(req.params.id)))));
  router.put('/orders/:id/status', wrap(async (req, res) => {
    const body = req.body || {};
    await orders.updateOrderStatus(db, toId(req.params.id), body.status, body.note, req.admin.id);
    res.json({ ok: true });
  }));

  // image upload: the browser sends the raw file as the request body
  router.post('/images', express.raw({ type: ['image/*', 'application/octet-stream'], limit: '6mb' }), wrap(async (req, res) => {
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
