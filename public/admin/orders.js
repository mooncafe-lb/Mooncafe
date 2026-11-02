import { h, clear, t, call, toast, errorText, fields, sheet, state } from './core.js';

const money = (n) => Number(n).toLocaleString('en-US');
const when = (v) => { const d = new Date(v); return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString(state.lang === 'ar' ? 'ar-LB-u-nu-latn' : 'en-GB'); };
const nm = (o, f = 'name') => o[`${f}_${state.lang}`] || o[`${f}_en`] || o[`${f}_ar`] || '';

export function renderOrders(container) {
  let status = ''; let offset = 0; const limit = 20; let list = []; let total = 0;
  const listEl = h('div'); const moreEl = h('div');
  const filter = fields.select(t('status'), '', [{ value: '', label: t('all') }, ...state.data.order_statuses.map((s) => ({ value: s, label: t('order_status')[s] }))]);
  const select = filter.el.children[1] || filter.el.children[0];
  select.addEventListener('change', () => { status = filter.get(); load(true); });

  const row = (o) => h('button', { class: 'list-row order-row', type: 'button', dataset: { order: String(o.id) }, onClick: () => openOrder(o.id) },
    h('div', { class: 'grow' }, h('b', null, o.public_code), h('span', { class: 'hint' }, ` · ${o.customer_name}`), h('small', { class: 'hint' }, `${o.fulfillment === 'delivery' ? t('delivery') : t('pickup')} · ${when(o.created_at)}`)),
    h('div', null, h('div', { class: `badge st-${o.status}` }, t('order_status')[o.status]), h('b', null, money(o.total_lbp))));

  async function load(reset) {
    if (reset) { offset = 0; list = []; }
    try {
      const res = await call(`/orders?limit=${limit}&offset=${offset}${status ? `&status=${status}` : ''}`);
      list = list.concat(res.orders); total = res.total; offset = list.length;
      clear(listEl, list.length ? list.map(row) : h('p', { class: 'hint' }, t('empty')));
      clear(moreEl, list.length < total ? h('button', { class: 'btn ghost', type: 'button', onClick: () => load(false) }, t('more')) : null);
    } catch (e) { toast(errorText(e), true); }
  }

  async function openOrder(id) {
    let data;
    try { data = await call(`/orders/${id}`); } catch (e) { toast(errorText(e), true); return; }
    const { order, items, history } = data;
    sheet(order.public_code, (body, close) => {
      const note = fields.text(t('note'), '', { max: 300 });
      const buttons = state.data.order_statuses.map((s) => h('button', {
        class: `btn small${s === order.status ? '' : ' ghost'}`, type: 'button', dataset: { status: s }, disabled: s === order.status,
        onClick: async () => { try { await call(`/orders/${id}/status`, { method: 'PUT', body: { status: s, note: note.get() } }); toast(t('saved')); close(); await load(true); } catch (e) { toast(errorText(e), true); } },
      }, t('order_status')[s]));
      body.appendChild(h('div', null,
        h('p', null, h('b', null, order.customer_name), ' · ', h('a', { href: `tel:${order.phone}`, dir: 'ltr' }, order.phone), ' · ', order.fulfillment === 'delivery' ? t('delivery') : t('pickup')),
        order.address ? h('p', null, `${t('address')}: ${order.address}`) : null,
        order.latitude != null ? h('p', null, h('a', { href: `https://maps.google.com/?q=${order.latitude},${order.longitude}`, target: '_blank', rel: 'noopener noreferrer' }, t('map'))) : null,
        order.notes ? h('p', null, `${t('notes')}: ${order.notes}`) : null,
        h('h3', null, t('items')),
        items.map((it) => h('div', { class: 'list-row' }, h('div', { class: 'grow' },
          h('b', null, `${nm(it)}${nm(it, 'size_name') ? ` (${nm(it, 'size_name')})` : ''} × ${it.quantity}`),
          (it.options || []).length ? h('small', { class: 'hint' }, it.options.map((o) => nm(o)).join(', ')) : null,
          it.special_instructions ? h('small', { class: 'hint' }, it.special_instructions) : null), h('b', null, money(it.line_total_lbp)))),
        h('div', { class: 'sum' }, h('div', { class: 'row' }, h('span', null, t('subtotal')), h('span', null, money(order.subtotal_lbp))),
          order.fulfillment === 'delivery' ? h('div', { class: 'row' }, h('span', null, t('delivery_fee')), h('span', null, money(order.delivery_fee_lbp))) : null,
          h('div', { class: 'row big' }, h('span', null, t('total')), h('span', null, money(order.total_lbp)))),
        h('h3', null, t('set_status')), note.el, h('div', { class: 'chips' }, buttons),
        h('h3', null, t('history')), history.map((x) => h('div', { class: 'hint' }, `${when(x.created_at)} · ${t('order_status')[x.status]}${x.note ? ` · ${x.note}` : ''}${x.changed_by_email ? ` · ${x.changed_by_email}` : ''}`)),
        order.whatsapp_message ? h('details', null, h('summary', null, t('copy_msg')), h('pre', { class: 'msg', dir: 'auto' }, order.whatsapp_message)) : null));
    });
  }

  clear(container, h('h2', null, t('tab_orders')), filter.el, listEl, moreEl);
  load(true);
}
