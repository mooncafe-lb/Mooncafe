import { h, clear } from '../js/h.js';
import { S } from './strings.js';

export const state = { lang: 'ar', admin: null, data: null, onUnauthorized: () => {} };
// permission check for the signed-in user (the server checks again on every request)
export const has = (perm) => !!state.admin && (state.admin.permissions.includes('*') || state.admin.permissions.includes(perm));
export const t = (key, vars = {}) => {
  const raw = S[state.lang][key] !== undefined ? S[state.lang][key] : key;
  return typeof raw === 'string' ? raw.replace(/\{(\w+)\}/g, (_, k) => vars[k]) : raw;
};

export class CallError extends Error {
  constructor(status, body) { super((body && body.error) || `http_${status}`); this.status = status; this.body = body || {}; }
}

// All admin requests: same-origin cookie, custom header (CSRF protection), JSON or raw body.
export async function call(path, { method = 'GET', body, raw, headers = {} } = {}) {
  let res;
  try {
    res = await fetch(`/api/admin${path}`, {
      method, credentials: 'same-origin',
      headers: { Accept: 'application/json', 'X-Requested-With': 'mc-admin', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: raw !== undefined ? raw : (body !== undefined ? JSON.stringify(body) : undefined),
    });
  } catch (_) { throw new CallError(0, { error: 'network' }); }
  let data = null;
  try { data = await res.json(); } catch (_) { /* empty */ }
  if (res.status === 401 && path !== '/login') state.onUnauthorized();
  if (!res.ok) throw new CallError(res.status, data);
  return data;
}

export function errorText(err) {
  const b = (err && err.body) || {};
  if (err.status === 0) return t('err_network');
  if (err.status === 401 && b.error === 'invalid_credentials') return t('err_credentials');
  if (err.status === 429) return t('err_locked');
  if (b.error === 'invalid_setup_token') return t('err_setup_token');
  if (b.error === 'already_setup') return t('err_already');
  if (b.error === 'wrong_password') return t('err_wrong_password');
  if (b.error === 'username_taken' || b.error === 'email_taken') return t('err_taken');
  if (b.error === 'forbidden' || err.status === 403) return t('err_forbidden');
  if (b.error === 'last_super_admin') return t('err_last_super');
  if (b.error === 'cannot_disable_self' || b.error === 'cannot_delete_self') return t('err_self');
  if (b.error === 'not_your_order') return t('err_not_yours');
  if (b.error === 'claim_first') return t('err_claim_first');
  if (b.error === 'already_assigned') return `${t('err_assigned')}${b.assigned_name ? `: ${b.assigned_name}` : ''}`;
  if (b.error === 'order_closed') return t('err_closed_order');
  if (b.error === 'validation') return t('err_validation');
  return t('err_generic');
}

let toastTimer;
export function toast(message, bad = false) {
  const el = h('div', { class: 'toast', role: 'status', style: bad ? { background: '#FF8A78' } : null }, message);
  document.body.appendChild(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), 3200);
}

// ---------------------------------------------------------------- fields
// Each returns { el, get() }. get() reads the live value from the input.
const wrapField = (label, input, hint) => h('div', { class: 'field' }, label ? h('label', null, label) : null, input, hint ? h('small', { class: 'hint' }, hint) : null);
export const fields = {
  text: (label, value, o = {}) => { const i = h('input', { class: 'input', type: 'text', value: value || '', maxlength: o.max, dir: o.dir, placeholder: o.placeholder }); return { el: wrapField(label, i, o.hint), get: () => i.value }; },
  area: (label, value, o = {}) => { const i = h('textarea', { class: 'input', value: value || '', maxlength: o.max, rows: o.rows || 3, dir: o.dir, placeholder: o.placeholder }); return { el: wrapField(label, i, o.hint), get: () => i.value }; },
  number: (label, value, o = {}) => {
    const i = h('input', { class: 'input', type: 'number', inputmode: 'numeric', min: o.min, value: value == null ? '' : String(value), placeholder: o.placeholder });
    return { el: wrapField(label, i, o.hint), get: () => (String(i.value).trim() === '' ? null : Number(i.value)) };
  },
  color: (label, value) => { const i = h('input', { class: 'input color', type: 'color', value: value || '#000000' }); return { el: wrapField(label, i), get: () => i.value }; },
  time: (value) => { const i = h('input', { class: 'input', type: 'time', value: value || '' }); return { el: i, get: () => i.value }; },
  bool: (label, value) => { const i = h('input', { type: 'checkbox', checked: !!value }); return { el: h('label', { class: 'check' }, i, h('span', null, label)), get: () => !!i.checked }; },
  select: (label, value, options) => {
    const i = h('select', { class: 'input', value }, options.map((o) => h('option', { value: o.value, selected: o.value === value }, o.label)));
    i.value = value;
    return { el: wrapField(label, i), get: () => i.value };
  },
};

// ---------------------------------------------------------------- sheet
let openSheet = null;
export function sheet(title, build) {
  closeSheet();
  const body = h('div', { class: 'sheet-body' });
  const box = h('div', { class: 'sheet wide', role: 'dialog', 'aria-modal': 'true' },
    h('div', { class: 'sheet-head' }, h('h2', null, title), h('button', { class: 'x', type: 'button', 'aria-label': t('close'), onClick: closeSheet }, '×')), body);
  const backdrop = h('div', { class: 'backdrop', onClick: (e) => { if (e.target === backdrop) closeSheet(); } }, box);
  document.body.appendChild(backdrop);
  document.body.style.overflow = 'hidden';
  openSheet = backdrop;
  build(body, closeSheet);
  return { body, close: closeSheet };
}
export function closeSheet() { if (openSheet) { openSheet.remove(); openSheet = null; document.body.style.overflow = ''; } }

export const confirmDialog = (message) => (typeof window.confirm === 'function' ? window.confirm(message) : true);

export async function uploadImage(file, kind = 'photo') {
  if (!file) return null;
  let res;
  try {
    res = await fetch(`/api/admin/images?kind=${kind}&name=${encodeURIComponent(file.name || '')}`, {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-Requested-With': 'mc-admin' }, body: file,
    });
  } catch (_) { throw new CallError(0, { error: 'network' }); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new CallError(res.status, data);
  return data;
}

// Image picker: shows the current image, uploads on choose, supports removal.
export function imagePicker(label, currentId, { kind = 'photo', fallbackUrl = null, removeLabel } = {}) {
  let id = currentId || null;
  const preview = h('img', { class: 'thumb', alt: '', src: id ? `/api/images/${id}?v=thumb` : (fallbackUrl || '') });
  const status = h('small', { class: 'hint' });
  const input = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp,image/gif', onChange: async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    if (file.size > 6 * 1024 * 1024) { status.textContent = t('err_generic'); return; }
    status.textContent = t('loading');
    try { const r = await uploadImage(file, kind); id = r.id; preview.setAttribute('src', `/api/images/${id}?v=thumb`); status.textContent = ''; } catch (e) { status.textContent = errorText(e); }
  } });
  const remove = h('button', { class: 'link', type: 'button', onClick: () => { id = null; preview.setAttribute('src', fallbackUrl || ''); } }, removeLabel || t('remove_image'));
  return { el: h('div', { class: 'field' }, label ? h('label', null, label) : null, h('div', { class: 'row' }, preview, h('div', null, input, remove)), status), get: () => id };
}

export { h, clear };
