/* ==========================================================================
   auth.js — Session-based auth middleware + RBAC. Every protected route runs
   requireAuth, which reloads the user from the database per request so that
   disabled accounts and role changes take effect immediately (no reliance on
   hidden frontend checks — all enforcement happens here, on the backend).
   ========================================================================== */
'use strict';

const { getDb } = require('../database/db');
const { httpError } = require('../utils/helpers');

function loadUserById(userId) {
  const db = getDb();
  const row = db.prepare(
    `SELECT u.*, s.student_id AS linked_student_id
     FROM users u LEFT JOIN students s ON s.user_id = u.id
     WHERE u.id = ?`
  ).get(userId);
  if (!row) return null;
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
    createdAt: row.created_at
  };
}

/* Attach req.user (fresh from DB) when a valid session cookie exists. */
function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return next(httpError(401, 'Please sign in to continue.'));
  }
  const user = loadUserById(req.session.userId);
  if (!user) {
    req.session.destroy(() => {});
    return next(httpError(401, 'Please sign in to continue.'));
  }
  if (!user.isActive) {
    req.session.destroy(() => {});
    return next(httpError(401, 'Your account is disabled.'));
  }
  req.user = user;
  next();
}

/* Role guard. Admin passes every check; anything else must be listed. */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return requireAuth(req, res, next);
    if (req.user.role === 'admin' || roles.includes(req.user.role)) return next();
    return next(httpError(403, 'You do not have permission to perform this action.'));
  };
}

function requireAdmin(req, res, next) {
  return requireRole('admin')(req, res, next);
}

/* Convenience actor object used by audit logging. */
function actorOf(user) {
  if (!user) return null;
  return { id: user.id, username: user.username, fullName: user.fullName, role: user.role };
}

function clientIp(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '';
}

module.exports = { requireAuth, requireRole, requireAdmin, loadUserById, actorOf, clientIp };
