/* ==========================================================================
   backup.routes.js — Admin-only backup & restore.
   ========================================================================== */
'use strict';

const express = require('express');
const { requireAuth, requireAdmin, actorOf, clientIp } = require('../middleware/auth');
const service = require('../services/backup.service');
const { asyncHandler } = require('../utils/helpers');

const router = express.Router();

router.use(requireAuth, requireAdmin);

router.get('/', (req, res) => {
  res.json({ backups: service.listBackups() });
});

router.post('/create', asyncHandler(async (req, res) => {
  const backup = service.createBackup(actorOf(req.user), clientIp(req));
  res.status(201).json({ ok: true, backup, backups: service.listBackups() });
}));

router.get('/download/:name', (req, res) => {
  const full = service.downloadBackup(req.params.name);
  res.download(full);
});

router.post('/restore/:name', asyncHandler(async (req, res) => {
  const result = service.restoreBackup(req.params.name, actorOf(req.user), clientIp(req));
  res.json({ ok: true, ...result });
}));

/* JSON export of every table (original "export backup" feature). */
router.get('/export', (req, res) => {
  res.json(service.exportJson());
});

/* Factory reset: wipe and re-seed the authoritative dataset. */
router.post('/reset', asyncHandler(async (req, res) => {
  const result = service.resetDatabase(actorOf(req.user), clientIp(req));
  res.json({ ok: true, ...result });
}));

module.exports = router;
