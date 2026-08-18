/* ==========================================================================
   dashboard.routes.js — Backend-computed summaries.
   Class leaders/admins get the batch-wide summary; students get their own.
   ========================================================================== */
'use strict';

const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const service = require('../services/dashboard.service');

const router = express.Router();

router.get('/summary', requireAuth, requireRole('class_leader', 'admin'), (req, res) => {
  res.json({ summary: service.batchSummary() });
});

router.get('/me', requireAuth, requireRole('student'), (req, res) => {
  const summary = service.studentSummary(req.user.studentId);
  if (!summary) return res.status(404).json({ error: 'Student record not found.' });
  res.json({ summary });
});

module.exports = router;
