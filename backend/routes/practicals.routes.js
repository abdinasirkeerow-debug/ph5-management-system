/* ==========================================================================
   practicals.routes.js — Practical subjects + session attendance.
   Reads for all roles; writes admin-only. Class leaders & students are
   strictly read-only (403 on any write attempt).
   ========================================================================== */
'use strict';

const express = require('express');
const { z } = require('zod');
const { validate } = require('../middleware/validate');
const { requireAuth, requireRole, actorOf, clientIp } = require('../middleware/auth');
const service = require('../services/practicals.service');
const { asyncHandler } = require('../utils/helpers');

const router = express.Router();

/* ---- Reads (all authenticated roles) ---- */

router.get('/', requireAuth, (req, res) => {
  res.json({ subjects: service.listSubjects() });
});

/* All attendance records visible to the current role (students: own only).
   Registered before GET /:id so "attendance" is not treated as a subject id. */
router.get('/attendance', requireAuth, (req, res) => {
  const opts = { role: req.user.role, forStudentId: req.user.studentId };
  res.json({ attendance: service.listAttendanceAll(opts) });
});

router.get('/:id', requireAuth, (req, res) => {
  const subject = service.findSubjectById(req.params.id);
  if (!subject) return res.status(404).json({ error: 'Practical subject not found.' });
  res.json({ subject });
});

/* Attendance records for a subject (students see only their own). */
router.get('/:id/attendance', requireAuth, (req, res) => {
  const subject = service.findSubjectById(req.params.id);
  if (!subject) return res.status(404).json({ error: 'Practical subject not found.' });
  const opts = { role: req.user.role, forStudentId: req.user.studentId };
  const date = req.query.date || null;
  const records = date
    ? service.sessionRecords(subject.id, date, opts)
    : service.sessionRecordsForSubject(subject.id, opts);
  res.json({ attendance: records });
});

/* ---- Writes (admin only) ---- */

router.post('/', requireAuth, requireRole('admin'), validate(z.object({
  name: z.string().trim().min(1, 'A subject name is required.'),
  code: z.string().optional().nullable(),
  practicalDate: z.string().optional().nullable(),
  instructor: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  isActive: z.boolean().optional()
})), asyncHandler(async (req, res) => {
  const result = service.createSubject(req.body, actorOf(req.user), clientIp(req));
  res.status(201).json({
    subject: result.subject,
    subjects: service.listSubjects(),
    /* Baseline session records when a practical date was supplied. */
    attendance: result.attendance
  });
}));

router.patch('/:id', requireAuth, requireRole('admin'), validate(z.object({
  name: z.string().trim().min(1, 'A subject name is required.').optional(),
  code: z.string().optional().nullable(),
  instructor: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  isActive: z.boolean().optional()
})), asyncHandler(async (req, res) => {
  const subject = service.updateSubject(req.params.id, req.body, actorOf(req.user), clientIp(req));
  res.json({ subject, subjects: service.listSubjects() });
}));

router.post('/:id/toggle', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const subject = service.toggleSubject(req.params.id, actorOf(req.user), clientIp(req));
  res.json({ subject, subjects: service.listSubjects() });
}));

router.delete('/:id', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const result = service.deleteSubject(req.params.id, actorOf(req.user), clientIp(req));
  res.json({ ...result, subjects: service.listSubjects() });
}));

/* ---- Attendance sessions (admin writes) ---- */

/* Open a session: every active student appears as "not marked". */
router.post('/:id/sessions', requireAuth, requireRole('admin'), validate(z.object({
  date: z.string().min(1, 'A session date is required.')
})), asyncHandler(async (req, res) => {
  const records = service.openSession(req.params.id, req.body.date, actorOf(req.user), clientIp(req));
  res.status(201).json({
    attendance: records,
    allAttendance: service.listAttendanceAll({ role: req.user.role, forStudentId: req.user.studentId })
  });
}));

/* Save individual marks and/or a mass action. */
router.post('/:id/sessions/save', requireAuth, requireRole('admin'), validate(z.object({
  date: z.string().min(1, 'A session date is required.'),
  entries: z.array(z.object({
    studentId: z.string(),
    status: z.enum(['present', 'absent', 'late', 'excused', 'not_marked'])
  })).optional(),
  action: z.enum(['all-present', 'all-absent', 'reset']).optional()
})), asyncHandler(async (req, res) => {
  const records = service.saveAttendance(
    req.params.id, req.body.date, req.body, actorOf(req.user), clientIp(req)
  );
  res.json({
    attendance: records,
    allAttendance: service.listAttendanceAll({ role: req.user.role, forStudentId: req.user.studentId })
  });
}));

router.delete('/:id/sessions/:date', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const result = service.deleteSession(req.params.id, req.params.date, actorOf(req.user), clientIp(req));
  res.json({ ...result, allAttendance: service.listAttendanceAll({}) });
}));

module.exports = router;
