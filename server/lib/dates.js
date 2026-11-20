'use strict';
// All customer-facing dates and the daily order numbering use the Lebanon calendar (Asia/Beirut), including daylight saving.
// The exact instant is stored in UTC (created_at); these helpers only convert it for display and for choosing the day.
const TZ = 'Asia/Beirut';
const fmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

function toDate(value) {
  if (value instanceof Date) return value;
  const s = String(value);
  // SQLite and some drivers return 'YYYY-MM-DD HH:MM:SS' without a zone: that is UTC
  return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s.replace(' ', 'T')}Z`);
}

function parts(date) {
  const p = {};
  for (const x of fmt.formatToParts(date)) if (x.type !== 'literal') p[x.type] = x.value;
  return p;
}

// 'YYYY-MM-DD' of the Beirut calendar day that contains this instant
function beirutDate(value) {
  const p = parts(toDate(value));
  return `${p.year}-${p.month}-${p.day}`;
}

// { iso, iso_date: '2026-11-04', date: '04/11/2026', time24: '13:45', time_en: '01:45 PM', time_ar: '01:45 م' }
function stamp(value) {
  const d = toDate(value);
  if (Number.isNaN(d.getTime())) return null;
  const p = parts(d);
  const h24 = Number(p.hour);
  const h12 = String(h24 % 12 || 12).padStart(2, '0');
  return {
    iso: d.toISOString(),
    iso_date: `${p.year}-${p.month}-${p.day}`,
    date: `${p.day}/${p.month}/${p.year}`,
    time24: `${p.hour}:${p.minute}`,
    time_en: `${h12}:${p.minute} ${h24 >= 12 ? 'PM' : 'AM'}`,
    time_ar: `${h12}:${p.minute} ${h24 >= 12 ? 'م' : 'ص'}`,
  };
}

module.exports = { TZ, toDate, beirutDate, stamp };
