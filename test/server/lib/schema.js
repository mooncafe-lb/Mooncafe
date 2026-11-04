'use strict';
// Detects whether the database migrations the new site needs have been applied.
// While they are pending the site still works in a read-only "setup" mode with the built-in menu.
const PROBES = {
  menu: [
    'SELECT id, image_id FROM categories LIMIT 1',
    'SELECT id, price_lbp, is_available FROM product_sizes LIMIT 1',
    'SELECT id, selection, is_required, max_choices FROM option_groups LIMIT 1',
    'SELECT id, price_delta_lbp FROM option_choices LIMIT 1',
    'SELECT id, request_id, whatsapp_message, language FROM orders LIMIT 1',
    'SELECT id, size_name_ar, size_name_en, special_instructions FROM order_items LIMIT 1',
    'SELECT id, thumb, sha256, byte_size, original_name FROM images LIMIT 1',
    'SELECT id, order_id, status, changed_by, note FROM order_status_history LIMIT 1',
  ],
  admin: [
    'SELECT id, role, is_active, failed_attempts, locked_until FROM admins LIMIT 1',
    'SELECT id, admin_id, token_hash, expires_at FROM admin_sessions LIMIT 1',
  ],
  staff: [
    'SELECT id, username, full_name, last_activity_at, created_by FROM admins LIMIT 1',
    'SELECT id, assigned_to, assigned_name, assigned_at FROM orders LIMIT 1',
    'SELECT id, event, actor_name, target_name FROM order_status_history LIMIT 1',
  ],
};

function createSchemaChecker(db, ttlMs = 15000) {
  let cache = null;
  let at = 0;
  async function probe(list) {
    for (const sql of list) {
      try { await db.query(sql); } catch (_) { return false; }
    }
    return true;
  }
  return async function status(force = false) {
    if (!force && cache && Date.now() - at < ttlMs) return cache;
    cache = { menu: await probe(PROBES.menu), admin: await probe(PROBES.admin), staff: await probe(PROBES.staff) };
    at = Date.now();
    return cache;
  };
}

module.exports = { createSchemaChecker, PROBES };
