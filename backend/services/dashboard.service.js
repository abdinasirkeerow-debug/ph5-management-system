/* ==========================================================================
   dashboard.service.js — Batch-wide and per-student summaries, calculated
   live from source transactions (never stored).
   ========================================================================== */
'use strict';

const { getDb } = require('../database/db');
const { listFees, findFeeById } = require('./fees.service');
const { totalPaidFor, feeStatus } = require('./payments.service');
const { attendanceStats, listSubjects, sessionRecords } = require('./practicals.service');
const { currentPeriodKey } = require('../utils/helpers');

function isCurrentOrPastMonth(periodKey) {
  // periodKey format: YYYY-MM. Lexicographic compare of zero-padded YYYY-MM is
  // chronological; the "now" is resolved in the application timezone so a
  // UTC-hosted server and the frontend agree on which month has begun.
  return String(periodKey) <= currentPeriodKey();
}

function getMonthStatus(periodKey) {
  if (isCurrentOrPastMonth(periodKey)) return 'due';
  return 'not_due';
}

function batchSummary() {
  const db = getDb();
  const fees = listFees().filter((f) => f.isActive);
  const students = db.prepare("SELECT student_id FROM students WHERE status = 'active' ORDER BY full_name COLLATE NOCASE").all();
  const activeStudentCount = students.length;

  // Separate fees by due status
  const dueFees = fees.filter(f => isCurrentOrPastMonth(f.periodKey));
  const futureFees = fees.filter(f => !isCurrentOrPastMonth(f.periodKey));

  const totalRequired = dueFees.reduce((sum, f) => sum + f.amountRequired * activeStudentCount, 0);
  const totalScheduledAll = fees.reduce((sum, f) => sum + f.amountRequired * activeStudentCount, 0);
  const totalCollected = Number(
    db.prepare('SELECT COALESCE(SUM(amount),0) AS t FROM payment_transactions').get().t
  );

  // Per-fee breakdown + paid/partial/unpaid counts.
  const feeBreakdown = fees.map((f) => {
    const isDue = isCurrentOrPastMonth(f.periodKey);
    const collected = Number(db.prepare(
      'SELECT COALESCE(SUM(amount),0) AS t FROM payment_transactions WHERE fee_requirement_id = ?'
    ).get(f.id).t);

    const counts = { paid: 0, partial: 0, unpaid: 0, not_due: 0 };
    if (isDue) {
      students.forEach((s) => {
        const st = feeStatus(s.student_id, f);
        counts[st.key]++;
      });
    } else {
      counts.not_due = activeStudentCount;
    }
    return {
      feeId: f.id,
      title: f.title,
      periodKey: f.periodKey,
      required: f.amountRequired,
      expected: isDue ? f.amountRequired * activeStudentCount : 0,
      collected,
      counts,
      status: isDue ? 'due' : 'not_due'
    };
  });

  // Overall student status across all DUE active fees only.
  const overall = { paid: 0, partial: 0, unpaid: 0 };
  students.forEach((s) => {
    let paid = 0;
    let required = 0;
    dueFees.forEach((f) => {
      paid += totalPaidFor(s.student_id, f.id);
      required += f.amountRequired;
    });
    if (required === 0) {
      // No due fees yet
      overall.unpaid++; // neutral
    } else if (paid <= 0) {
      overall.unpaid++;
    } else if (paid < required) {
      overall.partial++;
    } else {
      overall.paid++;
    }
  });

  const attn = attendanceStats(null);
  const subjects = listSubjects();

  return {
    activeStudents: activeStudentCount,
    totalRequired,           // Total required for DUE months only
    totalScheduledAll,       // Total scheduled for ALL months (including future)
    totalCollected,
    totalRemaining: Math.max(0, totalRequired - totalCollected),
    totalScheduledRemaining: Math.max(0, totalScheduledAll - totalCollected),
    feeCount: fees.length,
    dueFeeCount: dueFees.length,
    futureFeeCount: futureFees.length,
    paymentCount: Number(db.prepare('SELECT COUNT(*) AS c FROM payment_transactions').get().c),
    subjectCount: subjects.length,
    attendanceCount: attn.total,
    statusCounts: overall,
    attendance: { present: attn.present, absent: attn.absent, late: attn.late, excused: attn.excused, notMarked: attn.notMarked, rate: attn.rate },
    feeBreakdown
  };
}

/* A student's own view. */
function studentSummary(studentId) {
  const db = getDb();
  const student = db.prepare('SELECT * FROM students WHERE student_id = ?').get(studentId);
  if (!student) return null;

  const fees = listFees().filter((f) => f.isActive);
  const dueFees = fees.filter(f => isCurrentOrPastMonth(f.periodKey));
  const futureFees = fees.filter(f => !isCurrentOrPastMonth(f.periodKey));

  const totalRequired = dueFees.reduce((sum, f) => sum + f.amountRequired, 0);
  const totalScheduledAll = fees.reduce((sum, f) => sum + f.amountRequired, 0);
  const totalPaid = dueFees.reduce((sum, f) => sum + totalPaidFor(studentId, f.id), 0);

  const feeStatuses = fees.map((f) => {
    const isDue = isCurrentOrPastMonth(f.periodKey);
    const st = isDue ? feeStatus(studentId, f) : { key: 'not_due', label: 'NOT DUE', paid: 0, required: f.amountRequired };
    return { feeId: f.id, title: f.title, periodKey: f.periodKey, ...st, status: isDue ? 'due' : 'not_due' };
  });

  const attn = attendanceStats(null);
  const myAttn = db.prepare(
    'SELECT COUNT(*) AS c FROM practical_attendance WHERE student_id = ?'
  ).get(studentId).c;
  const sessionList = db.prepare(
    'SELECT practical_subject_id, practical_date FROM practical_attendance WHERE student_id = ?'
  ).all(studentId);

  return {
    student: { studentId, fullName: student.full_name, status: student.status },
    totalRequired,
    totalScheduledAll,
    totalPaid,
    totalRemaining: Math.max(0, totalRequired - totalPaid),
    totalScheduledRemaining: Math.max(0, totalScheduledAll - totalPaid),
    feeStatuses,
    attendance: {
      present: Number(db.prepare("SELECT COUNT(*) AS c FROM practical_attendance WHERE student_id = ? AND attendance_status='present'").get(studentId).c),
      absent: Number(db.prepare("SELECT COUNT(*) AS c FROM practical_attendance WHERE student_id = ? AND attendance_status='absent'").get(studentId).c),
      late: Number(db.prepare("SELECT COUNT(*) AS c FROM practical_attendance WHERE student_id = ? AND attendance_status='late'").get(studentId).c),
      excused: Number(db.prepare("SELECT COUNT(*) AS c FROM practical_attendance WHERE student_id = ? AND attendance_status='excused'").get(studentId).c),
      notMarked: Number(db.prepare("SELECT COUNT(*) AS c FROM practical_attendance WHERE student_id = ? AND attendance_status='not_marked'").get(studentId).c),
      total: myAttn,
      sessions: sessionList.length
    },
    batchAttendanceRate: attn.rate
  };
}

module.exports = { batchSummary, studentSummary, isCurrentOrPastMonth };
