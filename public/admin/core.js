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
  if (err.status === 413 || b.error === 'payload_too_large') return t('err_img_big');
  if (b.error === 'invalid_image' || b.error === 'empty_upload') return t('err_img_invalid');
  if (b.error === 'unsupported_image_type') return t('err_img_type');
  if (b.error === 'image_save_failed') return t('err_img_upload');
  if (b.error === 'image_unreachable') return t('err_img_unreachable');
  if (b.error === 'username_taken' || b.error === 'email_taken') return t('err_taken');
  if (b.error === 'forbidden' || err.status === 403) return t('err_forbidden');
  if (b.error === 'last_super_admin') return t('err_last_super');
  if (b.error === 'cannot_disable_self' || b.error === 'cannot_delete_self') return t('err_self');
  if (b.error === 'not_your_order') return t('err_not_yours');
  if (b.error === 'claim_first') return t('err_claim_first');
  if (b.error === 'already_assigned') return `${t('err_assigned')}${b.assigned_name ? `: ${b.assigned_name}` : ''}`;
  if (b.error === 'order_closed') return t('err_closed_order');
  if (b.error === 'validation' && b.errors && b.errors.status === 'not_allowed_for_order_type') return t('err_bad_status');
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

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

// Phone photos are large: shrink them in the browser first (1600px) so uploads are small and fast.
// If the browser cannot do it, the original file is uploaded as it is.
export async function shrinkImage(file, kind) {
  if (kind === 'logo' || !/^image\/(jpeg|png|webp)$/.test(file.type || '') || file.size <= 1.2 * 1024 * 1024) return file;
  try {
    if (typeof createImageBitmap !== 'function') return file;
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale); canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const type = file.type === 'image/jpeg' ? 'image/jpeg' : 'image/webp';
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, type, 0.86));
    return blob && blob.type === type && blob.size < file.size ? blob : file;
  } catch (_) { return file; }
}

// Image picker. A save is only allowed when the upload really finished and the image can be loaded back from the site:
//   get()     the image id to save, problem()  an error text while uploading or after a failed upload (empty when fine)
export function imagePicker(label, currentId, { kind = 'photo', fallbackUrl = null, removeLabel } = {}) {
  let id = currentId || null;
  let busy = false;
  let failure = '';
  const preview = h('img', { class: 'thumb', alt: '', src: id ? `/api/images/${id}?v=thumb` : (fallbackUrl || '') });
  const status = h('small', { class: 'hint img-status', role: 'status' });
  const show = (text, bad) => { status.textContent = text; status.className = `hint img-status${bad ? ' err' : ''}`; };
  const input = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp,image/gif', onChange: async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    failure = '';
    if (file.size > MAX_UPLOAD_BYTES * 4) { failure = t('err_img_big'); show(failure, true); return; }
    busy = true; show(t('uploading'));
    try {
      const upload = await shrinkImage(file, kind);
      if (upload.size > MAX_UPLOAD_BYTES) throw new CallError(413, { error: 'payload_too_large' });
      const r = await uploadImage(upload, kind);
      const check = await fetch(r.thumb_url || r.url, { credentials: 'same-origin' });          // can the browser really load it?
      if (!check.ok) throw new CallError(check.status || 0, { error: 'image_unreachable' });
      id = r.id; preview.setAttribute('src', `/api/images/${id}?v=thumb`); show(t('uploaded'));
    } catch (e) { failure = errorText(e); show(failure, true); } finally { busy = false; }
  } });
  const remove = h('button', { class: 'link', type: 'button', onClick: () => { id = null; failure = ''; show(''); preview.setAttribute('src', fallbackUrl || ''); } }, removeLabel || t('remove_image'));
  return {
    el: h('div', { class: 'field' }, label ? h('label', null, label) : null, h('div', { class: 'row' }, preview, h('div', null, input, remove)), status),
    get: () => id,
    problem: () => (busy ? t('err_img_pending') : failure),
  };
}
export const imageProblem = (...pickers) => pickers.map((p) => p.problem()).find(Boolean) || '';

export { h, clear };
