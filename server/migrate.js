'use strict';
const fs = require('fs');
const path = require('path');
const { pool, waitForDb } = require('./db');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');
const LOCK_KEY = 778899;
const MODES = ['hold', 'dry-run', 'apply'];

// MIGRATION_MODE controls whether pending migrations touch the database:
//   hold    (default) - strictly read-only check; pending migrations are NOT applied
//   dry-run           - run them inside ONE transaction, print results, ALWAYS roll back
//   apply             - run them and commit permanently
// A missing or unrecognised value means "hold". Nothing in this file ever switches
// to "apply" on its own: only an explicit MIGRATION_MODE=apply does.
function getMode() {
  const raw = (process.env.MIGRATION_MODE || '').trim().toLowerCase();
  if (!raw) return 'hold';
  if (MODES.includes(raw)) return raw;
  console.warn(`[migrate] unknown MIGRATION_MODE "${raw}", using "hold" (valid: ${MODES.join(', ')})`);
  return 'hold';
}

function listMigrationFiles() {
  return fs.readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d+_.+\.sql$/.test(f))
    .sort();
}

// Read-only. Works with the pool or with a client that is inside a transaction.
async function getAppliedNames(db) {
  const { rows: reg } = await db.query("SELECT to_regclass('schema_migrations') AS t");
  if (!reg[0].t) return { done: new Set(), tableExists: false };
  const { rows } = await db.query('SELECT name FROM schema_migrations');
  return { done: new Set(rows.map((r) => r.name)), tableExists: true };
}

// Read-only row counts so a dry run shows what the migrations would produce.
const REPORT_TABLES = [
  'admins', 'images', 'categories', 'products', 'product_sizes',
  'option_groups', 'option_choices', 'orders', 'order_items', 'order_status_history',
];

async function printReport(client, tag) {
  const parts = [];
  for (const table of REPORT_TABLES) {
    const { rows: reg } = await client.query('SELECT to_regclass($1) AS t', [table]);
    if (!reg[0].t) { parts.push(`${table}=missing`); continue; }
    const { rows } = await client.query(`SELECT count(*) AS n FROM ${table}`);
    parts.push(`${table}=${rows[0].n}`);
  }
  console.log(`${tag} row counts: ${parts.join(', ')}`);
  const { rows: reg } = await client.query("SELECT to_regclass('product_sizes') AS t");
  if (reg[0].t) {
    const { rows } = await client.query(
      `SELECT count(*) FILTER (WHERE price_lbp IS NOT NULL) AS priced,
              count(*) FILTER (WHERE price_lbp IS NULL) AS unpriced
       FROM product_sizes`);
    console.log(`${tag} sizes with a price=${rows[0].priced}, sizes without a price=${rows[0].unpriced}`);
  }
}

function describeError(err) {
  return [err.message, err.detail, err.hint, err.where].filter(Boolean).join(' | ');
}

// ---------------------------------------------------------------- hold
// Strictly read-only: two SELECTs on the pool. No transaction, no lock, no CREATE TABLE.
async function runHold(files) {
  const { done, tableExists } = await getAppliedNames(pool);
  const pending = files.filter((f) => !done.has(f));
  if (!tableExists) {
    console.log('[migrate] MIGRATION_MODE=hold: no schema_migrations table yet (hold never creates it), so every migration counts as pending');
  }
  if (pending.length) {
    console.log(`[migrate] MIGRATION_MODE=hold: ${pending.length} pending migration(s) NOT applied: ${pending.join(', ')}`);
    console.log('[migrate] set MIGRATION_MODE=dry-run to test them, or apply to apply them');
  } else {
    console.log('[migrate] MIGRATION_MODE=hold: database is up to date');
  }
  return { mode: 'hold', pending: pending.length, applied: 0, rolledBack: 0, failed: false, error: null };
}

// ------------------------------------------------- dry-run and apply
async function runInTransaction(mode, files) {
  const dry = mode === 'dry-run';
  const tag = dry ? '[migrate][dry-run]' : '[migrate]';
  const client = await pool.connect();
  let pendingCount = null;   // known once the applied list has been read
  let destroyClient = false; // true if a ROLLBACK could not be confirmed
  try {
    await client.query('BEGIN');
    // Transaction-scoped advisory lock: safe with pooled connections, released automatically.
    await client.query('SELECT pg_advisory_xact_lock($1)', [LOCK_KEY]);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const { done } = await getAppliedNames(client);
    const pending = files.filter((f) => !done.has(f));
    pendingCount = pending.length;

    for (const file of pending) {
      console.log(dry ? `${tag} running ${file} (will be rolled back)` : `${tag} applying ${file}`);
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
    }
    if (pending.length) await printReport(client, tag);

    if (dry) {
      // Dry run: the ONLY way out of this transaction is ROLLBACK.
      await client.query('ROLLBACK');
      if (pending.length) {
        console.log(`${tag} OK: ${pending.length} migration(s) ran without errors. All table, data and settings changes were ROLLED BACK and nothing is applied.`);
        console.log(`${tag} note: PostgreSQL sequence counters (auto-increment ids) are NOT rolled back, so ids created later may skip some numbers. This is harmless.`);
        console.log(`${tag} ${pending.length} migration(s) are still pending. Set MIGRATION_MODE=apply to apply them, or hold to stop testing.`);
      } else {
        console.log(`${tag} nothing pending, nothing was run`);
      }
      return { mode, pending: pending.length, applied: 0, rolledBack: pending.length, failed: false, error: null };
    }

    await client.query('COMMIT');
    console.log(pending.length ? `${tag} applied ${pending.length} migration(s)` : `${tag} database is up to date`);
    return { mode, pending: 0, applied: pending.length, rolledBack: 0, failed: false, error: null };
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      destroyClient = true; // closing the connection makes PostgreSQL abort the open transaction
      console.error(`${tag} ROLLBACK could not be confirmed (${rollbackErr.message}); closing the connection so PostgreSQL aborts the transaction`);
    }
    if (!dry) throw err; // apply: fail loudly, exactly like before
    if (pendingCount === null) {
      // The failure happened before the pending list was read: count it read-only now.
      try {
        const { done } = await getAppliedNames(pool);
        pendingCount = files.filter((f) => !done.has(f)).length;
      } catch (_) { /* leave unknown */ }
    }
    console.error(`${tag} FAILED: ${describeError(err)}`);
    console.error(`${tag} all transactional changes were rolled back (sequence counters may have advanced). `
      + `${pendingCount === null ? 'The number of pending migrations could not be determined' : `${pendingCount} migration(s) are still pending`}.`);
    // A dry run must never take the site down: report and let the server keep starting.
    return { mode, pending: pendingCount, applied: 0, rolledBack: 0, failed: true, error: describeError(err) };
  } finally {
    client.release(destroyClient);
  }
}

async function runMigrations() {
  const mode = getMode();
  const files = listMigrationFiles();
  return mode === 'hold' ? runHold(files) : runInTransaction(mode, files);
}

module.exports = { runMigrations };

if (require.main === module) {
  waitForDb()
    .then(runMigrations)
    .then((result) => pool.end().then(() => { if (result.failed) process.exit(1); }))
    .catch((err) => {
      console.error('[migrate] failed:', err.message);
      process.exit(1);
    });
}
