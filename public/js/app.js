import { h, clear } from './h.js';
import { api } from './api.js';
import { createCart, buildLine } from './cart.js';
import { createI18n } from './i18n.js';
import { createTray } from './tray.js';
import { createSheets } from './sheets.js';

const PLACEHOLDER = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="46" cy="52" r="27" fill="none" stroke="#000" stroke-width="7"/><circle cx="46" cy="52" r="15" fill="#000"/><path d="M73 40a15 15 0 0 1 0 25" fill="none" stroke="#000" stroke-width="7" stroke-linecap="round"/></svg>')}`;
const DEFAULT_FONTS = { ar: 'Cairo', en: 'Poppins' };

function safeStorage() {
  try { const s = window.localStorage; s.setItem('mc_probe', '1'); s.removeItem('mc_probe'); return s; } catch (_) {
    const mem = new Map();
    return { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
  }
}

const storage = safeStorage();
const i18n = createI18n(storage.getItem('mc_lang') || 'ar');
const cart = createCart(storage);
const state = { store: null, menu: null, error: false, loading: true, active: null };
const t = (k, v) => i18n.t(k, v);
const root = document.getElementById('app');

const ctx = {
  state, i18n, cart, placeholder: PLACEHOLDER,
  canOrder: () => !!(state.store && state.store.ready && state.store.status.open && state.store.whatsapp_enabled),
  closedReason() {
    const s = state.store;
    if (!s || !s.ready) return t('setup_notice');
    if (!s.whatsapp_enabled) return t('err_ordering_disabled');
    return `${t('err_closed')} ${i18n.nextOpen(s.status.next_open)}`.trim();
  },
  loadCustomer() { try { return JSON.parse(storage.getItem('mc_customer') || '{}') || {}; } catch (_) { return {}; } },
  saveCustomer(c) { try { storage.setItem('mc_customer', JSON.stringify(c)); } catch (_) { /* ignore */ } },
  async refreshStore() { try { state.store = await api('/api/store'); applyBranding(); renderPage(); sheets.rerender(); } catch (_) { /* keep the last known state */ } },
  async reloadMenu() {
    try {
      state.menu = await api('/api/menu');
      if (state.menu.ready) cart.reprice(state.menu.categories);
      renderPage();
    } catch (_) { /* ignore */ }
  },
};

const tray = createTray({ cart, i18n, placeholder: PLACEHOLDER, onOpen: () => sheets.openTray() });
const sheets = createSheets({ ...ctx, tray });
let toastTimer = null;

function toast(message) {
  const el = h('div', { class: 'toast', role: 'status' }, message);
  document.body.appendChild(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), 3500);
}

// ------------------------------------------------------------------ branding
function applyBranding() {
  const s = state.store;
  if (!s) return;
  const b = s.branding;
  const style = document.documentElement.style;
  style.setProperty('--primary', b.primary_color);
  style.setProperty('--bg', b.page_background);
  style.setProperty('--surface', b.surface_color);
  style.setProperty('--on-dark', b.text_on_dark);
  style.setProperty('--on-primary', b.text_on_primary);
  style.setProperty('--font-ar', `'${b.font_ar}'`);
  style.setProperty('--font-en', `'${b.font_en}'`);
  const wanted = [b.font_ar, b.font_en].filter((f) => f !== DEFAULT_FONTS.ar && f !== DEFAULT_FONTS.en);
  if (wanted.length && !document.getElementById('brand-fonts')) {
    const family = wanted.map((f) => `family=${encodeURIComponent(f).replace(/%20/g, '+')}:wght@400;600;700;800`).join('&');
    document.head.appendChild(h('link', { id: 'brand-fonts', rel: 'stylesheet', href: `https://fonts.googleapis.com/css2?${family}&display=swap` }));
  }
  i18n.setOverrides(s.content.overrides);
  i18n.setCurrency({ ar: s.content.currency_ar, en: s.content.currency_en });
  document.title = `${i18n.name(s, 'name')} | ${s.name_en}`;
}

function applyLang() {
  document.documentElement.lang = i18n.lang;
  document.documentElement.dir = i18n.dir;
  storage.setItem('mc_lang', i18n.lang);
}

// ---------------------------------------------------------------------- page
const socialLink = (kind, v) => {
  const value = (v || '').trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  const handle = value.replace(/^@/, '');
  return { instagram: `https://instagram.com/${handle}`, facebook: `https://facebook.com/${handle}`, tiktok: `https://tiktok.com/@${handle}` }[kind];
};

function priceLabel(p) {
  const prices = p.sizes.map((s) => s.price_lbp).filter((x) => x != null);
  if (!p.available) return h('span', { class: 'price muted' }, t('sold_out'));
  if (!prices.length) return h('span', { class: 'price muted' }, t('price_soon'));
  const min = Math.min(...prices);
  return h('span', { class: 'price' }, new Set(prices).size > 1 ? `${t('from')} ${i18n.money(min)}` : i18n.money(min));
}

function card(p) {
  const img = h('div', { class: 'card-img' }, h('img', { src: p.thumb_url || PLACEHOLDER, alt: '', loading: 'lazy' }));
  const orderable = p.orderable && ctx.canOrder();
  const quick = p.sizes.length === 1 && p.sizes[0].price_lbp != null && !p.groups.some((g) => g.required);
  const onAdd = async () => {
    if (!quick) { sheets.openProduct(p); return; }
    const line = buildLine(p, p.sizes[0].id, [], '', 1);
    if (!line) return;
    await tray.fly(img.getBoundingClientRect(), p.thumb_url);
    cart.add(line); tray.pop(line.key);
  };
  return h('article', { class: 'card', dataset: { product: String(p.id) } },
    img,
    h('div', { class: 'card-body' },
      h('button', { class: 'link card-name', type: 'button', style: { textAlign: 'start', padding: 0, color: 'inherit', textDecoration: 'none' }, onClick: () => sheets.openProduct(p) }, i18n.name(p)),
      i18n.name(p, 'description') ? h('div', { class: 'card-desc' }, i18n.name(p, 'description')) : null,
      h('div', { class: 'card-foot' }, priceLabel(p),
        h('button', { class: 'add', type: 'button', disabled: !orderable, 'aria-label': `${t('add_to_tray')}: ${i18n.name(p)}`, onClick: onAdd }, '+'))));
}

function statusPill() {
  const s = state.store;
  if (!s) return null;
  const open = s.ready && s.status.open;
  return h('span', { class: `status${open ? ' is-open' : ''}` }, open ? t('open_now') : t('closed_now'));
}

function notices() {
  const s = state.store;
  if (!s) return [];
  const out = [];
  if (s.content.banner_enabled && i18n.name(s.content, 'banner')) out.push(h('div', { class: 'notice info' }, i18n.name(s.content, 'banner')));
  if (!s.ready) out.push(h('div', { class: 'notice info' }, t('setup_notice')));
  else if (!s.status.open) {
    const msg = i18n.lang === 'ar' ? s.status.message_ar : s.status.message_en;
    out.push(h('div', { class: 'notice closed', role: 'status' }, msg || t('err_closed'), s.status.next_open ? h('small', null, i18n.nextOpen(s.status.next_open)) : null));
  }
  return out;
}

function hero() {
  const s = state.store;
  return h('section', { class: 'hero' },
    s.branding.hero_image_url ? h('img', { class: 'hero-bg', src: s.branding.hero_image_url, alt: '' }) : null,
    h('img', { class: 'hero-logo', src: s.branding.logo_url, alt: `${s.name_en} ${s.name_ar}` }),
    h('div', null, h('h1', null, i18n.name(s.content, 'hero_title')), h('p', null, i18n.name(s.content, 'hero_text')),
      h('button', { class: 'btn dark', type: 'button', onClick: () => { const m = document.getElementById('menu'); if (m && m.scrollIntoView) m.scrollIntoView({ behavior: 'smooth' }); } }, t('order_now'))));
}

function footer() {
  const s = state.store;
  const links = ['instagram', 'facebook', 'tiktok'].map((k) => [k, socialLink(k, s.social[k])]).filter(([, url]) => url);
  const digits = (s.phone || '').replace(/\D/g, '');
  const days = ['sat', 'sun', 'mon', 'tue', 'wed', 'thu', 'fri'];
  const address = i18n.lang === 'ar' ? s.address_ar : s.address_en;
  const hasHours = days.some((d) => (s.hours[d] || []).length);
  return h('footer', { class: 'foot' },
    h('div', null, h('h3', null, t('contact')), address ? h('p', null, address) : null,
      s.phone ? h('p', null, h('a', { href: `tel:+${digits.length === 8 ? `961${digits}` : digits}`, dir: 'ltr' }, s.phone)) : null),
    links.length ? h('div', null, h('h3', null, t('follow_us')), links.map(([k, url]) => h('p', null, h('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, k[0].toUpperCase() + k.slice(1))))) : h('div'),
    hasHours ? h('div', null, h('h3', null, t('working_hours')), h('div', { class: 'hours' }, days.flatMap((d) => [
      h('b', null, i18n.day(d)),
      h('span', { dir: 'ltr', style: { textAlign: 'start' } }, (s.hours[d] || []).length ? s.hours[d].map((x) => `${x.open}–${x.close}`).join('  ·  ') : t('closed_day')),
    ]))) : h('div'),
    i18n.name(s.content, 'footer') ? h('p', { style: { gridColumn: '1 / -1' } }, i18n.name(s.content, 'footer')) : null);
}

function renderPage() {
  if (!state.store) return;
  const s = state.store;
  const cats = state.menu ? state.menu.categories : [];
  if (!state.active && cats.length) state.active = cats[0].id;
  root.classList.remove('app-loading');
  clear(root, h('div', { class: 'wrap' },
    h('header', { class: 'top' },
      h('div', { class: 'brand' }, h('div', { class: 'logo-plate' }, h('img', { src: s.branding.logo_url, alt: 'Moon Cafe' })),
        h('div', null, h('div', { class: 'brand-name' }, i18n.name(s, 'name')), h('div', { class: 'brand-sub' }, i18n.name(s, 'tagline')))),
      statusPill(),
      h('button', { class: 'lang', type: 'button', onClick: () => { i18n.setLang(i18n.lang === 'ar' ? 'en' : 'ar'); applyLang(); applyBranding(); sheets.closeSheet(); renderPage(); } }, t('lang_toggle'))),
    notices(),
    hero(),
    s.promotions.length ? h('div', { class: 'promos', 'aria-label': t('promotions') }, s.promotions.map((p) => h('div', { class: 'promo' }, h('b', null, i18n.name(p, 'title')), i18n.name(p, 'text') ? h('p', null, i18n.name(p, 'text')) : null))) : null,
    h('div', { class: 'dock', id: 'dock' }, tray.el),
    h('main', { id: 'menu' },
      state.error ? h('div', { class: 'state' }, h('p', null, t('load_failed')), h('button', { class: 'btn', type: 'button', onClick: load }, t('retry')))
        : !state.menu ? h('div', { class: 'spinner', role: 'status', 'aria-label': t('loading') })
          : [
            h('nav', { class: 'tabs', 'aria-label': t('menu_title') }, cats.map((c) => h('button', {
              class: `tab${c.id === state.active ? ' active' : ''}`, type: 'button', dataset: { cat: String(c.id) },
              onClick: () => { state.active = c.id; const el = document.getElementById(`cat-${c.id}`); if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth' }); renderPage(); },
            }, i18n.name(c)))),
            cats.map((c) => h('section', { class: 'panel', id: `cat-${c.id}` }, h('h2', { class: 'panel-title' }, i18n.name(c)), h('div', { class: 'grid' }, c.products.map(card)))),
          ]),
    footer()));
  tray.render();
  const dock = document.getElementById('dock');
  if (dock) document.documentElement.style.setProperty('--dock-h', `${Math.round(dock.getBoundingClientRect().height)}px`);
}

async function load() {
  state.error = false;
  try {
    const [store, menu] = await Promise.all([api('/api/store'), api('/api/menu')]);
    state.store = store; state.menu = menu;
    applyBranding(); applyLang();
    if (menu.ready && cart.reprice(menu.categories) > 0) toast(t('err_items'));
  } catch (_) {
    state.error = true;
    if (!state.store) state.store = fallbackStore();
  }
  state.loading = false;
  renderPage();
}

// Shown only when the server cannot be reached at all.
function fallbackStore() {
  return {
    ready: false, name_en: 'Moon Cafe', name_ar: 'مون كافيه', tagline_ar: 'نحنا والقمر جيران', tagline_en: 'We and the moon are neighbors', address_en: '', address_ar: '', phone: '',
    whatsapp_enabled: false, social: {}, hours: {}, promotions: [],
    branding: { primary_color: '#FFC000', secondary_color: '#000000', surface_color: '#121212', page_background: '#000000', text_on_dark: '#FFFFFF', text_on_primary: '#000000', font_ar: 'Cairo', font_en: 'Poppins', logo_url: '/assets/moon-cafe-logo.png', hero_image_url: null },
    content: { hero_title_ar: 'نحنا والقمر جيران', hero_title_en: 'We and the moon are neighbors', hero_text_ar: '', hero_text_en: '', banner_enabled: false, footer_ar: '', footer_en: '', currency_ar: 'ل.ل.', currency_en: 'LBP', overrides: {} },
    delivery: { delivery_enabled: true, pickup_enabled: true, delivery_fee_lbp: 0, min_order_lbp: 0 },
    status: { open: false, reason: 'setup', message_ar: '', message_en: '', next_open: null },
  };
}

cart.subscribe(() => { tray.render(); const cur = sheets.current(); if (cur && cur.kind === 'tray') sheets.rerender(); });
applyLang();

export const ready = load().then(() => {
  // keep open/closed fresh without a reload (skipped in tests)
  if (!globalThis.MC_NO_POLL) setInterval(() => { if (!document.hidden) ctx.refreshStore(); }, 60000);
});
export { state, cart, i18n, sheets, tray, ctx };
