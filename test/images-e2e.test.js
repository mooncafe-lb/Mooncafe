'use strict';
// Upload -> link to product -> customer menu -> image URL, through the real routers, with the real image processing.
const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');
const path = require('path');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function resolve(request, ...rest) {
  return request === 'express' ? path.join(__dirname, 'helpers', 'mock-express.js') : origResolve.call(this, request, ...rest);
};
const sharp = require('sharp');
const { dispatch } = require('./helpers/mock-express');
const { freshDb } = require('./helpers/fixtures');
const auth = require('../server/lib/auth');
const users = require('../server/lib/users');
const { createAdminRouter } = require('../server/lib/adminRouter');
const { createPublicRouter } = require('../server/lib/publicRouter');
const images = require('../server/lib/images');

const config = { sessionSecret: 's'.repeat(40), setupToken: 'setup-token-123', isProd: false };
const PW = 'correct horse battery';
const H = { 'x-requested-with': 'mc-admin' };

async function site() {
  const db = await freshDb();
  await auth.setupFirstAdmin(db, config, { token: 'setup-token-123', email: 'owner@moon.cafe', full_name: 'Owner', password: PW });
  const boss = auth.publicAdmin((await db.query('SELECT id, email, username, full_name, role FROM admins WHERE id = 1')).rows[0]);
  await users.createUser(db, boss, { full_name: 'Ahmad', username: 'ahmad', role: 'staff', password: PW });
  const adm = createAdminRouter({ db, config }); const pub = createPublicRouter({ db, config });
  const as = async (login) => {
    const r = await dispatch(adm, { method: 'POST', url: '/login', headers: H, body: { login, password: PW } });
    const cookies = { mc_session: r.cookiesSet.mc_session.value };
    return (method, url, body, headers = {}) => dispatch(adm, { method, url, body, headers: { ...H, ...headers }, cookies });
  };
  return { db, adm, pub, as, owner: await as('owner@moon.cafe') };
}
const photo = (w, h, noise) => sharp({ create: { width: w, height: h, channels: 3, ...(noise ? { noise: { type: 'gaussian', mean: 128, sigma: 70 } } : { background: { r: 190, g: 110, b: 40 } }) } }).jpeg({ quality: 95 }).toBuffer();
const product = async (db, name) => (await db.query('SELECT p.id, p.category_id FROM products p WHERE p.name_en = $1 LIMIT 1', [name])).rows[0];
const sizes = async (db, id) => (await db.query('SELECT id, name_ar, name_en, price_lbp FROM product_sizes WHERE product_id = $1 ORDER BY sort_order', [id])).rows;

async function linkImage(ctx, name, imageId) {
  const p = await product(ctx.db, name);
  const sz = (await sizes(ctx.db, p.id)).map((s) => ({ id: s.id, name_ar: s.name_ar, name_en: s.name_en, price_lbp: s.price_lbp || 90000 }));
  return ctx.owner('PUT', `/products/${p.id}`, { category_id: p.category_id, name_ar: name, name_en: name, image_id: imageId, sizes: sz });
}

test('upload -> link to the product -> customer menu shows it -> the image URL works -> still works after a restart', async () => {
  const ctx = await site();
  const up = await ctx.owner('POST', '/images?kind=photo&name=latte.jpg', await photo(3000, 2000), { 'content-type': 'image/jpeg' });
  assert.equal(up.statusCode, 201); assert.match(up.body.thumb_url, /^\/api\/images\/\d+\?v=thumb$/); assert.equal(up.body.processed, true);
  assert.equal((await linkImage(ctx, 'Mango', up.body.id)).statusCode, 200);
  const menu = (await dispatch(ctx.pub, { method: 'GET', url: '/menu' })).body;
  const mango = menu.categories.flatMap((c) => c.products).find((p) => p.name_en === 'Mango');
  assert.equal(mango.thumb_url, up.body.thumb_url); assert.equal(mango.image_url, `/api/images/${up.body.id}`);
  const thumb = await dispatch(ctx.pub, { method: 'GET', url: `/images/${up.body.id}?v=thumb` });
  const full = await dispatch(ctx.pub, { method: 'GET', url: `/images/${up.body.id}` });
  assert.equal(thumb.statusCode, 200); assert.equal(thumb.headers['Content-Type'], 'image/webp');
  assert.equal((await sharp(full.body).metadata()).width, 1600); assert.equal((await sharp(thumb.body).metadata()).width, 480);
  assert.ok(thumb.body.length < full.body.length);
  const boot = (await ctx.owner('GET', '/bootstrap')).body;                                      // visible in the admin too
  assert.equal(boot.categories.flatMap((c) => c.products).find((p) => p.name_en === 'Mango').image_id, up.body.id);
  // "restart": brand-new routers on the same database
  const pub2 = createPublicRouter({ db: ctx.db, config });
  assert.equal((await dispatch(pub2, { method: 'GET', url: `/images/${up.body.id}?v=thumb` })).statusCode, 200);
  assert.equal((await dispatch(pub2, { method: 'GET', url: '/menu' })).body.categories.flatMap((c) => c.products).find((p) => p.name_en === 'Mango').thumb_url, up.body.thumb_url);
});

test('replacing an image links the new one and keeps the old image row (nothing is deleted)', async () => {
  const ctx = await site();
  const a = (await ctx.owner('POST', '/images', await photo(800, 600), { 'content-type': 'image/jpeg' })).body;
  const b = (await ctx.owner('POST', '/images', await photo(900, 700), { 'content-type': 'image/jpeg' })).body;
  await linkImage(ctx, 'Oreo', a.id); await linkImage(ctx, 'Oreo', b.id);
  const oreo = (await dispatch(ctx.pub, { method: 'GET', url: '/menu' })).body.categories.flatMap((c) => c.products).find((p) => p.name_en === 'Oreo');
  assert.equal(oreo.thumb_url, `/api/images/${b.id}?v=thumb`);
  assert.equal((await ctx.db.query('SELECT count(*) AS n FROM images')).rows[0].n, 2);
  assert.equal((await dispatch(ctx.pub, { method: 'GET', url: `/images/${a.id}` })).statusCode, 200);
});

test('a big phone photo (more than 6 MB, the old limit) is accepted and stored small', async () => {
  const ctx = await site();
  const big = await photo(4500, 3400, true);
  assert.ok(big.length > 6 * 1024 * 1024, `test photo is ${big.length} bytes`);
  const up = await ctx.owner('POST', '/images', big, { 'content-type': 'image/jpeg' });
  assert.equal(up.statusCode, 201); assert.ok(up.body.bytes < big.length / 3);
});

test('if sharp cannot load on the server the original image is still stored and served (no silent failure)', async () => {
  const ctx = await site();
  images.setSharpLoader(() => { throw new Error('native binary missing'); });
  try {
    const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 255, g: 192, b: 0 } } }).png().toBuffer();
    const up = await ctx.owner('POST', '/images', png, { 'content-type': 'image/png' });
    assert.equal(up.statusCode, 201); assert.equal(up.body.processed, false);
    const got = await dispatch(ctx.pub, { method: 'GET', url: `/images/${up.body.id}?v=thumb` });
    assert.equal(got.statusCode, 200); assert.equal(got.headers['Content-Type'], 'image/png'); assert.deepEqual(got.body, png);
    const bad = await ctx.owner('POST', '/images', Buffer.from('plain text'), { 'content-type': 'image/jpeg' });
    assert.equal(bad.statusCode, 400); assert.equal(bad.body.error, 'unsupported_image_type');
  } finally { images.setSharpLoader(() => require('sharp')); }
});

test('bad uploads get a clear error code: not an image, SVG, empty, too large; staff cannot upload', async () => {
  const ctx = await site();
  const up = (body) => ctx.owner('POST', '/images', body, { 'content-type': 'image/jpeg' });
  assert.equal((await up(Buffer.from('hello'))).body.error, 'unsupported_image_type');
  assert.equal((await up(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).body.error, 'unsupported_image_type');
  assert.equal((await up(Buffer.alloc(0))).body.error, 'empty_upload');
  const huge = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(images.MAX_UPLOAD_BYTES)]);
  const r = await up(huge); assert.equal(r.statusCode, 413); assert.equal(r.body.error, 'payload_too_large');
  const corrupt = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]);
  assert.equal((await up(corrupt)).body.error, 'invalid_image');
  const staff = await ctx.as('ahmad');
  assert.equal((await staff('POST', '/images', await photo(100, 100), { 'content-type': 'image/jpeg' })).statusCode, 403);
  assert.equal((await ctx.db.query('SELECT count(*) AS n FROM images')).rows[0].n, 0);                // nothing stored by the failed attempts
});
