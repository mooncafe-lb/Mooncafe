import { h, clear } from './h.js';
import { api } from './api.js';
import { createCart, buildLine } from './cart.js';
import { createI18n } from './i18n.js';
import { createTray } from './tray.js';
import { createSheets } from './sheets.js';

const svgUri = (body, color = '#000') => `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`)}`;
const PLACEHOLDER = svgUri('<circle cx="22" cy="26" r="13"/><circle cx="22" cy="26" r="7" fill="#000"/><path d="M36 20a7 7 0 0 1 0 12"/>');
// simple outline icons for the category chips (generic drawings, not the logo)
const ICONS = {
  coffee: '<path d="M10 20h22v8a10 10 0 0 1-10 10 10 10 0 0 1-12-10v-8z"/><path d="M32 22h3a4 4 0 0 1 0 8h-3"/><path d="M16 8c-2 3 2 4 0 7M23 8c-2 3 2 4 0 7"/>',
  latte: '<path d="M14 9h20l-3 29a4 4 0 0 1-4 3.5h-6a4 4 0 0 1-4-3.5L14 9z"/><path d="M15 17h18"/>',
  milkshake: '<path d="M13 19h22l-2 19a4 4 0 0 1-4 3.5h-10a4 4 0 0 1-4-3.5L13 19z"/><path d="M15 19a9 7 0 0 1 18 0"/><path d="M26 6l-2 13"/>',
  frappe: '<path d="M13 22h22l-2 16a4 4 0 0 1-4 3.5h-10a4 4 0 0 1-4-3.5L13 22z"/><path d="M15 22c0-6 4-9 9-9s9 3 9 9"/><path d="M20 30h8"/>',
  smoothie: '<path d="M18 6h12v6l4 6v19a4 4 0 0 1-4 4H18a4 4 0 0 1-4-4V18l4-6V6z"/><path d="M14 26h20"/>',
};
const iconFor = (nameEn, color) => svgUri(ICONS[String(nameEn).toLowerCase()] || ICONS.coffee, color);
const TRAY_ICON = svgUri('<rect x="5" y="14" width="38" height="22" rx="7"/><path d="M12 22h24M12 28h24"/>', '#FFC000');
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
const state = { store: null, menu: null, error: false, loading: true, active: null, query: '', size: new Map(), stageVisible: true };
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
    try { state.menu = await api('/api/menu'); if (state.menu.ready) cart.reprice(state.menu.categories); renderPage(); } catch (_) { /* ignore */ }
  },
};

const tray = createTray({ cart, i18n, placeholder: TRAY_ICON, onOpen: () => sheets.openTray() });
const sheets = createSheets({ ...ctx, placeholder: PLACEHOLDER, tray });
const summaryEl = h('aside', { class: 'summary', 'aria-live': 'polite' });
const barEl = h('div', { class: 'bar idle' });
const sectionsEl = h('div', { id: 'menu' });
const tabsEl = h('nav', { class: 'tabs' });
let trayCountEl = null;
let barCartBtn = null;
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

// ---------------------------------------------------------------- pieces
const socialLink = (kind, v) => {
  const value = (v || '').trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  const handle = value.replace(/^@/, '');
  return { instagram: `https://instagram.com/${handle}`, facebook: `https://facebook.com/${handle}`, tiktok: `https://tiktok.com/@${handle}` }[kind];
};

function statusPill() {
  const s = state.store;
  const open = s.ready && s.status.open;
  return h('span', { class: `status${open ? ' is-open' : ''}` }, open ? t('open_now') : t('closed_now'));
}

function notices() {
  const s = state.store;
  const out = [];
  if (s.content.banner_enabled && i18n.name(s.content, 'banner')) out.push(h('div', { class: 'notice info' }, i18n.name(s.content, 'banner')));
  if (!s.ready) out.push(h('div', { class: 'notice info' }, t('setup_notice')));
  else if (!s.status.open) {
    const msg = i18n.lang === 'ar' ? s.status.message_ar : s.status.message_en;
    out.push(h('div', { class: 'notice closed', role: 'status' }, msg || t('err_closed'), s.status.next_open ? h('small', null, i18n.nextOpen(s.status.next_open)) : null));
  }
  return out;
}

function contactBlocks() {
  const s = state.store;
  const links = ['instagram', 'facebook', 'tiktok'].map((k) => [k, socialLink(k, s.social[k])]).filter(([, url]) => url);
  const digits = (s.phone || '').replace(/\D/g, '');
  const days = ['sat', 'sun', 'mon', 'tue', 'wed', 'thu', 'fri'];
  const address = i18n.lang === 'ar' ? s.address_ar : s.address_en;
  const hasHours = days.some((d) => (s.hours[d] || []).length);
  return [
    h('div', null, h('h3', null, t('contact')), address ? h('p', null, address) : null,
      s.phone ? h('p', null, h('a', { href: `tel:+${digits.length === 8 ? `961${digits}` : digits}`, dir: 'ltr' }, s.phone)) : null),
    links.length ? h('div', null, h('h3', null, t('follow_us')), links.map(([k, url]) => h('p', null, h('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, k[0].toUpperCase() + k.slice(1))))) : h('div'),
    hasHours ? h('div', null, h('h3', null, t('working_hours')), h('div', { class: 'hours' }, days.flatMap((d) => [
      h('b', null, i18n.day(d)),
      h('span', { dir: 'ltr', style: { textAlign: 'start' } }, (s.hours[d] || []).length ? s.hours[d].map((x) => `${x.open}–${x.close}`).join('  ·  ') : t('closed_day')),
    ]))) : h('div'),
  ];
}

const switchLang = () => { i18n.setLang(i18n.lang === 'ar' ? 'en' : 'ar'); applyLang(); applyBranding(); sheets.closeSheet(); renderPage(); };

function header() {
  const s = state.store;
  trayCountEl = h('span', { class: 'badge-count' }, String(cart.count()));
  return h('header', { class: 'top' },
    h('div', { class: 'top-side' }, statusPill(), h('button', { class: 'lang', type: 'button', onClick: switchLang }, t('lang_toggle'))),
    h('div', { class: 'brand' }, h('div', { class: 'logo-plate' }, h('img', { src: s.branding.logo_url, alt: 'Moon Cafe' })),
      h('div', { class: 'brand-text' }, h('div', { class: 'brand-name' }, i18n.name(s, 'name')), h('div', { class: 'brand-sub' }, i18n.name(s, 'tagline')))),
    h('div', { class: 'top-side end' },
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('tray_open'), onClick: () => sheets.openTray() }, h('img', { src: TRAY_ICON, alt: '' }), trayCountEl),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': t('info'), onClick: () => sheets.openInfo(t('info'), () => h('div', { class: 'info-sheet' }, contactBlocks())) }, h('span', { class: 'burger' }, h('i'), h('i'), h('i')))));
}

function lineRows(withControls) {
  return cart.items().map((l) => h('div', { class: 'sum-line' },
    h('img', { src: l.thumb_url || PLACEHOLDER, alt: '' }),
    h('div', { class: 'grow' }, h('b', null, i18n.name(l)), h('small', null, `${i18n.name(l, 'size')} × ${l.qty}`)),
    h('span', { class: 'sum-price' }, i18n.money(l.unit_price * l.qty)),
    withControls ? h('button', { class: 'x', type: 'button', 'aria-label': t('remove'), onClick: () => cart.remove(l.key) }, '×') : null));
}

function renderSummary() {
  const n = cart.count();
  clear(summaryEl,
    h('div', { class: 'sum-head' }, h('h2', null, t('your_order')), h('span', { class: 'pill' }, t('items_count', { n }))),
    n ? lineRows(true) : h('p', { class: 'hint' }, t('tray_empty')),
    n ? h('div', { class: 'sum-total' }, h('span', null, t('cart_total')), h('b', null, i18n.money(cart.subtotal()))) : null,
    h('button', { class: 'btn wide', type: 'button', disabled: !n, onClick: () => sheets.openCheckout() }, t('checkout')));
}

function renderBar() {
  const n = cart.count();
  const wa = state.store && state.store.whatsapp_number
    ? h('a', { class: 'wa', href: `https://wa.me/${state.store.whatsapp_number}`, target: '_blank', rel: 'noopener noreferrer', 'aria-label': t('contact_whatsapp') }, h('span', null, 'WhatsApp'), h('small', null, t('contact_whatsapp'))) : null;
  barEl.className = n ? 'bar' : 'bar idle';
  barCartBtn = null;
  if (n) {
    barCartBtn = h('button', { class: 'bar-cart', type: 'button', 'aria-label': `${t('tray_open')} (${n})`, onClick: () => sheets.openTray() }, h('img', { src: TRAY_ICON, alt: '' }), h('span', { class: 'bar-count' }, String(n)));
    clear(barEl, barCartBtn, h('div', { class: 'bar-total' }, h('small', null, t('cart_total')), h('b', null, i18n.money(cart.subtotal()))),
      h('button', { class: 'btn', type: 'button', onClick: () => sheets.openCheckout() }, t('checkout')), wa);
  } else clear(barEl, wa);
}

function renderCartUi() {
  tray.render(); renderSummary(); renderBar();
  if (trayCountEl) clear(trayCountEl, String(cart.count()));
}

// ------------------------------------------------------------------- menu
function productCard(p) {
  const sizes = p.sizes;
  const wanted = state.size.get(p.id);
  let sizeId = (sizes.find((s) => s.id === wanted && s.price_lbp != null) || sizes.find((s) => s.price_lbp != null) || sizes[0] || {}).id;
  const img = h('button', { class: 'card-img', type: 'button', 'aria-label': i18n.name(p), onClick: () => sheets.openProduct(p, sizeId) }, h('img', { src: p.thumb_url || PLACEHOLDER, alt: '', loading: 'lazy' }));
  const chips = h('div', { class: 'sizes' });
  const foot = h('div', { class: 'card-foot' });

  const draw = () => {
    const size = sizes.find((s) => s.id === sizeId);
    const orderable = p.orderable && ctx.canOrder() && size && size.price_lbp != null;
    clear(chips, sizes.length > 1 ? sizes.map((s) => h('button', {
      class: 'size-chip', type: 'button', 'aria-pressed': s.id === sizeId ? 'true' : 'false', disabled: s.price_lbp == null,
      onClick: () => { sizeId = s.id; state.size.set(p.id, s.id); draw(); },
    }, i18n.name(s))) : null);
    clear(foot,
      !p.available ? h('span', { class: 'price muted' }, t('sold_out')) : size && size.price_lbp != null ? h('span', { class: 'price' }, i18n.money(size.price_lbp)) : h('span', { class: 'price muted' }, t('price_soon')),
      h('button', { class: 'add', type: 'button', disabled: !orderable, 'aria-label': `${t('add_to_tray')}: ${i18n.name(p)}`, onClick: onAdd }, h('span', { class: 'plus' }, '+'), t('add_to_tray')));
  };

  async function onAdd() {
    if (p.groups.some((g) => g.required)) { sheets.openProduct(p, sizeId); return; }      // needs a choice (Hot/Iced, flavour, ...)
    const line = buildLine(p, sizeId, [], '', 1);
    if (!line) return;
    await tray.fly(img.getBoundingClientRect(), p.thumb_url);
    cart.add(line); tray.pop(line.key);
  }

  draw();
  return h('article', { class: 'card', dataset: { product: String(p.id) } }, img,
    h('div', { class: 'card-body' }, h('button', { class: 'card-name', type: 'button', onClick: () => sheets.openProduct(p, sizeId) }, i18n.name(p)),
      i18n.name(p, 'description') ? h('div', { class: 'card-desc' }, i18n.name(p, 'description')) : null, chips, foot));
}

const matches = (p) => {
  const q = state.query.trim().toLowerCase();
  return !q || `${p.name_ar} ${p.name_en}`.toLowerCase().includes(q);
};

function renderSections() {
  if (state.error) { clear(sectionsEl, h('div', { class: 'state' }, h('p', null, t('load_failed')), h('button', { class: 'btn', type: 'button', onClick: load }, t('retry')))); return; }
  if (!state.menu) { clear(sectionsEl, h('div', { class: 'spinner', role: 'status', 'aria-label': t('loading') })); return; }
  const shown = state.menu.categories.map((c) => ({ c, products: c.products.filter(matches) })).filter((x) => x.products.length);
  clear(sectionsEl, shown.length ? shown.map(({ c, products }) => h('section', { class: 'panel', id: `cat-${c.id}` },
    h('h2', { class: 'panel-title' }, i18n.name(c)), h('div', { class: 'grid' }, products.map(productCard))))
    : h('div', { class: 'state' }, t('no_results')));
}

function renderTabs() {
  const cats = state.menu ? state.menu.categories : [];
  clear(tabsEl, cats.map((c) => h('button', {
    class: `tab${c.id === state.active ? ' active' : ''}`, type: 'button', dataset: { cat: String(c.id) },
    onClick: () => { state.active = c.id; const el = document.getElementById(`cat-${c.id}`); if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth' }); renderTabs(); },
  }, h('img', { src: iconFor(c.name_en, c.id === state.active ? '#000' : '#fff'), alt: '' }), h('span', null, i18n.name(c)))));
}

function stage() {
  const s = state.store;
  const el = h('section', { class: 'stage', style: s.branding.hero_image_url ? { backgroundImage: `linear-gradient(rgba(0,0,0,.72), rgba(0,0,0,.72)), url(${s.branding.hero_image_url})` } : null },
    h('div', { class: 'stage-text' }, h('h1', null, i18n.name(s.content, 'hero_title')), h('p', null, i18n.name(s.content, 'hero_text')),
      h('button', { class: 'btn', type: 'button', onClick: () => { const m = document.getElementById('menu'); if (m && m.scrollIntoView) m.scrollIntoView({ behavior: 'smooth' }); } }, t('order_now'))),
    h('div', { class: 'stage-grid' }, tray.el, summaryEl));
  if (window.IntersectionObserver) new window.IntersectionObserver((entries) => { state.stageVisible = entries[0].isIntersecting; }, { threshold: 0.2 }).observe(el);
  return el;
}

function renderPage() {
  if (!state.store) return;
  const s = state.store;
  if (!state.active && state.menu && state.menu.categories.length) state.active = state.menu.categories[0].id;
  root.classList.remove('app-loading');
  clear(root,
    h('div', { class: 'wrap' }, header(), notices(), stage(),
      s.promotions.length ? h('div', { class: 'promos', 'aria-label': t('promotions') }, s.promotions.map((p) => h('div', { class: 'promo' }, h('b', null, i18n.name(p, 'title')), i18n.name(p, 'text') ? h('p', null, i18n.name(p, 'text')) : null))) : null,
      h('div', { class: 'search' }, h('input', { class: 'input', type: 'search', placeholder: t('search_placeholder'), 'aria-label': t('search_placeholder'), value: state.query, onInput: (e) => { state.query = e.target.value; renderSections(); } })),
      tabsEl, sectionsEl,
      h('footer', { class: 'foot' }, contactBlocks(), i18n.name(s.content, 'footer') ? h('p', { style: { gridColumn: '1 / -1' } }, i18n.name(s.content, 'footer')) : null)),
    barEl);
  renderTabs(); renderSections(); renderCartUi();
  tray.setTarget(() => (state.stageVisible || !barCartBtn ? tray.slots : barCartBtn));
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
    ready: false, name_en: 'Moon Cafe', name_ar: 'مون كافيه', tagline_ar: 'نحنا والقمر جيران', tagline_en: 'We and the moon are neighbors', address_en: '', address_ar: '', phone: '', whatsapp_number: '',
    whatsapp_enabled: false, social: {}, hours: {}, promotions: [],
    branding: { primary_color: '#FFC000', secondary_color: '#000000', surface_color: '#121212', page_background: '#000000', text_on_dark: '#FFFFFF', text_on_primary: '#000000', font_ar: 'Cairo', font_en: 'Poppins', logo_url: '/assets/moon-cafe-logo.png', hero_image_url: null },
    content: { hero_title_ar: 'نحنا والقمر جيران', hero_title_en: 'We and the moon are neighbors', hero_text_ar: '', hero_text_en: '', banner_enabled: false, footer_ar: '', footer_en: '', currency_ar: 'ل.ل.', currency_en: 'LBP', overrides: {} },
    delivery: { delivery_enabled: true, pickup_enabled: true, delivery_fee_lbp: 0, min_order_lbp: 0 },
    status: { open: false, reason: 'setup', message_ar: '', message_en: '', next_open: null },
  };
}

cart.subscribe(() => { renderCartUi(); const cur = sheets.current(); if (cur && cur.kind === 'tray') sheets.rerender(); });
applyLang();

export const ready = load().then(() => {
  // keep open/closed fresh without a reload (skipped in tests)
  if (!globalThis.MC_NO_POLL) setInterval(() => { if (!document.hidden) ctx.refreshStore(); }, 60000);
});
export { state, cart, i18n, sheets, tray, ctx };
