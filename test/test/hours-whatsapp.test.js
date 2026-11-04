'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateStore } = require('../server/lib/hours');
const { normalizePhone, whatsappUrl, buildOrderMessage, renderTemplate } = require('../server/lib/whatsapp');

const hours = { mon: [{ open: '08:00', close: '23:00' }], tue: [{ open: '18:00', close: '02:00' }], wed: [], thu: [], fri: [], sat: [], sun: [] };
const auto = { mode: 'auto', timezone: 'Asia/Beirut', closed_message_ar: 'مغلق', closed_message_en: 'Closed' };

test('open inside hours (Beirut winter time, UTC+2)', () => {
  const r = evaluateStore(auto, hours, new Date('2026-11-02T08:30:00Z')); // Monday 10:30
  assert.equal(r.open, true); assert.equal(r.reason, 'open_hours'); assert.equal(r.closes_in_minutes, 750);
});
test('closed before opening, next opening is Monday 08:00 in 60 minutes', () => {
  const r = evaluateStore(auto, hours, new Date('2026-11-02T05:00:00Z'));
  assert.equal(r.open, false); assert.deepEqual(r.next_open, { day: 'mon', time: '08:00', in_minutes: 60 });
  assert.equal(r.message_ar, 'مغلق');
});
test('an interval running past midnight stays open on the next day', () => {
  assert.equal(evaluateStore(auto, hours, new Date('2026-11-03T23:30:00Z')).open, true);   // Wed 01:30
  assert.equal(evaluateStore(auto, hours, new Date('2026-11-04T00:30:00Z')).open, false);  // Wed 02:30
});
test('manual override beats the schedule in both directions', () => {
  assert.equal(evaluateStore({ ...auto, mode: 'force_open' }, hours, new Date('2026-11-04T00:30:00Z')).open, true);
  const closed = evaluateStore({ ...auto, mode: 'force_closed' }, hours, new Date('2026-11-02T08:30:00Z'));
  assert.equal(closed.open, false); assert.equal(closed.reason, 'manual_closed');
});
test('no hours configured means closed with reason no_hours', () => {
  const empty = { sun: [], mon: [], tue: [], wed: [], thu: [], fri: [], sat: [] };
  const r = evaluateStore(auto, empty, new Date('2026-11-02T08:30:00Z'));
  assert.equal(r.open, false); assert.equal(r.reason, 'no_hours'); assert.equal(r.next_open, null);
});
test('Beirut timezone follows daylight saving (summer UTC+3)', () => {
  const r = evaluateStore(auto, hours, new Date('2026-07-06T04:30:00Z')); // Monday 07:30 local in summer
  assert.equal(r.open, false);
  assert.equal(evaluateStore(auto, hours, new Date('2026-07-06T05:30:00Z')).open, true); // 08:30 local
});

test('Lebanese phone numbers normalise to +961', () => {
  for (const p of ['78964984', '78 964 984', '+961 78 964 984', '0096178964984', '078964984']) assert.equal(normalizePhone(p).e164, '+96178964984', p);
  assert.equal(normalizePhone('03 123 456').e164, '+9613123456');
  assert.equal(normalizePhone('+44 7700 900123').e164, '+447700900123');
  for (const bad of ['', '123', 'abc', '+961 1']) assert.equal(normalizePhone(bad), null, bad);
});
test('wa.me link uses the 961 country code and encodes the message', () => {
  const url = whatsappUrl('78964984', 'مرحبا\nline 2');
  assert.ok(url.startsWith('https://wa.me/96178964984?text='));
  assert.equal(decodeURIComponent(url.split('text=')[1]), 'مرحبا\nline 2');
});

const order = { code: 'MC-ABC234', customer_name: 'Sara', phone: '+96171123456', fulfillment: 'delivery', address: 'Sibline', latitude: 33.5, longitude: 35.4, notes: 'no sugar', subtotal_lbp: 700000, delivery_fee_lbp: 50000, total_lbp: 750000 };
const items = [{ name_ar: 'لاتيه', name_en: 'Latte', size_name_ar: 'كبير', size_name_en: 'Large', options: [{ name_ar: 'ساخن', name_en: 'Hot' }, { name_ar: 'كراميل', name_en: 'Caramel' }], special_instructions: 'extra hot', unit_price_lbp: 350000, quantity: 2, line_total_lbp: 700000 }];
test('Arabic order message has every required part', () => {
  const m = buildOrderMessage({ order, items, lang: 'ar', storeName: 'Moon Cafe' });
  for (const part of ['MC-ABC234', 'Sara', '+96171123456', 'توصيل', 'Sibline', 'https://maps.google.com/?q=33.5,35.4', 'لاتيه (كبير) x2', 'ساخن، كراميل', 'extra hot', '350,000 x 2 = 700,000', '750,000', '50,000', 'no sugar']) {
    assert.ok(m.includes(part), `missing: ${part}\n${m}`);
  }
});
test('pickup message omits delivery fee, address and location lines', () => {
  const m = buildOrderMessage({ order: { ...order, fulfillment: 'pickup', address: '', latitude: null, longitude: null, delivery_fee_lbp: 0, total_lbp: 700000 }, items, lang: 'en' });
  assert.ok(m.includes('Pickup')); assert.ok(!m.includes('Delivery fee')); assert.ok(!m.includes('Address')); assert.ok(!m.includes('Location'));
});
test('custom template placeholders are replaced and empty lines dropped', () => {
  const m = buildOrderMessage({ order: { ...order, notes: '' }, items, lang: 'en', template: 'Hi {name}\nNotes: {notes}\n{items}\nTotal {total} {currency}' });
  assert.ok(m.startsWith('Hi Sara')); assert.ok(!m.includes('Notes:')); assert.ok(m.includes('Total 750,000 LBP'));
  assert.equal(renderTemplate('A {x}\nB {y}', { x: '', y: 'ok' }), 'B ok');
});
