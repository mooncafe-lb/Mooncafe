import { h, clear } from './h.js';
import { api, ApiError } from './api.js';
import { buildLine, MAX_QTY } from './cart.js';

const uuid = () => (globalThis.crypto && crypto.randomUUID ? crypto.randomUUID()
  : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3) | 8).toString(16); }));

// Product sheet, tray sheet and checkout. ctx comes from app.js.
export function createSheets(ctx) {
  const { state, i18n, cart, tray, placeholder } = ctx;
  const t = (k, v) => i18n.t(k, v);
  let current = null;

  function closeSheet() {
    if (!current) return;
    current.backdrop.remove();
    document.body.style.overflow = '';
    document.removeEventListener('keydown', current.onKey);
    current = null;
  }

  // render(sheet) returns the sheet content; call current.render() to redraw
  function showSheet(kind, render) {
    closeSheet();
    const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true' });
    const backdrop = h('div', { class: 'backdrop', onClick: (e) => { if (e.target === backdrop) closeSheet(); } }, sheet);
    const onKey = (e) => { if (e.key === 'Escape') closeSheet(); };
    document.addEventListener('keydown', onKey);
    document.body.appendChild(backdrop);
    document.body.style.overflow = 'hidden';
    current = { kind, backdrop, sheet, onKey, render: () => clear(sheet, render()) };
    current.render();
    return current;
  }

  const head = (title) => h('div', { class: 'sheet-head' }, h('h2', null, title),
    h('button', { class: 'x', type: 'button', 'aria-label': t('close'), onClick: closeSheet }, '×'));

  const stepper = (qty, onChange) => h('div', { class: 'stepper' },
    h('button', { type: 'button', 'aria-label': t('decrease'), onClick: () => onChange(qty - 1) }, '−'),
    h('span', null, String(qty)),
    h('button', { type: 'button', 'aria-label': t('increase'), onClick: () => onChange(Math.min(MAX_QTY, qty + 1)) }, '+'));

  const lineDetails = (l) => [
    l.options.length ? h('small', null, l.options.map((o) => i18n.name(o)).join(i18n.lang === 'ar' ? '، ' : ', ')) : null,
    l.instructions ? h('small', null, l.instructions) : null,
  ];

  // ---------------------------------------------------------------- product
  function openProduct(product) {
    const firstSize = product.sizes.find((s) => s.price_lbp != null) || product.sizes[0];
    const pick = { sizeId: firstSize && firstSize.id, chosen: new Set(), notes: '', qty: 1, invalid: new Set() };
    let imgEl = null;

    const selectedSize = () => product.sizes.find((s) => s.id === pick.sizeId);
    const unitPrice = () => {
      const size = selectedSize();
      if (!size || size.price_lbp == null) return null;
      let extra = 0;
      for (const g of product.groups) for (const c of g.choices) if (pick.chosen.has(c.id)) extra += c.price_delta_lbp;
      return size.price_lbp + extra;
    };

    function toggleChoice(group, choice) {
      pick.invalid.delete(group.id);
      if (group.selection === 'single') {
        const had = pick.chosen.has(choice.id);
        for (const c of group.choices) pick.chosen.delete(c.id);
        if (!had || group.required) pick.chosen.add(choice.id);
      } else if (pick.chosen.has(choice.id)) pick.chosen.delete(choice.id);
      else {
        const count = group.choices.filter((c) => pick.chosen.has(c.id)).length;
        if (!group.max_choices || count < group.max_choices) pick.chosen.add(choice.id);
      }
      sheet.render();
    }

    async function add() {
      pick.invalid = new Set(product.groups.filter((g) => g.required && !g.choices.some((c) => pick.chosen.has(c.id))).map((g) => g.id));
      if (pick.invalid.size) { sheet.render(); return; }
      const line = buildLine(product, pick.sizeId, [...pick.chosen], pick.notes, pick.qty);
      if (!line) return;
      const from = imgEl && imgEl.getBoundingClientRect();
      closeSheet();
      await tray.fly(from, product.thumb_url);
      cart.add(line);
      tray.pop(line.key);
    }

    const sheet = showSheet('product', () => {
      const ok = ctx.canOrder();
      const unit = unitPrice();
      imgEl = h('div', { class: 'sheet-img' }, h('img', { src: product.image_url || placeholder, alt: i18n.name(product) }));
      return [
        head(i18n.name(product)),
        imgEl,
        i18n.name(product, 'description') ? h('p', { class: 'card-desc', style: { display: 'block' } }, i18n.name(product, 'description')) : null,
        product.sizes.length > 1 || (product.sizes[0] && product.sizes[0].price_lbp == null) ? h('div', { class: 'group' },
          h('div', { class: 'group-title' }, t('choose_size')),
          h('div', { class: 'chips' }, product.sizes.map((s) => h('button', {
            class: 'chip', type: 'button', 'aria-pressed': s.id === pick.sizeId ? 'true' : 'false', disabled: s.price_lbp == null,
            onClick: () => { pick.sizeId = s.id; sheet.render(); },
          }, i18n.name(s), h('small', null, s.price_lbp == null ? t('price_soon') : i18n.money(s.price_lbp)))))) : null,
        product.groups.map((g) => h('div', { class: `group${pick.invalid.has(g.id) ? ' invalid' : ''}` },
          h('div', { class: 'group-title' }, i18n.name(g),
            h('small', null, g.required ? t('required') : (g.selection === 'multiple' && g.max_choices ? t('pick_up_to', { n: g.max_choices }) : t('optional')))),
          h('div', { class: 'chips' }, g.choices.map((c) => h('button', {
            class: 'chip', type: 'button', 'aria-pressed': pick.chosen.has(c.id) ? 'true' : 'false', onClick: () => toggleChoice(g, c),
          }, i18n.name(c), c.price_delta_lbp ? h('small', null, `+ ${i18n.money(c.price_delta_lbp)}`) : null))),
          pick.invalid.has(g.id) ? h('div', { class: 'err' }, t('pick_required', { group: i18n.name(g) })) : null)),
        h('div', { class: 'field' }, h('label', { for: 'p-notes' }, t('notes_label')),
          h('textarea', { id: 'p-notes', class: 'input', maxlength: '200', placeholder: t('notes_placeholder'), value: pick.notes, onInput: (e) => { pick.notes = e.target.value; } })),
        h('div', { class: 'row', style: { marginBlock: '14px' } }, h('span', { class: 'label' }, t('quantity')), stepper(pick.qty, (q) => { pick.qty = Math.max(1, q); sheet.render(); })),
        !ok ? h('div', { class: 'banner-msg' }, ctx.closedReason()) : null,
        h('button', { class: 'btn wide', type: 'button', disabled: !ok || unit == null, onClick: add },
          unit == null ? t('price_soon') : t('add_for', { total: i18n.money(unit * pick.qty) })),
      ];
    });
  }

  // ------------------------------------------------------------------- tray
  function openTray() {
    const sheet = showSheet('tray', () => {
      const items = cart.items();
      const ok = ctx.canOrder();
      return [
        head(t('tray_title')),
        items.length ? items.map((l) => h('div', { class: 'line' },
          h('div', { class: 'cup' }, h('div', { class: 'cup-in' }, h('img', { src: l.thumb_url || placeholder, alt: '' }))),
          h('div', { class: 'line-main' }, h('b', null, `${i18n.name(l)}${i18n.name(l, 'size') ? ` · ${i18n.name(l, 'size')}` : ''}`), lineDetails(l), h('small', null, i18n.money(l.unit_price))),
          h('div', null, stepper(l.qty, (q) => cart.setQty(l.key, q)), h('button', { class: 'link', type: 'button', onClick: () => cart.remove(l.key) }, t('remove')))))
          : h('p', { class: 'state' }, t('tray_empty')),
        items.length ? h('div', { class: 'sum' }, h('div', { class: 'row big' }, h('span', null, t('subtotal')), h('span', null, i18n.money(cart.subtotal())))) : null,
        items.length && !ok ? h('div', { class: 'banner-msg' }, ctx.closedReason()) : null,
        items.length ? h('button', { class: 'btn wide', type: 'button', disabled: !ok, onClick: () => openCheckout() }, t('checkout')) : null,
        items.length ? h('div', { style: { textAlign: 'center' } }, h('button', { class: 'link', type: 'button', onClick: () => cart.clear() }, t('clear_tray'))) : null,
      ];
    });
    return sheet;
  }

  // --------------------------------------------------------------- checkout
  const saved = ctx.loadCustomer();
  const form = { fulfillment: 'pickup', name: saved.name || '', phone: saved.phone || '', address: saved.address || '', notes: '', lat: null, lng: null, errors: {}, busy: false, message: '', requestId: uuid(), done: null, locating: false, located: false };

  function validate() {
    const e = {};
    if (form.name.trim().length < 2) e.name = t('err_required');
    const digits = form.phone.replace(/\D/g, '');
    if (!digits) e.phone = t('err_required'); else if (digits.length < 7) e.phone = t('err_phone');
    if (form.fulfillment === 'delivery' && form.address.trim().length < 5) e.address = t('err_required');
    return e;
  }

  function locate(sheet) {
    if (!navigator.geolocation) { form.message = t('location_failed'); sheet.render(); return; }
    form.locating = true; sheet.render();
    navigator.geolocation.getCurrentPosition(
      (pos) => { form.lat = Number(pos.coords.latitude.toFixed(6)); form.lng = Number(pos.coords.longitude.toFixed(6)); form.located = true; form.locating = false; form.message = ''; sheet.render(); },
      () => { form.locating = false; form.message = t('location_failed'); sheet.render(); },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
  }

  async function submit(sheet) {
    form.errors = validate();
    form.message = '';
    if (Object.keys(form.errors).length) { form.message = t('err_validation'); sheet.render(); return; }
    form.busy = true; sheet.render();
    try {
      const body = {
        request_id: form.requestId, lang: i18n.lang, customer_name: form.name.trim(), phone: form.phone.trim(), fulfillment: form.fulfillment,
        address: form.fulfillment === 'delivery' ? form.address.trim() : '', notes: form.notes.trim(), items: cart.orderItems(),
      };
      if (form.fulfillment === 'delivery' && form.lat !== null) { body.latitude = form.lat; body.longitude = form.lng; }
      const res = await api('/api/orders', { method: 'POST', body });
      ctx.saveCustomer({ name: form.name.trim(), phone: form.phone.trim(), address: form.address.trim() });
      cart.clear();
      form.done = res; form.busy = false; form.requestId = uuid();
      sheet.render();
      if (res.whatsapp_url) window.location.href = res.whatsapp_url;
    } catch (err) {
      form.busy = false;
      const body = (err instanceof ApiError && err.body) || {};
      if (err.status === 0) form.message = t('err_network');
      else if (err.status === 409 && body.error === 'store_closed') { form.message = t('err_closed'); ctx.refreshStore(); }
      else if (err.status === 409 && body.error === 'ordering_disabled') form.message = t('err_ordering_disabled');
      else if (err.status === 409 && (body.error === 'delivery_disabled' || body.error === 'pickup_disabled')) form.message = t(body.error === 'delivery_disabled' ? 'delivery_off' : 'pickup_off');
      else if (err.status === 422 && body.error === 'invalid_items') { form.message = t('err_items'); await ctx.reloadMenu(); }
      else if (err.status === 422 && body.error === 'below_minimum') form.message = t('min_order', { amount: i18n.money(body.min_order_lbp) });
      else if (err.status === 400 && body.error === 'validation') {
        const m = body.errors || {};
        form.errors = { name: m.customer_name && t('err_required'), phone: m.phone && t('err_phone'), address: m.address && t('err_required') };
        form.message = t('err_validation');
      } else if (err.status === 503) form.message = t('err_not_ready');
      else form.message = t('err_generic');
      sheet.render();
    }
  }

  function openCheckout() {
    const d = state.store.delivery;
    if (form.fulfillment === 'delivery' && !d.delivery_enabled) form.fulfillment = 'pickup';
    if (form.fulfillment === 'pickup' && !d.pickup_enabled && d.delivery_enabled) form.fulfillment = 'delivery';
    form.done = null; form.message = ''; form.errors = {};
    ctx.refreshStore();
    const sheet = showSheet('checkout', () => {
      if (form.done) {
        return [head(t('sent_title')), h('div', { class: 'done' },
          h('p', null, t('sent_text')), h('p', { class: 'label' }, t('order_code')), h('div', { class: 'code' }, form.done.order.code),
          h('p', null, i18n.money(form.done.order.total_lbp)),
          form.done.whatsapp_url ? h('a', { class: 'btn wide', href: form.done.whatsapp_url, target: '_blank', rel: 'noopener' }, t('open_whatsapp')) : null,
          h('p', null, h('button', { class: 'link', type: 'button', onClick: closeSheet }, t('new_order'))))];
      }
      const isDelivery = form.fulfillment === 'delivery';
      const fee = isDelivery ? d.delivery_fee_lbp : 0;
      const sub = cart.subtotal();
      const belowMin = d.min_order_lbp > 0 && sub < d.min_order_lbp;
      const field = (key, label, input, hint) => h('div', { class: `field${form.errors[key] ? ' invalid' : ''}` }, h('label', { for: `c-${key}` }, label), input, hint || null, form.errors[key] ? h('div', { class: 'err' }, form.errors[key]) : null);
      return [
        head(t('checkout_title')),
        h('div', { class: 'field' }, h('span', { class: 'label' }, t('order_type')), h('div', { class: 'seg' },
          h('button', { class: 'chip', type: 'button', 'aria-pressed': String(!isDelivery), disabled: !d.pickup_enabled, onClick: () => { form.fulfillment = 'pickup'; sheet.render(); } }, t('pickup')),
          h('button', { class: 'chip', type: 'button', 'aria-pressed': String(isDelivery), disabled: !d.delivery_enabled, onClick: () => { form.fulfillment = 'delivery'; sheet.render(); } }, t('delivery')))),
        isDelivery && i18n.name(d, 'note') ? h('p', { class: 'card-desc', style: { display: 'block' } }, i18n.name(d, 'note')) : null,
        field('name', t('full_name'), h('input', { id: 'c-name', class: 'input', autocomplete: 'name', value: form.name, onInput: (e) => { form.name = e.target.value; } })),
        field('phone', t('phone'), h('input', { id: 'c-phone', class: 'input', type: 'tel', inputmode: 'tel', autocomplete: 'tel', dir: 'ltr', value: form.phone, onInput: (e) => { form.phone = e.target.value; } })),
        isDelivery ? field('address', t('address'), h('textarea', { id: 'c-address', class: 'input', placeholder: t('address_hint'), autocomplete: 'street-address', value: form.address, onInput: (e) => { form.address = e.target.value; } })) : null,
        isDelivery ? h('div', { class: 'field' }, h('button', { class: 'btn ghost', type: 'button', disabled: form.locating, onClick: () => locate(sheet) }, form.located ? `✓ ${t('location_set')}` : t('use_location'))) : null,
        field('notes', t('notes'), h('textarea', { id: 'c-notes', class: 'input', maxlength: '500', value: form.notes, onInput: (e) => { form.notes = e.target.value; } })),
        h('div', { class: 'sum' },
          h('div', { class: 'row' }, h('span', null, t('subtotal')), h('span', null, i18n.money(sub))),
          isDelivery ? h('div', { class: 'row' }, h('span', null, t('delivery_fee')), h('span', null, i18n.money(fee))) : null,
          h('div', { class: 'row big' }, h('span', null, t('total')), h('span', null, i18n.money(sub + fee)))),
        belowMin ? h('div', { class: 'banner-msg' }, t('min_order', { amount: i18n.money(d.min_order_lbp) })) : null,
        form.message ? h('div', { class: 'banner-msg' }, form.message) : null,
        !ctx.canOrder() ? h('div', { class: 'banner-msg' }, ctx.closedReason()) : null,
        h('button', { class: 'btn wide', type: 'button', disabled: form.busy || !ctx.canOrder() || belowMin || !cart.count(), onClick: () => submit(sheet) }, form.busy ? t('sending') : t('place_order')),
        h('div', { style: { textAlign: 'center' } }, h('button', { class: 'link', type: 'button', onClick: openTray }, t('back'))),
      ];
    });
  }

  return { openProduct, openTray, openCheckout, closeSheet, current: () => current, rerender: () => current && current.render() };
}
