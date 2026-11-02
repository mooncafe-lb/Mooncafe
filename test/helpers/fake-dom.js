'use strict';
// A small fake browser (DOM subset + window/localStorage/fetch hooks) so the real customer app
// code can run in Node tests. It supports exactly what public/js uses.
class TextNode { constructor(t) { this.nodeType = 3; this.data = String(t); this.parentNode = null; } get textContent() { return this.data; } remove() { if (this.parentNode) this.parentNode.removeChild(this); } }

class Element {
  constructor(tag, doc) {
    this.nodeType = 1; this.tagName = tag.toUpperCase(); this.ownerDocument = doc; this.parentNode = null;
    this.childNodes = []; this.attrs = new Map(); this.listeners = new Map(); this.dataset = {}; this.style = new Proxy({}, {
      get: (t, k) => (k === 'setProperty' ? (n, v) => { t[n] = v; } : k === 'removeProperty' ? (n) => { delete t[n]; } : t[k]),
      set: (t, k, v) => { t[k] = v; return true; },
    });
    this._classes = new Set(); this.value = ''; this.disabled = false; this.checked = false;
    const self = this;
    this.classList = {
      add: (...c) => c.forEach((x) => self._classes.add(x)), remove: (...c) => c.forEach((x) => self._classes.delete(x)),
      contains: (c) => self._classes.has(c), toggle: (c, f) => { const on = f === undefined ? !self._classes.has(c) : f; if (on) self._classes.add(c); else self._classes.delete(c); },
    };
  }
  get className() { return [...this._classes].join(' '); }
  set className(v) { this._classes = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get id() { return this.attrs.get('id') || ''; }
  get children() { return this.childNodes.filter((n) => n.nodeType === 1); }
  get textContent() { return this.childNodes.map((n) => n.textContent).join(''); }
  set textContent(v) { this.replaceChildren(); if (v) this.appendChild(new TextNode(v)); }
  setAttribute(k, v) { this.attrs.set(k, String(v)); if (k === 'class') this.className = v; }
  getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; }
  removeAttribute(k) { this.attrs.delete(k); }
  appendChild(n) { if (n.parentNode) n.parentNode.removeChild(n); n.parentNode = this; this.childNodes.push(n); return n; }
  removeChild(n) { const i = this.childNodes.indexOf(n); if (i >= 0) this.childNodes.splice(i, 1); n.parentNode = null; return n; }
  replaceChildren(...nodes) { for (const c of [...this.childNodes]) this.removeChild(c); nodes.forEach((n) => this.appendChild(typeof n === 'string' ? new TextNode(n) : n)); }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  addEventListener(type, fn) { if (!this.listeners.has(type)) this.listeners.set(type, []); this.listeners.get(type).push(fn); }
  removeEventListener(type, fn) { const l = this.listeners.get(type) || []; const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); }
  dispatchEvent(ev) {
    ev.target = ev.target || this; ev.preventDefault = ev.preventDefault || (() => {});
    for (let n = this; n; n = n.parentNode) { for (const fn of [...((n.listeners && n.listeners.get(ev.type)) || [])]) fn(ev); if (ev.cancelBubble) break; }
    return true;
  }
  click() { this.dispatchEvent({ type: 'click', bubbles: true }); }
  focus() {} scrollIntoView() {}
  getBoundingClientRect() { return { left: 10, top: 20, width: 100, height: 80, right: 110, bottom: 100 }; }
  animate() { const anim = {}; setTimeout(() => anim.onfinish && anim.onfinish(), 3); anim.cancel = () => {}; return anim; }
  contains(n) { for (let x = n; x; x = x.parentNode) if (x === this) return true; return false; }
}

function walk(node, fn) { fn(node); (node.childNodes || []).forEach((c) => walk(c, fn)); }

function installDom({ reducedMotion = true, fetchImpl, storage = {}, geo } = {}) {
  const doc = {};
  doc.createElement = (t) => new Element(t, doc);
  doc.createTextNode = (t) => new TextNode(t);
  doc.documentElement = new Element('html', doc); doc.head = new Element('head', doc); doc.body = new Element('body', doc);
  doc.documentElement.appendChild(doc.head); doc.documentElement.appendChild(doc.body);
  doc.getElementById = (id) => { let found = null; walk(doc.documentElement, (n) => { if (!found && n.attrs && n.attrs.get('id') === id) found = n; }); return found; };
  const docListeners = new Map();
  doc.addEventListener = (t, fn) => { if (!docListeners.has(t)) docListeners.set(t, []); docListeners.get(t).push(fn); };
  doc.removeEventListener = (t, fn) => { const l = docListeners.get(t) || []; const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); };
  doc.fire = (type, extra) => (docListeners.get(type) || []).slice().forEach((fn) => fn({ type, ...extra }));
  doc.hidden = false; doc.title = '';
  const root = doc.createElement('div'); root.setAttribute('id', 'app'); doc.body.appendChild(root);

  const mem = new Map(Object.entries(storage));
  const localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k), _mem: mem };
  const location = { _href: 'https://moon.test/', get href() { return this._href; }, set href(v) { this._href = v; this.navigations.push(v); }, navigations: [] };
  const win = { localStorage, location, matchMedia: () => ({ matches: reducedMotion }) };
  Object.assign(globalThis, { document: doc, window: win, fetch: fetchImpl, setInterval: globalThis.setInterval });
  Object.defineProperty(globalThis, 'navigator', { value: { geolocation: geo }, configurable: true, writable: true });
  globalThis.MC_NO_POLL = true;
  return { doc, root, localStorage, location, win };
}

// ---- query helpers
const all = (el, pred) => { const out = []; walk(el, (n) => { if (n.nodeType === 1 && pred(n)) out.push(n); }); return out; };
const byClass = (el, c) => all(el, (n) => n.classList.contains(c));
const byTag = (el, tag) => all(el, (n) => n.tagName === tag.toUpperCase());
const withText = (el, text, tag) => all(el, (n) => (!tag || n.tagName === tag.toUpperCase()) && n.textContent.includes(text) && n.childNodes.every((c) => c.nodeType === 3 || !c.textContent.includes(text)));
const flush = (ms = 15) => new Promise((r) => setTimeout(r, ms));
const type = (el, value) => { el.value = value; el.dispatchEvent({ type: 'input', bubbles: true, target: el }); };

module.exports = { installDom, Element, all, byClass, byTag, withText, flush, type };
