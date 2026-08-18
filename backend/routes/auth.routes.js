/* ==========================================================================
   auth.routes.js — Login, logout, session restore, password change.
   ========================================================================== */
'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const { z } = require('zod');
const { validate } = require('../middleware/validate');
const { requireAuth, loadUserById, actorOf, clientIp } = require('../middleware/auth');
const { getDb } = require('../database/db');
const config = require('../config/env');
const { writeAudit } = require('../services/audit.service');
const { nowISO, httpError, asyncHandler } = require('../utils/helpers');

const router = express.Router();

/* Map a DB user to the session payload the frontend mirrors. */
function sessionPayload(user) {
  return {
    userId: user.id,
    username: user.username,
    fullName: user.fullName,
    role: user.role,
    studentId: user.studentId || null,
    mustChangePassword: user.mustChangePassword,
    lastLogin: user.lastLogin,
    createdAt: user.createdAt
  };
}

router.post('/login', validate(z.object({
  username: z.string().trim().min(1, 'Username is required.'),
  password: z.string().min(1, 'Password is required.')
})), (req, res, next) => {
  const db = getDb();
  const { username, password } = req.body;
  const ip = clientIp(req);
  const now = nowISO();

  const user = db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(username);
  if (!user) {
    writeAudit(null, 'LOGIN_FAILED', 'user', null, `Failed login for username: ${username}`, { ip });
    return res.status(401).json({ error: 'Invalid login credentials.' });
  }
  if (!user.active) {
    writeAudit({ id: user.id, username: user.username, fullName: user.full_name, role: user.role },
      'LOGIN_DENIED', 'user', user.id, 'Account disabled', { ip });
    return res.status(401).json({ error: 'Your account is disabled.' });
  }
  // password_hash is NULL for passwordless production accounts — never feed
  // NULL to bcrypt (it throws). Both cases read as the same generic failure.
  if (!user.password_hash || !bcrypt.compareSync(password, user.password_hash)) {
    writeAudit({ id: user.id, username: user.username, fullName: user.full_name, role: user.role },
      'LOGIN_FAILED', 'user', user.id, 'Incorrect password', { ip });
    return res.status(401).json({ error: 'Invalid login credentials.' });
  }

  db.prepare('UPDATE users SET last_login = ?, updated_at = ? WHERE id = ?').run(now, now, user.id);

  req.session.regenerate((err) => {
    if (err) return next(err);
    req.session.userId = user.id;
    req.session.role = user.role;
    req.session.username = user.username;
    req.session.fullName = user.full_name;
    req.session.save((saveErr) => {
      if (saveErr) return next(saveErr);
      const fresh = loadUserById(user.id);
      writeAudit({ id: user.id, username: user.username, fullName: user.full_name, role: user.role },
        'LOGIN_SUCCESS', 'user', user.id, 'Signed in', { ip });
      res.json({ session: sessionPayload(fresh) });
    });
  });
});

router.post('/logout', requireAuth, (req, res, next) => {
  const actor = actorOf(req.user);
  const ip = clientIp(req);
  const session = req.session;
  writeAudit(actor, 'LOGOUT', 'user', req.user.id, 'Signed out', { ip });
  session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie(config.sessionCookieName);
    res.json({ ok: true });
  });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ session: sessionPayload(req.user) });
});

router.post('/change-password', requireAuth, validate(z.object({
  currentPassword: z.string().min(1, 'Current password is required.'),
  newPassword: z.string().min(6, 'New password must be at least 6 characters.')
})), asyncHandler(async (req, res) => {
  const db = getDb();
  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
  if (!row || !row.password_hash || !bcrypt.compareSync(req.body.currentPassword, row.password_hash)) {
    throw httpError(400, 'Your current password is incorrect.');
  }
  const now = nowISO();
  const hash = bcrypt.hashSync(req.body.newPassword, 10);
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?')
    .run(hash, now, req.user.id);
  writeAudit(actorOf(req.user), 'PASSWORD_CHANGE', 'user', req.user.id, 'Changed own password', { ip: clientIp(req) });
  const fresh = loadUserById(req.user.id);
  res.json({ ok: true, session: sessionPayload(fresh) });
}));

module.exports = router;
