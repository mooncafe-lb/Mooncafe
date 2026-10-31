'use strict';
const fs = require('fs');
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const cookieParser = require('cookie-parser');

const config = require('./config');
const db = require('./db');
const { runMigrations } = require('./migrate');

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));
app.use(compression());
app.use(express.json({ limit: '200kb' }));
app.use(cookieParser());

app.get('/healthz', async (_req, res) => {
  try {
    await db.query('SELECT 1');
    res.json({ ok: true });
  } catch (_) {
    res.status(503).json({ ok: false });
  }
});

// Every file in server/routes exporting { path, router } is mounted automatically.
const routesDir = path.join(__dirname, 'routes');
if (fs.existsSync(routesDir)) {
  for (const file of fs.readdirSync(routesDir).filter((f) => f.endsWith('.js')).sort()) {
    const mod = require(path.join(routesDir, file));
    if (mod && mod.path && mod.router) {
      app.use(mod.path, mod.router);
      console.log('[routes] mounted', mod.path);
    }
  }
}

app.use('/api', (_req, res) => res.status(404).json({ error: 'not_found' }));

app.use(express.static(path.join(__dirname, '..', 'public'), {
  maxAge: config.isProd ? '1h' : 0,
}));

app.use((_req, res) => res.status(404).type('text/plain').send('Not found / غير موجود'));

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  if (err && err.type === 'entity.too.large') return res.status(413).json({ error: 'payload_too_large' });
  if (err instanceof SyntaxError && 'body' in err) return res.status(400).json({ error: 'invalid_json' });
  console.error('[error]', err && err.message);
  res.status(500).json({ error: 'server_error' });
});

async function start() {
  await db.waitForDb();
  const migration = await runMigrations();

// Internal only (never sent to clients); a future authenticated admin route may read it.
app.locals.migrationStatus = {
  mode: migration.mode,
  pending: migration.pending,
  failed: migration.failed
};

if (migration.failed) {
  // Only a dry run can return failed=true (apply throws). Its changes were rolled back, so keep serving.
  console.error('[server] migration dry-run FAILED; starting anyway on the existing database schema');
} else if (migration.pending > 0) {
  console.warn(
    `[server] ${migration.pending} migration(s) pending (mode: ${migration.mode}); starting on the existing database schema`
  );
}
  const server = app.listen(config.port, '0.0.0.0', () => {
    console.log(`[server] listening on port ${config.port}`);
  });
  const shutdown = (signal) => {
    console.log(`[server] ${signal} received, shutting down`);
    server.close(() => db.pool.end().finally(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

if (require.main === module) {
  start().catch((err) => {
    console.error('[server] failed to start:', err.message);
    process.exit(1);
  });
}

module.exports = app;
