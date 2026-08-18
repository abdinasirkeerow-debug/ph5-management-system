/* ==========================================================================
   env.js — Central configuration. Reads process.env (with dotenv fallback).
   Secrets are never logged or sent to the browser.
   ========================================================================== */
const path = require('path');
require('dotenv').config();

const ROOT = path.join(__dirname, '..', '..'); // project/

const NODE_ENV = process.env.NODE_ENV || 'development';
const IS_PROD = NODE_ENV === 'production';
const IS_TEST = NODE_ENV === 'test';

/* Database path. DATABASE_PATH is the Railway volume mount (/app/data/app.db);
   DB_PATH is kept as a backward-compatible alias used by the test suite. */
const dbPath = process.env.DATABASE_PATH ||
  process.env.DB_PATH ||
  path.join(ROOT, 'backend', 'data', 'app.db');

const config = {
  root: ROOT,
  nodeEnv: NODE_ENV,
  isProd: IS_PROD,
  isTest: IS_TEST,

  /* Bind all interfaces so Railway/Nixpacks can route traffic to the container. */
  host: '0.0.0.0',
  port: parseInt(process.env.PORT || '3000', 10),

  /* Session */
  sessionSecret: process.env.SESSION_SECRET || (IS_PROD ? null : 'ph5-dev-insecure-secret-change-me'),
  sessionCookieName: 'ph5.sid',
  sessionMaxAgeMs: 1000 * 60 * 60 * 8, // 8 hours

  /* Database. In production, backups default to a sibling of the DB file so they
     land on the persisted Railway volume instead of the ephemeral container FS. */
  dbPath,
  backupDir: process.env.BACKUP_DIR ||
    (IS_PROD ? path.join(path.dirname(dbPath), 'backups') : path.join(ROOT, 'backend', 'backups')),

  /* Application timezone — "current month" for monthly fees is resolved in this
     zone so that UTC-hosted servers do not open or block a month at the wrong
     wall-clock time (e.g. 31 Aug 21:00 UTC is already 1 Sep in Mogadishu). */
  appTimezone: process.env.APP_TIMEZONE || 'Africa/Mogadishu',

  /* Payment rules — only these exact amounts may be recorded per transaction.
     Extend this list (and the DB CHECK <= 2) to support $4 and future amounts. */
  allowedPaymentAmounts: [1, 2],

  /* Practical attendance statuses */
  attendanceStatuses: ['present', 'absent', 'late', 'excused', 'not_marked']
};

if (!config.sessionSecret) {
  throw new Error('SESSION_SECRET must be set (see .env.example).');
}
if (config.isProd && config.sessionSecret.length < 32) {
  throw new Error(
    'SESSION_SECRET must be at least 32 characters in production (found ' +
    config.sessionSecret.length + '). Generate a strong value, e.g. ' +
    "`node -e \"console.log(require('crypto').randomBytes(48).toString('hex'))\"`."
  );
}

module.exports = config;
