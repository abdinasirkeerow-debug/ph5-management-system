/* ==========================================================================
   seed.js — Idempotent seed of the authoritative Batch Five dataset.
   --------------------------------------------------------------------------
   - 59 students (verbatim from roster.js) + one login account each.
   - 17 monthly fee requirements (Aug 2026 – Dec 2027): $2/month per student.
   - NO demo practical subjects — those are created by authorised staff via the UI.
   - No demo payments/attendance are seeded.
   - Running it twice never creates duplicates.
   ========================================================================== */
'use strict';

const bcrypt = require('bcryptjs');
const roster = require('./roster');
const config = require('../config/env');
const helpers = require('../utils/helpers');

const { uid, nowISO, avatarColor, makePhone, makeEmail } = helpers;

/* Student accounts all start on this temporary password (must be changed at
   first sign-in). It is a seed default, not a hard-coded admin credential.
   In production, student accounts are seeded passwordless instead: the login
   flow refuses to accept them until staff assign a real password. */
const DEFAULT_STUDENT_PASSWORD = '123456';

function seedStudentsAndUsers(db, now, opts) {
  opts = opts || {};
  const insertStudent = db.prepare(
    `INSERT INTO students
       (id, student_id, full_name, gender, phone, email, program, batch, status, avatar_color, user_id, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
  );
  const insertUser = db.prepare(
    `INSERT INTO users
       (id, username, email, full_name, password_hash, role, active, must_change_password, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  );

  // Hash once and reuse — all student temp passwords are the same value.
  // In passwordless mode there is deliberately NO hash: accounts cannot log in
  // until an admin sets a real password (must_change_password = 1).
  const hash = opts.passwordless ? null : bcrypt.hashSync(DEFAULT_STUDENT_PASSWORD, 10);

  roster.forEach(([studentId, fullName, gender]) => {
    const userId = uid('usr');
    insertUser.run(userId, studentId, makeEmail(fullName, studentId), fullName, hash, 'student', 1, 1, now, now);
    insertStudent.run(
      uid('stu'), studentId, fullName, gender, makePhone(studentId), makeEmail(fullName, studentId),
      'Public Health', 'Batch Five', 'active', avatarColor(studentId), userId, now, now
    );
  });
}

function seedMonthlyFees(db, now) {
  const insert = db.prepare(
    `INSERT INTO fee_requirements
       (id, title, category, required_amount, due_date, period_key, description, active, created_by, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  );

  // 17 months: August 2026 through December 2027
  const months = [
    { year: 2026, month: 8 },
    { year: 2026, month: 9 },
    { year: 2026, month: 10 },
    { year: 2026, month: 11 },
    { year: 2026, month: 12 },
    { year: 2027, month: 1 },
    { year: 2027, month: 2 },
    { year: 2027, month: 3 },
    { year: 2027, month: 4 },
    { year: 2027, month: 5 },
    { year: 2027, month: 6 },
    { year: 2027, month: 7 },
    { year: 2027, month: 8 },
    { year: 2027, month: 9 },
    { year: 2027, month: 10 },
    { year: 2027, month: 11 },
    { year: 2027, month: 12 }
  ];

  months.forEach(({ year, month }, idx) => {
    const monthStr = String(month).padStart(2, '0');
    const periodKey = `${year}-${monthStr}`;
    const id = `fee_${periodKey.replace('-', '_')}`;
    const monthName = new Date(year, month - 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
    const title = `Monthly Contribution — ${monthName}`;
    const lastDay = new Date(year, month, 0).getDate();
    const dueDate = `${year}-${monthStr}-${String(lastDay).padStart(2, '0')}`;
    const description = `Monthly contribution for ${monthName} ($2 per student).`;

    insert.run(id, title, 'Monthly', 2, dueDate, periodKey, description, 1, null, now, now);
  });
}

/* Ensure the base dataset exists. No-op (idempotent) when already seeded. */
function ensureSeeded(db, opts) {
  opts = opts || {};
  const now = nowISO();
  const studentCount = db.prepare('SELECT COUNT(*) AS c FROM students').get().c;

  db.exec('BEGIN IMMEDIATE');
  try {
    if (studentCount === 0) {
      seedStudentsAndUsers(db, now, opts);
    }
    const feeCount = db.prepare('SELECT COUNT(*) AS c FROM fee_requirements').get().c;
    if (feeCount === 0) seedMonthlyFees(db, now);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return { students: db.prepare('SELECT COUNT(*) AS c FROM students').get().c };
}

/* Wipe all data (FK-safe order) and re-seed. Used by tests and the
   admin-controlled factory reset. Staff login accounts (admin / class
   leaders) are preserved so the acting admin can keep working after a
   reset; student accounts and all academic records are rebuilt from the
   authoritative roster. */
function resetDatabase(db) {
  db.exec('PRAGMA foreign_keys = OFF;');
  try {
    db.exec(
      'DELETE FROM sessions;' +
      'DELETE FROM audit_logs;' +
      'DELETE FROM practical_attendance;' +
      'DELETE FROM practical_subjects;' +
      'DELETE FROM payment_transactions;' +
      'DELETE FROM fee_requirements;' +
      'DELETE FROM students;' +
      "DELETE FROM users WHERE role = 'student';"
    );
  } finally {
    db.exec('PRAGMA foreign_keys = ON;');
  }
  ensureSeeded(db, { passwordless: config.isProd });
}

module.exports = { ensureSeeded, resetDatabase, DEFAULT_STUDENT_PASSWORD };
