import { h, clear } from './h.js';
import { api, ApiError } from './api.js';
import { createI18n } from './i18n.js';

function safeStorage() {
  try { const s = window.localStorage; s.setItem('mc_probe', '1'); s.removeItem('mc_probe'); return s; } catch (_) { return { getItem: () => null, setItem: () => {} }; }
}
const storage = safeStorage();
const i18n = createI18n(storage.getItem('mc_lang') || 'ar');
const t = (k, v) => i18n.t(k, v);
const root = document.getElementById('app');
const token = (window.location.pathname || '').split('/').filter(Boolean)[1] || '';
const state = { data: null, notFound: false, offline: false, ratingError: false };

function applyLang() {
  document.documentElement.lang = i18n.lang; document.documentElement.dir = i18n.dir; storage.setItem('mc_lang', i18n.lang);
  document.title = `${t('trk_title')} | Moon Cafe`;
}

async function applyBranding() {
  try {
    const s = await api('/api/store');
    const style = document.documentElement.style; const b = s.branding;
    style.setProperty('--primary', b.primary_color); style.setProperty('--bg', b.page_background); style.setProperty('--surface', b.surface_color);
    style.setProperty('--on-dark', b.text_on_dark); style.setProperty('--on-primary', b.text_on_primary);
    i18n.setCurrency({ ar: s.content.currency_ar, en: s.content.currency_en }); i18n.setOverrides(s.content.overrides);
    render();
  } catch (_) { /* the default colours are the brand colours already */ }
}

const when = (stamp) => (stamp ? `${stamp.date}  ${stamp.time[i18n.lang]}` : '');

function stageList(d) {
  return h('ol', { class: 'timeline' }, d.stages.map((s) => h('li', { class: `stage ${s.state}`, dataset: { stage: s.key, state: s.state } },
    h('span', { class: 'dot' }, s.state === 'done' ? '✓' : ''),
    h('div', { class: 'stage-body' }, h('div', { class: 'stage-name' }, s.label[i18n.lang]),
      s.at ? h('div', { class: 'stage-time' }, when(s.at)) : (s.state === 'pending' ? h('div', { class: 'stage-time' }, t('trk_waiting')) : null)))));
}

function feedback(d) {
  const f = d.feedback;
  if (!f) return null;                                                   // not delivered yet: no review request at all
  const rated = f.rating;
  return h('section', { class: 'card-t thanks', id: 'feedback' },
    h('h2', null, t('thanks_title')),
    h('p', null, rated ? t('rate_thanks') : t('thanks_text')),
    h('div', { class: 'stars', role: 'group', 'aria-label': t('rate_label') }, [1, 2, 3, 4, 5].map((n) => h('button', {
      class: `star${rated && n <= rated ? ' on' : ''}`, type: 'button', disabled: !!rated, 'aria-label': `${n} ${t('star')}`, dataset: { star: String(n) }, onClick: () => rate(n),
    }, '★'))),
    state.ratingError ? h('div', { class: 'err' }, t('rate_error')) : null,
    rated && f.review_url ? h('a', { class: 'btn', href: f.review_url, target: '_blank', rel: 'noopener noreferrer' }, t('review_cta')) : null);
}

function render() {
  applyLang();
  const d = state.data;
  clear(root, h('div', { class: 'trk' },
    h('div', { class: 'trk-top' }, h('div', { class: 'logo-plate' }, h('img', { src: '/assets/moon-cafe-logo.png', alt: 'Moon Cafe' })),
      h('button', { class: 'lang', type: 'button', lang: i18n.lang === 'ar' ? 'en' : 'ar', dir: i18n.lang === 'ar' ? 'ltr' : 'rtl', onClick: () => { i18n.setLang(i18n.lang === 'ar' ? 'en' : 'ar'); render(); } }, t('lang_toggle'))),
    state.notFound ? h('section', { class: 'card-t state' }, t('trk_not_found'))
      : !d ? h('div', { class: 'spinner', role: 'status' })
        : [
          h('section', { class: 'card-t trk-head' },
            h('div', { class: 'trk-word' }, t('order_word')), h('div', { class: 'trk-number', id: 'order-number' }, d.number ? `#${d.number}` : ''),
            h('div', { class: 'trk-stamp' }, h('span', null, `${t('order_date')}: `, h('b', { id: 'order-date' }, d.date)), h('span', null, `${t('order_time')}: `, h('b', { id: 'order-time' }, d.time[i18n.lang]))),
            h('div', { class: `trk-chip${d.cancelled ? ' bad' : ''}`, id: 'order-status' }, d.status_label[i18n.lang])),
          h('section', { class: 'card-t' }, d.cancelled ? h('p', { class: 'err' }, t('trk_cancelled')) : null, stageList(d),
            h('div', { class: 't-note', style: { marginTop: '14px' } }, `${t('trk_last_update')}: `, h('b', { id: 'last-update', dir: 'ltr' }, when(d.last_update)))),
          feedback(d),
          h('section', { class: 'card-t' }, h('h3', { style: { marginTop: 0 } }, t('trk_items')),
            d.items.map((i) => h('div', { class: 't-row' }, h('div', null, h('b', null, `${i18n.name(i)} × ${i.quantity}`),
              i18n.name(i, 'size') ? h('small', null, i18n.name(i, 'size')) : null,
              i.options.length ? h('small', null, i.options.map((o) => i18n.name(o)).join(i18n.lang === 'ar' ? '، ' : ', ')) : null), h('span', null, i18n.money(i.line_total_lbp)))),
            h('div', { class: 't-row' }, h('span', null, t('trk_type')), h('b', { id: 'order-type' }, d.fulfillment === 'delivery' ? t('delivery') : t('pickup'))),
            d.fulfillment === 'delivery' ? h('div', { class: 't-row' }, h('span', null, t('delivery_fee')), h('span', null, i18n.money(d.delivery_fee_lbp))) : null,
            h('div', { class: 't-row t-total' }, h('span', null, t('total')), h('span', { id: 'order-total' }, i18n.money(d.total_lbp)))),
          h('p', { class: 't-note' }, state.offline ? t('trk_error') : t('trk_auto')),
        ]));
}

export async function refresh() {
  try {
    state.data = await api(`/api/track/${encodeURIComponent(token)}`);
    state.notFound = false; state.offline = false;
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) state.notFound = true; else state.offline = true;
  }
  render();
}

async function rate(n) {
  state.ratingError = false;
  try {
    await api(`/api/track/${encodeURIComponent(token)}/rating`, { method: 'POST', body: { rating: n } });
    await refresh();
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) await refresh(); else { state.ratingError = true; render(); }
  }
}

applyLang(); render();
export const ready = Promise.all([refresh(), applyBranding()]).then(() => {
  // safe periodic refresh (every 10 s while the page is visible) instead of a long-lived connection
  if (!globalThis.MC_NO_POLL) {
    setInterval(() => { if (!document.hidden) refresh(); }, 10000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  }
});
export { state, i18n };
