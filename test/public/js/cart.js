// Tray state. Pure logic (no DOM): easy to test. Prices here are for display only;
// the server prices every order again from the database.
const KEY = 'mc_cart_v1';
export const MAX_QTY = 50;

export function lineKey(l) {
  return [l.product_id, l.size_id, [...l.choice_ids].sort((a, b) => a - b).join('.'), (l.instructions || '').trim()].join('|');
}

// Builds a tray line from the menu data. Returns null when it cannot be ordered.
export function buildLine(product, sizeId, choiceIds, instructions, qty) {
  const size = product.sizes.find((s) => s.id === sizeId);
  if (!size || size.price_lbp == null || !product.orderable) return null;
  const picked = [];
  for (const g of product.groups) for (const c of g.choices) if (choiceIds.includes(c.id)) picked.push({ group: g, choice: c });
  const unit = size.price_lbp + picked.reduce((n, p) => n + p.choice.price_delta_lbp, 0);
  const line = {
    product_id: product.id, size_id: size.id, choice_ids: picked.map((p) => p.choice.id), instructions: (instructions || '').trim(), qty,
    unit_price: unit, name_ar: product.name_ar, name_en: product.name_en, size_ar: size.name_ar, size_en: size.name_en,
    options: picked.map((p) => ({ name_ar: p.choice.name_ar, name_en: p.choice.name_en })), thumb_url: product.thumb_url || null,
  };
  line.key = lineKey(line);
  return line;
}

export function createCart(storage) {
  let lines = [];
  const listeners = new Set();
  try {
    const saved = JSON.parse(storage.getItem(KEY) || '[]');
    if (Array.isArray(saved)) lines = saved.filter((l) => l && l.key && l.qty > 0);
  } catch (_) { lines = []; }

  const save = () => {
    try { storage.setItem(KEY, JSON.stringify(lines)); } catch (_) { /* private mode: keep in memory */ }
    listeners.forEach((fn) => fn());
  };

  return {
    items: () => lines,
    count: () => lines.reduce((n, l) => n + l.qty, 0),
    subtotal: () => lines.reduce((n, l) => n + l.unit_price * l.qty, 0),
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    add(line) {
      const found = lines.find((l) => l.key === line.key);
      if (found) found.qty = Math.min(MAX_QTY, found.qty + line.qty);
      else lines.push({ ...line, qty: Math.min(MAX_QTY, line.qty) });
      save();
    },
    setQty(key, qty) {
      if (qty <= 0) lines = lines.filter((l) => l.key !== key);
      else { const l = lines.find((x) => x.key === key); if (l) l.qty = Math.min(MAX_QTY, qty); }
      save();
    },
    remove(key) { lines = lines.filter((l) => l.key !== key); save(); },
    clear() { lines = []; save(); },
    // After the menu loads: refresh names/prices, drop what can no longer be ordered. Returns the number dropped.
    reprice(categories) {
      const products = new Map();
      for (const c of categories) for (const p of c.products) products.set(p.id, p);
      const before = lines.length;
      lines = lines.map((l) => {
        const p = products.get(l.product_id);
        const fresh = p && buildLine(p, l.size_id, l.choice_ids, l.instructions, l.qty);
        return fresh && fresh.choice_ids.length === l.choice_ids.length ? fresh : null;
      }).filter(Boolean);
      save();
      return before - lines.length;
    },
    orderItems: () => lines.map((l) => ({ product_id: l.product_id, size_id: l.size_id, quantity: l.qty, choice_ids: l.choice_ids, instructions: l.instructions })),
  };
}
