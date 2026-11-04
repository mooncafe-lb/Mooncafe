import { h, clear, t, call, toast, errorText, fields, sheet, closeSheet, confirmDialog, imagePicker, state } from './core.js';

const nm = (o) => (state.lang === 'ar' ? o.name_ar : o.name_en) || o.name_en || o.name_ar || '';
const money = (n) => Number(n).toLocaleString('en-US');

function priceSummary(p) {
  const prices = p.sizes.map((s) => (s.price_lbp == null ? t('no_price') : money(s.price_lbp)));
  return prices.join(' / ');
}

function errorLines(err) {
  const e = err && err.body && err.body.errors;
  return e ? Object.entries(e).map(([k, v]) => `${k}: ${v}`).join(' · ') : '';
}

export function renderMenu(container, reload) {
  const cats = state.data.categories;
  const move = async (table, ids, index, delta, extra = {}) => {
    const next = [...ids]; const j = index + delta;
    if (j < 0 || j >= next.length) return;
    [next[index], next[j]] = [next[j], next[index]];
    try { await call(`/${table}/reorder`, { method: 'POST', body: { ids: next, ...extra } }); await reload(); } catch (e) { toast(errorText(e), true); }
  };

  const productRow = (cat, p, i) => h('div', { class: 'list-row', dataset: { product: String(p.id) } },
    h('img', { class: 'thumb sm', alt: '', src: p.thumb_url || '/assets/favicon.png' }),
    h('div', { class: 'grow' }, h('b', null, nm(p)), h('small', { class: 'hint' }, priceSummary(p)),
      h('div', { class: 'badges' }, !p.is_visible ? h('span', { class: 'badge' }, t('visible') + ' ✗') : null, !p.is_available ? h('span', { class: 'badge warn' }, t('sold_out')) : null,
        p.sizes.some((s) => s.price_lbp == null) ? h('span', { class: 'badge warn' }, t('no_price')) : null)),
    h('div', { class: 'actions' },
      h('button', { class: 'link', type: 'button', 'aria-label': t('up'), onClick: () => move('products', cat.products.map((x) => x.id), i, -1, { category_id: cat.id }) }, '↑'),
      h('button', { class: 'link', type: 'button', 'aria-label': t('down'), onClick: () => move('products', cat.products.map((x) => x.id), i, 1, { category_id: cat.id }) }, '↓'),
      h('button', { class: 'btn small ghost', type: 'button', onClick: () => productEditor(p, cat.id, reload) }, t('edit'))));

  const catBlock = (cat, i) => h('section', { class: 'box', dataset: { category: String(cat.id) } },
    h('div', { class: 'row' },
      h('h3', null, nm(cat), !cat.is_visible ? h('span', { class: 'badge' }, ' ✗') : null),
      h('div', { class: 'actions' },
        h('button', { class: 'link', type: 'button', 'aria-label': t('up'), onClick: () => move('categories', cats.map((x) => x.id), i, -1) }, '↑'),
        h('button', { class: 'link', type: 'button', 'aria-label': t('down'), onClick: () => move('categories', cats.map((x) => x.id), i, 1) }, '↓'),
        h('button', { class: 'btn small ghost', type: 'button', onClick: () => categoryEditor(cat, reload) }, t('edit')),
        h('button', { class: 'btn small', type: 'button', onClick: () => productEditor(null, cat.id, reload) }, `+ ${t('add_product')}`))),
    cat.products.length ? cat.products.map((p, idx) => productRow(cat, p, idx)) : h('p', { class: 'hint' }, t('empty')));

  clear(container,
    h('div', { class: 'row' }, h('h2', null, t('tab_menu')), h('button', { class: 'btn', type: 'button', onClick: () => categoryEditor(null, reload) }, `+ ${t('add_category')}`)),
    h('p', { class: 'hint' }, t('price_soon_note')),
    cats.map(catBlock));
}

function categoryEditor(cat, reload) {
  sheet(cat ? t('edit') : t('add_category'), (body, close) => {
    const f = {
      name_ar: fields.text(t('name_ar'), cat && cat.name_ar, { max: 120 }), name_en: fields.text(t('name_en'), cat && cat.name_en, { max: 120, dir: 'ltr' }),
      visible: fields.bool(t('visible'), cat ? cat.is_visible : true), image: imagePicker(t('image'), cat && cat.image_id),
    };
    const msg = h('div', { class: 'err' });
    const save = async () => {
      const payload = { name_ar: f.name_ar.get(), name_en: f.name_en.get(), is_visible: f.visible.get(), image_id: f.image.get() };
      try { await call(cat ? `/categories/${cat.id}` : '/categories', { method: cat ? 'PUT' : 'POST', body: payload }); toast(t('saved')); close(); await reload(); } catch (e) { msg.textContent = `${errorText(e)} ${errorLines(e)}`; }
    };
    const del = async () => {
      if (!confirmDialog(t('yes_delete'))) return;
      try { await call(`/categories/${cat.id}`, { method: 'DELETE' }); }
      catch (e) {
        if (e.status === 409 && e.body.error === 'category_not_empty') {
          if (!confirmDialog(t('delete_category_force', { n: e.body.products }))) return;
          try { await call(`/categories/${cat.id}?force=1`, { method: 'DELETE' }); } catch (e2) { msg.textContent = errorText(e2); return; }
        } else { msg.textContent = errorText(e); return; }
      }
      toast(t('deleted')); close(); await reload();
    };
    body.appendChild(h('div', null, f.name_ar.el, f.name_en.el, f.visible.el, f.image.el, msg,
      h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onClick: save }, t('save')), cat ? h('button', { class: 'btn ghost', type: 'button', onClick: del }, t('delete')) : null)));
  });
}

function productEditor(product, categoryId, reload) {
  sheet(product ? nm(product) : t('add_product'), (body, close) => {
    const cats = state.data.categories;
    const f = {
      category: fields.select(t('category'), String(product ? product.category_id : categoryId), cats.map((c) => ({ value: String(c.id), label: nm(c) }))),
      name_ar: fields.text(t('name_ar'), product && product.name_ar, { max: 120 }), name_en: fields.text(t('name_en'), product && product.name_en, { max: 120, dir: 'ltr' }),
      desc_ar: fields.area(t('desc_ar'), product && product.description_ar, { max: 500 }), desc_en: fields.area(t('desc_en'), product && product.description_en, { max: 500, dir: 'ltr' }),
      visible: fields.bool(t('visible'), product ? product.is_visible : true), soldOut: fields.bool(t('sold_out'), product ? !product.is_available : false),
      image: imagePicker(t('image'), product && product.image_id),
    };

    // ---- sizes
    const sizeRows = (product ? product.sizes : [{ name_ar: 'عادي', name_en: 'Regular', price_lbp: null, is_available: true }]).map(makeSize);
    const sizesBox = h('div');
    function makeSize(s) {
      const row = { id: s.id, f: {
        name_ar: fields.text(t('size_name_ar'), s.name_ar, { max: 60 }), name_en: fields.text(t('size_name_en'), s.name_en, { max: 60, dir: 'ltr' }),
        price: fields.number(t('price'), s.price_lbp, { min: 1, placeholder: t('price_unset') }), available: fields.bool(t('available'), s.is_available !== false),
      } };
      row.el = h('div', { class: 'subbox', dataset: { size: '1' } }, h('div', { class: 'grid2' }, row.f.name_ar.el, row.f.name_en.el, row.f.price.el, row.f.available.el),
        h('button', { class: 'link', type: 'button', onClick: () => { sizeRows.splice(sizeRows.indexOf(row), 1); drawSizes(); } }, t('delete')));
      return row;
    }
    const drawSizes = () => clear(sizesBox, sizeRows.map((r) => r.el));
    drawSizes();

    // ---- option groups
    const groupRows = (product ? product.groups : []).map(makeGroup);
    const groupsBox = h('div');
    function makeChoice(c, parent) {
      const row = { id: c.id, f: { name_ar: fields.text(t('choice_ar'), c.name_ar, { max: 60 }), name_en: fields.text(t('choice_en'), c.name_en, { max: 60, dir: 'ltr' }),
        delta: fields.number(t('extra_price'), c.price_delta_lbp || 0, { min: 0 }), available: fields.bool(t('available'), c.is_available !== false) } };
      row.el = h('div', { class: 'subbox inner', dataset: { choice: '1' } }, h('div', { class: 'grid2' }, row.f.name_ar.el, row.f.name_en.el, row.f.delta.el, row.f.available.el),
        h('button', { class: 'link', type: 'button', onClick: () => { parent.choices.splice(parent.choices.indexOf(row), 1); parent.draw(); } }, t('delete')));
      return row;
    }
    function makeGroup(g) {
      const row = { id: g.id, choices: [], f: {
        name_ar: fields.text(t('group_name_ar'), g.name_ar, { max: 60 }), name_en: fields.text(t('group_name_en'), g.name_en, { max: 60, dir: 'ltr' }),
        selection: fields.select(t('selection'), g.selection || 'single', [{ value: 'single', label: t('single') }, { value: 'multiple', label: t('multiple') }]),
        required: fields.bool(t('required'), g.is_required !== undefined ? g.is_required : g.required), max: fields.number(t('max_choices'), g.max_choices, { min: 1 }),
      } };
      const box = h('div');
      row.draw = () => clear(box, row.choices.map((c) => c.el));
      row.choices = (g.choices || []).map((c) => makeChoice(c, row));
      row.draw();
      row.el = h('div', { class: 'subbox', dataset: { group: '1' } }, h('div', { class: 'grid2' }, row.f.name_ar.el, row.f.name_en.el, row.f.selection.el, row.f.max.el), row.f.required.el, box,
        h('div', { class: 'row' }, h('button', { class: 'btn small ghost', type: 'button', onClick: () => { row.choices.push(makeChoice({ name_ar: '', name_en: '', price_delta_lbp: 0 }, row)); row.draw(); } }, `+ ${t('add_choice')}`),
          h('button', { class: 'link', type: 'button', onClick: () => { groupRows.splice(groupRows.indexOf(row), 1); drawGroups(); } }, t('delete'))));
      return row;
    }
    const drawGroups = () => clear(groupsBox, groupRows.map((r) => r.el));
    drawGroups();

    const msg = h('div', { class: 'err' });
    const save = async () => {
      const payload = {
        category_id: Number(f.category.get()), name_ar: f.name_ar.get(), name_en: f.name_en.get(), description_ar: f.desc_ar.get(), description_en: f.desc_en.get(),
        image_id: f.image.get(), is_visible: f.visible.get(), is_available: !f.soldOut.get(),
        sizes: sizeRows.map((r) => ({ id: r.id, name_ar: r.f.name_ar.get(), name_en: r.f.name_en.get(), price_lbp: r.f.price.get(), is_available: r.f.available.get() })),
        groups: groupRows.map((g) => ({
          id: g.id, name_ar: g.f.name_ar.get(), name_en: g.f.name_en.get(), selection: g.f.selection.get(), is_required: g.f.required.get(), max_choices: g.f.max.get(),
          choices: g.choices.map((c) => ({ id: c.id, name_ar: c.f.name_ar.get(), name_en: c.f.name_en.get(), price_delta_lbp: c.f.delta.get() || 0, is_available: c.f.available.get() })),
        })),
      };
      try { await call(product ? `/products/${product.id}` : '/products', { method: product ? 'PUT' : 'POST', body: payload }); toast(t('saved')); close(); await reload(); }
      catch (e) { msg.textContent = `${errorText(e)} ${errorLines(e)}`; }
    };
    const del = async () => {
      if (!confirmDialog(t('yes_delete'))) return;
      try { await call(`/products/${product.id}`, { method: 'DELETE' }); toast(t('deleted')); close(); await reload(); } catch (e) { msg.textContent = errorText(e); }
    };

    body.appendChild(h('div', null,
      f.category.el, h('div', { class: 'grid2' }, f.name_ar.el, f.name_en.el), h('div', { class: 'grid2' }, f.desc_ar.el, f.desc_en.el), f.image.el,
      h('div', { class: 'grid2' }, f.visible.el, f.soldOut.el),
      h('h3', null, t('sizes')), sizesBox, h('button', { class: 'btn small ghost', type: 'button', onClick: () => { sizeRows.push(makeSize({ name_ar: '', name_en: '', price_lbp: null })); drawSizes(); } }, `+ ${t('add_size')}`),
      h('h3', null, t('groups')), groupsBox,
      h('button', { class: 'btn small ghost', type: 'button', onClick: () => { groupRows.push(makeGroup({ name_ar: '', name_en: '', selection: 'single', is_required: false, choices: [] })); drawGroups(); } }, `+ ${t('add_group')}`),
      msg,
      h('div', { class: 'row sticky' }, h('button', { class: 'btn', type: 'button', onClick: save }, t('save')), product ? h('button', { class: 'btn ghost', type: 'button', onClick: del }, t('delete')) : null)));
  });
}

export { closeSheet };
