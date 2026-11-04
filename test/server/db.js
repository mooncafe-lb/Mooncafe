'use strict';
const pg = require('pg');
const config = require('./config');

// bigint columns (prices, totals) come back as numbers instead of strings
pg.types.setTypeParser(20, (value) => Number(value));

const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  ssl: config.dbSsl ? { rejectUnauthorized: false } : false,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 20000, // free Neon databases need a moment to wake up
});

pool.on('error', (err) => console.error('[db] idle client error:', err.message));

const query = (text, params) => pool.query(text, params);

async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
    throw err;
  } finally {
    client.release();
  }
}

async function waitForDb(attempts = 5) {
  for (let i = 1; i <= attempts; i++) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (err) {
      console.error(`[db] connection attempt ${i}/${attempts} failed: ${err.code || err.message}`);
      if (i === attempts) throw err;
      await new Promise((resolve) => setTimeout(resolve, 2000 * i));
    }
  }
}

module.exports = { pool, query, withTransaction, waitForDb };
