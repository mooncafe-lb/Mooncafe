import { h, clear, t, call, toast, errorText, fields, imagePicker, state } from './core.js';
import { DICT } from '../js/i18n.js';

const DAYS = ['sat', 'sun', 'mon', 'tue', 'wed', 'thu', 'fri'];
const cur = (key) => state.data.settings[key];

// Saves one settings group. The full current value is sent so fields this form does not show are kept.
async function saveSetting(key, changes, msgEl) {
  try {
    const res = await call(`/settings/${key}`, { method: 'PUT', body: { ...cur(key), ...changes } });
    state.data.settings[key] = { ...cur(key), ...res.value };
    toast(t('saved'));
    if (msgEl) msgEl.textContent = '';
    return true;
  } catch (e) {
    const detail = e.body && e.body.errors ? Object.entries(e.body.errors).map(([k, v]) => `${k}: ${v}`).join(' · ') : '';
    if (msgEl) msgEl.textContent = `${errorText(e)} ${detail}`; else toast(errorText(e), true);
    return false;
  }
}

// Builds a box with the given field definitions and a Save button.
function formBox(title, key, defs, { extra } = {}) {
  const data = cur(key);
  const f = {};
  const msg = h('div', { class: 'err' });
  for (const d of defs) {
    f[d.k] = d.type === 'bool' ? fields.bool(d.label, data[d.k])
      : d.type === 'select' ? fields.select(d.label, data[d.k], d.options)
        : fields[d.type || 'text'](d.label, data[d.k], { max: d.max, dir: d.dir, hint: d.hint, min: d.min });
  }
  return h('section', { class: 'box' }, title ? h('h3', null, title) : null,
    h('div', { class: 'grid2' }, defs.map((d) => f[d.k].el)), extra ? extra(f) : null, msg,
    h('button', { class: 'btn', type: 'button', onClick: () => saveSetting(key, Object.fromEntries(defs.map((d) => [d.k, f[d.k].get()])), msg) }, t('save')));
}

// ------------------------------------------------------------------ status and hours
export function renderStore(container) {
  const status = cur('store_status');
  const live = h('div', { class: 'notice info' }, t('loading'));
  const refreshLive = async () => {
    try {
      const s = (await (await fetch('/api/store', { credentials: 'same-origin' })).json()).status;
      clear(live, h('b', null, `${t('live_status')}: ${s.open ? t('open_now') : t('closed_now')}`),
        s.next_open ? h('small', null, `${t('next_open')}: ${t('days')[s.next_open.day]} ${s.next_open.time}`) : null);
    } catch (_) { clear(live, t('err_network')); }
  };
  refreshLive();

  const statusBox = formBox(t('store_mode'), 'store_status', [
    { k: 'mode', type: 'select', label: t('store_mode'), options: [{ value: 'auto', label: t('mode_auto') }, { value: 'force_open', label: t('mode_force_open') }, { value: 'force_closed', label: t('mode_force_closed') }] },
    { k: 'timezone', label: t('timezone'), dir: 'ltr' },
    { k: 'closed_message_ar', type: 'area', label: t('closed_msg_ar'), max: 300 }, { k: 'closed_message_en', type: 'area', label: t('closed_msg_en'), max: 300, dir: 'ltr' },
  ]);

  // ---- hours editor
  const hours = cur('opening_hours');
  const rows = {};
  const msg = h('div', { class: 'err' });
  const dayBlock = (d) => {
    rows[d] = (hours[d] || []).map(makeInterval);
    const box = h('div');
    const draw = () => clear(box, rows[d].map((r) => r.el));
    function makeInterval(iv) {
      const row = { open: fields.time(iv.open), close: fields.time(iv.close) };
      row.el = h('div', { class: 'row interval' }, h('span', null, t('open_from')), row.open.el, h('span', null, t('open_to')), row.close.el,
        h('button', { class: 'link', type: 'button', onClick: () => { rows[d].splice(rows[d].indexOf(row), 1); draw(); } }, '✕'));
      return row;
    }
    draw();
    return h('div', { class: 'day', dataset: { day: d } }, h('div', { class: 'row' }, h('b', null, t('days')[d]),
      h('button', { class: 'btn small ghost', type: 'button', onClick: () => { rows[d].push(makeInterval({ open: '08:00', close: '23:00' })); draw(); } }, `+ ${t('add_interval')}`)), box);
  };
  const hoursBox = h('section', { class: 'box' }, h('h3', null, t('hours')), h('p', { class: 'hint' }, t('hours_help')), DAYS.map(dayBlock), msg,
    h('button', { class: 'btn', type: 'button', onClick: async () => {
      const body = Object.fromEntries(DAYS.map((d) => [d, rows[d].map((r) => ({ open: r.open.get(), close: r.close.get() }))]));
      if (await saveSetting('opening_hours', body, msg)) refreshLive();
    } }, t('save')));
  const wrap = h('div', null, h('h2', null, t('tab_store')), live, statusBox, hoursBox);
  wrap.addEventListener('click', (e) => { if (e.target && e.target.tagName === 'BUTTON') setTimeout(refreshLive, 400); });
  return wrap;
}

// ----------------------------------------------------------------------- brand
export function renderBrand() {
  const b = cur('branding');
  const colorDefs = ['primary_color', 'secondary_color', 'surface_color', 'page_background', 'text_on_dark', 'text_on_primary'];
  const f = Object.fromEntries(colorDefs.map((k) => [k, fields.color(t(k), b[k])]));
  const font = { ar: fields.select(t('font_ar'), b.font_ar, state.data.fonts.ar.map((x) => ({ value: x, label: x }))), en: fields.select(t('font_en'), b.font_en, state.data.fonts.en.map((x) => ({ value: x, label: x }))) };
  const logo = imagePicker(t('logo'), b.logo_image_id, { kind: 'logo', fallbackUrl: '/assets/moon-cafe-logo.png', removeLabel: t('use_default_logo') });
  const hero = imagePicker(t('hero_image'), b.hero_image_id);
  const msg = h('div', { class: 'err' });
  return h('div', null, h('h2', null, t('tab_brand')),
    h('section', { class: 'box' }, h('h3', null, t('colors')), h('div', { class: 'grid2' }, colorDefs.map((k) => f[k].el)),
      h('h3', null, t('fonts')), h('div', { class: 'grid2' }, font.ar.el, font.en.el),
      h('h3', null, t('logo')), h('p', { class: 'hint' }, t('logo_help')), logo.el, hero.el, msg,
      h('button', { class: 'btn', type: 'button', onClick: () => saveSetting('branding', {
        ...Object.fromEntries(colorDefs.map((k) => [k, f[k].get()])), font_ar: font.ar.get(), font_en: font.en.get(), logo_image_id: logo.get(), hero_image_id: hero.get(),
      }, msg) }, t('save'))));
}

// --------------------------------------------------------------------- content
export function renderContent() {
  const promos = (cur('promotions').items || []).map(promoRow);
  const promoBox = h('div');
  const drawPromos = () => clear(promoBox, promos.map((p) => p.el));
  function promoRow(p) {
    const row = { id: p.id || `p${Math.random().toString(36).slice(2, 8)}`, f: {
      title_ar: fields.text(t('promo_title_ar'), p.title_ar, { max: 100 }), title_en: fields.text(t('promo_title_en'), p.title_en, { max: 100, dir: 'ltr' }),
      text_ar: fields.text(t('promo_text_ar'), p.text_ar, { max: 300 }), text_en: fields.text(t('promo_text_en'), p.text_en, { max: 300, dir: 'ltr' }), active: fields.bool(t('promo_active'), p.active !== false),
    } };
    row.el = h('div', { class: 'subbox', dataset: { promo: '1' } }, h('div', { class: 'grid2' }, row.f.title_ar.el, row.f.title_en.el, row.f.text_ar.el, row.f.text_en.el), row.f.active.el,
      h('button', { class: 'link', type: 'button', onClick: () => { promos.splice(promos.indexOf(row), 1); drawPromos(); } }, t('delete')));
    return row;
  }
  drawPromos();
  const promoMsg = h('div', { class: 'err' });
  return h('div', null, h('h2', null, t('tab_content')),
    formBox(t('store_info'), 'store', [
      { k: 'name_en', label: t('name_en_store'), max: 80, dir: 'ltr' }, { k: 'name_ar', label: t('name_ar_store'), max: 80 },
      { k: 'tagline_en', label: t('tagline_en'), max: 120, dir: 'ltr' }, { k: 'tagline_ar', label: t('tagline_ar'), max: 120 },
      { k: 'address', label: t('address_en'), max: 200, dir: 'ltr' }, { k: 'address_ar', label: t('address_ar'), max: 200 }, { k: 'phone', label: t('phone_store'), max: 30, dir: 'ltr' },
    ]),
    formBox(t('social'), 'social', [{ k: 'instagram', label: t('instagram'), max: 200, dir: 'ltr' }, { k: 'facebook', label: t('facebook'), max: 200, dir: 'ltr' }, { k: 'tiktok', label: t('tiktok'), max: 200, dir: 'ltr' }]),
    formBox(t('home_content'), 'content', [
      { k: 'hero_title_ar', label: t('hero_title_ar'), max: 120 }, { k: 'hero_title_en', label: t('hero_title_en'), max: 120, dir: 'ltr' },
      { k: 'hero_text_ar', type: 'area', label: t('hero_text_ar'), max: 400 }, { k: 'hero_text_en', type: 'area', label: t('hero_text_en'), max: 400, dir: 'ltr' },
      { k: 'banner_enabled', type: 'bool', label: t('banner_enabled') }, { k: 'banner_ar', label: t('banner_ar'), max: 200 }, { k: 'banner_en', label: t('banner_en'), max: 200, dir: 'ltr' },
      { k: 'footer_ar', label: t('footer_ar'), max: 300 }, { k: 'footer_en', label: t('footer_en'), max: 300, dir: 'ltr' },
      { k: 'currency_ar', label: t('currency_ar'), max: 12 }, { k: 'currency_en', label: t('currency_en'), max: 12, dir: 'ltr' },
    ]),
    h('section', { class: 'box' }, h('h3', null, t('promotions')), promoBox, promoMsg,
      h('div', { class: 'row' }, h('button', { class: 'btn small ghost', type: 'button', onClick: () => { promos.push(promoRow({ active: true })); drawPromos(); } }, `+ ${t('add')}`),
        h('button', { class: 'btn', type: 'button', onClick: () => saveSetting('promotions', { items: promos.map((p) => ({ id: p.id, title_ar: p.f.title_ar.get(), title_en: p.f.title_en.get(), text_ar: p.f.text_ar.get(), text_en: p.f.text_en.get(), active: p.f.active.get() })) }, promoMsg) }, t('save')))));
}

// ----------------------------------------------------------------------- texts
export function renderTexts() {
  const overrides = cur('content').overrides || {};
  const keys = Object.keys(DICT.en).filter((k) => typeof DICT.en[k] === 'string');
  const inputs = {};
  const rows = keys.map((k) => {
    const ar = fields.text('', (overrides[k] || {}).ar, { placeholder: DICT.ar[k] }); const en = fields.text('', (overrides[k] || {}).en, { placeholder: DICT.en[k], dir: 'ltr' });
    inputs[k] = { ar, en };
    return h('div', { class: 'grid2 text-row', dataset: { key: k } }, ar.el, en.el);
  });
  const msg = h('div', { class: 'err' });
  return h('div', null, h('h2', null, t('tab_texts')), h('p', { class: 'hint' }, t('texts_help')), h('section', { class: 'box' }, rows, msg,
    h('button', { class: 'btn', type: 'button', onClick: () => {
      const map = {};
      for (const k of keys) { const ar = inputs[k].ar.get().trim(); const en = inputs[k].en.get().trim(); if (ar || en) map[k] = { ar, en }; }
      saveSetting('content', { overrides: map }, msg);
    } }, t('save'))));
}

// ------------------------------------------------------------ whatsapp, delivery
export function renderWhatsapp() {
  const vars = '{code} {name} {phone} {type} {address} {location} {items} {subtotal} {delivery_fee} {total} {notes} {currency}';
  return h('div', null, h('h2', null, t('tab_whatsapp')),
    formBox(t('whatsapp'), 'whatsapp', [
      { k: 'number', label: t('wa_number'), max: 30, dir: 'ltr' }, { k: 'enabled', type: 'bool', label: t('wa_enabled') },
      { k: 'message_template', type: 'area', label: t('wa_template'), max: 2000, hint: `${t('wa_template_help')} ${vars}` },
    ]),
    formBox(t('delivery_settings'), 'delivery', [
      { k: 'delivery_enabled', type: 'bool', label: t('delivery_enabled') }, { k: 'pickup_enabled', type: 'bool', label: t('pickup_enabled') },
      { k: 'delivery_fee_lbp', type: 'number', label: t('delivery_fee_lbp'), min: 0 }, { k: 'min_order_lbp', type: 'number', label: t('min_order_lbp'), min: 0 },
      { k: 'note_ar', label: t('note_ar'), max: 300 }, { k: 'note_en', label: t('note_en'), max: 300, dir: 'ltr' },
    ]));
}
