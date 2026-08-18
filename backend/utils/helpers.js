/* ==========================================================================
   helpers.js — Small shared utilities (ids, dates, hashing, HTTP errors).
   ========================================================================== */
'use strict';

/* Deterministic 53-bit hash — mirrors the cyrb53 used in the frontend so that
   generated values (avatar colors, phones, emails) match the original design. */
function cyrb53(str, seed) {
  seed = seed || 0;
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

const AVATAR_PALETTE = ['#2456c7', '#0f9b96', '#e08f00', '#7c5cd6', '#d6457f', '#0f9d58', '#4a6fa5', '#b0612b'];

function avatarColor(seedStr) {
  return AVATAR_PALETTE[cyrb53(String(seedStr)) % AVATAR_PALETTE.length];
}

function uid(prefix) {
  const rnd = Math.random().toString(36).slice(2, 8) + Math.random().toString(36).slice(2, 8);
  return (prefix || 'id') + '_' + Date.now().toString(36) + rnd;
}

function nowISO() {
  return new Date().toISOString();
}

function todayISO() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

/* Current YYYY-MM in the application timezone (see config.appTimezone).
   A monthly fee is "due" once its month has begun in this zone; using the
   server's UTC/local wall clock could open or block a month at the wrong time
   for hosted servers. Falls back to the local date if the zone is unsupported. */
function currentPeriodKey() {
  let year, month;
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: require('../config/env').appTimezone,
      year: 'numeric',
      month: '2-digit'
    }).formatToParts(new Date());
    year = parts.find((p) => p.type === 'year').value;
    month = parts.find((p) => p.type === 'month').value;
  } catch (_) {
    const d = new Date();
    year = String(d.getFullYear());
    month = String(d.getMonth() + 1).padStart(2, '0');
  }
  return `${year}-${month}`;
}

/* Deterministic phone in the same format the original seed used. */
function makePhone(studentId) {
  const h = cyrb53(studentId + '|phone');
  return '+252 6' + String(10 + (h % 8)) + ' ' + String(1000000 + (h % 8999999));
}

/* Deterministic student email in the same format the original seed used. */
function makeEmail(name, studentId) {
  const parts = String(name).toLowerCase().replace(/[^a-z ]/g, '').trim().split(/\s+/);
  return (parts[0] + '.' + (parts[1] || String(studentId).slice(-3))) + '@student.zamzam.edu.so';
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function httpError(status, message) {
  return new HttpError(status, message);
}

/* Wrap an async route handler so rejections reach the error middleware. */
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

/* Normalise a number from JSON input (may arrive as string in some clients). */
function toNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

module.exports = {
  cyrb53,
  avatarColor,
  uid,
  nowISO,
  todayISO,
  currentPeriodKey,
  makePhone,
  makeEmail,
  HttpError,
  httpError,
  asyncHandler,
  toNumber
};
