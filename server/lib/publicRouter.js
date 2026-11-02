'use strict';
const { wrap, errorMiddleware, rateLimit, httpError } = require('./util');
const { createSchemaChecker } = require('./schema');
const { loadAll } = require('./settings');
const { loadMenu } = require('./catalog');
const { evaluateStore } = require('./hours');
const { createOrder } = require('./orders');
const { loadImage } = require('./images');
const { buildSeedMenu } = require('../seed/menu');

function storeView(settings, status, ready, nowDate) {
  const s = settings.store;
  const b = settings.branding;
  const d = settings.delivery;
  return {
    ready,
    name_en: s.name_en, name_ar: s.name_ar, tagline_ar: s.tagline_ar, tagline_en: s.tagline_en,
    address_en: s.address, address_ar: s.address_ar || s.address, phone: s.phone,
    whatsapp_enabled: !!settings.whatsapp.enabled && ready,
    social: settings.social,
    hours: settings.opening_hours,
    branding: {
      primary_color: b.primary_color, secondary_color: b.secondary_color, surface_color: b.surface_color,
      page_background: b.page_background, text_on_dark: b.text_on_dark, text_on_primary: b.text_on_primary,
      font_ar: b.font_ar, font_en: b.font_en,
      logo_url: b.logo_image_id ? `/api/images/${b.logo_image_id}` : '/assets/moon-cafe-logo.png',
      hero_image_url: b.hero_image_id ? `/api/images/${b.hero_image_id}` : null,
    },
    content: settings.content,
    promotions: settings.promotions.items.filter((p) => p.active),
    delivery: {
      delivery_enabled: !!d.delivery_enabled, pickup_enabled: !!d.pickup_enabled,
      delivery_fee_lbp: Number(d.delivery_fee_lbp) || 0, min_order_lbp: Number(d.min_order_lbp) || 0,
      note_ar: d.note_ar, note_en: d.note_en,
    },
    status: ready ? status : { ...status, open: false, reason: 'setup', next_open: null },
    server_time: nowDate.toISOString(),
  };
}

function createPublicRouter({ db, config, now = () => new Date() }) {
  const express = require('express');
  const router = express.Router();
  const schema = createSchemaChecker(db);
  const orderLimiter = rateLimit({ windowMs: 60 * 1000, max: 12, key: 'orders' });

  router.get('/store', wrap(async (req, res) => {
    const ready = (await schema()).menu;
    const settings = await loadAll(db);
    const status = evaluateStore(settings.store_status, settings.opening_hours, now());
    res.set('Cache-Control', 'no-cache');
    res.json(storeView(settings, status, ready, now()));
  }));

  router.get('/menu', wrap(async (req, res) => {
    const ready = (await schema()).menu;
    res.set('Cache-Control', 'no-cache');
    res.json({ ready, categories: ready ? await loadMenu(db) : buildSeedMenu() });
  }));

  router.get('/images/:id', wrap(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1 || !(await schema()).menu) throw httpError(404, 'not_found');
    const variant = req.query.v === 'thumb' ? 'thumb' : 'full';
    const etag = `"img-${id}-${variant}"`;
    if (req.get('if-none-match') === etag) return res.status(304).end();
    const img = await loadImage(db, id, variant);
    if (!img) throw httpError(404, 'not_found');
    res.set({ 'Content-Type': img.mime, 'Cache-Control': 'public, max-age=31536000, immutable', ETag: etag, 'X-Content-Type-Options': 'nosniff' });
    return res.send(img.data);
  }));

  router.post('/orders', orderLimiter, wrap(async (req, res) => {
    if (!(await schema()).menu) throw httpError(503, 'not_ready');
    const settings = await loadAll(db);
    const result = await createOrder(db, settings, req.body, now());
    res.status(result.duplicate ? 200 : 201).json(result);
  }));

  router.use(errorMiddleware);
  return router;
}

module.exports = { createPublicRouter, storeView };
