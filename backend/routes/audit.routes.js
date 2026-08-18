/* ==========================================================================
   audit.routes.js — Read-only audit log (admin only).
   ========================================================================== */
'use strict';

const express = require('express');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { listAudit } = require('../services/audit.service');

const router = express.Router();

router.use(requireAuth, requireAdmin);

router.get('/', (req, res) => {
  const action = req.query.action || null;
  const limit = req.query.limit ? Number(req.query.limit) : null;
  res.json({ audit: listAudit({ action, limit }) });
});

module.exports = router;
