'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createTestDb } = require('./helpers/db');
const auth = require('../server/lib/auth');

const config = { sessionSecret: 'x'.repeat(40), setupToken: 'setup-token-123', isProd: false };
const PW = 'correct horse battery';
const setup = (db, over = {}) => auth.setupFirstAdmin(db, config, { token: 'setup-token-123', email: 'Owner@Moon.cafe', full_name: 'Owner Name', password: PW, ...over });

test('passwords are stored as salted scrypt hashes and verify correctly', async () => {
  const h = await auth.hashPassword(PW);
  assert.match(h, /^scrypt\$16384\$8\$1\$/); assert.ok(!h.includes(PW));
  assert.equal(await auth.verifyPassword(PW, h), true);
  assert.equal(await auth.verifyPassword('wrong password!', h), false);
  assert.notEqual(h, await auth.hashPassword(PW));
  assert.equal(await auth.verifyPassword(PW, 'garbage'), false);
});

test('first admin: needs the setup token, a strong password, and works only once', async () => {
  const db = createTestDb();
  await assert.rejects(auth.setupFirstAdmin(db, { ...config, setupToken: '' }, { token: 'x', email: 'a@b.co', password: PW }), (e) => e.code === 'setup_disabled');
  await assert.rejects(setup(db, { token: 'nope' }), (e) => e.code === 'invalid_setup_token');
  await assert.rejects(setup(db, { password: 'short' }), (e) => e.status === 400 && e.extra.errors.password === 'too_short');
  await assert.rejects(setup(db, { email: 'not-an-email' }), (e) => e.extra.errors.email === 'invalid_format');
  const a = await setup(db);
  assert.equal(a.email, 'owner@moon.cafe');
  await assert.rejects(setup(db, { email: 'other@moon.cafe' }), (e) => e.code === 'already_setup');
  const row = (await db.query('SELECT password_hash FROM admins')).rows[0];
  assert.ok(row.password_hash.startsWith('scrypt$') && !row.password_hash.includes(PW));
});

test('login creates a hashed session; wrong passwords and unknown emails are refused', async () => {
  const db = createTestDb(); await setup(db);
  await assert.rejects(auth.login(db, config, { email: 'owner@moon.cafe', password: 'wrong' }), (e) => e.status === 401 && e.code === 'invalid_credentials');
  await assert.rejects(auth.login(db, config, { email: 'ghost@moon.cafe', password: PW }), (e) => e.status === 401 && e.code === 'invalid_credentials');
  const r = await auth.login(db, config, { email: 'OWNER@moon.cafe', password: PW }, { ip: '1.2.3.4', ua: 'jest' });
  assert.ok(r.token.length >= 40);
  const stored = (await db.query('SELECT token_hash FROM admin_sessions')).rows[0].token_hash;
  assert.notEqual(stored, r.token); assert.equal(stored, auth.tokenHash(r.token, config.sessionSecret));
  const me = await auth.sessionAdmin(db, config, r.token);
  assert.deepEqual([me.id, me.email, me.name, me.role, me.permissions], [1, 'owner@moon.cafe', 'Owner Name', 'super_admin', ['*']]);
  assert.equal(await auth.sessionAdmin(db, config, 'forged-token'), null);
  assert.equal(await auth.sessionAdmin(db, { ...config, sessionSecret: 'y'.repeat(40) }, r.token), null);
});

test('five wrong passwords lock the account for 15 minutes', async () => {
  const db = createTestDb(); await setup(db);
  const t0 = new Date('2026-11-01T10:00:00Z');
  for (let i = 0; i < 5; i++) await assert.rejects(auth.login(db, config, { email: 'owner@moon.cafe', password: 'bad' + i }, {}, t0), (e) => e.status === 401);
  await assert.rejects(auth.login(db, config, { email: 'owner@moon.cafe', password: PW }, {}, new Date(t0.getTime() + 60000)), (e) => e.status === 429 && e.code === 'account_locked');
  const r = await auth.login(db, config, { email: 'owner@moon.cafe', password: PW }, {}, new Date(t0.getTime() + 16 * 60000));
  assert.ok(r.token);
});

test('sessions expire after 7 days and logout ends them', async () => {
  const db = createTestDb(); await setup(db);
  const t0 = new Date('2026-11-01T10:00:00Z');
  const r = await auth.login(db, config, { email: 'owner@moon.cafe', password: PW }, {}, t0);
  assert.ok(await auth.sessionAdmin(db, config, r.token, new Date(t0.getTime() + 6 * 86400000)));
  assert.equal(await auth.sessionAdmin(db, config, r.token, new Date(t0.getTime() + 8 * 86400000)), null);
  await auth.logout(db, config, r.token);
  assert.equal(await auth.sessionAdmin(db, config, r.token, t0), null);
});

test('disabled admins cannot log in or use an old session', async () => {
  const db = createTestDb(); await setup(db);
  const r = await auth.login(db, config, { email: 'owner@moon.cafe', password: PW });
  await db.query('UPDATE admins SET is_active = false');
  assert.equal(await auth.sessionAdmin(db, config, r.token), null);
  await assert.rejects(auth.login(db, config, { email: 'owner@moon.cafe', password: PW }), (e) => e.status === 401);
});

test('changing the password checks the old one and closes the other sessions', async () => {
  const db = createTestDb(); await setup(db);
  const a = await auth.login(db, config, { email: 'owner@moon.cafe', password: PW });
  const b = await auth.login(db, config, { email: 'owner@moon.cafe', password: PW });
  await assert.rejects(auth.changePassword(db, config, 1, { current_password: 'nope', new_password: 'another long password' }, a.token), (e) => e.code === 'wrong_password');
  await assert.rejects(auth.changePassword(db, config, 1, { current_password: PW, new_password: 'short' }, a.token), (e) => e.status === 400);
  await auth.changePassword(db, config, 1, { current_password: PW, new_password: 'another long password' }, a.token);
  assert.ok(await auth.sessionAdmin(db, config, a.token)); assert.equal(await auth.sessionAdmin(db, config, b.token), null);
  await assert.rejects(auth.login(db, config, { email: 'owner@moon.cafe', password: PW }), (e) => e.status === 401);
  assert.ok((await auth.login(db, config, { email: 'owner@moon.cafe', password: 'another long password' })).token);
});

test('CSRF rule: changing requests need the custom header and a matching origin', () => {
  const req = (method, headers) => ({ method, get: (h) => headers[h.toLowerCase()] });
  assert.equal(auth.checkCsrf(req('GET', {})), true);
  assert.equal(auth.checkCsrf(req('POST', {})), false);
  assert.equal(auth.checkCsrf(req('POST', { 'x-requested-with': 'mc-admin' })), true);
  assert.equal(auth.checkCsrf(req('POST', { 'x-requested-with': 'mc-admin', origin: 'https://moon.onrender.com', host: 'moon.onrender.com' })), true);
  assert.equal(auth.checkCsrf(req('POST', { 'x-requested-with': 'mc-admin', origin: 'https://evil.example', host: 'moon.onrender.com' })), false);
  assert.equal(auth.checkCsrf(req('DELETE', { origin: 'https://moon.onrender.com', host: 'moon.onrender.com' })), false);
});

test('session cookie is HttpOnly, SameSite=Strict and Secure in production', () => {
  const o = auth.cookieOptions({ isProd: true }, 1000);
  assert.deepEqual(o, { httpOnly: true, sameSite: 'strict', secure: true, path: '/', maxAge: 1000 });
  assert.equal(auth.cookieOptions({ isProd: false }, 1).secure, false);
});
