'use strict';
const fs = require('fs');
const path = require('path');
const { pool, waitForDb } = require('./db');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');
const LOCK_KEY = 778899;

async function runMigrations() {
  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d+_.+\.sql$/.test(f))
    .sort();

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Transaction-scoped lock: safe with pooled connections, released automatically.
    await client.query('SELECT pg_advisory_xact_lock($1)', [LOCK_KEY]);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const { rows } = await client.query('SELECT name FROM schema_migrations');
    const done = new Set(rows.map((r) => r.name));

    let applied = 0;
    for (const file of files) {
      if (done.has(file)) continue;
      console.log('[migrate] applying', file);
      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      applied++;
    }
    await client.query('COMMIT');
    console.log(applied ? `[migrate] applied ${applied} migration(s)` : '[migrate] database is up to date');
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { runMigrations };

if (require.main === module) {
  waitForDb()
    .then(runMigrations)
    .then(() => pool.end())
    .catch((err) => {
      console.error('[migrate] failed:', err.message);
      process.exit(1);
    });
}
