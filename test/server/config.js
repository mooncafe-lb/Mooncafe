'use strict';
require('dotenv').config();

const env = process.env;
const isProd = env.NODE_ENV === 'production';

function fail(message) {
  console.error('[config] ' + message);
  process.exit(1);
}

if (!env.DATABASE_URL) fail('DATABASE_URL is missing.');
if (isProd && (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32)) {
  fail('SESSION_SECRET must be set (32+ characters) in production.');
}

let host = '';
try {
  host = new URL(env.DATABASE_URL).hostname;
} catch (_) {
  fail('DATABASE_URL is not a valid URL.');
}
const isLocalDb = ['localhost', '127.0.0.1', '::1'].includes(host);

module.exports = {
  isProd,
  port: Number(env.PORT) || 3000,
  databaseUrl: env.DATABASE_URL,
  dbSsl: !isLocalDb,
  sessionSecret: env.SESSION_SECRET || 'dev-only-secret-dev-only-secret-dev-only',
  setupToken: env.SETUP_TOKEN || '',
};
