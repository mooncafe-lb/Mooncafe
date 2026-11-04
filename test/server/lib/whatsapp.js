'use strict';
// Lebanese phone normalisation, WhatsApp link and the order message.

// Returns { e164: '+96178964984', digits: '96178964984' } or null when it is not a usable number.
function normalizePhone(raw) {
  const s = String(raw == null ? '' : raw).trim();
  let d = s.replace(/\D/g, '');
  if (!d) return null;
  let international = s.startsWith('+');
  if (!international && d.startsWith('00')) { d = d.slice(2); international = true; }
  let digits;
  if (international) digits = d;
  else if (d.startsWith('961') && d.length >= 10) digits = d;
  else if (d.startsWith('0')) digits = '961' + d.slice(1);
  else if (d.length >= 7 && d.length <= 8) digits = '961' + d;
  else digits = d;
  if (digits.length < 8 || digits.length > 15) return null;
  if (digits.startsWith('961') && (digits.length < 10 || digits.length > 11)) return null;
  return { e164: '+' + digits, digits };
}

function whatsappUrl(number, message) {
  const n = normalizePhone(number);
  if (!n) return null;
  return `https://wa.me/${n.digits}?text=${encodeURIComponent(message)}`;
}

const money = (n) => Number(n).toLocaleString('en-US');

const L = {
  ar: {
    title: 'طلب جديد', code: 'رقم الطلب', name: 'الاسم', phone: 'الهاتف', type: 'نوع الطلب', address: 'العنوان',
    location: 'الموقع', subtotal: 'المجموع', fee: 'رسوم التوصيل', total: 'الإجمالي', notes: 'ملاحظات',
    delivery: 'توصيل', pickup: 'استلام', options: 'الخيارات', note: 'ملاحظة', currency: 'ل.ل.', sep: '، ',
  },
  en: {
    title: 'New order', code: 'Order', name: 'Name', phone: 'Phone', type: 'Order type', address: 'Address',
    location: 'Location', subtotal: 'Subtotal', fee: 'Delivery fee', total: 'Total', notes: 'Notes',
    delivery: 'Delivery', pickup: 'Pickup', options: 'Options', note: 'Note', currency: 'LBP', sep: ', ',
  },
};

function defaultTemplate(lang, storeName) {
  const t = L[lang];
  return [
    `${t.title} - ${storeName}`,
    `${t.code}: {code}`,
    `${t.name}: {name}`,
    `${t.phone}: {phone}`,
    `${t.type}: {type}`,
    `${t.address}: {address}`,
    `${t.location}: {location}`,
    '-----------------',
    '{items}',
    '-----------------',
    `${t.subtotal}: {subtotal} {currency}`,
    `${t.fee}: {delivery_fee} {currency}`,
    `${t.total}: {total} {currency}`,
    `${t.notes}: {notes}`,
  ].join('\n');
}

// Lines whose placeholders are all empty are dropped ({currency} does not count).
function renderTemplate(template, vars) {
  const out = [];
  for (const line of String(template).split('\n')) {
    const names = [...line.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
    const significant = names.filter((n) => n !== 'currency');
    if (significant.length && significant.every((n) => !String(vars[n] == null ? '' : vars[n]).trim())) continue;
    out.push(line.replace(/\{(\w+)\}/g, (_, n) => (vars[n] == null ? '' : String(vars[n]))));
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// order: { code, customer_name, phone, fulfillment, address, latitude, longitude, notes, subtotal_lbp, delivery_fee_lbp, total_lbp }
// items: [{ name_ar, name_en, size_name_ar, size_name_en, options:[{name_ar,name_en}], special_instructions, unit_price_lbp, quantity, line_total_lbp }]
function buildOrderMessage({ order, items, lang = 'ar', template = '', storeName = 'Moon Cafe' }) {
  const t = L[lang] || L.ar;
  const pick = (o, k) => (lang === 'en' ? o[`${k}_en`] : o[`${k}_ar`]) || o[`${k}_en`] || o[`${k}_ar`] || '';
  const itemLines = items.map((it, i) => {
    const size = pick(it, 'size_name');
    const lines = [`${i + 1}) ${pick(it, 'name')}${size ? ` (${size})` : ''} x${it.quantity}`];
    const opts = (it.options || []).map((o) => pick(o, 'name')).filter(Boolean);
    if (opts.length) lines.push(`   ${t.options}: ${opts.join(t.sep)}`);
    if (it.special_instructions) lines.push(`   ${t.note}: ${it.special_instructions}`);
    lines.push(`   ${money(it.unit_price_lbp)} x ${it.quantity} = ${money(it.line_total_lbp)} ${t.currency}`);
    return lines.join('\n');
  });
  const isDelivery = order.fulfillment === 'delivery';
  const hasPoint = order.latitude != null && order.longitude != null;
  const vars = {
    code: order.code,
    name: order.customer_name,
    phone: order.phone,
    type: isDelivery ? t.delivery : t.pickup,
    address: order.address,
    location: hasPoint ? `https://maps.google.com/?q=${order.latitude},${order.longitude}` : '',
    items: itemLines.join('\n'),
    subtotal: money(order.subtotal_lbp),
    delivery_fee: isDelivery ? money(order.delivery_fee_lbp) : '',
    total: money(order.total_lbp),
    notes: order.notes,
    currency: t.currency,
  };
  return renderTemplate(template && template.trim() ? template : defaultTemplate(lang, storeName), vars);
}

module.exports = { normalizePhone, whatsappUrl, buildOrderMessage, renderTemplate, money };
