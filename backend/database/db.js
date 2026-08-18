/* ==========================================================================
   db.js — SQLite connection management (Node built-in node:sqlite driver).
   --------------------------------------------------------------------------
   A single connection is opened lazily from config and auto-seeded when the
   database is empty, so a fresh checkout works with `npm run dev` after
   `npm run create-admin`. Tests point DB_PATH at a temp file and get their
   own isolated database.
   ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const config = require('../config/env');
const seed = require('./seed');

/* ---------------------------------------------------------------------------
   Safe in-place schema migrations for databases created by older schemas.
   `CREATE TABLE IF NOT EXISTS` never alters an existing table, so any new
   column must be added here with ALTER TABLE. Each migration is idempotent:
   it checks the live table before doing anything and only touches a legacy
   database once. Fresh databases created from schema.sql skip everything.
   --------------------------------------------------------------------------- */
function migrateSchema(db) {
  const tableCols = (table) =>
    db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);

  // ---- fee_requirements.period_key (17-month schedule, Aug 2026 – Dec 2027) --
  const feeCols = tableCols('fee_requirements');
  if (!feeCols.includes('period_key')) {
    // Legacy database. The old schema held 3 unrelated demo fees (plus the
    // matching 4 demo subjects / any demo payments). Those cannot be mapped
    // onto the monthly schedule, so this one-time upgrade clears them and lets
    // ensureSeeded() build the authoritative 17 monthly requirements.
    // Students and their login accounts are preserved untouched.
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(
        'DELETE FROM payment_transactions;' +   // FK-restricted on fee_requirements, drop first
        'DELETE FROM fee_requirements;' +
        'DELETE FROM practical_attendance;' +
        'DELETE FROM practical_subjects;'
      );
      // SQLite cannot add a NOT NULL + UNIQUE column via ALTER TABLE; a UNIQUE
      // index on the (nullable) new column enforces the same invariant while
      // schema.sql supplies NOT NULL for fresh databases.
      db.exec('ALTER TABLE fee_requirements ADD COLUMN period_key TEXT;');
      db.exec(
        'CREATE UNIQUE INDEX IF NOT EXISTS uq_fee_requirements_period_key ' +
        'ON fee_requirements(period_key) WHERE period_key IS NOT NULL;'
      );
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }

  // ---- practical_attendance: add 'late' and 'excused' to the status CHECK ----
  // SQLite cannot ALTER a CHECK constraint, so the table is rebuilt in place.
  // Existing rows are copied verbatim and every index is recreated.
  const paDef = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'practical_attendance'"
  ).get();
  if (paDef && !/['"](late|excused)['"]/.test(paDef.sql)) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(
        'ALTER TABLE practical_attendance RENAME TO practical_attendance_old;' +
        'CREATE TABLE practical_attendance (' +
          'id TEXT PRIMARY KEY, ' +
          'practical_subject_id TEXT NOT NULL, ' +
          'student_id TEXT NOT NULL, ' +
          'practical_date TEXT NOT NULL, ' +
          "attendance_status TEXT NOT NULL CHECK (attendance_status IN ('present','absent','late','excused','not_marked')), " +
          'marked_by TEXT, ' +
          'created_at TEXT NOT NULL, ' +
          'updated_at TEXT NOT NULL, ' +
          'FOREIGN KEY (practical_subject_id) REFERENCES practical_subjects(id) ON DELETE CASCADE, ' +
          'FOREIGN KEY (student_id) REFERENCES students(student_id) ON DELETE CASCADE, ' +
          'UNIQUE (practical_subject_id, student_id, practical_date)' +
        ');' +
        'INSERT INTO practical_attendance ' +
          '(id, practical_subject_id, student_id, practical_date, attendance_status, marked_by, created_at, updated_at) ' +
          'SELECT id, practical_subject_id, student_id, practical_date, attendance_status, marked_by, created_at, updated_at ' +
          'FROM practical_attendance_old;' +
        'DROP TABLE practical_attendance_old;'
      );
      db.exec(
        'CREATE INDEX IF NOT EXISTS idx_attendance_subject ON practical_attendance(practical_subject_id);' +
        'CREATE INDEX IF NOT EXISTS idx_attendance_student ON practical_attendance(student_id);' +
        'CREATE INDEX IF NOT EXISTS idx_attendance_date ON practical_attendance(practical_date);'
      );
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }

  // ---- Future migrations go here (each guarded by its own column check). ----
}

function createDatabase(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA journal_mode = WAL;');
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(schema);
  migrateSchema(db);
  return db;
}

let _db = null;

function getDb() {
  if (!_db) {
    _db = createDatabase(config.dbPath);
    // In production, seed student accounts passwordless (no shared default
    // password); in development/test the seed default '123456' is used.
    seed.ensureSeeded(_db, { passwordless: config.isProd });
  }
  return _db;
}

/* Swap the live connection (used by the admin restore-from-backup flow). */
function setDb(db) {
  _db = db;
}

/* Close the live connection (graceful shutdown). Idempotent. */
function closeDb() {
  if (_db) {
    try { _db.close(); } catch (_) {}
    _db = null;
  }
}

module.exports = { createDatabase, getDb, setDb, closeDb };
