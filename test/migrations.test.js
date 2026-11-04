'use strict';
// Checks on the migration files themselves: ordering, no destructive statements, and that applying 002 and 004
// on a database that already holds data keeps every existing row.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createTestDb, applyMigration } = require('./helpers/db');

const DIR = path.join(__dirname, '..', 'migrations');
const files = fs.readdirSync(DIR).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();

test('migration files are numbered 001..005 with no gaps and no duplicates', () => {
  assert.deepEqual(files, ['001_init.sql', '002_menu_structure.sql', '003_seed_menu.sql', '004_admin_security.sql', '005_staff_and_order_tracking.sql']);
});

test('002, 003 and 004 contain no DROP TABLE/COLUMN, TRUNCATE or DELETE', () => {
  for (const f of files.slice(1)) {
    const sql = fs.readFileSync(path.join(DIR, f), 'utf8').replace(/--[^\n]*/g, '');
    assert.ok(!/\b(DROP\s+(TABLE|COLUMN|INDEX|SCHEMA|DATABASE)|TRUNCATE|DELETE\s+FROM)\b/i.test(sql), `${f} has a destructive statement`);
  }
  // the only constraints relaxed: products.price_lbp and admins.email may be empty (unpriced Coffee, username-only staff);
  // the only constraint replaced: orders.status gets a wider list (found by its content, see 005)
  const all = files.slice(1).map((f) => fs.readFileSync(path.join(DIR, f), 'utf8').replace(/--[^\n]*/g, '')).join('\n');
  assert.deepEqual([...all.matchAll(/ALTER TABLE (\w+) ALTER COLUMN (\w+) (.*?);/g)].map((m) => m.slice(1, 4).join(' ')), ['products price_lbp DROP NOT NULL', 'admins email DROP NOT NULL']);
  // UPDATE statements touch only the settings table
  assert.deepEqual([...new Set([...all.matchAll(/^\s*UPDATE\s+(\w+)/gim)].map((m) => m[1]))], ['settings']);
});

test('002 and 004 keep every existing row (admins, settings, images, products, orders and their items)', async () => {
  const db = createTestDb({ migrations: ['001_init.sql'] });
  await db.query("INSERT INTO admins (email, password_hash) VALUES ('owner@moon.cafe', 'hash')");
  await db.query("INSERT INTO settings (key, value) VALUES ('store', '{\"name_en\":\"Moon Cafe\",\"hours\":\"daily\"}')");
  await db.query("INSERT INTO images (mime, data) VALUES ('image/png', x'89504e47')");
  await db.query("INSERT INTO categories (name_ar, name_en, sort_order) VALUES ('قهوة', 'Coffee', 1)");
  await db.query("INSERT INTO products (category_id, name_ar, name_en, price_lbp, sort_order) VALUES (1, 'اسبريسو', 'Espresso', 90000, 1), (1, 'شاي', 'Tea', 0, 2)");
  await db.query("INSERT INTO orders (public_code, customer_name, phone, fulfillment, subtotal_lbp, delivery_fee_lbp, total_lbp, status) VALUES ('MC-OLD111', 'Old Customer', '+96171000000', 'pickup', 90000, 0, 90000, 'confirmed')");
  await db.query("INSERT INTO order_items (order_id, product_id, name_ar, name_en, unit_price_lbp, quantity, line_total_lbp) VALUES (1, 1, 'اسبريسو', 'Espresso', 90000, 1, 90000)");
  const count = async (t) => Number((await db.query(`SELECT count(*) AS n FROM ${t}`)).rows[0].n);
  const before = Object.fromEntries(await Promise.all(['admins', 'settings', 'images', 'categories', 'products', 'orders', 'order_items'].map(async (t) => [t, await count(t)])));

  applyMigration(db, '002_menu_structure.sql');
  applyMigration(db, '004_admin_security.sql');
  applyMigration(db, '005_staff_and_order_tracking.sql');
  // the two portable data statements of 002 (the rest is PostgreSQL-only and is covered by the dry-run on Render)
  await db.query("INSERT INTO product_sizes (product_id, name_ar, name_en, price_lbp, sort_order) SELECT p.id, 'عادي', 'Regular', NULLIF(p.price_lbp, 0), 0 FROM products p WHERE NOT EXISTS (SELECT 1 FROM product_sizes s WHERE s.product_id = p.id)");
  await db.query('INSERT INTO order_status_history (order_id, status, created_at) SELECT id, status, created_at FROM orders');

  for (const [t, n] of Object.entries(before)) assert.equal(await count(t), n, `${t} row count changed`);
  assert.equal((await db.query('SELECT email, password_hash FROM admins')).rows[0].password_hash, 'hash');
  const admin = (await db.query('SELECT role, is_active, failed_attempts, locked_until FROM admins')).rows[0];
  assert.deepEqual([admin.role, admin.is_active, admin.failed_attempts, admin.locked_until], ['owner', 1, 0, null]);
  const a5 = (await db.query('SELECT username, full_name, last_activity_at, created_by FROM admins')).rows[0];
  assert.deepEqual([a5.username, a5.full_name, a5.last_activity_at, a5.created_by], [null, '', null, null]);
  const o5 = (await db.query('SELECT assigned_to, assigned_name, assigned_at, status FROM orders')).rows[0];
  assert.deepEqual([o5.assigned_to, o5.assigned_name, o5.assigned_at, o5.status], [null, '', null, 'confirmed']);   // old orders stay unassigned with their old status
  const h5 = (await db.query('SELECT event, actor_name, target_name FROM order_status_history')).rows[0];
  assert.deepEqual([h5.event, h5.actor_name, h5.target_name], ['status', '', '']);   // the existing admin stays valid
  assert.equal((await db.query("SELECT value FROM settings WHERE key='store'")).rows[0].value.hours, 'daily');
  const sizes = (await db.query('SELECT p.name_en, s.name_en AS size, s.price_lbp FROM product_sizes s JOIN products p ON p.id = s.product_id ORDER BY p.id')).rows;
  assert.deepEqual(sizes.map((r) => [r.name_en, r.size, r.price_lbp]), [['Espresso', 'Regular', 90000], ['Tea', 'Regular', null]]);   // old price kept; price 0 becomes "unset"
  const order = (await db.query('SELECT language, request_id, whatsapp_message FROM orders')).rows[0];
  assert.deepEqual([order.language, order.request_id, order.whatsapp_message], ['ar', null, null]);
  assert.equal((await db.query('SELECT status FROM order_status_history')).rows[0].status, 'confirmed');
  assert.equal((await db.query('SELECT size_name_en, special_instructions FROM order_items')).rows[0].special_instructions, '');
  assert.equal((await db.query('SELECT thumb, sha256 FROM images')).rows[0].thumb, null);
});
