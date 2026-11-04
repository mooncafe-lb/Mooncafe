'use strict';
// Store open/closed logic. Pure functions: easy to test, no database access.
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const WEEK = 7 * 1440;

function isValidTimezone(tz) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch (_) { return false; }
}

function localParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type).value;
  const day = get('weekday').slice(0, 3).toLowerCase();
  const dayIdx = DAYS.indexOf(day);
  return { day, dayIdx, minutes: dayIdx * 1440 + Number(get('hour')) * 60 + Number(get('minute')) };
}

const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };

// Every interval as minutes-from-Sunday-00:00. An interval whose close is not after its
// open runs past midnight (e.g. 18:00 -> 02:00).
function intervals(hours) {
  const out = [];
  DAYS.forEach((day, i) => {
    for (const iv of (hours && hours[day]) || []) {
      const open = toMin(iv.open);
      let close = toMin(iv.close);
      if (close <= open) close += 1440;
      out.push({ day, open: iv.open, close: iv.close, start: i * 1440 + open, end: i * 1440 + close });
    }
  });
  return out;
}

function evaluateStore(status, hours, now = new Date()) {
  const s = status || {};
  const timezone = s.timezone || 'Asia/Beirut';
  const base = {
    timezone,
    message_ar: s.closed_message_ar || '',
    message_en: s.closed_message_en || '',
  };
  const ivs = intervals(hours);
  const { minutes: m } = localParts(now, timezone);

  let next = null;
  let best = Infinity;
  for (const iv of ivs) {
    let delta = iv.start - m;
    if (delta <= 0) delta += WEEK;
    if (delta < best) { best = delta; next = iv; }
  }
  const nextOpen = next ? { day: next.day, time: next.open, in_minutes: best } : null;
  const current = ivs.find((iv) => (m >= iv.start && m < iv.end) || (m + WEEK >= iv.start && m + WEEK < iv.end));

  if (s.mode === 'force_open') return { ...base, open: true, mode: s.mode, reason: 'manual_open', next_open: null };
  if (s.mode === 'force_closed') return { ...base, open: false, mode: s.mode, reason: 'manual_closed', next_open: nextOpen };
  if (current) {
    const into = m >= current.start ? m : m + WEEK;
    return { ...base, open: true, mode: 'auto', reason: 'open_hours', closes_in_minutes: current.end - into, next_open: null };
  }
  return { ...base, open: false, mode: 'auto', reason: ivs.length ? 'closed_hours' : 'no_hours', next_open: nextOpen };
}

module.exports = { DAYS, isValidTimezone, localParts, evaluateStore };
