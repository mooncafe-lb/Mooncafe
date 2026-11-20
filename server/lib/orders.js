'use strict';
const crypto = require('crypto');
const S = require('./validate');
const { httpError, isUniqueViolation } = require('./util');
const { normalizePhone, buildOrderMessage, whatsappUrl } = require('./whatsapp');
const { evaluateStore } = require('./hours');
const { truthy } = require('./catalog');
const { can } = require('./permissions');
const dates = require('./dates');

const ORDER_STATUSES = ['whatsapp_prepared', 'confirmed', 'preparing', 'ready', 'out_for_delivery', 'completed', 'cancelled'];
const ACTIVE_STATUSES = ['confirmed', 'preparing', 'ready', 'out_for_delivery'];
const CLOSED_STATUSES = ['completed', 'cancelled'];
// Which statuses an order may have depends on its type: pickup has "ready", delivery has "out_for_delivery".
const STATUS_FLOWS = {
  pickup: ['whatsapp_prepared', 'confirmed', 'preparing', 'ready', 'completed', 'cancelled'],
  delivery: ['whatsapp_prepared', 'confirmed', 'preparing', 'out_for_delivery', 'completed', 'cancelled'],
};
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

const ORDER_COLS = 'id, public_code, status, fulfillment, subtotal_lbp, delivery_fee_lbp, total_lbp, whatsapp_message, created_at';
const TRACK_COLS = ', order_date, daily_number, tracking_token';

async function findByRequestId(db, requestId, tracking) {
  const { rows } = await db.query(`SELECT ${ORDER_COLS}${tracking ? TRACK_COLS : ''} FROM orders WHERE request_id = $1`, [requestId]);
  return rows[0] || null;
}

const trackingUrl = (baseUrl, token) => (token ? `${baseUrl}/track/${token}` : '');

// What the person who placed the order gets back. internal_id is for server code and tests only: routes remove it.
function result(settings, row, duplicate, baseUrl) {
  const st = dates.stamp(row.created_at);
  return {
    duplicate: !!duplicate,
    internal_id: row.id,
    order: {
      number: row.daily_number || null,
      code: row.daily_number ? undefined : row.public_code,        // old-style reference only while the numbering migration is not applied
      date: st.date, time: { en: st.time_en, ar: st.time_ar }, placed_at: st.iso,
      status: row.status, fulfillment: row.fulfillment,
      subtotal_lbp: row.subtotal_lbp, delivery_fee_lbp: row.delivery_fee_lbp, total_lbp: row.total_lbp,
      tracking_url: trackingUrl(baseUrl, row.tracking_token),
    },
    message: row.whatsapp_message,
    whatsapp_url: whatsappUrl(settings.whatsapp.number, row.whatsapp_message),
  };
}

// opts.tracking: true when migration 006 is applied (daily numbers + tracking links); opts.baseUrl: the site address for links
async function createOrder(db, settings, raw, now = new Date(), opts = {}) {
  const tracking = !!opts.tracking;
  const baseUrl = opts.baseUrl || '';
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
    const existing = await findByRequestId(db, input.request_id, tracking);
    if (existing) return result(settings, existing, true, baseUrl);
  }

  const items = await priceItems(db, input.items);
  const subtotal = items.reduce((sum, i) => sum + i.line_total_lbp, 0);
  const fee = input.fulfillment === 'delivery' ? Number(d.delivery_fee_lbp) || 0 : 0;
  if (Number(d.min_order_lbp) > 0 && subtotal < Number(d.min_order_lbp)) {
    throw httpError(422, 'below_minimum', { min_order_lbp: Number(d.min_order_lbp), subtotal_lbp: subtotal });
  }
  const total = subtotal + fee;
  const st = dates.stamp(now);

  for (let attempt = 1; attempt <= 5; attempt++) {
    const code = makeCode();
    try {
      const saved = await db.withTransaction(async (client) => {
        let number = null;
        let token = null;
        if (tracking) {
          // Daily number: one atomic statement. The row of today's date is locked until this transaction ends, so concurrent
          // orders queue up here and each gets the next number. If anything below fails, the increment is rolled back too.
          number = (await client.query(
            `INSERT INTO order_counters (order_date, last_number) VALUES ($1, 1)
             ON CONFLICT (order_date) DO UPDATE SET last_number = order_counters.last_number + 1
             RETURNING last_number`, [st.iso_date])).rows[0].last_number;
          token = crypto.randomBytes(32).toString('base64url');
        }
        const order = {
          code, number, date: st.date, time_en: st.time_en, time_ar: st.time_ar, tracking_url: trackingUrl(baseUrl, token),
          customer_name: input.customer_name, phone: phone.e164, fulfillment: input.fulfillment, address: input.address,
          latitude: input.latitude === undefined ? null : input.latitude, longitude: input.longitude === undefined ? null : input.longitude,
          notes: input.notes, subtotal_lbp: subtotal, delivery_fee_lbp: fee, total_lbp: total,
        };
        const message = buildOrderMessage({ order, items, lang: input.lang, template: settings.whatsapp.message_template, storeName: settings.store.name_en });
        const cols = ['public_code', 'customer_name', 'phone', 'fulfillment', 'address', 'latitude', 'longitude', 'notes', 'subtotal_lbp', 'delivery_fee_lbp', 'total_lbp', 'status', 'request_id', 'whatsapp_message', 'language'];
        const vals = [code, order.customer_name, order.phone, order.fulfillment, order.address, order.latitude, order.longitude, order.notes, subtotal, fee, total, 'whatsapp_prepared', input.request_id || null, message, input.lang];
        if (tracking) { cols.push('created_at', 'order_date', 'daily_number', 'tracking_token'); vals.push(st.iso, st.iso_date, number, token); }
        const ins = await client.query(`INSERT INTO orders (${cols.join(', ')}) VALUES (${placeholders(vals.length)}) RETURNING id`, vals);
        const orderId = ins.rows[0].id;
        for (const it of items) {
          await client.query(
            `INSERT INTO order_items (order_id, product_id, name_ar, name_en, options, unit_price_lbp, quantity, line_total_lbp,
               size_name_ar, size_name_en, special_instructions)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
            [orderId, it.product_id, it.name_ar, it.name_en, JSON.stringify(it.options), it.unit_price_lbp, it.quantity, it.line_total_lbp,
              it.size_name_ar, it.size_name_en, it.special_instructions]);
        }
        await client.query(`INSERT INTO order_status_history (order_id, status, note, created_at) VALUES ($1, 'whatsapp_prepared', '', $2)`, [orderId, st.iso]);   // same instant as the order itself
        return { id: orderId, public_code: code, daily_number: number, tracking_token: token, message };
      });
      return result(settings, {
        id: saved.id, public_code: saved.public_code, daily_number: saved.daily_number, tracking_token: saved.tracking_token, status: 'whatsapp_prepared',
        fulfillment: input.fulfillment, subtotal_lbp: subtotal, delivery_fee_lbp: fee, total_lbp: total, whatsapp_message: saved.message, created_at: st.iso,
      }, false, baseUrl);
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      if (input.request_id) {
        const existing = await findByRequestId(db, input.request_id, tracking);
        if (existing) return result(settings, existing, true, baseUrl);
      }
      // otherwise a public code collided: try again (in a new transaction, so the daily number is not wasted)
    }
  }
  throw httpError(500, 'order_code_failed');
}

// ---------------------------------------------------------------- admin side
const touch = (client, adminId) => client.query('UPDATE admins SET last_activity_at = CURRENT_TIMESTAMP WHERE id = $1', [adminId]);
const logEvent = (client, orderId, { event, status, actor, target = '', note = '' }) => client.query(
  `INSERT INTO order_status_history (order_id, status, changed_by, note, event, actor_name, target_name) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
  [orderId, status, actor.id, String(note || '').slice(0, 300), event, actor.name, target]);

const likeTerm = (q) => `%${String(q).toLowerCase().replace(/[\\%_]/g, '\\$&')}%`;

// Search: "12" or "#12" = daily number (up to 4 digits), "04/11/2026" or "2026-11-04" = date, anything else = customer name, phone or old reference.
function searchClause(term, params, tracking) {
  const t = String(term || '').trim();
  if (!t) return null;
  const dm = t.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
  const iso = dm ? `${dm[3]}-${dm[2].padStart(2, '0')}-${dm[1].padStart(2, '0')}` : (/^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null);
  if (iso && tracking) { params.push(iso); return `order_date = $${params.length}`; }
  // 1 to 4 digits without a leading zero (or with #) is an order number; a leading zero or a longer number is a phone number
  if (/^#?[1-9]\d{0,3}$/.test(t) && tracking) { params.push(Number(t.replace('#', ''))); return `daily_number = $${params.length}`; }
  params.push(likeTerm(t));
  const n = params.length;
  let clause = `lower(customer_name) LIKE $${n} ESCAPE '\\' OR phone LIKE $${n} ESCAPE '\\' OR lower(public_code) LIKE $${n} ESCAPE '\\'`;
  const digits = t.replace(/\D/g, '').replace(/^0+/, '');
  // phones are stored as +961...: a local number typed with its leading 0 must still match
  if (/^[\d\s+()-]+$/.test(t) && digits.length >= 3) { params.push(`%${digits}%`); clause += ` OR phone LIKE $${params.length}`; }
  return `(${clause})`;
}

// filters: status, assigned ('none' | admin id), q (search text), date ('YYYY-MM-DD', Beirut day)
async function listOrders(db, { status, assigned, q, date, limit = 30, offset = 0, tracking = false } = {}) {
  const where = []; const params = [];
  if (status) { params.push(status); where.push(`status = $${params.length}`); }
  if (assigned === 'none') where.push('assigned_to IS NULL');
  else if (Number.isInteger(assigned)) { params.push(assigned); where.push(`assigned_to = $${params.length}`); }
  if (date && tracking && /^\d{4}-\d{2}-\d{2}$/.test(date)) { params.push(date); where.push(`order_date = $${params.length}`); }
  const sc = searchClause(q, params, tracking);
  if (sc) where.push(sc);
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const rows = (await db.query(
    `SELECT id, public_code, customer_name, phone, fulfillment, subtotal_lbp, delivery_fee_lbp, total_lbp, status, created_at, language,
            assigned_to, assigned_name, assigned_at${tracking ? ', order_date, daily_number' : ''}
     FROM orders ${clause} ORDER BY created_at DESC, id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset])).rows;
  const total = (await db.query(`SELECT count(*) AS n FROM orders ${clause}`, params)).rows[0].n;
  return { orders: rows.map((r) => ({ ...r, placed: dates.stamp(r.created_at) })), total: Number(total) };
}

async function getOrder(db, id) {
  const order = (await db.query('SELECT * FROM orders WHERE id = $1', [id])).rows[0];
  if (!order) throw httpError(404, 'not_found');
  const items = (await db.query('SELECT * FROM order_items WHERE order_id = $1 ORDER BY id', [id])).rows;
  const history = (await db.query(
    `SELECT id, event, status, note, created_at, changed_by, actor_name, target_name
     FROM order_status_history WHERE order_id = $1 ORDER BY created_at, id`, [id])).rows;
  return {
    order: { ...order, placed: dates.stamp(order.created_at), assigned: order.assigned_at ? dates.stamp(order.assigned_at) : null, tracking_path: order.tracking_token ? `/track/${order.tracking_token}` : '' },
    items,
    history: history.map((h) => ({ ...h, at: dates.stamp(h.created_at) })),
  };
}

async function loadForUpdate(client, id) {
  const o = (await client.query('SELECT id, status, fulfillment, assigned_to, assigned_name FROM orders WHERE id = $1', [id])).rows[0];
  if (!o) throw httpError(404, 'not_found');
  return o;
}

// "Receive the order": records the employee as responsible and moves a new order to "confirmed".
async function claimOrder(db, id, actor) {
  return db.withTransaction(async (client) => {
    const o = await loadForUpdate(client, id);
    if (CLOSED_STATUSES.includes(o.status)) throw httpError(409, 'order_closed');
    if (o.assigned_to === actor.id) return { already: true };
    if (o.assigned_to) throw httpError(409, 'already_assigned', { assigned_name: o.assigned_name });
    const next = o.status === 'whatsapp_prepared' ? 'confirmed' : o.status;
    await client.query('UPDATE orders SET assigned_to = $1, assigned_name = $2, assigned_at = CURRENT_TIMESTAMP, status = $3 WHERE id = $4', [actor.id, actor.name, next, id]);
    await logEvent(client, id, { event: 'claimed', status: next, actor });
    await touch(client, actor.id);
    return { already: false, status: next };
  });
}

async function assignOrder(db, id, targetId, actor) {
  return db.withTransaction(async (client) => {
    const o = await loadForUpdate(client, id);
    if (CLOSED_STATUSES.includes(o.status)) throw httpError(409, 'order_closed');
    const t = (await client.query('SELECT id, full_name, username, email, is_active FROM admins WHERE id = $1', [targetId])).rows[0];
    if (!t || !truthy(t.is_active)) throw httpError(400, 'validation', { errors: { admin_id: 'unknown_user' } });
    const targetName = t.full_name || t.username || t.email || '';
    const next = o.status === 'whatsapp_prepared' ? 'confirmed' : o.status;
    await client.query('UPDATE orders SET assigned_to = $1, assigned_name = $2, assigned_at = CURRENT_TIMESTAMP, status = $3 WHERE id = $4', [t.id, targetName, next, id]);
    await logEvent(client, id, { event: 'assigned', status: next, actor, target: targetName });
    await touch(client, actor.id);
  });
}

async function releaseOrder(db, id, actor) {
  await db.withTransaction(async (client) => {
    const o = await loadForUpdate(client, id);
    if (!o.assigned_to) throw httpError(409, 'not_assigned');
    const mine = o.assigned_to === actor.id;
    if (!(can(actor.role, 'orders.release') || (mine && can(actor.role, 'orders.release_own')))) throw httpError(403, 'forbidden');
    await client.query("UPDATE orders SET assigned_to = NULL, assigned_name = '', assigned_at = NULL WHERE id = $1", [id]);
    await logEvent(client, id, { event: 'released', status: o.status, actor, target: o.assigned_name });
    await touch(client, actor.id);
  });
}

async function updateOrderStatus(db, id, status, note, actor) {
  if (!ORDER_STATUSES.includes(status)) throw httpError(400, 'validation', { errors: { status: 'invalid_choice' } });
  await db.withTransaction(async (client) => {
    const o = await loadForUpdate(client, id);
    if (!STATUS_FLOWS[o.fulfillment].includes(status)) throw httpError(400, 'validation', { errors: { status: 'not_allowed_for_order_type' } });
    if (!can(actor.role, 'orders.update')) {
      if (!can(actor.role, 'orders.update_own')) throw httpError(403, 'forbidden');
      if (o.assigned_to !== actor.id) throw httpError(403, o.assigned_to ? 'not_your_order' : 'claim_first', { assigned_name: o.assigned_name });
    }
    if (o.status === status) return;
    await client.query('UPDATE orders SET status = $1 WHERE id = $2', [status, id]);
    await logEvent(client, id, { event: 'status', status, actor, note });
    await touch(client, actor.id);
  });
}

module.exports = {
  ORDER_STATUSES, ACTIVE_STATUSES, CLOSED_STATUSES, STATUS_FLOWS, createOrder, priceItems, listOrders, getOrder,
  claimOrder, assignOrder, releaseOrder, updateOrderStatus, orderShape,
};
