'use strict';
const S = require('./validate');
const { httpError, isUniqueViolation } = require('./util');
const auth = require('./auth');
const { ROLES, normalizeRole, can } = require('./permissions');

const USERNAME = /^[a-zA-Z0-9._-]{3,32}$/;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const truthy = (v) => v === true || v === 1 || v === 't';

const createShape = S.obj({
  full_name: S.str({ min: 2, max: 80 }),
  username: S.str({ min: 3, max: 32, pattern: USERNAME }),
  email: S.str({ max: 254, pattern: EMAIL, def: '' }),
  role: S.oneOf(ROLES, { def: 'staff' }),
  password: auth.newPasswordRule,
  is_active: S.bool({ def: true }),
});
const updateShape = S.obj({
  full_name: S.str({ min: 2, max: 80 }),
  username: S.str({ min: 3, max: 32, pattern: USERNAME }),
  email: S.str({ max: 254, pattern: EMAIL, def: '' }),
  role: S.oneOf(ROLES, { optional: true }),
  is_active: S.bool({ def: true }),
  password: S.str({ min: 10, max: 200, trim: false, optional: true }),
});

const FIELDS = 'id, email, username, full_name, role, is_active, last_login_at, last_activity_at, created_at';
const shape = (r) => ({
  id: r.id, email: r.email || '', username: r.username || '', full_name: r.full_name || '', role: normalizeRole(r.role),
  name: r.full_name || r.username || r.email || '', is_active: truthy(r.is_active), last_login_at: r.last_login_at, last_activity_at: r.last_activity_at, created_at: r.created_at,
});

async function listUsers(db) {
  const rows = (await db.query(`SELECT ${FIELDS} FROM admins ORDER BY id`)).rows;
  return rows.map(shape);
}

async function activeSuperAdmins(db, exceptId) {
  const rows = (await db.query("SELECT id FROM admins WHERE role IN ('owner', 'super_admin') AND is_active = true AND id <> $1", [exceptId || 0])).rows;
  return rows.length;
}

async function taken(db, { username, email }, exceptId = 0) {
  const u = (await db.query('SELECT id FROM admins WHERE lower(username) = $1 AND id <> $2', [username.toLowerCase(), exceptId])).rows[0];
  if (u) throw httpError(409, 'username_taken');
  if (email) {
    const e = (await db.query('SELECT id FROM admins WHERE lower(email) = $1 AND id <> $2', [email.toLowerCase(), exceptId])).rows[0];
    if (e) throw httpError(409, 'email_taken');
  }
}

async function createUser(db, actor, raw) {
  const u = S.parse(createShape, raw);
  const canAll = can(actor.role, 'users.manage_all');
  if (!canAll && !can(actor.role, 'users.manage_staff')) throw httpError(403, 'forbidden');
  if (!canAll && u.role !== 'staff') throw httpError(403, 'forbidden');   // managers can only create staff
  await taken(db, u);
  try {
    const { rows } = await db.query(
      'INSERT INTO admins (email, username, full_name, role, is_active, password_hash, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
      [u.email ? u.email.toLowerCase() : null, u.username, u.full_name, u.role, u.is_active, await auth.hashPassword(u.password), actor.id]);
    return { id: rows[0].id };
  } catch (e) { if (isUniqueViolation(e)) throw httpError(409, 'username_taken'); throw e; }
}

async function updateUser(db, actor, id, raw) {
  const u = S.parse(updateShape, raw);
  const target = (await db.query(`SELECT ${FIELDS} FROM admins WHERE id = $1`, [id])).rows[0];
  if (!target) throw httpError(404, 'not_found');
  const canAll = can(actor.role, 'users.manage_all');
  const targetRole = normalizeRole(target.role);
  if (!canAll && !(can(actor.role, 'users.manage_staff') && targetRole === 'staff')) throw httpError(403, 'forbidden');
  const newRole = u.role !== undefined ? u.role : targetRole;
  if (newRole !== targetRole && !canAll) throw httpError(403, 'forbidden');
  const wasSuper = targetRole === 'super_admin';
  if (id === actor.id && (u.is_active === false)) throw httpError(409, 'cannot_disable_self');
  if (wasSuper && (newRole !== 'super_admin' || u.is_active === false) && (await activeSuperAdmins(db, id)) === 0) throw httpError(409, 'last_super_admin');
  await taken(db, u, id);
  const sets = ['full_name = $1', 'username = $2', 'email = $3', 'role = $4', 'is_active = $5'];
  const params = [u.full_name, u.username, u.email ? u.email.toLowerCase() : null, newRole === 'super_admin' && target.role === 'owner' ? 'owner' : newRole, u.is_active];
  if (u.password) { params.push(await auth.hashPassword(u.password)); sets.push(`password_hash = $${params.length}`, 'failed_attempts = 0', 'locked_until = NULL'); }
  params.push(id);
  try { await db.query(`UPDATE admins SET ${sets.join(', ')} WHERE id = $${params.length}`, params); } catch (e) { if (isUniqueViolation(e)) throw httpError(409, 'username_taken'); throw e; }
  if (u.password || u.is_active === false) await db.query('DELETE FROM admin_sessions WHERE admin_id = $1', [id]);   // signed out everywhere
}

async function deleteUser(db, actor, id) {
  if (!can(actor.role, 'users.manage_all')) throw httpError(403, 'forbidden');
  if (id === actor.id) throw httpError(409, 'cannot_delete_self');
  const target = (await db.query('SELECT id, role FROM admins WHERE id = $1', [id])).rows[0];
  if (!target) throw httpError(404, 'not_found');
  if (normalizeRole(target.role) === 'super_admin' && (await activeSuperAdmins(db, id)) === 0) throw httpError(409, 'last_super_admin');
  await db.query('DELETE FROM admins WHERE id = $1', [id]);   // their orders and log lines keep the name that was written at the time
}

module.exports = { listUsers, createUser, updateUser, deleteUser };
