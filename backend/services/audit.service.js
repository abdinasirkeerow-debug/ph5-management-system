/* ==========================================================================
   audit.service.js — Centralised audit logging. Every critical write in the
   system routes through writeAudit so there is a single trail.
   ========================================================================== */
'use strict';

const { getDb } = require('../database/db');
const { uid, nowISO } = require('../utils/helpers');

/* actor: { id, username, fullName, role } or null for system/anonymous. */
function writeAudit(actor, action, entityType, entityId, details, opts) {
  opts = opts || {};
  const db = getDb();
  const now = nowISO();
  const id = uid('aud');
  db.prepare(
    `INSERT INTO audit_logs (id, user_id, action, entity_type, entity_id, old_value, new_value, details, ip_address, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).run(
    id,
    actor ? actor.id : null,
    action,
    entityType || null,
    entityId || null,
    opts.oldValue != null ? String(opts.oldValue) : null,
    opts.newValue != null ? String(opts.newValue) : null,
    details || null,
    opts.ip || null,
    now
  );
  return id;
}

function mapAuditRow(row) {
  return {
    id: row.id,
    actorId: row.user_id,
    actorName: row.actor_name || 'System',
    role: row.actor_role || 'system',
    action: row.action,
    entity: row.entity_type,
    entityId: row.entity_id,
    oldValue: row.old_value,
    newValue: row.new_value,
    details: row.details,
    ipAddress: row.ip_address,
    timestamp: row.created_at
  };
}

/* List audit entries newest-first, optionally filtered by action. */
function listAudit(opts) {
  opts = opts || {};
  const db = getDb();
  const params = [];
  let sql =
    `SELECT a.*, u.full_name AS actor_name, u.role AS actor_role
     FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id`;
  if (opts.action) {
    sql += ' WHERE a.action = ?';
    params.push(opts.action);
  }
  sql += ' ORDER BY a.created_at DESC, a.rowid DESC';
  if (opts.limit) {
    sql += ' LIMIT ?';
    params.push(opts.limit);
  }
  return db.prepare(sql).all(...params).map(mapAuditRow);
}

module.exports = { writeAudit, listAudit };
