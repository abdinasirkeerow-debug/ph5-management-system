/* ==========================================================================
   students.service.js — Student records (CRUD, status, soft delete).
   Students are never hard-deleted; "delete" soft-deletes (deactivates the
   linked account and marks the student suspended) so history is preserved.
   ========================================================================== */
'use strict';

const bcrypt = require('bcryptjs');
const { getDb } = require('../database/db');
const { writeAudit } = require('./audit.service');
const { uid, nowISO, httpError, avatarColor } = require('../utils/helpers');
const { DEFAULT_STUDENT_PASSWORD } = require('../database/seed');

const VALID_STATUSES = ['active', 'suspended', 'graduated'];

function mapStudent(row, totalPaid) {
  return {
    id: row.id,
    studentId: row.student_id,
    fullName: row.full_name,
    gender: row.gender,
    phone: row.phone,
    email: row.email,
    program: row.program,
    batch: row.batch,
    status: row.status,
    avatarColor: row.avatar_color,
    userId: row.user_id,
    totalPaid: Number(totalPaid || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

const SELECT_STUDENT = `
  SELECT s.*,
    COALESCE((SELECT SUM(amount) FROM payment_transactions p WHERE p.student_id = s.student_id), 0) AS total_paid
  FROM students s`;

function listStudents(opts) {
  opts = opts || {};
  const db = getDb();
  const where = [];
  const params = [];

  if (opts.role === 'student' && opts.forStudentId) {
    where.push('s.student_id = ?');
    params.push(opts.forStudentId);
  }
  if (opts.activeOnly) {
    where.push("s.status = 'active'");
  }
  if (opts.status) {
    where.push('s.status = ?');
    params.push(opts.status);
  }
  if (opts.search) {
    where.push('(s.full_name LIKE ? OR s.student_id LIKE ? OR s.phone LIKE ? OR s.email LIKE ?)');
    const q = `%${opts.search}%`;
    params.push(q, q, q, q);
  }

  let sql = SELECT_STUDENT;
  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ' ORDER BY s.full_name COLLATE NOCASE';

  return db.prepare(sql).all(...params).map((r) => mapStudent(r, r.total_paid));
}

function findStudentByKey(key) {
  const db = getDb();
  const row = db.prepare(
    SELECT_STUDENT + ' WHERE s.id = ? OR s.student_id = ?'
  ).get(key, key);
  return row ? mapStudent(row, row.total_paid) : null;
}

function requireStudent(key) {
  const student = findStudentByKey(key);
  if (!student) throw httpError(404, 'Student not found.');
  return student;
}

/* Admin creates a student together with their login account. */
function createStudent(payload, actor) {
  const db = getDb();
  const fullName = String(payload.fullName || '').trim();
  const studentId = String(payload.studentId || '').trim().toUpperCase();
  const gender = payload.gender === 'F' ? 'F' : 'M';
  const status = VALID_STATUSES.includes(payload.status) ? payload.status : 'active';
  const password = payload.password || DEFAULT_STUDENT_PASSWORD;

  if (!fullName) throw httpError(400, 'Full name is required.');
  if (!studentId) throw httpError(400, 'Student ID is required.');

  const now = nowISO();
  const hash = bcrypt.hashSync(password, 10);

  db.exec('BEGIN IMMEDIATE');
  try {
    const existingStudent = db.prepare('SELECT student_id FROM students WHERE student_id = ?').get(studentId);
    if (existingStudent) throw httpError(409, 'A student with this ID already exists.');
    const existingUser = db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE').get(studentId);
    if (existingUser) throw httpError(409, 'A login account with this username already exists.');

    const userId = uid('usr');
    db.prepare(
      `INSERT INTO users (id, username, email, full_name, password_hash, role, active, must_change_password, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    ).run(userId, studentId, payload.email || null, fullName, hash, 'student', 1, 1, now, now);

    const studentRow = {
      id: uid('stu'),
      student_id: studentId,
      full_name: fullName,
      gender,
      phone: payload.phone || null,
      email: payload.email || null,
      status,
      avatar_color: avatarColor(studentId),
      user_id: userId,
      created_at: now,
      updated_at: now
    };
    db.prepare(
      `INSERT INTO students (id, student_id, full_name, gender, phone, email, program, batch, status, avatar_color, user_id, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      studentRow.id, studentRow.student_id, studentRow.full_name, studentRow.gender,
      studentRow.phone, studentRow.email, 'Public Health', 'Batch Five', studentRow.status,
      studentRow.avatar_color, studentRow.user_id, studentRow.created_at, studentRow.updated_at
    );
    db.exec('COMMIT');

    writeAudit(actor, 'STUDENT_CREATE', 'student', studentRow.id,
      `Created ${studentId} (${fullName}) with login account`);

    const student = findStudentByKey(studentId);
    return { student, account: { id: userId, username: studentId, role: 'student' } };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/* Update editable fields. Student ID changes are allowed only when the
   student has no payments or attendance yet (otherwise history would break). */
function updateStudent(key, patch, actor) {
  const db = getDb();
  const current = requireStudent(key);

  const changes = {};
  if (patch.fullName !== undefined) changes.full_name = String(patch.fullName).trim();
  if (patch.gender !== undefined) changes.gender = patch.gender === 'F' ? 'F' : 'M';
  if (patch.phone !== undefined) changes.phone = patch.phone || null;
  if (patch.email !== undefined) changes.email = patch.email || null;
  if (patch.status !== undefined) {
    if (!VALID_STATUSES.includes(patch.status)) throw httpError(400, 'Invalid student status.');
    changes.status = patch.status;
  }

  let newStudentId = null;
  if (patch.studentId !== undefined) {
    const sid = String(patch.studentId).trim().toUpperCase();
    if (sid !== current.studentId) {
      const hasRecords = db.prepare(
        'SELECT (SELECT COUNT(*) FROM payment_transactions WHERE student_id = ?) + ' +
        '(SELECT COUNT(*) FROM practical_attendance WHERE student_id = ?) AS c'
      ).get(current.studentId, current.studentId).c > 0;
      if (hasRecords) {
        throw httpError(409, 'Student ID cannot be changed because this student already has payment or attendance records.');
      }
      const clash = db.prepare('SELECT id FROM students WHERE student_id = ? AND id != ?').get(sid, current.id);
      if (clash) throw httpError(409, 'A student with this ID already exists.');
      newStudentId = sid;
    }
  }

  const now = nowISO();
  db.exec('BEGIN IMMEDIATE');
  try {
    if (newStudentId) {
      db.prepare('UPDATE students SET student_id = ?, updated_at = ? WHERE id = ?')
        .run(newStudentId, now, current.id);
      db.prepare('UPDATE users SET username = ?, updated_at = ? WHERE id = ?')
        .run(newStudentId, now, current.userId);
      changes.student_id = newStudentId;
    }
    if (Object.keys(changes).length) {
      const sets = Object.keys(changes).map((k) => `${k} = ?`).join(', ');
      db.prepare(`UPDATE students SET ${sets}, updated_at = ? WHERE id = ?`)
        .run(...Object.values(changes), now, current.id);
    }
    // Keep the linked account's display name in sync.
    if (patch.fullName !== undefined && current.userId) {
      db.prepare('UPDATE users SET full_name = ?, updated_at = ? WHERE id = ?')
        .run(changes.full_name, now, current.userId);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  writeAudit(actor, 'STUDENT_UPDATE', 'student', current.id,
    `Updated ${newStudentId || current.studentId} (${changes.full_name || current.fullName})`);

  return findStudentByKey(newStudentId || current.studentId);
}

/* Set status (active/suspended/graduated) and sync the login account. */
function setStudentStatus(key, status, actor) {
  const db = getDb();
  if (!VALID_STATUSES.includes(status)) throw httpError(400, 'Invalid student status.');
  const student = requireStudent(key);

  const now = nowISO();
  db.prepare('UPDATE students SET status = ?, updated_at = ? WHERE id = ?').run(status, now, student.id);
  if (student.userId) {
    db.prepare('UPDATE users SET active = ?, updated_at = ? WHERE id = ?')
      .run(status === 'active' ? 1 : 0, now, student.userId);
  }

  const action = status === 'active' ? 'STUDENT_REACTIVATE' : status === 'suspended' ? 'STUDENT_SUSPEND' : 'STUDENT_STATUS';
  writeAudit(actor, action, 'student', student.id, `${status.toUpperCase()} ${student.studentId}`);
  return findStudentByKey(student.id);
}

/* Soft delete — deactivates the account, keeps every record. */
function archiveStudent(key, actor) {
  const db = getDb();
  const student = requireStudent(key);

  const now = nowISO();
  db.prepare('UPDATE students SET status = ?, updated_at = ? WHERE id = ?').run('suspended', now, student.id);
  if (student.userId) {
    db.prepare('UPDATE users SET active = 0, updated_at = ? WHERE id = ?').run(now, student.userId);
  }
  writeAudit(actor, 'STUDENT_DELETE', 'student', student.id,
    `Soft-deleted ${student.studentId} (${student.fullName}); account deactivated`);
  return findStudentByKey(student.id);
}

module.exports = {
  listStudents,
  findStudentByKey,
  requireStudent,
  createStudent,
  updateStudent,
  setStudentStatus,
  archiveStudent
};
