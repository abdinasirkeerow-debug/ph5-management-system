/* ==========================================================================
   fees.routes.js — Fee requirements. Read for all roles, write for admin.
   ========================================================================== */
'use strict';

const express = require('express');
const { z } = require('zod');
const { validate } = require('../middleware/validate');
const { requireAuth, requireRole, actorOf, clientIp } = require('../middleware/auth');
const service = require('../services/fees.service');
const { asyncHandler } = require('../utils/helpers');

const router = express.Router();

router.get('/', requireAuth, (req, res) => {
  res.json({ fees: service.listFees() });
});

router.post('/', requireAuth, requireRole('admin'), validate(z.object({
  title: z.string().trim().min(1, 'Fee title is required.'),
  category: z.string().optional().default('General'),
  amountRequired: z.coerce.number().positive('Required amount must be a positive number.'),
  dueDate: z.string().optional().nullable(),
  periodKey: z.string().trim().regex(/^\d{4}-\d{2}$/, 'Period key must be in format YYYY-MM.'),
  description: z.string().optional().nullable(),
  isActive: z.boolean().optional()
})), asyncHandler(async (req, res) => {
  const fee = service.createFee(req.body, actorOf(req.user), clientIp(req));
  res.status(201).json({ fee, fees: service.listFees() });
}));

router.patch('/:id', requireAuth, requireRole('admin'), validate(z.object({
  title: z.string().trim().min(1, 'Fee title is required.').optional(),
  category: z.string().optional(),
  amountRequired: z.coerce.number().positive('Required amount must be a positive number.').optional(),
  dueDate: z.string().optional().nullable(),
  periodKey: z.string().trim().regex(/^\d{4}-\d{2}$/, 'Period key must be in format YYYY-MM.').optional(),
  description: z.string().optional().nullable(),
  isActive: z.boolean().optional()
})), asyncHandler(async (req, res) => {
  const fee = service.updateFee(req.params.id, req.body, actorOf(req.user));
  res.json({ fee, fees: service.listFees() });
}));

router.post('/:id/toggle', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const fee = service.toggleFee(req.params.id, actorOf(req.user), clientIp(req));
  res.json({ fee, fees: service.listFees() });
}));

router.delete('/:id', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const result = service.deleteFee(req.params.id, actorOf(req.user), clientIp(req));
  res.json({ ...result, fees: service.listFees() });
}));

module.exports = router;
