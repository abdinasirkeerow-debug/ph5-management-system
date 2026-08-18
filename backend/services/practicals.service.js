/* ==========================================================================
   practicals.service.js — Practical subjects + session-based attendance.
   --------------------------------------------------------------------------
   - Subjects are dynamic (admin-managed), never hard-coded.
   - Opening a session creates a `not_marked` record for every active student.
   - Attendance supports present / absent / not_marked, single-student marks
     and confirmed mass actions (all present / all absent / reset).
   - Students and class leaders are strictly read-only; every change is
     written by an admin and logged to the audit trail.
   ========================================================================== */
'use strict';

const { getDb } = require('../database/db');
const { writeAudit } = require('./audit.service');
const { uid, nowISO, todayISO, httpError } = require('../utils/helpers');

const STATUSES = ['present', 'absent', 'late', 'excused', 'not_marked'];

function mapSubject(row) {
  return {
    id: row.id,
    name: row.subject_name,
    code: row.code,
    practicalDate: row.practical_date,
    instructor: row.instructor,
    description: row.notes,
    isActive: row.status === 'active',
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapAttendance(row) {
  return {
    id: row.id,
    subjectId: row.practical_subject_id,
    studentId: row.student_id,
    studentName: row.student_name || null,
    studentGender: row.student_gender || null,
    avatarColor: row.avatar_color || null,
    date: row.practical_date,
    status: row.attendance_status,
    markedBy: row.marker_username || null,
    markedByName: row.marker_full_name || null,
    markedAt: row.updated_at
  };
}

function listSubjects() {
  const db = getDb();
  return db.prepare('SELECT * FROM practical_subjects ORDER BY subject_name COLLATE NOCASE').all().map(mapSubject);
}

function findSubjectById(id) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM practical_subjects WHERE id = ?').get(id);
  return row ? mapSubject(row) : null;
}

function activeStudents(studentId) {
  const db = getDb();
  if (studentId) {
    return db.prepare(
      "SELECT * FROM students WHERE student_id = ? AND status = 'active'"
    ).all(studentId);
  }
  return db.prepare("SELECT * FROM students WHERE status = 'active' ORDER BY full_name COLLATE NOCASE").all();
}

const ATTENDANCE_SELECT = `
  SELECT a.*, s.full_name AS student_name, s.gender AS student_gender, s.avatar_color,
    u.username AS marker_username, u.full_name AS marker_full_name
  FROM practical_attendance a
  LEFT JOIN students s ON s.student_id = a.student_id
  LEFT JOIN users u ON u.id = a.marked_by`;

function sessionRecords(subjectId, date, opts) {
  opts = opts || {};
  const db = getDb();
  const where = ['a.practical_subject_id = ?', 'a.practical_date = ?'];
  const params = [subjectId, date];
  if (opts.role === 'student' && opts.forStudentId) {
    where.push('a.student_id = ?');
    params.push(opts.forStudentId);
  }
  const sql = ATTENDANCE_SELECT + ' WHERE ' + where.join(' AND ') +
    ' ORDER BY s.full_name COLLATE NOCASE';
  return db.prepare(sql).all(...params).map(mapAttendance);
}

/* Opening a session creates a not_marked record for every active student. */
function openSession(subjectId, date, actor, ip) {
  const db = getDb();
  const subject = findSubjectById(subjectId);
  if (!subject) throw httpError(404, 'Practical subject not found.');
  if (!date) throw httpError(400, 'A session date is required.');

  const students = activeStudents();
  const now = nowISO();
  const insert = db.prepare(
    `INSERT OR IGNORE INTO practical_attendance
       (id, practical_subject_id, student_id, practical_date, attendance_status, marked_by, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?)`
  );
  db.exec('BEGIN IMMEDIATE');
  try {
    students.forEach((s) => {
      insert.run(uid('att'), subjectId, s.student_id, date, 'not_marked', actor ? actor.id : null, now, now);
    });
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  writeAudit(actor, 'ATTENDANCE_SESSION_OPEN', 'attendance', `${subjectId}|${date}`,
    `Opened session for ${subject.name} on ${date} (${students.length} students)`, { ip });
  return sessionRecords(subjectId, date, {});
}

/* Save individual marks and/or a mass action. Entries upserted; an action
   applies to every active student in the session. */
function saveAttendance(subjectId, date, payload, actor, ip) {
  const db = getDb();
  const subject = findSubjectById(subjectId);
  if (!subject) throw httpError(404, 'Practical subject not found.');
  if (!date) throw httpError(400, 'A session date is required.');

  const now = nowISO();
  const upsert = db.prepare(
    `INSERT INTO practical_attendance
       (id, practical_subject_id, student_id, practical_date, attendance_status, marked_by, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?)
     ON CONFLICT(practical_subject_id, student_id, practical_date)
     DO UPDATE SET attendance_status = excluded.attendance_status, marked_by = excluded.marked_by, updated_at = excluded.updated_at`
  );

  const action = payload.action || null;
  const entries = Array.isArray(payload.entries) ? payload.entries : [];

  try {
    db.exec('BEGIN IMMEDIATE');

    // Validated entries (single-student marks).
    entries.forEach((e) => {
      const status = e.status;
      if (!STATUSES.includes(status)) throw httpError(400, `Invalid attendance status: ${status}`);
      const student = db.prepare('SELECT student_id FROM students WHERE student_id = ?').get(e.studentId);
      if (!student) throw httpError(404, 'Student not found.');
      upsert.run(uid('att'), subjectId, e.studentId, date, status, actor ? actor.id : null, now, now);
    });

    // Mass action over all active students.
    if (action === 'all-present' || action === 'all-absent' || action === 'reset') {
      const status = action === 'all-present' ? 'present' : action === 'all-absent' ? 'absent' : 'not_marked';
      activeStudents().forEach((s) => {
        upsert.run(uid('att'), subjectId, s.student_id, date, status, actor ? actor.id : null, now, now);
      });
    } else if (action != null) {
      throw httpError(400, 'Invalid mass action.');
    }

    if (!entries.length && !action) {
      throw httpError(400, 'Nothing to save: provide entries or a mass action.');
    }

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  writeAudit(actor, 'ATTENDANCE_UPDATE', 'attendance', `${subjectId}|${date}`,
    `Saved attendance for ${subject.name} on ${date}` +
    (entries.length ? ` (${entries.length} student mark${entries.length === 1 ? '' : 's'})` : '') +
    (action ? ` (mass: ${action})` : ''), { ip });

  return sessionRecords(subjectId, date, {});
}

/* All attendance rows for a subject (students see only their own). */
function sessionRecordsForSubject(subjectId, opts) {
  opts = opts || {};
  const db = getDb();
  const where = ['a.practical_subject_id = ?'];
  const params = [subjectId];
  if (opts.role === 'student' && opts.forStudentId) {
    where.push('a.student_id = ?');
    params.push(opts.forStudentId);
  }
  const sql = ATTENDANCE_SELECT + ' WHERE ' + where.join(' AND ') +
    ' ORDER BY a.practical_date DESC, s.full_name COLLATE NOCASE';
  return db.prepare(sql).all(...params).map(mapAttendance);
}

/* All attendance rows in the system (students see only their own). */
function listAttendanceAll(opts) {
  opts = opts || {};
  const db = getDb();
  const where = [];
  const params = [];
  if (opts.role === 'student' && opts.forStudentId) {
    where.push('a.student_id = ?');
    params.push(opts.forStudentId);
  }
  const sql = ATTENDANCE_SELECT +
    (where.length ? ' WHERE ' + where.join(' AND ') : '') +
    ' ORDER BY a.practical_date DESC, a.practical_subject_id';
  return db.prepare(sql).all(...params).map(mapAttendance);
}

function deleteSession(subjectId, date, actor, ip) {
  const db = getDb();
  const subject = findSubjectById(subjectId);
  if (!subject) throw httpError(404, 'Practical subject not found.');
  const count = db.prepare(
    'SELECT COUNT(*) AS c FROM practical_attendance WHERE practical_subject_id = ? AND practical_date = ?'
  ).get(subjectId, date).c;
  db.prepare('DELETE FROM practical_attendance WHERE practical_subject_id = ? AND practical_date = ?')
    .run(subjectId, date);
  writeAudit(actor, 'ATTENDANCE_SESSION_DELETE', 'attendance', `${subjectId}|${date}`,
    `Deleted session for ${subject.name} on ${date} (${count} records)`, { ip });
  return { ok: true, removed: count };
}

function createSubject(payload, actor, ip) {
  const db = getDb();
  const name = String(payload.name || '').trim();
  if (!name) throw httpError(400, 'A subject name is required.');
  const now = nowISO();
  const id = payload.id || uid('sub');
  const practicalDate = payload.practicalDate || null;

  db.prepare(
    `INSERT INTO practical_subjects
       (id, subject_name, code, practical_date, instructor, notes, status, created_by, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).run(
    id, name, payload.code || null, practicalDate, payload.instructor || null,
    payload.description || null, payload.isActive === false ? 'inactive' : 'active',
    actor ? actor.id : null, now, now
  );

  writeAudit(actor, 'SUBJECT_CREATE', 'subject', id, `Created practical subject: ${name}`, { ip });

  let baseline = null;
  // When a practical date is supplied, every active student immediately
  // appears as "not marked" for that session (per spec).
  if (practicalDate) {
    baseline = openSession(id, practicalDate, actor, ip);
  }
  return { subject: findSubjectById(id), attendance: baseline };
}

function updateSubject(id, patch, actor, ip) {
  const db = getDb();
  const current = findSubjectById(id);
  if (!current) throw httpError(404, 'Practical subject not found.');
  const changes = {};
  if (patch.name !== undefined) {
    const name = String(patch.name).trim();
    if (!name) throw httpError(400, 'A subject name is required.');
    changes.subject_name = name;
  }
  if (patch.code !== undefined) changes.code = patch.code || null;
  if (patch.instructor !== undefined) changes.instructor = patch.instructor || null;
  if (patch.description !== undefined) changes.notes = patch.description || null;
  if (patch.isActive !== undefined) changes.status = patch.isActive ? 'active' : 'inactive';

  const now = nowISO();
  if (Object.keys(changes).length) {
    const sets = Object.keys(changes).map((k) => `${k} = ?`).join(', ');
    db.prepare(`UPDATE practical_subjects SET ${sets}, updated_at = ? WHERE id = ?`)
      .run(...Object.values(changes), now, id);
  }
  writeAudit(actor, 'SUBJECT_UPDATE', 'subject', id, `Updated subject: ${changes.subject_name || current.name}`, { ip });
  return findSubjectById(id);
}

function toggleSubject(id, actor, ip) {
  const db = getDb();
  const current = findSubjectById(id);
  if (!current) throw httpError(404, 'Practical subject not found.');
  const status = current.isActive ? 'inactive' : 'active';
  db.prepare('UPDATE practical_subjects SET status = ?, updated_at = ? WHERE id = ?')
    .run(status, nowISO(), id);
  writeAudit(actor, status === 'active' ? 'SUBJECT_ACTIVATE' : 'SUBJECT_DEACTIVATE', 'subject', id,
    `${status === 'active' ? 'Activated' : 'Deactivated'} subject: ${current.name}`, { ip });
  return findSubjectById(id);
}

function deleteSubject(id, actor, ip) {
  const db = getDb();
  const current = findSubjectById(id);
  if (!current) throw httpError(404, 'Practical subject not found.');
  const linked = db.prepare(
    'SELECT COUNT(*) AS c FROM practical_attendance WHERE practical_subject_id = ?'
  ).get(id).c;
  db.prepare('DELETE FROM practical_subjects WHERE id = ?').run(id); // cascades attendance
  writeAudit(actor, 'SUBJECT_DELETE', 'subject', id,
    `Deleted subject: ${current.name}${linked ? ` (${linked} attendance records)` : ''}`, { ip });
  return { ok: true, removed: linked };
}

/* Aggregated stats used by dashboards. */
function attendanceStats(subjectId) {
  const db = getDb();
  let sql =
    'SELECT attendance_status, COUNT(*) AS c FROM practical_attendance';
  const params = [];
  if (subjectId) {
    sql += ' WHERE practical_subject_id = ?';
    params.push(subjectId);
  }
  sql += ' GROUP BY attendance_status';
  const rows = db.prepare(sql).all(...params);
  const counts = { present: 0, absent: 0, late: 0, excused: 0, notMarked: 0 };
  rows.forEach((r) => {
    if (r.attendance_status === 'present') counts.present = r.c;
    else if (r.attendance_status === 'absent') counts.absent = r.c;
    else if (r.attendance_status === 'late') counts.late = r.c;
    else if (r.attendance_status === 'excused') counts.excused = r.c;
    else counts.notMarked = r.c;
  });
  const total = counts.present + counts.absent + counts.late + counts.excused + counts.notMarked;
  const marked = counts.present + counts.absent;
  return {
    present: counts.present,
    absent: counts.absent,
    late: counts.late,
    excused: counts.excused,
    notMarked: counts.notMarked,
    total,
    marked,
    rate: marked ? Math.round((counts.present / marked) * 100) : 0
  };
}

module.exports = {
  STATUSES,
  listSubjects,
  findSubjectById,
  createSubject,
  updateSubject,
  toggleSubject,
  deleteSubject,
  openSession,
  sessionRecords,
  sessionRecordsForSubject,
  listAttendanceAll,
  saveAttendance,
  deleteSession,
  attendanceStats
};
