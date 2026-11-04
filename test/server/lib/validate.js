'use strict';
const { httpError } = require('./util');

// Tiny schema validator. A "rule" is (value, path, errors) => cleanedValue.
// Unknown keys in objects are dropped. All problems are collected, then thrown as 400.
const MISSING = (v) => v === undefined || v === null;

function str({ min = 0, max = 1000, optional = false, def, pattern, trim = true } = {}) {
  return (v, path, errs) => {
    if (MISSING(v)) {
      if (def !== undefined) return def;
      if (optional) return undefined;
      errs[path] = 'required'; return undefined;
    }
    if (typeof v !== 'string') { errs[path] = 'must_be_text'; return undefined; }
    const s = trim ? v.trim() : v;
    if (s.length < min) { errs[path] = min === 1 ? 'required' : 'too_short'; return undefined; }
    if (s.length > max) { errs[path] = 'too_long'; return undefined; }
    if (pattern && s !== '' && !pattern.test(s)) { errs[path] = 'invalid_format'; return undefined; }
    return s;
  };
}

function int({ min = -Infinity, max = Infinity, optional = false, def, nullable = false } = {}) {
  return (v, path, errs) => {
    if (MISSING(v) || v === '') {
      if (nullable && (v === null || v === '')) return null;
      if (def !== undefined) return def;
      if (optional) return undefined;
      errs[path] = 'required'; return undefined;
    }
    const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
    if (typeof n !== 'number' || !Number.isInteger(n)) { errs[path] = 'must_be_integer'; return undefined; }
    if (n < min || n > max) { errs[path] = 'out_of_range'; return undefined; }
    return n;
  };
}

function num({ min = -Infinity, max = Infinity, optional = false } = {}) {
  return (v, path, errs) => {
    if (MISSING(v) || v === '') { if (optional) return undefined; errs[path] = 'required'; return undefined; }
    const n = typeof v === 'string' ? Number(v) : v;
    if (typeof n !== 'number' || !Number.isFinite(n)) { errs[path] = 'must_be_number'; return undefined; }
    if (n < min || n > max) { errs[path] = 'out_of_range'; return undefined; }
    return n;
  };
}

function bool({ def } = {}) {
  return (v, path, errs) => {
    if (MISSING(v)) { if (def !== undefined) return def; errs[path] = 'required'; return undefined; }
    if (typeof v !== 'boolean') { errs[path] = 'must_be_boolean'; return undefined; }
    return v;
  };
}

function oneOf(values, { def, optional = false } = {}) {
  return (v, path, errs) => {
    if (MISSING(v)) {
      if (def !== undefined) return def;
      if (optional) return undefined;
      errs[path] = 'required'; return undefined;
    }
    if (!values.includes(v)) { errs[path] = 'invalid_choice'; return undefined; }
    return v;
  };
}

function arr(rule, { min = 0, max = 100, def } = {}) {
  return (v, path, errs) => {
    if (MISSING(v)) { if (def !== undefined) return def; errs[path] = 'required'; return undefined; }
    if (!Array.isArray(v)) { errs[path] = 'must_be_list'; return undefined; }
    if (v.length < min) { errs[path] = 'too_few'; return undefined; }
    if (v.length > max) { errs[path] = 'too_many'; return undefined; }
    return v.map((item, i) => rule(item, `${path}[${i}]`, errs));
  };
}

function obj(shape, { optional = false, def } = {}) {
  return (v, path, errs) => {
    if (MISSING(v)) {
      if (def !== undefined) return def;
      if (optional) return undefined;
      errs[path] = 'required'; return undefined;
    }
    if (typeof v !== 'object' || Array.isArray(v)) { errs[path] = 'must_be_object'; return undefined; }
    const out = {};
    for (const [key, rule] of Object.entries(shape)) {
      const value = rule(v[key], path ? `${path}.${key}` : key, errs);
      if (value !== undefined) out[key] = value;
    }
    return out;
  };
}

// a map with free keys (used for text overrides)
function map(keyPattern, rule, { max = 300 } = {}) {
  return (v, path, errs) => {
    if (MISSING(v)) return {};
    if (typeof v !== 'object' || Array.isArray(v)) { errs[path] = 'must_be_object'; return undefined; }
    const keys = Object.keys(v);
    if (keys.length > max) { errs[path] = 'too_many'; return undefined; }
    const out = {};
    for (const k of keys) {
      if (!keyPattern.test(k)) continue;
      out[k] = rule(v[k], `${path}.${k}`, errs);
    }
    return out;
  };
}

const color = (opts = {}) => str({ max: 7, pattern: /^#[0-9a-fA-F]{6}$/, ...opts });
const time = () => str({ max: 5, min: 1, pattern: /^([01]\d|2[0-3]):[0-5]\d$|^24:00$/ });

function parse(rule, raw) {
  const errs = {};
  const value = rule(raw, '', errs);
  if (Object.keys(errs).length) throw httpError(400, 'validation', { errors: errs });
  return value;
}

module.exports = { str, int, num, bool, oneOf, arr, obj, map, color, time, parse };
