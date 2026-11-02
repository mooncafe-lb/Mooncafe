'use strict';
// Reads the menu from the database. Public output never contains hidden items.
const imageUrl = (id) => (id ? `/api/images/${id}` : null);
const thumbUrl = (id) => (id ? `/api/images/${id}?v=thumb` : null);
const truthy = (v) => v === true || v === 1 || v === 't';

async function loadMenu(db, { admin = false } = {}) {
  const [cats, prods, sizes, groups, choices] = await Promise.all([
    db.query('SELECT * FROM categories ORDER BY sort_order, id'),
    db.query('SELECT * FROM products ORDER BY sort_order, id'),
    db.query('SELECT * FROM product_sizes ORDER BY sort_order, id'),
    db.query('SELECT * FROM option_groups ORDER BY sort_order, id'),
    db.query('SELECT * FROM option_choices ORDER BY sort_order, id'),
  ]);
  const by = (rows, key) => rows.reduce((m, r) => { (m[r[key]] = m[r[key]] || []).push(r); return m; }, {});
  const sizesBy = by(sizes.rows, 'product_id');
  const groupsBy = by(groups.rows, 'product_id');
  const choicesBy = by(choices.rows, 'group_id');
  const prodsBy = by(prods.rows, 'category_id');

  const shapeProduct = (p) => {
    const psizes = (sizesBy[p.id] || []).map((s) => ({
      id: s.id, name_ar: s.name_ar, name_en: s.name_en,
      price_lbp: s.price_lbp == null ? null : Number(s.price_lbp),
      ...(admin ? { is_available: truthy(s.is_available) } : {}),
    }));
    const usable = (sizesBy[p.id] || []).filter((s) => truthy(s.is_available) && s.price_lbp != null);
    const out = {
      id: p.id, name_ar: p.name_ar, name_en: p.name_en,
      description_ar: p.description_ar, description_en: p.description_en,
      image_url: imageUrl(p.image_id), thumb_url: thumbUrl(p.image_id),
      available: truthy(p.is_available),
      orderable: truthy(p.is_available) && usable.length > 0,
      sizes: admin ? psizes : psizes.filter((_, i) => truthy((sizesBy[p.id] || [])[i].is_available)),
      groups: (groupsBy[p.id] || []).map((g) => ({
        id: g.id, name_ar: g.name_ar, name_en: g.name_en, selection: g.selection,
        required: truthy(g.is_required), max_choices: g.max_choices == null ? null : Number(g.max_choices),
        choices: (choicesBy[g.id] || [])
          .filter((c) => admin || truthy(c.is_available))
          .map((c) => ({
            id: c.id, name_ar: c.name_ar, name_en: c.name_en, price_delta_lbp: Number(c.price_delta_lbp),
            ...(admin ? { is_available: truthy(c.is_available) } : {}),
          })),
      })),
    };
    if (admin) { out.category_id = p.category_id; out.image_id = p.image_id || null; out.is_visible = truthy(p.is_visible); out.is_available = truthy(p.is_available); }
    return out;
  };

  return cats.rows
    .filter((c) => admin || truthy(c.is_visible))
    .map((c) => ({
      id: c.id, name_ar: c.name_ar, name_en: c.name_en, image_url: imageUrl(c.image_id),
      ...(admin ? { image_id: c.image_id || null, is_visible: truthy(c.is_visible) } : {}),
      products: (prodsBy[c.id] || []).filter((p) => admin || truthy(p.is_visible)).map(shapeProduct),
    }))
    .filter((c) => admin || c.products.length > 0);
}

module.exports = { loadMenu, truthy };
