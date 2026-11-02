'use strict';
// Minimal stand-in for express so the router factories can be exercised without installing express.
function Router() {
  const stack = [];
  const add = (method) => (path, ...handlers) => stack.push({ method, path, handlers });
  const router = { stack };
  for (const m of ['get', 'post', 'put', 'delete']) router[m] = add(m.toUpperCase());
  router.use = (...handlers) => stack.push({ method: 'USE', path: null, handlers });
  return router;
}
const express = () => { throw new Error('not used'); };
express.Router = Router;
express.raw = () => function rawParser() {};
module.exports = express;

// Dispatch a fake request through a router (same order express would use).
async function dispatch(router, { method, url, body, headers = {}, cookies = {}, ip = '1.1.1.1' }) {
  const [pathname, qs] = url.split('?');
  const query = Object.fromEntries(new URLSearchParams(qs || ''));
  const res = { statusCode: 200, headers: {}, cookiesSet: {}, ended: false };
  res.status = (c) => { res.statusCode = c; return res; };
  res.set = (k, v) => { if (typeof k === 'object') Object.assign(res.headers, k); else res.headers[k] = v; return res; };
  res.json = (b) => { res.body = b; res.ended = true; return res; };
  res.send = (b) => { res.body = b; res.ended = true; return res; };
  res.end = () => { res.ended = true; return res; };
  res.cookie = (n, v, o) => { res.cookiesSet[n] = { value: v, options: o }; return res; };
  res.clearCookie = (n) => { delete res.cookiesSet[n]; res.cleared = n; return res; };
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  const req = { method, url, query, body, cookies, ip, params: {}, get: (h) => lower[h.toLowerCase()] };

  const matches = (route) => {
    if (route.method === 'USE') return {};
    if (route.method !== method) return null;
    const names = []; const re = new RegExp('^' + route.path.replace(/:(\w+)/g, (_, n) => { names.push(n); return '([^/]+)'; }) + '/?$');
    const m = pathname.match(re);
    return m ? Object.fromEntries(names.map((n, i) => [n, decodeURIComponent(m[i + 1])])) : null;
  };
  const chain = [];
  for (const route of router.stack) {
    const params = matches(route);
    if (params) for (const h of route.handlers) chain.push({ h, params, isErr: h.length === 4 });
  }
  let i = 0; let error = null;
  const next = async (err) => {
    if (err) error = err;
    while (i < chain.length && !res.ended) {
      const { h, params, isErr } = chain[i++];
      if (!!error !== isErr) continue;
      req.params = params;
      try { if (isErr) await h(error, req, res, next); else await h(req, res, next); } catch (e) { error = e; continue; }
      return;
    }
  };
  await next();
  if (!res.ended && !error) res.statusCode = 404;
  return res;
}
module.exports.dispatch = dispatch;
