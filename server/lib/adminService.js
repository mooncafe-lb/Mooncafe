'use strict';
const S = require('./validate');
const { httpError } = require('./util');
const { loadMenu } = require('./catalog');
const settingsLib = require('./settings');
const { ORDER_STATUSES } = require('./orders');

const name = () => S.str({ min: 1, max: 120 });
const sizeRule = S.obj({
  id: S.int({ min: 1, optional: true }), name_ar: S.str({ min: 1, max: 60 }), name_en: S.str({ min: 1, max: 60 }),
  price_lbp: S.int({ min: 1, max: 1000000000, nullable: true, def: null }), is_available: S.bool({ def: true }),
});
const choiceRule = S.obj({
  id: S.int({ min: 1, optional: true }), name_ar: S.str({ min: 1, max: 60 }), name_en: S.str({ min: 1, max: 60 }),
  price_delta_lbp: S.int({ min: 0, max: 100000000, def: 0 }), is_available: S.bool({ def: true }),
});
const groupRule = S.obj({
  id: S.int({ min: 1, optional: true }), name_ar: S.str({ min: 1, max: 60 }), name_en: S.str({ min: 1, max: 60 }),
  selection: S.oneOf(['single', 'multiple'], { def: 'single' }), is_required: S.bool({ def: false }),
  max_choices: S.int({ min: 1, max: 20, nullable: true, def: null }), choices: S.arr(choiceRule, { max: 40, def: [] }),
});
const productRule = S.obj({
  category_id: S.int({ min: 1 }), name_ar: name(), name_en: name(),
  description_ar: S.str({ max: 500, def: '' }), description_en: S.str({ max: 500, def: '' }),
  image_id: S.int({ min: 1, nullable: true, def: null }), is_visible: S.bool({ def: true }), is_available: S.bool({ def: true }),
  sizes: S.arr(sizeRule, { min: 1, max: 8 }), groups: S.arr(groupRule, { max: 10, def: [] }),
});
const categoryRule = S.obj({
  name_ar: name(), name_en: name(), image_id: S.int({ min: 1, nullable: true, def: null }), is_visible: S.bool({ def: true }),
});
const idsRule = S.obj({ ids: S.arr(S.int({ min: 1 }), { min: 1, max: 500 }), category_id: S.int({ min: 1, optional: true }) });

async function bootstrap(db) {
  return {
    categories: await loadMenu(db, { admin: true }),
    settings: await settingsLib.loadAll(db),
    order_statuses: ORDER_STATUSES,
    fonts: { ar: settingsLib.FONTS_AR, en: settingsLib.FONTS_EN },
  };
}

// ------------------------------------------------------------ categories
async function createCategory(db, raw) {
  const c = S.parse(categoryRule, raw);
  const max = (await db.query('SELECT COALESCE(MAX(sort_order), 0) AS m FROM categories')).rows[0].m;
  const { rows } = await db.query(
    'INSERT INTO categories (name_ar, name_en, image_id, is_visible, sort_order) VALUES ($1,$2,$3,$4,$5) RETURNING id',
    [c.name_ar, c.name_en, c.image_id, c.is_visible, Number(max) + 1]);
  return { id: rows[0].id };
}

async function updateCategory(db, id, raw) {
  const c = S.parse(categoryRule, raw);
  const r = await db.query(
    `UPDATE categories SET name_ar=$1, name_en=$2, image_id=$3, is_visible=$4, updated_at=CURRENT_TIMESTAMP WHERE id=$5 RETURNING id`,
    [c.name_ar, c.name_en, c.image_id, c.is_visible, id]);
  if (!r.rows[0]) throw httpError(404, 'not_found');
}

async function deleteCategory(db, id, force) {
  const n = Number((await db.query('SELECT count(*) AS n FROM products WHERE category_id = $1', [id])).rows[0].n);
  if (n > 0 && !force) throw httpError(409, 'category_not_empty', { products: n });
  const r = await db.query('DELETE FROM categories WHERE id = $1 RETURNING id', [id]);
  if (!r.rows[0]) throw httpError(404, 'not_found');
}

async function reorder(db, table, raw) {
  const { ids, category_id: categoryId } = S.parse(idsRule, raw);
  await db.withTransaction(async (client) => {
    for (let i = 0; i < ids.length; i++) {
      if (table === 'products' && categoryId) await client.query('UPDATE products SET sort_order=$1 WHERE id=$2 AND category_id=$3', [i + 1, ids[i], categoryId]);
      else await client.query(`UPDATE ${table === 'products' ? 'products' : 'categories'} SET sort_order=$1 WHERE id=$2`, [i + 1, ids[i]]);
    }
  });
}

// ------------------------------------------------------------ products
// Keeps existing row ids when the editor sends them back, inserts new rows, deletes removed ones.
async function syncChildren(client, productId, sizes, groups) {
  const keepSizes = [];
  const existingSizes = new Set((await client.query('SELECT id FROM product_sizes WHERE product_id=$1', [productId])).rows.map((r) => r.id));
  for (let i = 0; i < sizes.length; i++) {
    const s = sizes[i];
    if (s.id && existingSizes.has(s.id)) {
      await client.query(
        `UPDATE product_sizes SET name_ar=$1, name_en=$2, price_lbp=$3, is_available=$4, sort_order=$5, updated_at=CURRENT_TIMESTAMP WHERE id=$6`,
        [s.name_ar, s.name_en, s.price_lbp, s.is_available, i, s.id]);
      keepSizes.push(s.id);
    } else {
      const r = await client.query(
        'INSERT INTO product_sizes (product_id, name_ar, name_en, price_lbp, is_available, sort_order) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
        [productId, s.name_ar, s.name_en, s.price_lbp, s.is_available, i]);
      keepSizes.push(r.rows[0].id);
    }
  }
  for (const id of existingSizes) if (!keepSizes.includes(id)) await client.query('DELETE FROM product_sizes WHERE id=$1', [id]);

  const existingGroups = new Set((await client.query('SELECT id FROM option_groups WHERE product_id=$1', [productId])).rows.map((r) => r.id));
  const keepGroups = [];
  for (let gi = 0; gi < groups.length; gi++) {
    const g = groups[gi];
    let groupId;
    if (g.id && existingGroups.has(g.id)) {
      await client.query(
        'UPDATE option_groups SET name_ar=$1, name_en=$2, selection=$3, is_required=$4, max_choices=$5, sort_order=$6 WHERE id=$7',
        [g.name_ar, g.name_en, g.selection, g.is_required, g.max_choices, gi + 1, g.id]);
      groupId = g.id;
    } else {
      groupId = (await client.query(
        'INSERT INTO option_groups (product_id, name_ar, name_en, selection, is_required, max_choices, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
        [productId, g.name_ar, g.name_en, g.selection, g.is_required, g.max_choices, gi + 1])).rows[0].id;
    }
    keepGroups.push(groupId);
    const existingChoices = new Set((await client.query('SELECT id FROM option_choices WHERE group_id=$1', [groupId])).rows.map((r) => r.id));
    const keepChoices = [];
    for (let ci = 0; ci < g.choices.length; ci++) {
      const c = g.choices[ci];
      if (c.id && existingChoices.has(c.id)) {
        await client.query(
          'UPDATE option_choices SET name_ar=$1, name_en=$2, price_delta_lbp=$3, is_available=$4, sort_order=$5 WHERE id=$6',
          [c.name_ar, c.name_en, c.price_delta_lbp, c.is_available, ci + 1, c.id]);
        keepChoices.push(c.id);
      } else {
        keepChoices.push((await client.query(
          'INSERT INTO option_choices (group_id, name_ar, name_en, price_delta_lbp, is_available, sort_order) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
          [groupId, c.name_ar, c.name_en, c.price_delta_lbp, c.is_available, ci + 1])).rows[0].id);
      }
    }
    for (const id of existingChoices) if (!keepChoices.includes(id)) await client.query('DELETE FROM option_choices WHERE id=$1', [id]);
  }
  for (const id of existingGroups) if (!keepGroups.includes(id)) await client.query('DELETE FROM option_groups WHERE id=$1', [id]);
}

async function assertCategory(client, id) {
  if (!(await client.query('SELECT id FROM categories WHERE id=$1', [id])).rows[0]) {
    throw httpError(400, 'validation', { errors: { category_id: 'unknown_category' } });
  }
}

async function createProduct(db, raw) {
  const p = S.parse(productRule, raw);
  return db.withTransaction(async (client) => {
    await assertCategory(client, p.category_id);
    const max = (await client.query('SELECT COALESCE(MAX(sort_order), 0) AS m FROM products WHERE category_id=$1', [p.category_id])).rows[0].m;
    const id = (await client.query(
      `INSERT INTO products (category_id, name_ar, name_en, description_ar, description_en, image_id, is_visible, is_available, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [p.category_id, p.name_ar, p.name_en, p.description_ar, p.description_en, p.image_id, p.is_visible, p.is_available, Number(max) + 1])).rows[0].id;
    await syncChildren(client, id, p.sizes, p.groups);
    return { id };
  });
}

async function updateProduct(db, id, raw) {
  const p = S.parse(productRule, raw);
  await db.withTransaction(async (client) => {
    await assertCategory(client, p.category_id);
    const r = await client.query(
      `UPDATE products SET category_id=$1, name_ar=$2, name_en=$3, description_ar=$4, description_en=$5, image_id=$6,
         is_visible=$7, is_available=$8, updated_at=CURRENT_TIMESTAMP WHERE id=$9 RETURNING id`,
      [p.category_id, p.name_ar, p.name_en, p.description_ar, p.description_en, p.image_id, p.is_visible, p.is_available, id]);
    if (!r.rows[0]) throw httpError(404, 'not_found');
    await syncChildren(client, id, p.sizes, p.groups);
  });
}

async function deleteProduct(db, id) {
  const r = await db.query('DELETE FROM products WHERE id=$1 RETURNING id', [id]);
  if (!r.rows[0]) throw httpError(404, 'not_found');
}

module.exports = {
  bootstrap, createCategory, updateCategory, deleteCategory, reorder, createProduct, updateProduct, deleteProduct,
  productRule, categoryRule,
};
