/* ==========================================================================
   routes/index.js — Mounts every API router under /api plus /api/health.
   ========================================================================== */
'use strict';

const express = require('express');
const { getDb } = require('../database/db');
const config = require('../config/env');

const authRoutes = require('./auth.routes');
const studentsRoutes = require('./students.routes');
const accountsRoutes = require('./accounts.routes');
const feesRoutes = require('./fees.routes');
const paymentsRoutes = require('./payments.routes');
const practicalsRoutes = require('./practicals.routes');
const dashboardRoutes = require('./dashboard.routes');
const backupRoutes = require('./backup.routes');
const auditRoutes = require('./audit.routes');

const router = express.Router();

router.get('/health', (req, res) => {
  const db = getDb();
  let students = -1;
  try {
    students = db.prepare('SELECT COUNT(*) AS c FROM students').get().c;
  } catch (_) { /* database not ready yet */ }
  res.json({
    ok: true,
    status: 'ok',
    service: 'Public Health Batch Five Management System',
    database: 'sqlite',
    students,
    time: new Date().toISOString(),
    allowedPaymentAmounts: config.allowedPaymentAmounts
  });
});

router.use('/auth', authRoutes);
router.use('/students', studentsRoutes);
router.use('/accounts', accountsRoutes);
router.use('/fees', feesRoutes);
router.use('/payments', paymentsRoutes);
router.use('/practicals', practicalsRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/backup', backupRoutes);
router.use('/audit', auditRoutes);

module.exports = router;
