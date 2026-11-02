'use strict';
const crypto = require('crypto');
const S = require('./validate');
const { httpError, isUniqueViolation } = require('./util');
const { normalizePhone, buildOrderMessage, whatsappUrl } = require('./whatsapp');
const { evaluateStore } = require('./hours');
const { truthy } = require('./catalog');

const ORDER_STATUSES = ['whatsapp_prepared', 'confirmed', 'preparing', 'completed', 'cancelled'];
const MAX_QTY = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const orderShape = S.obj({
  request_id: S.str({ max: 36, pattern: UUID, optional: true }),
  lang: S.oneOf(['ar', 'en'], { def: 'ar' }),
  customer_name: S.str({ min: 2, max: 80 }),
  phone: S.str({ min: 5, max: 30 }),
  fulfillment: S.oneOf(['pickup', 'delivery']),
  address: S.str({ max: 300, def: '' }),
  latitude: S.num({ min: -90, max: 90, optional: true }),
  longitude: S.num({ min: -180, max: 180, optional: true }),
  notes: S.str({ max: 500, def: '' }),
  items: S.arr(S.obj({
    product_id: S.int({ min: 1 }),
    size_id: S.int({ min: 1 }),
    quantity: S.int({ min: 1, max: MAX_QTY }),
    choice_ids: S.arr(S.int({ min: 1 }), { max: 30, def: [] }),
    instructions: S.str({ max: 200, def: '' }),
  }), { min: 1, max: 40 }),
});

const makeCode = () => 'MC-' + Array.from({ length: 6 }, () => CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)]).join('');
const placeholders = (n, from = 1) => Array.from({ length: n }, (_, i) => `$${i + from}`).join(',');

// Prices every line from the database. The browser never decides a price.
async function priceItems(db, items) {
  const productIds = [...new Set(items.map((i) => i.product_id))];
  const ph = placeholders(productIds.length);
  const products = (await db.query(
    `SELECT p.id, p.name_ar, p.name_en, p.is_available, p.is_visible, c.is_visible AS cat_visible
     FROM products p JOIN categories c ON c.id = p.category_id WHERE p.id IN (${ph})`, productIds)).rows;
  const sizes = (await db.query(
    `SELECT id, product_id, name_ar, name_en, price_lbp, is_available FROM product_sizes WHERE product_id IN (${ph})`, productIds)).rows;
  const groups = (await db.query(
    `SELECT id, product_id, name_ar, name_en, selection, is_required, max_choices FROM option_groups WHERE product_id IN (${ph})`, productIds)).rows;
  const choices = groups.length ? (await db.query(
    `SELECT id, group_id, name_ar, name_en, price_delta_lbp, is_available FROM option_choices WHERE group_id IN (${placeholders(groups.length)})`,
    groups.map((g) => g.id))).rows : [];

  const errors = [];
  const priced = items.map((item, index) => {
    const fail = (code, extra) => { errors.push({ index, code, ...extra }); return null; };
    const product = products.find((p) => p.id === item.product_id);
    if (!product || !truthy(product.is_visible) || !truthy(product.cat_visible) || !truthy(product.is_available)) return fail('product_unavailable');
    const size = sizes.find((s) => s.id === item.size_id && s.product_id === product.id);
    if (!size || !truthy(size.is_available)) return fail('size_invalid');
    if (size.price_lbp == null) return fail('size_unpriced');

    const wanted = [...new Set(item.choice_ids)];
    const productGroups = groups.filter((g) => g.product_id === product.id);
    const picked = [];
    for (const id of wanted) {
      const choice = choices.find((c) => c.id === id && productGroups.some((g) => g.id === c.group_id));
      if (!choice || !truthy(choice.is_available)) return fail('choice_invalid', { choice_id: id });
      picked.push(choice);
    }
    for (const g of productGroups) {
      const count = picked.filter((c) => c.group_id === g.id).length;
      if (truthy(g.is_required) && count === 0) return fail('choice_required', { group_id: g.id });
      if (g.selection === 'single' && count > 1) return fail('too_many_choices', { group_id: g.id });
      if (g.selection === 'multiple' && g.max_choices != null && count > g.max_choices) return fail('too_many_choices', { group_id: g.id });
    }
    const options = picked.map((c) => {
      const g = productGroups.find((x) => x.id === c.group_id);
      return { group_ar: g.name_ar, group_en: g.name_en, name_ar: c.name_ar, name_en: c.name_en, price_delta_lbp: Number(c.price_delta_lbp) };
    });
    const unit = Number(size.price_lbp) + options.reduce((sum, o) => sum + o.price_delta_lbp, 0);
    return {
      product_id: product.id, name_ar: product.name_ar, name_en: product.name_en,
      size_name_ar: size.name_ar, size_name_en: size.name_en, options,
      special_instructions: item.instructions, unit_price_lbp: unit, quantity: item.quantity, line_total_lbp: unit * item.quantity,
    };
  });
  if (errors.length) throw httpError(422, 'invalid_items', { lines: errors });
  return priced;
}

async function findByRequestId(db, requestId) {
  const { rows } = await db.query(
    `SELECT id, public_code, status, fulfillment, subtotal_lbp, delivery_fee_lbp, total_lbp, whatsapp_message
     FROM orders WHERE request_id = $1`, [requestId]);
  return rows[0] || null;
}

function result(settings, row, duplicate) {
  return {
    duplicate: !!duplicate,
    order: {
      id: row.id, code: row.public_code, status: row.status, fulfillment: row.fulfillment,
      subtotal_lbp: row.subtotal_lbp, delivery_fee_lbp: row.delivery_fee_lbp, total_lbp: row.total_lbp,
    },
    message: row.whatsapp_message,
    whatsapp_url: whatsappUrl(settings.whatsapp.number, row.whatsapp_message),
  };
}

async function createOrder(db, settings, raw, now = new Date()) {
  const input = S.parse(orderShape, raw);
  const phone = normalizePhone(input.phone);
  if (!phone) throw httpError(400, 'validation', { errors: { phone: 'invalid_phone' } });
  if (input.fulfillment === 'delivery' && input.address.length < 5) {
    throw httpError(400, 'validation', { errors: { address: 'required' } });
  }
  if ((input.latitude === undefined) !== (input.longitude === undefined)) {
    throw httpError(400, 'validation', { errors: { latitude: 'location_incomplete' } });
  }

  // The server, not the browser, decides whether the café is open.
  if (!settings.whatsapp.enabled) throw httpError(409, 'ordering_disabled');
  const status = evaluateStore(settings.store_status, settings.opening_hours, now);
  if (!status.open) {
    throw httpError(409, 'store_closed', {
      reason: status.reason, message_ar: status.message_ar, message_en: status.message_en, next_open: status.next_open,
    });
  }
  const d = settings.delivery;
  if (input.fulfillment === 'delivery' && !d.delivery_enabled) throw httpError(409, 'delivery_disabled');
  if (input.fulfillment === 'pickup' && !d.pickup_enabled) throw httpError(409, 'pickup_disabled');

  if (input.request_id) {
    const existing = await findByRequestId(db, input.request_id);
    if (existing) return result(settings, existing, true);
  }

  const items = await priceItems(db, input.items);
  const subtotal = items.reduce((sum, i) => sum + i.line_total_lbp, 0);
  const fee = input.fulfillment === 'delivery' ? Number(d.delivery_fee_lbp) || 0 : 0;
  if (Number(d.min_order_lbp) > 0 && subtotal < Number(d.min_order_lbp)) {
    throw httpError(422, 'below_minimum', { min_order_lbp: Number(d.min_order_lbp), subtotal_lbp: subtotal });
  }
  const total = subtotal + fee;

  for (let attempt = 1; attempt <= 5; attempt++) {
    const code = makeCode();
    const order = {
      code, customer_name: input.customer_name, phone: phone.e164, fulfillment: input.fulfillment, address: input.address,
      latitude: input.latitude === undefined ? null : input.latitude, longitude: input.longitude === undefined ? null : input.longitude,
      notes: input.notes, subtotal_lbp: subtotal, delivery_fee_lbp: fee, total_lbp: total,
    };
    const message = buildOrderMessage({ order, items, lang: input.lang, template: settings.whatsapp.message_template, storeName: settings.store.name_en });
    try {
      const id = await db.withTransaction(async (client) => {
        const ins = await client.query(
          `INSERT INTO orders (public_code, customer_name, phone, fulfillment, address, latitude, longitude, notes,
             subtotal_lbp, delivery_fee_lbp, total_lbp, status, request_id, whatsapp_message, language)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'whatsapp_prepared',$12,$13,$14) RETURNING id`,
          [code, order.customer_name, order.phone, order.fulfillment, order.address, order.latitude, order.longitude, order.notes,
            subtotal, fee, total, input.request_id || null, message, input.lang]);
        const orderId = ins.rows[0].id;
        for (const it of items) {
          await client.query(
            `INSERT INTO order_items (order_id, product_id, name_ar, name_en, options, unit_price_lbp, quantity, line_total_lbp,
               size_name_ar, size_name_en, special_instructions)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
            [orderId, it.product_id, it.name_ar, it.name_en, JSON.stringify(it.options), it.unit_price_lbp, it.quantity, it.line_total_lbp,
              it.size_name_ar, it.size_name_en, it.special_instructions]);
        }
        await client.query(`INSERT INTO order_status_history (order_id, status, note) VALUES ($1, 'whatsapp_prepared', '')`, [orderId]);
        return orderId;
      });
      return result(settings, {
        id, public_code: code, status: 'whatsapp_prepared', fulfillment: input.fulfillment,
        subtotal_lbp: subtotal, delivery_fee_lbp: fee, total_lbp: total, whatsapp_message: message,
      }, false);
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      if (input.request_id) {
        const existing = await findByRequestId(db, input.request_id);
        if (existing) return result(settings, existing, true);
      }
      // otherwise a public code collided: try again with a new code
    }
  }
  throw httpError(500, 'order_code_failed');
}

// ---------------------------------------------------------------- admin side
async function listOrders(db, { status, limit = 30, offset = 0 } = {}) {
  const where = status ? 'WHERE status = $1' : '';
  const params = status ? [status] : [];
  const rows = (await db.query(
    `SELECT id, public_code, customer_name, phone, fulfillment, subtotal_lbp, delivery_fee_lbp, total_lbp, status, created_at, language
     FROM orders ${where} ORDER BY created_at DESC, id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset])).rows;
  const total = (await db.query(`SELECT count(*) AS n FROM orders ${where}`, params)).rows[0].n;
  return { orders: rows, total: Number(total) };
}

async function getOrder(db, id) {
  const order = (await db.query('SELECT * FROM orders WHERE id = $1', [id])).rows[0];
  if (!order) throw httpError(404, 'not_found');
  const items = (await db.query('SELECT * FROM order_items WHERE order_id = $1 ORDER BY id', [id])).rows;
  const history = (await db.query(
    `SELECT h.id, h.status, h.note, h.created_at, a.email AS changed_by_email
     FROM order_status_history h LEFT JOIN admins a ON a.id = h.changed_by WHERE h.order_id = $1 ORDER BY h.created_at, h.id`, [id])).rows;
  return { order, items, history };
}

async function updateOrderStatus(db, id, status, note, adminId) {
  if (!ORDER_STATUSES.includes(status)) throw httpError(400, 'validation', { errors: { status: 'invalid_choice' } });
  await db.withTransaction(async (client) => {
    const found = await client.query('SELECT id FROM orders WHERE id = $1', [id]);
    if (!found.rows[0]) throw httpError(404, 'not_found');
    await client.query('UPDATE orders SET status = $1 WHERE id = $2', [status, id]);
    await client.query('INSERT INTO order_status_history (order_id, status, changed_by, note) VALUES ($1,$2,$3,$4)', [id, status, adminId, String(note || '').slice(0, 300)]);
  });
}

module.exports = { ORDER_STATUSES, createOrder, priceItems, listOrders, getOrder, updateOrderStatus, orderShape };
