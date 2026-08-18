/* ==========================================================================
   payments.routes.js — Payment transactions.
   ========================================================================== */
'use strict';

const express = require('express');
const { z } = require('zod');
const { validate } = require('../middleware/validate');
const { requireAuth, requireRole, actorOf, clientIp } = require('../middleware/auth');
const service = require('../services/payments.service');
const { asyncHandler } = require('../utils/helpers');

const router = express.Router();

router.get('/', requireAuth, (req, res) => {
  const opts = {
    role: req.user.role,
    forStudentId: req.user.studentId,
    studentId: req.query.studentId || null,
    feeId: req.query.feeId || null,
    periodKey: req.query.periodKey || null,
    status: req.query.status || null, // 'paid' | 'partial' | 'unpaid'
    method: req.query.method || null,
    search: req.query.search || null,
    limit: req.query.limit ? Number(req.query.limit) : null
  };
  res.json({ payments: service.listPayments(opts) });
});

router.post('/', requireAuth, requireRole('admin'), validate(z.object({
  studentId: z.string().trim().min(1, 'Student is required.'),
  feeId: z.string().trim().min(1, 'Fee requirement is required.'),
  amount: z.number(),
  method: z.enum(['Cash', 'Mobile Money', 'Bank Transfer']),
  reference: z.string().optional().nullable(),
  note: z.string().optional().nullable(),
  date: z.string().optional()
})), asyncHandler(async (req, res) => {
  const payment = service.recordPayment(req.body, actorOf(req.user), clientIp(req));
  res.status(201).json({ payment, payments: service.listPayments({}) });
}));

/* Controlled admin deletion with audit trail. */
router.delete('/:id', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const result = service.deletePayment(req.params.id, actorOf(req.user), clientIp(req));
  res.json({ ...result, payments: service.listPayments({}) });
}));

module.exports = router;
