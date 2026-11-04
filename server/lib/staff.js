'use strict';
const { httpError } = require('./util');
const { normalizeRole } = require('./permissions');
const { ACTIVE_STATUSES } = require('./orders');

const truthy = (v) => v === true || v === 1 || v === 't';
const later = (a, b) => (!a ? b : !b ? a : (new Date(a) > new Date(b) ? a : b));
const ph = (n, from = 1) => Array.from({ length: n }, (_, i) => `$${i + from}`).join(',');

// One screen for the owner/manager: who works on what, who did what last.
async function staffDashboard(db) {
  const users = (await db.query('SELECT id, email, username, full_name, role, is_active, last_login_at, last_activity_at FROM admins ORDER BY id')).rows;
  const current = (await db.query(
    `SELECT id, public_code, status, total_lbp, fulfillment, assigned_to, assigned_at FROM orders
     WHERE assigned_to IS NOT NULL AND status IN (${ph(ACTIVE_STATUSES.length)}) ORDER BY assigned_at, id`, ACTIVE_STATUSES)).rows;
  const handled = (await db.query(
    `SELECT changed_by AS admin_id, count(DISTINCT order_id) AS n, max(created_at) AS last_at
     FROM order_status_history WHERE changed_by IS NOT NULL GROUP BY changed_by`)).rows;
  const waiting = Number((await db.query("SELECT count(*) AS n FROM orders WHERE assigned_to IS NULL AND status = 'whatsapp_prepared'")).rows[0].n);
  const staff = users.map((u) => {
    const mine = current.filter((o) => o.assigned_to === u.id);
    const h = handled.find((x) => x.admin_id === u.id);
    return {
      id: u.id, name: u.full_name || u.username || u.email || '', username: u.username || '', role: normalizeRole(u.role), is_active: truthy(u.is_active),
      last_login_at: u.last_login_at, last_activity_at: later(u.last_activity_at, h && h.last_at),
      active_orders: mine.length, current_orders: mine.map((o) => ({ id: o.id, code: o.public_code, status: o.status, total_lbp: o.total_lbp, fulfillment: o.fulfillment, assigned_at: o.assigned_at })),
      handled_orders: h ? Number(h.n) : 0,
    };
  });
  return { staff, waiting_orders: waiting };
}

// Past orders an employee worked on, plus their latest actions.
async function staffHistory(db, id) {
  const user = (await db.query('SELECT id, email, username, full_name, role FROM admins WHERE id = $1', [id])).rows[0];
  if (!user) throw httpError(404, 'not_found');
  const orders = (await db.query(
    `SELECT DISTINCT o.id, o.public_code, o.status, o.total_lbp, o.fulfillment, o.created_at
     FROM orders o JOIN order_status_history h ON h.order_id = o.id WHERE h.changed_by = $1 ORDER BY o.created_at DESC, o.id DESC LIMIT 50`, [id])).rows;
  const activity = (await db.query(
    `SELECT h.id, h.event, h.status, h.target_name, h.created_at, o.public_code, o.id AS order_id
     FROM order_status_history h JOIN orders o ON o.id = h.order_id WHERE h.changed_by = $1 ORDER BY h.created_at DESC, h.id DESC LIMIT 30`, [id])).rows;
  return { user: { id: user.id, name: user.full_name || user.username || user.email || '', username: user.username || '', role: normalizeRole(user.role) }, orders, activity };
}

module.exports = { staffDashboard, staffHistory };
