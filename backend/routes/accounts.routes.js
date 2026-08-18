/* ==========================================================================
   accounts.routes.js — Login account management. Admin-only.
   Password hashes are never included in any response.
   ========================================================================== */
'use strict';

const express = require('express');
const { z } = require('zod');
const { validate } = require('../middleware/validate');
const { requireAuth, requireAdmin, actorOf, clientIp } = require('../middleware/auth');
const service = require('../services/accounts.service');
const { asyncHandler } = require('../utils/helpers');

const router = express.Router();

router.use(requireAuth, requireAdmin);

router.get('/', (req, res) => {
  res.json({ users: service.listAccounts() });
});

router.post('/', validate(z.object({
  username: z.string().trim().min(1, 'Username is required.'),
  fullName: z.string().trim().min(1, 'Full name is required.'),
  role: z.enum(['student', 'class_leader', 'admin']),
  password: z.string().optional(),
  studentId: z.string().optional(),
  email: z.string().optional()
})), asyncHandler(async (req, res) => {
  const user = service.createAccount(req.body, actorOf(req.user));
  res.status(201).json({ user, users: service.listAccounts() });
}));

router.patch('/:id/active', validate(z.object({
  active: z.boolean()
})), asyncHandler(async (req, res) => {
  const user = service.setAccountActive(req.params.id, req.body.active, actorOf(req.user));
  res.json({ user, users: service.listAccounts() });
}));

router.post('/:id/reset-password', validate(z.object({
  newPassword: z.string().min(6, 'New password must be at least 6 characters.')
})), asyncHandler(async (req, res) => {
  const user = service.resetPassword(req.params.id, req.body.newPassword, actorOf(req.user), clientIp(req));
  res.json({ ok: true, user });
}));

/* Assign / remove a Class Leader (admin-only, max two active leaders).
   role change only — the student record, password, fees, payments and
   attendance are preserved. Returns the updated account + fresh list. */
router.patch('/:id/leader', validate(z.object({
  action: z.enum(['assign', 'remove'])
})), asyncHandler(async (req, res) => {
  const user = req.body.action === 'assign'
    ? service.assignLeader(req.params.id, actorOf(req.user))
    : service.removeLeader(req.params.id, actorOf(req.user));
  res.json({ user, users: service.listAccounts() });
}));

module.exports = router;
