import { h, clear, t, call, toast, errorText, fields, state, closeSheet, CallError } from './core.js';
import { renderMenu } from './menu.js';
import { renderOrders } from './orders.js';
import { renderStore, renderBrand, renderContent, renderTexts, renderWhatsapp } from './settings.js';

const root = document.getElementById('admin');
const TABS = ['orders', 'menu', 'store', 'brand', 'content', 'whatsapp', 'texts', 'account'];
let tab = 'orders';
try { state.lang = localStorage.getItem('mc_admin_lang') === 'en' ? 'en' : 'ar'; } catch (_) { /* default */ }

function applyLang() { document.documentElement.lang = state.lang; document.documentElement.dir = state.lang === 'ar' ? 'rtl' : 'ltr'; try { localStorage.setItem('mc_admin_lang', state.lang); } catch (_) { /* ignore */ } }
const langButton = (rerender) => h('button', { class: 'lang', type: 'button', onClick: () => { state.lang = state.lang === 'ar' ? 'en' : 'ar'; applyLang(); rerender(); } }, t('lang_toggle'));
const shell = (...children) => clear(root, h('div', { class: 'wrap admin' }, ...children));

// -------------------------------------------------------------- screens
function notReady() {
  shell(h('div', { class: 'top' }, h('h1', null, t('title')), langButton(notReady)),
    h('section', { class: 'box' }, h('h2', null, t('not_ready')), h('p', null, t('not_ready_help'))));
}

function authScreen({ setup, tokenMissing }) {
  const email = fields.text(t('email'), '', { dir: 'ltr' }); const pw = fields.text(t('password'), '', { dir: 'ltr' });
  const token = fields.text(t('setup_token'), '', { dir: 'ltr' }); const pw2 = fields.text(t('repeat_password'), '', { dir: 'ltr' });
  const inputOf = (f) => f.el.children[1];
  inputOf(pw).setAttribute('type', 'password'); inputOf(pw2).setAttribute('type', 'password'); inputOf(email).setAttribute('autocomplete', 'username'); inputOf(pw).setAttribute('autocomplete', setup ? 'new-password' : 'current-password');
  const msg = h('div', { class: 'err', role: 'alert' });
  async function submit() {
    msg.textContent = '';
    try {
      if (setup) {
        if (pw.get().length < 10) { msg.textContent = t('err_pw_short'); return; }
        if (pw.get() !== pw2.get()) { msg.textContent = t('err_pw_match'); return; }
        await call('/setup', { method: 'POST', body: { token: token.get(), email: email.get(), password: pw.get() } });
      }
      const r = await call('/login', { method: 'POST', body: { email: email.get(), password: pw.get() } });
      state.admin = r.admin; await start();
    } catch (e) { msg.textContent = errorText(e); }
  }
  shell(h('div', { class: 'top' }, h('h1', null, t('title')), langButton(() => authScreen({ setup, tokenMissing }))),
    h('section', { class: 'box narrow' }, h('h2', null, setup ? t('setup') : t('login')),
      tokenMissing ? h('p', { class: 'err' }, t('setup_missing')) : null, setup ? h('p', { class: 'hint' }, t('setup_help')) : null,
      setup ? token.el : null, email.el, pw.el, setup ? pw2.el : null, msg,
      tokenMissing ? null : h('button', { class: 'btn wide', type: 'button', onClick: submit }, setup ? t('setup') : t('login'))));
}

function accountView() {
  const cur = fields.text(t('current_password'), '', { dir: 'ltr' }); const n1 = fields.text(t('new_password'), '', { dir: 'ltr' }); const n2 = fields.text(t('repeat_password'), '', { dir: 'ltr' });
  for (const f of [cur, n1, n2]) f.el.children[1].setAttribute('type', 'password');
  const msg = h('div', { class: 'err' });
  return h('div', null, h('h2', null, t('tab_account')), h('p', { class: 'hint' }, state.admin.email),
    h('section', { class: 'box narrow' }, h('h3', null, t('change_password')), cur.el, n1.el, n2.el, msg,
      h('button', { class: 'btn', type: 'button', onClick: async () => {
        msg.textContent = '';
        if (n1.get().length < 10) { msg.textContent = t('err_pw_short'); return; }
        if (n1.get() !== n2.get()) { msg.textContent = t('err_pw_match'); return; }
        try { await call('/change-password', { method: 'POST', body: { current_password: cur.get(), new_password: n1.get() } }); toast(t('saved')); for (const f of [cur, n1, n2]) f.el.children[1].value = ''; } catch (e) { msg.textContent = errorText(e); }
      } }, t('save'))));
}

async function reload() { state.data = await call('/bootstrap'); draw(); }

function draw() {
  const content = h('main', { class: 'content', id: 'tab-content' });
  const views = {
    orders: () => renderOrders(content), menu: () => renderMenu(content, reload),
    store: () => clear(content, renderStore()), brand: () => clear(content, renderBrand()), content: () => clear(content, renderContent()),
    whatsapp: () => clear(content, renderWhatsapp()), texts: () => clear(content, renderTexts()), account: () => clear(content, accountView()),
  };
  const label = (k) => t(`tab_${k}`);
  shell(
    h('div', { class: 'top' }, h('h1', null, `${t('title')}`),
      langButton(draw), h('button', { class: 'lang', type: 'button', onClick: async () => { try { await call('/logout', { method: 'POST' }); } catch (_) { /* ignore */ } state.admin = null; await start(); } }, t('logout'))),
    h('nav', { class: 'tabs' }, TABS.map((k) => h('button', { class: `tab${k === tab ? ' active' : ''}`, type: 'button', dataset: { tab: k }, onClick: () => { tab = k; closeSheet(); draw(); } }, label(k)))),
    content);
  views[tab]();
}

async function start() {
  applyLang();
  let session;
  try { session = await (await fetch('/api/admin/session', { credentials: 'same-origin' })).json(); } catch (_) { clear(root, h('p', { class: 'boot' }, t('err_network'))); return; }
  if (!session.ready) { notReady(); return; }
  if (!session.admin) { authScreen({ setup: !!session.setup_available, tokenMissing: !!session.setup_token_missing }); return; }
  state.admin = session.admin;
  try { state.data = await call('/bootstrap'); } catch (e) { if (e instanceof CallError && e.status === 503) { notReady(); return; } authScreen({ setup: false }); return; }
  draw();
}

state.onUnauthorized = () => { state.admin = null; authScreen({ setup: false }); };
export const ready = start();
export { state };
