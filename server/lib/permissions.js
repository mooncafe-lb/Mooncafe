'use strict';
// Roles and permissions. To add a capability: add a permission string here and check it with can() or the router's need().
// 'owner' is the role the first admin got before staff accounts existed; it counts as Super Admin.
const ROLES = ['super_admin', 'manager', 'staff'];

const PERMISSIONS = {
  super_admin: ['*'],
  manager: ['orders.view', 'orders.claim', 'orders.update', 'orders.assign', 'orders.release', 'staff.view', 'users.view', 'users.manage_staff'],
  staff: ['orders.view', 'orders.claim', 'orders.update_own', 'orders.release_own'],
};

const normalizeRole = (role) => (role === 'owner' ? 'super_admin' : (ROLES.includes(role) ? role : 'staff'));
const can = (role, permission) => {
  const list = PERMISSIONS[normalizeRole(role)];
  return list.includes('*') || list.includes(permission);
};
const permissionsOf = (role) => {
  const r = normalizeRole(role);
  return PERMISSIONS[r].includes('*') ? ['*'] : [...PERMISSIONS[r]];
};

module.exports = { ROLES, PERMISSIONS, normalizeRole, can, permissionsOf };
