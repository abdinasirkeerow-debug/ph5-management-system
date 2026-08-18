/* ==========================================================================
   payments.service.js — Payment transactions.
   --------------------------------------------------------------------------
   Rules enforced here (and mirrored by DB CHECK constraints):
   - one transaction per payment, amount is exactly $1 or $2 (extendable);
   - a transaction can never push a student over their required amount;
   - totals and balances are derived from SUM(payment_transactions.amount);
   - a SQLite transaction prevents race conditions / overpayment;
   - recorded payments are never silently overwritten; deletion is a
     controlled admin operation that leaves an audit trail.
   ========================================================================== */
'use strict';

const { getDb } = require('../database/db');
const { writeAudit } = require('./audit.service');
const { uid, nowISO, todayISO, currentPeriodKey, httpError, toNumber } = require('../utils/helpers');

const METHODS = ['Cash', 'Mobile Money', 'Bank Transfer'];

function mapPayment(row) {
  return {
    id: row.id,
    transactionId: row.transaction_id,
    studentId: row.student_id,
    feeId: row.fee_requirement_id,
    amount: Number(row.amount),
    method: row.method,
    reference: row.reference,
    note: row.note,
    date: row.payment_date,
    recordedBy: row.recorded_by,
    recordedByName: row.recorder_name || null,
    recordedAt: row.created_at
  };
}

function totalPaidFor(studentId, feeId) {
  const db = getDb();
  const row = db.prepare(
    'SELECT COALESCE(SUM(amount),0) AS total FROM payment_transactions WHERE student_id = ? AND fee_requirement_id = ?'
  ).get(studentId, feeId);
  return Number(row.total);
}

function listPayments(opts) {
  opts = opts || {};
  const db = getDb();
  const where = [];
  const params = [];

  if (opts.role === 'student' && opts.forStudentId) {
    where.push('p.student_id = ?');
    params.push(opts.forStudentId);
  }
  if (opts.feeId) {
    where.push('p.fee_requirement_id = ?');
    params.push(opts.feeId);
  }
  if (opts.periodKey) {
    where.push('f.period_key = ?');
    params.push(opts.periodKey);
  }
  if (opts.method) {
    where.push('p.method = ?');
    params.push(opts.method);
  }
  if (opts.studentId) {
    where.push('p.student_id = ?');
    params.push(opts.studentId);
  }
  if (opts.search) {
    where.push('(s.full_name LIKE ? OR s.student_id LIKE ? OR p.reference LIKE ?)');
    const q = `%${opts.search}%`;
    params.push(q, q, q);
  }

  let sql =
    `SELECT p.*, r.full_name AS recorder_name, f.period_key, f.required_amount
     FROM payment_transactions p
     LEFT JOIN students s ON s.student_id = p.student_id
     LEFT JOIN users r ON r.id = p.recorded_by
     LEFT JOIN fee_requirements f ON f.id = p.fee_requirement_id`;
  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ' ORDER BY p.payment_date DESC, p.created_at DESC';
  if (opts.limit) {
    sql += ' LIMIT ?';
    params.push(opts.limit);
  }
  let payments = db.prepare(sql).all(...params).map(mapPayment);

  // Filter by status if requested
  if (opts.status && ['paid', 'partial', 'unpaid'].includes(opts.status)) {
    const feeService = require('./fees.service');
    const feeById = {};
    // Build fee lookup
    payments.forEach(p => {
      if (!feeById[p.feeId]) {
        feeById[p.feeId] = feeService.findFeeById(p.feeId);
      }
    });
    payments = payments.filter(p => {
      const fee = feeById[p.feeId];
      if (!fee) return false;
      const st = feeStatus(p.studentId, fee);
      return st.key === opts.status;
    });
  }

  return payments;
}

/* Core write. Runs inside BEGIN IMMEDIATE … COMMIT and re-checks the balance
   inside the transaction so overpayment is impossible. */
function recordPayment(payload, actor, ip) {
  const db = getDb();
  const amount = toNumber(payload.amount);

  if (amount !== 1 && amount !== 2) {
    throw httpError(400, 'Invalid payment amount. Payment must be $1 or $2.');
  }
  if (!METHODS.includes(payload.method)) {
    throw httpError(400, 'Invalid payment method.');
  }

  const student = db.prepare('SELECT * FROM students WHERE student_id = ?').get(payload.studentId);
  if (!student) throw httpError(404, 'Student not found.');

  const fee = db.prepare('SELECT * FROM fee_requirements WHERE id = ?').get(payload.feeId);
  if (!fee) throw httpError(404, 'Fee requirement not found.');
  if (!fee.active) throw httpError(409, 'This fee is no longer active and cannot accept payments.');

  /* Server-side guard: a monthly fee only becomes payable once its month has
     begun (resolved in the application timezone). The UI already disables
     future months, but this must be enforced here, not just in the frontend. */
  const nowPeriod = currentPeriodKey();
  if (fee.period_key && String(fee.period_key) > nowPeriod) {
    throw httpError(409, 'Payment cannot be recorded because this monthly fee is not due yet.');
  }

  const date = payload.date || todayISO();
  const id = uid('pay');
  const transactionId = 'TXN-' + Date.now().toString(36).toUpperCase() + '-' +
    Math.random().toString(36).slice(2, 7).toUpperCase();
  const now = nowISO();

  db.exec('BEGIN IMMEDIATE');
  try {
    const paid = totalPaidFor(student.student_id, fee.id);
    const remaining = Math.max(0, Number(fee.required_amount) - paid);
    if (remaining <= 0) {
      throw httpError(409, 'This fee has already been paid in full.');
    }
    if (amount > remaining) {
      throw httpError(409, "Payment exceeds the student's remaining balance.");
    }

    db.prepare(
      `INSERT INTO payment_transactions
         (id, transaction_id, student_id, fee_requirement_id, amount, method, reference, note, payment_date, recorded_by, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      id, transactionId, student.student_id, fee.id, amount, payload.method,
      payload.reference || null, payload.note || null, date, actor ? actor.id : null, now
    );
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  const newPaid = totalPaidFor(student.student_id, fee.id);
  writeAudit(actor, 'PAYMENT_RECORD', 'payment', id,
    `$${amount} ${payload.method} for ${student.full_name} → ${fee.title} (now $${newPaid} of $${fee.required_amount})`,
    { ip });

  return getPaymentById(id);
}

function getPaymentById(id) {
  const db = getDb();
  const row = db.prepare(
    `SELECT p.*, r.full_name AS recorder_name
     FROM payment_transactions p LEFT JOIN users r ON r.id = p.recorded_by WHERE p.id = ?`
  ).get(id);
  return row ? mapPayment(row) : null;
}

/* Controlled admin deletion — leaves an audit trail. */
function deletePayment(id, actor, ip) {
  const db = getDb();
  const payment = getPaymentById(id);
  if (!payment) throw httpError(404, 'Payment not found.');
  db.prepare('DELETE FROM payment_transactions WHERE id = ?').run(id);
  const student = db.prepare('SELECT full_name FROM students WHERE student_id = ?').get(payment.studentId);
  writeAudit(actor, 'PAYMENT_DELETE', 'payment', id,
    `Deleted $${payment.amount} for ${student ? student.full_name : payment.studentId}`,
    { ip });
  return { ok: true };
}

/* Derived status for one student against one fee. */
function feeStatus(studentId, fee) {
  const paid = totalPaidFor(studentId, fee.id);
  const required = Number(fee.amountRequired);
  let key = 'unpaid';
  if (paid > 0 && paid < required) key = 'partial';
  else if (paid >= required) key = 'paid';
  return { key, label: key.toUpperCase(), paid, required };
}

module.exports = {
  METHODS,
  listPayments,
  recordPayment,
  deletePayment,
  totalPaidFor,
  feeStatus,
  getPaymentById
};
