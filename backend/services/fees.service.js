/* ==========================================================================
   fees.service.js — Fee requirements CRUD. Amounts must be positive; fees
   with recorded payments are archived rather than hard-deleted.
   ========================================================================== */
'use strict';

const { getDb } = require('../database/db');
const { writeAudit } = require('./audit.service');
const { uid, nowISO, httpError, toNumber } = require('../utils/helpers');

function mapFee(row) {
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    amountRequired: Number(row.required_amount),
    dueDate: row.due_date,
    periodKey: row.period_key,
    description: row.description,
    isActive: !!row.active,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function listFees() {
  const db = getDb();
  return db.prepare('SELECT * FROM fee_requirements ORDER BY period_key, id').all().map(mapFee);
}

function findFeeById(id) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM fee_requirements WHERE id = ?').get(id);
  return row ? mapFee(row) : null;
}

function findFeeByPeriodKey(periodKey) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM fee_requirements WHERE period_key = ?').get(periodKey);
  return row ? mapFee(row) : null;
}

function createFee(payload, actor) {
  const db = getDb();
  const title = String(payload.title || '').trim();
  const amount = toNumber(payload.amountRequired);
  if (!title) throw httpError(400, 'Fee title is required.');
  if (!Number.isFinite(amount) || amount <= 0) {
    throw httpError(400, 'Required amount must be a positive number.');
  }
  if (!payload.periodKey) {
    throw httpError(400, 'Period key is required (format: YYYY-MM).');
  }
  const periodKey = String(payload.periodKey).trim();
  const existing = findFeeByPeriodKey(periodKey);
  if (existing) throw httpError(409, `A fee for period ${periodKey} already exists.`);

  const now = nowISO();
  const id = payload.id || uid('fee');
  db.prepare(
    `INSERT INTO fee_requirements
       (id, title, category, required_amount, due_date, period_key, description, active, created_by, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    id, title, String(payload.category || 'General').trim(), amount,
    payload.dueDate || null, periodKey, payload.description || null,
    payload.isActive === false ? 0 : 1,
    actor ? actor.id : null, now, now
  );
  writeAudit(actor, 'FEE_CREATE', 'fee', id, `Created fee: ${title} ($${amount})`);
  return findFeeById(id);
}

function updateFee(id, patch, actor) {
  const db = getDb();
  const current = findFeeById(id);
  if (!current) throw httpError(404, 'Fee requirement not found.');

  const changes = {};
  if (patch.title !== undefined) {
    const title = String(patch.title).trim();
    if (!title) throw httpError(400, 'Fee title is required.');
    changes.title = title;
  }
  if (patch.category !== undefined) changes.category = String(patch.category).trim() || 'General';
  if (patch.amountRequired !== undefined) {
    const amount = toNumber(patch.amountRequired);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw httpError(400, 'Required amount must be a positive number.');
    }
    changes.required_amount = amount;
  }
  if (patch.dueDate !== undefined) changes.due_date = patch.dueDate || null;
  if (patch.periodKey !== undefined) {
    const periodKey = String(patch.periodKey).trim();
    const existing = findFeeByPeriodKey(periodKey);
    if (existing && existing.id !== id) throw httpError(409, `A fee for period ${periodKey} already exists.`);
    changes.period_key = periodKey;
  }
  if (patch.description !== undefined) changes.description = patch.description || null;
  if (patch.isActive !== undefined) changes.active = patch.isActive ? 1 : 0;

  const now = nowISO();
  if (Object.keys(changes).length) {
    const sets = Object.keys(changes).map((k) => `${k} = ?`).join(', ');
    db.prepare(`UPDATE fee_requirements SET ${sets}, updated_at = ? WHERE id = ?`)
      .run(...Object.values(changes), now, id);
  }
  writeAudit(actor, 'FEE_UPDATE', 'fee', id, `Updated fee: ${changes.title || current.title}`);
  return findFeeById(id);
}

function toggleFee(id, actor) {
  const db = getDb();
  const current = findFeeById(id);
  if (!current) throw httpError(404, 'Fee requirement not found.');
  const active = current.isActive ? 0 : 1;
  db.prepare('UPDATE fee_requirements SET active = ?, updated_at = ? WHERE id = ?')
    .run(active, nowISO(), id);
  writeAudit(actor, active ? 'FEE_ACTIVATE' : 'FEE_DEACTIVATE', 'fee', id,
    `${active ? 'Activated' : 'Deactivated'} fee: ${current.title}`);
  return findFeeById(id);
}

function deleteFee(id, actor) {
  const db = getDb();
  const current = findFeeById(id);
  if (!current) throw httpError(404, 'Fee requirement not found.');
  const linked = db.prepare('SELECT COUNT(*) AS c FROM payment_transactions WHERE fee_requirement_id = ?').get(id).c;
  if (linked > 0) {
    throw httpError(409,
      `Cannot delete this fee because ${linked} payment${linked === 1 ? ' has' : 's have'} already been recorded against it. Deactivate it instead.`);
  }
  db.prepare('DELETE FROM fee_requirements WHERE id = ?').run(id);
  writeAudit(actor, 'FEE_DELETE', 'fee', id, `Deleted fee: ${current.title}`);
  return { ok: true };
}

module.exports = { listFees, findFeeById, findFeeByPeriodKey, createFee, updateFee, toggleFee, deleteFee };
