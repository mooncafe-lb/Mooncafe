'use strict';
// Public order tracking. The ONLY key is the long random token in the link. Nothing here returns the customer's name,
// phone, address, notes, internal ids, the old order reference, or the names of employees.
const { httpError } = require('./util');
const S = require('./validate');
const dates = require('./dates');
const { STATUS_FLOWS } = require('./orders');

const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const LABELS = {
  whatsapp_prepared: { ar: 'طلب جديد', en: 'New Order' },
  confirmed: { ar: 'تم قبول الطلب', en: 'Accepted' },
  preparing: { ar: 'قيد التحضير', en: 'Preparing' },
  ready: { ar: 'جاهز للاستلام', en: 'Ready for Pickup' },
  out_for_delivery: { ar: 'مع المندوب', en: 'Out for Delivery' },
  completed: { ar: 'تم التسليم', en: 'Delivered' },
  cancelled: { ar: 'ملغي', en: 'Cancelled' },
};
const stampOut = (v) => { const s = dates.stamp(v); return s ? { iso: s.iso, date: s.date, time: { en: s.time_en, ar: s.time_ar } } : null; };
// a status that does not belong to the order type (only possible with old data) is shown as the closest stage
const NEAREST = { pickup: { out_for_delivery: 'ready' }, delivery: { ready: 'preparing' } };

async function findByToken(db, token) {
  if (typeof token !== 'string' || !TOKEN.test(token)) throw httpError(404, 'not_found');
  const order = (await db.query(
    `SELECT id, order_date, daily_number, created_at, status, fulfillment, subtotal_lbp, delivery_fee_lbp, total_lbp, rating, rated_at
     FROM orders WHERE tracking_token = $1`, [token])).rows[0];
  if (!order) throw httpError(404, 'not_found');
  return order;
}

async function getTracking(db, token, settings) {
  const o = await findByToken(db, token);
  const items = (await db.query(
    'SELECT name_ar, name_en, size_name_ar, size_name_en, options, quantity, line_total_lbp FROM order_items WHERE order_id = $1 ORDER BY id', [o.id])).rows;
  const history = (await db.query(
    "SELECT status, event, created_at FROM order_status_history WHERE order_id = $1 AND event IN ('status', 'claimed', 'assigned') ORDER BY created_at, id", [o.id])).rows;

  const flow = STATUS_FLOWS[o.fulfillment].filter((s) => s !== 'cancelled');
  const reachedAt = {};
  for (const h of history) if (!reachedAt[h.status]) reachedAt[h.status] = h.created_at;
  if (!reachedAt.whatsapp_prepared) reachedAt.whatsapp_prepared = o.created_at;
  const cancelled = o.status === 'cancelled';
  const effective = NEAREST[o.fulfillment][o.status] || o.status;
  const current = cancelled ? -1 : flow.indexOf(effective);
  const stages = flow.map((key, i) => ({
    key, label: LABELS[key],
    state: cancelled ? (reachedAt[key] ? 'done' : 'pending')
      : (key === 'completed' && o.status === 'completed') || i < current ? 'done' : i === current ? 'current' : 'pending',
    at: reachedAt[key] ? stampOut(reachedAt[key]) : null,
  }));
  const lastStatusRow = [...history].reverse()[0];
  const delivered = o.status === 'completed';
  const placed = dates.stamp(o.created_at);
  return {
    number: o.daily_number, date: placed.date, time: { en: placed.time_en, ar: placed.time_ar }, placed_at: placed.iso,
    fulfillment: o.fulfillment, status: o.status, status_label: LABELS[o.status], cancelled, stages,
    last_update: stampOut(lastStatusRow ? lastStatusRow.created_at : o.created_at),
    items: items.map((i) => ({
      name_ar: i.name_ar, name_en: i.name_en, size_ar: i.size_name_ar, size_en: i.size_name_en,
      options: (typeof i.options === 'string' ? JSON.parse(i.options) : i.options || []).map((x) => ({ name_ar: x.name_ar, name_en: x.name_en })),
      quantity: i.quantity, line_total_lbp: i.line_total_lbp,
    })),
    subtotal_lbp: o.subtotal_lbp, delivery_fee_lbp: o.delivery_fee_lbp, total_lbp: o.total_lbp,
    store: { name_ar: settings.store.name_ar, name_en: settings.store.name_en },
    // the feedback request exists only after delivery
    feedback: delivered ? { rating: o.rating || null, can_rate: !o.rating, review_url: settings.feedback.review_url || '' } : null,
  };
}

const ratingShape = S.obj({ rating: S.int({ min: 1, max: 5 }), comment: S.str({ max: 300, def: '' }) });

async function rateOrder(db, token, raw) {
  const o = await findByToken(db, token);
  const input = S.parse(ratingShape, raw);
  if (o.status !== 'completed') throw httpError(409, 'not_delivered');
  if (o.rating) throw httpError(409, 'already_rated');
  await db.withTransaction(async (client) => {
    const r = await client.query('UPDATE orders SET rating = $1, rating_comment = $2, rated_at = CURRENT_TIMESTAMP WHERE id = $3 AND rating IS NULL RETURNING id', [input.rating, input.comment, o.id]);
    if (!r.rows[0]) throw httpError(409, 'already_rated');
    await client.query("INSERT INTO order_status_history (order_id, status, note, event, actor_name) VALUES ($1, $2, $3, 'note', 'Customer')", [o.id, o.status, `Customer rating: ${input.rating}/5`]);
  });
}

module.exports = { getTracking, rateOrder, LABELS, TOKEN };
