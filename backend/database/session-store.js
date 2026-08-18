/* ==========================================================================
   session-store.js — Persistent SQLite session store for express-session.
   Sessions live in the same SQLite database as the rest of the system, so
   sessions survive server restarts.
   ========================================================================== */
'use strict';

const session = require('express-session');
const config = require('../config/env');
const { getDb } = require('./db');

class SQLiteSessionStore extends session.Store {
  /* The store resolves the live connection on every call so that the
     admin restore-from-backup flow (which swaps the connection) never
     leaves the store pointing at a closed database. */
  _db() {
    return getDb();
  }

  get(sid, callback) {
    try {
      const row = this._db()
        .prepare('SELECT sess FROM sessions WHERE sid = ? AND expire > ?')
        .get(sid, Date.now());
      callback(null, row ? JSON.parse(row.sess) : null);
    } catch (err) {
      callback(err);
    }
  }

  set(sid, sess, callback) {
    try {
      const expires = this._expiry(sess);
      this._db()
        .prepare(
          'INSERT INTO sessions (sid, sess, expire) VALUES (?,?,?) ' +
          'ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expire = excluded.expire'
        )
        .run(sid, JSON.stringify(sess), expires);
      callback(null);
    } catch (err) {
      callback(err);
    }
  }

  destroy(sid, callback) {
    try {
      this._db().prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
      callback(null);
    } catch (err) {
      callback(err);
    }
  }

  touch(sid, sess, callback) {
    try {
      this._db().prepare('UPDATE sessions SET expire = ? WHERE sid = ?')
        .run(this._expiry(sess), sid);
      callback(null);
    } catch (err) {
      callback(err);
    }
  }

  clear(callback) {
    try {
      this._db().exec('DELETE FROM sessions');
      callback(null);
    } catch (err) {
      callback(err);
    }
  }

  _expiry(sess) {
    if (sess && sess.cookie && sess.cookie.expires) {
      const t = new Date(sess.cookie.expires).getTime();
      if (!Number.isNaN(t)) return t;
    }
    return Date.now() + config.sessionMaxAgeMs;
  }
}

module.exports = { SQLiteSessionStore };
