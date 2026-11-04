'use strict';
const crypto = require('crypto');
const { promisify } = require('util');
const S = require('./validate');
const { httpError } = require('./util');
const { normalizeRole, permissionsOf } = require('./permissions');

const scrypt = promisify(crypto.scrypt);
const COOKIE = 'mc_session';
const SESSION_MS = 7 * 24 * 3600 * 1000;
const MAX_FAILS = 5;
const LOCK_MS = 15 * 60 * 1000;
const N = 16384; const R = 8; const P = 1;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, 64, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

async function verifyPassword(password, stored) {
  const parts = String(stored).split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, salt, hash] = parts;
  const expected = Buffer.from(hash, 'base64');
  const actual = await scrypt(password, Buffer.from(salt, 'base64'), expected.length, { N: Number(n), r: Number(r), p: Number(p) });
  return crypto.timingSafeEqual(actual, expected);
}

let dummyHash;
const getDummyHash = async () => { dummyHash = dummyHash || await hashPassword('not-a-real-password'); return dummyHash; };

const tokenHash = (token, secret) => crypto.createHmac('sha256', secret).update(String(token)).digest('hex');
const safeEqual = (a, b) => {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
const iso = (d) => d.toISOString();
const truthy = (v) => v === true || v === 1 || v === 't';

const credentialsShape = S.obj({ login: S.str({ min: 1, max: 254 }), password: S.str({ min: 1, max: 200, trim: false }) });

// What the browser and the routes know about a signed-in user. The display name is the real name when there is one.
function publicAdmin(a) {
  const role = normalizeRole(a.role);
  return {
    id: a.id, email: a.email || '', username: a.username || '', full_name: a.full_name || '',
    name: a.full_name || a.username || a.email || '', role, permissions: permissionsOf(role),
  };
}
const newPasswordRule = S.str({ min: 10, max: 200, trim: false });

async function adminCount(db) {
  return Number((await db.query('SELECT count(*) AS n FROM admins')).rows[0].n);
}

// First administrator: allowed only while no admin exists and only with the SETUP_TOKEN from Render.
async function setupFirstAdmin(db, config, raw) {
  if (!config.setupToken) throw httpError(403, 'setup_disabled');
  if (await adminCount(db) > 0) throw httpError(403, 'already_setup');
  const input = S.parse(S.obj({
    token: S.str({ min: 1, max: 200, trim: false }),
    email: S.str({ min: 3, max: 254, pattern: EMAIL }),
    full_name: S.str({ min: 2, max: 80 }),
    password: newPasswordRule,
  }), raw);
  if (!safeEqual(input.token, config.setupToken)) throw httpError(403, 'invalid_setup_token');
  const hash = await hashPassword(input.password);
  const { rows } = await db.query("INSERT INTO admins (email, password_hash, full_name, role) VALUES ($1, $2, $3, 'super_admin') RETURNING id", [input.email.toLowerCase(), hash, input.full_name]);
  return { id: rows[0].id, email: input.email.toLowerCase() };
}

async function login(db, config, raw, ctx = {}, now = new Date()) {
  const input = S.parse(credentialsShape, raw && raw.login === undefined && raw.email !== undefined ? { ...raw, login: raw.email } : raw);
  const who = input.login.toLowerCase();
  const { rows } = await db.query(
    `SELECT id, email, username, full_name, role, password_hash, is_active, failed_attempts, locked_until
     FROM admins WHERE lower(email) = $1 OR lower(username) = $1`, [who]);
  const admin = rows[0];
  if (admin && admin.locked_until && new Date(admin.locked_until) > now) throw httpError(429, 'account_locked');
  const ok = await verifyPassword(input.password, admin ? admin.password_hash : await getDummyHash());
  if (!admin || !ok || !truthy(admin.is_active)) {
    if (admin) {
      const fails = Number(admin.failed_attempts) + 1;
      const lock = fails >= MAX_FAILS ? iso(new Date(now.getTime() + LOCK_MS)) : null;
      await db.query('UPDATE admins SET failed_attempts = $1, locked_until = $2 WHERE id = $3', [lock ? 0 : fails, lock, admin.id]);
    }
    throw httpError(401, 'invalid_credentials');
  }
  await db.query('UPDATE admins SET failed_attempts = 0, locked_until = NULL, last_login_at = CURRENT_TIMESTAMP, last_activity_at = CURRENT_TIMESTAMP WHERE id = $1', [admin.id]);
  await db.query('DELETE FROM admin_sessions WHERE expires_at < $1', [iso(now)]);
  const token = crypto.randomBytes(32).toString('base64url');
  await db.query(
    'INSERT INTO admin_sessions (admin_id, token_hash, expires_at, ip, user_agent) VALUES ($1,$2,$3,$4,$5)',
    [admin.id, tokenHash(token, config.sessionSecret), iso(new Date(now.getTime() + SESSION_MS)), String(ctx.ip || '').slice(0, 60), String(ctx.ua || '').slice(0, 200)]);
  return { token, admin: publicAdmin(admin), maxAge: SESSION_MS };
}

async function sessionAdmin(db, config, token, now = new Date()) {
  if (!token || typeof token !== 'string' || token.length > 200) return null;
  const { rows } = await db.query(
    `SELECT a.id, a.email, a.username, a.full_name, a.role, a.is_active FROM admin_sessions s JOIN admins a ON a.id = s.admin_id
     WHERE s.token_hash = $1 AND s.expires_at > $2`, [tokenHash(token, config.sessionSecret), iso(now)]);
  const a = rows[0];
  return a && truthy(a.is_active) ? publicAdmin(a) : null;
}

async function logout(db, config, token) {
  if (token) await db.query('DELETE FROM admin_sessions WHERE token_hash = $1', [tokenHash(token, config.sessionSecret)]);
}

async function changePassword(db, config, adminId, raw, currentToken) {
  const input = S.parse(S.obj({ current_password: S.str({ min: 1, max: 200, trim: false }), new_password: newPasswordRule }), raw);
  const { rows } = await db.query('SELECT password_hash FROM admins WHERE id = $1', [adminId]);
  if (!rows[0] || !(await verifyPassword(input.current_password, rows[0].password_hash))) throw httpError(403, 'wrong_password');
  await db.query('UPDATE admins SET password_hash = $1 WHERE id = $2', [await hashPassword(input.new_password), adminId]);
  // every other session is closed; the current one stays
  await db.query('DELETE FROM admin_sessions WHERE admin_id = $1 AND token_hash <> $2', [adminId, tokenHash(currentToken || '', config.sessionSecret)]);
}

// State-changing requests need the custom header (a cross-site page cannot send it) and a matching Origin.
function checkCsrf(req) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return true;
  if (req.get('x-requested-with') !== 'mc-admin') return false;
  const origin = req.get('origin');
  if (!origin) return true;
  try { return new URL(origin).host === req.get('host'); } catch (_) { return false; }
}

function requireAdmin(db, config) {
  return async (req, res, next) => {
    try {
      if (!checkCsrf(req)) return res.status(403).json({ error: 'csrf' });
      const token = req.cookies && req.cookies[COOKIE];
      const admin = await sessionAdmin(db, config, token);
      if (!admin) return res.status(401).json({ error: 'unauthorized' });
      req.admin = admin;
      req.sessionToken = token;
      return next();
    } catch (err) { return next(err); }
  };
}

const cookieOptions = (config, maxAge) => ({ httpOnly: true, sameSite: 'strict', secure: !!config.isProd, path: '/', maxAge });

module.exports = {
  COOKIE, hashPassword, verifyPassword, tokenHash, setupFirstAdmin, login, sessionAdmin, logout, changePassword,
  requireAdmin, checkCsrf, cookieOptions, adminCount, MAX_FAILS, publicAdmin, newPasswordRule,
};
