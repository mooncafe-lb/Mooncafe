'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Module = require('module');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function resolve(request, ...rest) {
  return request === 'express' ? path.join(__dirname, 'helpers', 'mock-express.js') : origResolve.call(this, request, ...rest);
};
const sharp = require('sharp');
const { dispatch } = require('./helpers/mock-express');
const { freshDb } = require('./helpers/fixtures');
const { processImage, saveImage } = require('../server/lib/images');
const { createPublicRouter } = require('../server/lib/publicRouter');
const { CATEGORIES } = require('../server/seed/menu');

const photo = (w, h) => sharp({ create: { width: w, height: h, channels: 3, background: { r: 200, g: 120, b: 40 } } }).jpeg().toBuffer();

test('photos become WebP: main image max 1600px plus a 480px thumbnail', async () => {
  const r = await processImage(await photo(3200, 2000));
  assert.equal(r.mime, 'image/webp'); assert.equal(r.width, 1600); assert.ok(r.data.length > 100);
  const t = await sharp(r.thumb).metadata(); assert.equal(t.format, 'webp'); assert.equal(t.width, 480);
});
test('logo upload stays PNG and keeps transparency', async () => {
  const png = await sharp({ create: { width: 400, height: 400, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
  const r = await processImage(png, 'logo');
  assert.equal(r.mime, 'image/png'); assert.equal(r.thumb, null);
  assert.equal((await sharp(r.data).metadata()).hasAlpha, true);
});
test('non-images, SVG and empty uploads are rejected', async () => {
  const db = await freshDb();
  await assert.rejects(processImage(Buffer.from('not an image')), (e) => e.code === 'invalid_image');
  await assert.rejects(processImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')), (e) => ['invalid_image', 'unsupported_image_type'].includes(e.code));
  await assert.rejects(saveImage(db, Buffer.alloc(0)), (e) => e.code === 'empty_upload');
});
test('uploaded image is stored in PostgreSQL-style table and served with long cache headers', async () => {
  const db = await freshDb();
  const saved = await saveImage(db, await photo(800, 600), { name: 'latte.jpg' });
  const pub = createPublicRouter({ db, config: {} });
  const full = await dispatch(pub, { method: 'GET', url: `/images/${saved.id}` });
  assert.equal(full.statusCode, 200); assert.equal(full.headers['Content-Type'], 'image/webp'); assert.match(full.headers['Cache-Control'], /immutable/);
  const thumb = await dispatch(pub, { method: 'GET', url: `/images/${saved.id}?v=thumb` });
  assert.ok(thumb.body.length < full.body.length);
  const again = await dispatch(pub, { method: 'GET', url: `/images/${saved.id}`, headers: { 'If-None-Match': full.headers.ETag } });
  assert.equal(again.statusCode, 304);
  assert.equal((await dispatch(pub, { method: 'GET', url: '/images/999' })).statusCode, 404);
  assert.equal((await dispatch(pub, { method: 'GET', url: '/images/abc' })).statusCode, 404);
  const row = (await db.query('SELECT sha256, byte_size, original_name FROM images')).rows[0];
  assert.equal(row.original_name, 'latte.jpg'); assert.equal(row.sha256.length, 64);
});

// The built-in fallback menu must match migration 003 exactly (names, order, prices, choices).
test('seed/menu.js matches migrations/003_seed_menu.sql', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'migrations', '003_seed_menu.sql'), 'utf8');
  const expected = sql.split('CREATE TEMP TABLE _expected (')[1].split('CREATE TEMP TABLE _expected_options')[0];
  const rows = [...expected.matchAll(/\('(\w+)',(\d+),'([^']+)',(NULL|\d+),(NULL|\d+)\)/g)].map((m) => `${m[1]}|${m[2]}|${m[3]}|${m[4]}|${m[5]}`);
  const js = [];
  for (const c of CATEGORIES) c.products.forEach((p, i) => js.push(`${c.en}|${i + 1}|${typeof p === 'string' ? p : p.name}|${c.prices ? c.prices[0] : 'NULL'}|${c.prices ? c.prices[1] : 'NULL'}`));
  assert.equal(rows.length, 34); assert.deepEqual(js, rows);

  const optSql = sql.split('CREATE TEMP TABLE _expected_options')[1];
  const sqlGroups = [...optSql.matchAll(/\('(\w+)','([^']+)','(\w+)','([^']+)',(true|false),'single',\d+,'([^']+)','([^']+)','[\d|]+'\)/g)]
    .map((m) => `${m[1]}|${m[2]}|${m[3]}|${m[4]}|${m[5]}|${m[6]}|${m[7]}`).sort();
  const jsGroups = [];
  for (const c of CATEGORIES) for (const p of c.products) if (typeof p !== 'string') for (const g of p.groups) {
    jsGroups.push(`${c.en}|${p.name}|${g.en}|${g.ar}|${g.required}|${g.choices.map((x) => x[0]).join('|')}|${g.choices.map((x) => x[1]).join('|')}`);
  }
  assert.equal(sqlGroups.length, 12); assert.deepEqual(jsGroups.sort(), sqlGroups);
});
