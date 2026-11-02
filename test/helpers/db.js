'use strict';
// Test database: SQLite built from the REAL migration files (001, 002, 004), so column names,
// NOT NULL rules and CHECK constraints are the ones the production schema has.
// It wraps node:sqlite with the same interface as server/db.js: query() and withTransaction().
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const MIG = path.join(__dirname, '..', '..', 'migrations');
const JSON_COLUMNS = new Set(['value', 'options']);

function translate(sql) {
  return sql
    .replace(/--[^\n]*/g, '')
    .replace(/\bbigserial PRIMARY KEY\b/g, 'INTEGER PRIMARY KEY AUTOINCREMENT')
    .replace(/\bserial PRIMARY KEY\b/g, 'INTEGER PRIMARY KEY AUTOINCREMENT')
    .replace(/timestamptz/g, 'TEXT').replace(/double precision/g, 'REAL').replace(/\bjsonb\b/g, 'TEXT')
    .replace(/'\[\]'::TEXT/g, "'[]'").replace(/\bbytea\b/g, 'BLOB').replace(/\buuid\b/g, 'TEXT')
    .replace(/DEFAULT now\(\)/g, 'DEFAULT CURRENT_TIMESTAMP')
    // 002 relaxes products.price_lbp (ALTER ... DROP NOT NULL cannot run in SQLite)
    .replace(/(price_lbp\s+bigint)\s+NOT NULL\s+(CHECK \(price_lbp >= 0\))/, '$1 $2')
    .replace(/\bbigint\b/g, 'INTEGER');
}

function ddlStatements(file) {
  const sql = fs.readFileSync(path.join(MIG, file), 'utf8');
  return translate(sql).split(/;\s*\n/).map((s) => s.trim()).filter((s) => /^(CREATE|ALTER TABLE \w+ ADD COLUMN)/i.test(s))
    .flatMap((s) => {
      // SQLite cannot add a UNIQUE column with ALTER: add the column, then a unique index
      const m = s.match(/^ALTER TABLE (\w+) ADD COLUMN (\w+) (.*) UNIQUE$/i);
      return m ? [`ALTER TABLE ${m[1]} ADD COLUMN ${m[2]} ${m[3]}`, `CREATE UNIQUE INDEX ${m[1]}_${m[2]}_uq ON ${m[1]} (${m[2]})`] : [s];
    });
}

function prepareValue(v) {
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v instanceof Date) return v.toISOString();
  if (v === undefined) return null;
  return v;
}

function createTestDb({ migrations = ['001_init.sql', '002_menu_structure.sql', '004_admin_security.sql'] } = {}) {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON');
  for (const file of migrations) for (const stmt of ddlStatements(file)) raw.exec(stmt);

  function run(sql, params = []) {
    const text = sql.replace(/\$(\d+)/g, '?$1').replace(/::\w+/g, '');
    const stmt = raw.prepare(text);
    const args = params.map(prepareValue);
    const returning = /\bRETURNING\b/i.test(text) || /^\s*(SELECT|WITH)/i.test(text);
    if (!returning) { stmt.run(...args); return { rows: [] }; }
    const rows = stmt.all(...args).map((r) => {
      const o = { ...r };
      for (const k of Object.keys(o)) if (JSON_COLUMNS.has(k) && typeof o[k] === 'string' && /^[[{]/.test(o[k])) o[k] = JSON.parse(o[k]);
      return o;
    });
    return { rows };
  }
  const db = {
    raw,
    async query(sql, params) { return run(sql, params); },
    async withTransaction(fn) {
      raw.exec('BEGIN');
      try { const out = await fn({ query: async (s, p) => run(s, p) }); raw.exec('COMMIT'); return out; } catch (e) { raw.exec('ROLLBACK'); throw e; }
    },
  };
  return db;
}

module.exports = { createTestDb };
