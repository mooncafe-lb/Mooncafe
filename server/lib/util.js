'use strict';

class HttpError extends Error {
  constructor(status, code, extra) {
    super(code);
    this.status = status;
    this.code = code;
    this.extra = extra || {};
  }
}
const httpError = (status, code, extra) => new HttpError(status, code, extra);

// async route handler wrapper: rejected promises go to the router's error middleware
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// error middleware used by every router
// eslint-disable-next-line no-unused-vars
function errorMiddleware(err, _req, res, next) {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.code, ...err.extra });
  if (err && err.type === 'entity.too.large') return res.status(413).json({ error: 'payload_too_large' });
  if (err instanceof SyntaxError && 'body' in err) return res.status(400).json({ error: 'invalid_json' });
  console.error('[error]', err && (err.stack || err.message));
  return res.status(500).json({ error: 'server_error' });
}

// small in-memory rate limiter (per IP + key); good enough for one Render instance
function rateLimit({ windowMs, max, key = 'default' }) {
  const hits = new Map();
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
  }, windowMs);
  if (timer.unref) timer.unref();
  return (req, res, next) => {
    const id = `${key}:${req.ip || 'unknown'}`;
    const now = Date.now();
    let entry = hits.get(id);
    if (!entry || entry.reset <= now) { entry = { count: 0, reset: now + windowMs }; hits.set(id, entry); }
    entry.count += 1;
    if (entry.count > max) {
      res.set('Retry-After', String(Math.ceil((entry.reset - now) / 1000)));
      return res.status(429).json({ error: 'too_many_requests' });
    }
    return next();
  };
}

const isUniqueViolation = (err) => !!err && (err.code === '23505' || /UNIQUE constraint failed/i.test(err.message || ''));

module.exports = { HttpError, httpError, wrap, errorMiddleware, rateLimit, isUniqueViolation };
