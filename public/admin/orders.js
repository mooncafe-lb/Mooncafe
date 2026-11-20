import { h, clear, t, call, toast, errorText, fields, sheet, state, has } from './core.js';

const money = (n) => Number(n).toLocaleString('en-US');
const nm = (o, f = 'name') => o[`${f}_${state.lang}`] || o[`${f}_en`] || o[`${f}_ar`] || '';
const statusText = (s) => t('order_status')[s] || s;
const stampText = (p) => (p ? `${p.date} ${state.lang === 'ar' ? p.time_ar : p.time_en}` : '');
const atText = (a) => (a ? `${a.date} ${state.lang === 'ar' ? a.time_ar : a.time_en}` : '');

// "#3" for orders with a daily number, the old reference for older orders
export const orderLabel = (o) => (o.daily_number ? `#${o.daily_number}` : (o.public_code || ''));

// One line of the order's activity log, e.g. "Received by Ahmad" with the time in front.
export function eventText(e) {
  const vars = { actor: e.actor_name || t('none'), target: e.target_name || t('none'), status: statusText(e.status) };
  const first = e.event === 'status' && e.status === 'whatsapp_prepared' && !e.changed_by && !e.actor_name;
  if (e.event === 'created' || first) return t('ev_created');
  return t(`ev_${e.event}`, vars);
}

export function renderOrders(container) {
  let status = ''; let scope = ''; let q = ''; let day = ''; let offset = 0; const limit = 20; let list = []; let total = 0; let timer = null;
  const listEl = h('div'); const moreEl = h('div');
  const filter = fields.select(t('status'), '', [{ value: '', label: t('all') }, ...state.data.order_statuses.map((s) => ({ value: s, label: statusText(s) }))]);
  const scopeSel = fields.select('', '', [{ value: '', label: t('all') }, { value: 'me', label: t('my_orders') }, { value: 'none', label: t('only_unassigned') }]);
  filter.el.children[1].addEventListener('change', () => { status = filter.get(); load(true); });
  scopeSel.el.children[0].addEventListener('change', () => { scope = scopeSel.get(); load(true); });
  const search = h('input', { class: 'input', type: 'search', placeholder: t('search_orders'), 'aria-label': t('search_orders'), id: 'order-search' });
  search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => { q = search.value.trim(); load(true); }, 250); });
  const dateInput = h('input', { class: 'input', type: 'date', 'aria-label': t('filter_date'), id: 'order-day' });
  dateInput.addEventListener('change', () => { day = dateInput.value; load(true); });

  const row = (o) => h('button', { class: 'list-row order-row', type: 'button', dataset: { order: String(o.id) }, onClick: () => openOrder(o.id) },
    h('div', { class: 'grow' }, h('b', { class: 'row-number', dir: 'ltr' }, orderLabel(o)), h('span', { class: 'hint' }, ` · ${o.customer_name}`),
      h('small', { class: 'hint row-when' }, `${o.fulfillment === 'delivery' ? t('delivery') : t('pickup')} · ${stampText(o.placed)}`),
      h('small', { class: `hint responsible${o.assigned_name ? ' on' : ''}` }, o.assigned_name ? `${t('responsible')}: ${o.assigned_name}` : t('unassigned'))),
    h('div', null, h('div', { class: `badge st-${o.status}` }, statusText(o.status)), h('b', null, money(o.total_lbp))));

  async function load(reset) {
    if (reset) { offset = 0; list = []; }
    try {
      const params = `limit=${limit}&offset=${offset}${status ? `&status=${status}` : ''}${scope ? `&assigned=${scope}` : ''}${q ? `&q=${encodeURIComponent(q)}` : ''}${day ? `&date=${day}` : ''}`;
      const res = await call(`/orders?${params}`);
      list = list.concat(res.orders); total = res.total; offset = list.length;
      clear(listEl, list.length ? list.map(row) : h('p', { class: 'hint' }, t('empty')));
      clear(moreEl, list.length < total ? h('button', { class: 'btn ghost', type: 'button', onClick: () => load(false) }, t('more')) : null);
    } catch (e) { toast(errorText(e), true); }
  }

  async function openOrder(id) {
    let data; let team = [];
    try {
      data = await call(`/orders/${id}`);
      if (has('orders.assign')) team = (await call('/users')).users.filter((u) => u.is_active);
    } catch (e) { toast(errorText(e), true); return; }
    const { order, items, history } = data;
    const mine = order.assigned_to === state.admin.id;
    const closed = ['completed', 'cancelled'].includes(order.status);
    const canStatus = has('orders.update') || (has('orders.update_own') && mine);
    const flow = state.data.order_flows[order.fulfillment];                      // pickup and delivery have different stages
    const trackUrl = order.tracking_path ? `${(window.location && window.location.origin) || ''}${order.tracking_path}` : '';
    sheet(`${t('order_number')} ${orderLabel(order)}`, (body, close) => {
      const act = (fn) => async () => { try { await fn(); toast(t('saved')); close(); await load(true); } catch (e) { toast(errorText(e), true); } };
      const note = fields.text(t('note'), '', { max: 300 });
      const statusButtons = flow.map((s) => h('button', {
        class: `btn small${s === order.status ? '' : ' ghost'}`, type: 'button', dataset: { status: s }, disabled: s === order.status || !canStatus,
        onClick: act(() => call(`/orders/${id}/status`, { method: 'PUT', body: { status: s, note: note.get() } })),
      }, statusText(s)));
      const assignSel = has('orders.assign') ? fields.select(t('assign'), '', [{ value: '', label: t('none') }, ...team.map((u) => ({ value: String(u.id), label: `${u.name} (${t('roles')[u.role]})` }))]) : null;
      const copy = async (btn) => { try { await navigator.clipboard.writeText(trackUrl); btn.textContent = t('copied'); } catch (_) { /* no clipboard */ } };
      body.appendChild(h('div', null,
        h('div', { class: 'order-id' }, h('b', { class: 'order-number', dir: 'ltr' }, orderLabel(order)), order.daily_number ? '' : h('small', { class: 'hint' }, ` ${t('old_order')}`),
          h('div', { class: 'order-when' }, `${t('order_when')}: `, h('b', { dir: 'ltr' }, stampText(order.placed)))),
        trackUrl ? h('div', { class: 'chips track-actions' }, h('a', { class: 'btn small', href: trackUrl, target: '_blank', rel: 'noopener', id: 'open-tracking' }, t('open_tracking')),
          h('button', { class: 'btn small ghost', type: 'button', onClick: (e) => copy(e.currentTarget || e.target) }, t('copy_link'))) : null,
        h('p', { class: 'responsible-line' }, h('b', null, `${t('responsible')}: `), order.assigned_name || t('unassigned'),
          order.assigned_at ? h('small', { class: 'hint' }, ` · ${t('assigned_since')} ${stampText(order.assigned)}`) : null),
        h('div', { class: 'chips' },
          !order.assigned_to && !closed && has('orders.claim') ? h('button', { class: 'btn', type: 'button', dataset: { act: 'claim' }, onClick: act(() => call(`/orders/${id}/claim`, { method: 'POST' })) }, t('claim')) : null,
          order.assigned_to && (has('orders.release') || (mine && has('orders.release_own'))) ? h('button', { class: 'btn ghost small', type: 'button', dataset: { act: 'release' }, onClick: act(() => call(`/orders/${id}/release`, { method: 'POST' })) }, t('release')) : null),
        assignSel ? h('div', { class: 'row' }, h('div', { class: 'grow' }, assignSel.el),
          h('button', { class: 'btn small', type: 'button', dataset: { act: 'assign' }, onClick: act(async () => { if (!assignSel.get()) throw new Error('none'); await call(`/orders/${id}/assign`, { method: 'POST', body: { admin_id: Number(assignSel.get()) } }); }) }, t('save'))) : null,
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
        order.rating ? h('p', { class: 'rating-line' }, h('b', null, `${t('rating')}: `), '★'.repeat(order.rating), order.rating_comment ? ` — ${order.rating_comment}` : '') : null,
        h('h3', null, t('set_status')), note.el, h('div', { class: 'chips' }, statusButtons),
        h('h3', null, t('activity_log')),
        h('ol', { class: 'log' }, history.map((e) => h('li', { class: `log-row ev-${e.event}` }, h('time', null, atText(e.at)), h('span', null, ` — ${eventText(e)}`), e.note ? h('small', { class: 'hint' }, ` (${e.note})`) : null))),
        order.whatsapp_message ? h('details', null, h('summary', null, t('copy_msg')), h('pre', { class: 'msg', dir: 'auto' }, order.whatsapp_message)) : null));
    });
  }

  clear(container, h('h2', null, t('tab_orders')),
    h('div', { class: 'grid2' }, h('div', { class: 'field' }, search), h('div', { class: 'field' }, dateInput)),
    h('div', { class: 'grid2' }, filter.el, h('div', { class: 'field' }, h('label', null, ' '), scopeSel.el.children[0])), listEl, moreEl);
  load(true);
}
