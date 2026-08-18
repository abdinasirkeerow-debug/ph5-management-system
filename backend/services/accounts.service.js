/* ==========================================================================
   accounts.service.js — Login account management (admin-only routes).
   Password hashes are never returned by any API response.
   ========================================================================== */
'use strict';

const bcrypt = require('bcryptjs');
const { getDb } = require('../database/db');
const { writeAudit } = require('./audit.service');
const { uid, nowISO, httpError } = require('../utils/helpers');

const ROLES = ['student', 'class_leader', 'admin'];

function mapAccount(row) {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    fullName: row.full_name,
    role: row.role,
    studentId: row.linked_student_id || null,
    isActive: !!row.active,
    mustChangePassword: !!row.must_change_password,
    lastLogin: row.last_login,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function listAccounts() {
  const db = getDb();
  const rows = db.prepare(
    `SELECT u.*, s.student_id AS linked_student_id
     FROM users u LEFT JOIN students s ON s.user_id = u.id
     ORDER BY u.full_name COLLATE NOCASE, u.username COLLATE NOCASE`
  ).all();
  return rows.map(mapAccount);
}

function findAccountById(id) {
  const db = getDb();
  const row = db.prepare(
    `SELECT u.*, s.student_id AS linked_student_id
     FROM users u LEFT JOIN students s ON s.user_id = u.id WHERE u.id = ?`
  ).get(id);
  return row ? mapAccount(row) : null;
}

function createAccount(payload, actor) {
  const db = getDb();
  const username = String(payload.username || '').trim();
  const fullName = String(payload.fullName || '').trim();
  const role = payload.role || 'student';
  const password = payload.password || '123456';

  if (!username) throw httpError(400, 'Username is required.');
  if (!fullName) throw httpError(400, 'Full name is required.');
  if (!ROLES.includes(role)) throw httpError(400, 'Invalid role.');

  const existing = db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE').get(username);
  if (existing) throw httpError(409, 'A user with this username already exists.');

  /* The Class Leaders Portal is scoped to a maximum of two active leaders.
     Counting only active accounts means deactivating one frees its slot. */
  if (role === 'class_leader') {
    const leaders = db.prepare(
      "SELECT COUNT(*) AS c FROM users WHERE role = 'class_leader' AND active = 1"
    ).get().c;
    if (leaders >= 2) {
      throw httpError(409, 'A maximum of two class leaders are allowed.');
    }
  }

  let linkedStudentId = payload.studentId || null;
  if (linkedStudentId) {
    const student = db.prepare('SELECT id, user_id FROM students WHERE student_id = ?').get(linkedStudentId);
    if (!student) throw httpError(404, 'Linked student not found.');
    if (student.user_id) throw httpError(409, 'That student already has a login account.');
  }

  const now = nowISO();
  const hash = bcrypt.hashSync(password, 10);
  const id = uid('usr');
  db.prepare(
    `INSERT INTO users (id, username, email, full_name, password_hash, role, active, must_change_password, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).run(id, username, payload.email || null, fullName, hash, role, 1, 1, now, now);

  if (linkedStudentId) {
    db.prepare('UPDATE students SET user_id = ?, updated_at = ? WHERE student_id = ?')
      .run(id, now, linkedStudentId);
  }

  writeAudit(actor, 'USER_CREATE', 'user', id, `Created ${role} account: ${username}`);
  return findAccountById(id);
}

function setAccountActive(id, active, actor) {
  const db = getDb();
  const account = findAccountById(id);
  if (!account) throw httpError(404, 'Account not found.');
  if (!active && actor && actor.id === id) {
    throw httpError(400, 'You cannot deactivate your own account.');
  }
  const now = nowISO();
  db.prepare('UPDATE users SET active = ?, updated_at = ? WHERE id = ?').run(active ? 1 : 0, now, id);
  writeAudit(actor, active ? 'ACCOUNT_ACTIVATE' : 'ACCOUNT_DEACTIVATE', 'user', id,
    `${active ? 'Activated' : 'Deactivated'} account: ${account.username}`);
  return findAccountById(id);
}

/* Admin-assigned temporary password; forces a change at next sign-in. */
function resetPassword(id, newPassword, actor) {
  const db = getDb();
  const account = findAccountById(id);
  if (!account) throw httpError(404, 'Account not found.');
  if (actor && actor.id === id) {
    throw httpError(400, 'Use "Change my password" to change your own password.');
  }
  if (!newPassword || String(newPassword).length < 6) {
    throw httpError(400, 'New password must be at least 6 characters.');
  }
  const now = nowISO();
  const hash = bcrypt.hashSync(String(newPassword), 10);
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 1, updated_at = ? WHERE id = ?')
    .run(hash, now, id);
  writeAudit(actor, 'PASSWORD_RESET', 'user', id, `Admin reset password for ${account.username}`);
  return findAccountById(id);
}

/* Promote an active student account to class leader (max two active).
   Only the role changes — the linked student record, password and every
   fee/payment/attendance record are preserved untouched. Counting only
   active leaders means deactivating one frees its slot. */
function assignLeader(id, actor) {
  const db = getDb();
  const account = findAccountById(id);
  if (!account) throw httpError(404, 'Account not found.');
  if (account.role === 'class_leader') throw httpError(400, 'This account is already a class leader.');
  if (account.role !== 'student') throw httpError(400, 'Only student accounts can be assigned as class leaders.');
  if (!account.isActive) throw httpError(400, 'Only active accounts can be assigned as class leaders.');
  if (!account.studentId) throw httpError(400, 'This account is not linked to a student.');

  const leaders = db.prepare(
    "SELECT COUNT(*) AS c FROM users WHERE role = 'class_leader' AND active = 1"
  ).get().c;
  if (leaders >= 2) {
    throw httpError(409, 'A maximum of two class leaders are allowed.');
  }

  const now = nowISO();
  db.prepare("UPDATE users SET role = 'class_leader', updated_at = ? WHERE id = ?").run(now, id);
  writeAudit(actor, 'ROLE_ASSIGN_LEADER', 'user', id,
    `Assigned ${account.fullName} (${account.username}) as a class leader.`,
    { oldValue: 'student', newValue: 'class_leader' });
  return findAccountById(id);
}

/* Demote a class leader back to a student account. The account, linked
   student record, password, fees, payments and attendance are all preserved. */
function removeLeader(id, actor) {
  const db = getDb();
  const account = findAccountById(id);
  if (!account) throw httpError(404, 'Account not found.');
  if (account.role !== 'class_leader') throw httpError(400, 'This account is not a class leader.');

  const now = nowISO();
  db.prepare("UPDATE users SET role = 'student', updated_at = ? WHERE id = ?").run(now, id);
  writeAudit(actor, 'ROLE_REMOVE_LEADER', 'user', id,
    `Removed ${account.fullName} (${account.username}) as a class leader.`,
    { oldValue: 'class_leader', newValue: 'student' });
  return findAccountById(id);
}

module.exports = {
  listAccounts, findAccountById, createAccount, setAccountActive, resetPassword,
  assignLeader, removeLeader
};
