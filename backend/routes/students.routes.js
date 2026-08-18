/* ==========================================================================
   students.routes.js — Student records.
   Students see only their own record; class leaders and admins read all.
   All writes are admin-only.
   ========================================================================== */
'use strict';

const express = require('express');
const { z } = require('zod');
const { validate } = require('../middleware/validate');
const { requireAuth, requireRole, actorOf, clientIp } = require('../middleware/auth');
const service = require('../services/students.service');
const { asyncHandler } = require('../utils/helpers');

const router = express.Router();

router.get('/', requireAuth, (req, res) => {
  const opts = {
    role: req.user.role,
    forStudentId: req.user.studentId,
    search: req.query.search || null,
    status: req.query.status || null,
    activeOnly: req.query.activeOnly === 'true'
  };
  res.json({ students: service.listStudents(opts) });
});

router.get('/:id', requireAuth, (req, res) => {
  const student = service.requireStudent(req.params.id);
  // Students may only view their own record.
  if (req.user.role === 'student' && student.studentId !== req.user.studentId) {
    return res.status(403).json({ error: 'You do not have permission to perform this action.' });
  }
  res.json({ student });
});

router.post('/', requireAuth, requireRole('admin'), validate(z.object({
  fullName: z.string().trim().min(1, 'Full name is required.'),
  studentId: z.string().trim().min(1, 'Student ID is required.'),
  gender: z.enum(['M', 'F']).optional(),
  phone: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  status: z.string().optional(),
  password: z.string().optional()
})), asyncHandler(async (req, res) => {
  const result = service.createStudent(req.body, actorOf(req.user));
  res.status(201).json({ student: result.student, students: service.listStudents({}) });
}));

router.patch('/:id', requireAuth, requireRole('admin'), validate(z.object({
  fullName: z.string().trim().min(1, 'Full name is required.').optional(),
  gender: z.enum(['M', 'F']).optional(),
  phone: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  studentId: z.string().optional()
})), asyncHandler(async (req, res) => {
  const student = service.updateStudent(req.params.id, req.body, actorOf(req.user), clientIp(req));
  res.json({ student, students: service.listStudents({}) });
}));

router.patch('/:id/status', requireAuth, requireRole('admin'), validate(z.object({
  status: z.enum(['active', 'suspended', 'graduated'])
})), asyncHandler(async (req, res) => {
  const student = service.setStudentStatus(req.params.id, req.body.status, actorOf(req.user), clientIp(req));
  res.json({ student, students: service.listStudents({}) });
}));

/* Soft delete (archive): deactivates the account, keeps all history. */
router.delete('/:id', requireAuth, requireRole('admin'), asyncHandler(async (req, res) => {
  const student = service.archiveStudent(req.params.id, actorOf(req.user), clientIp(req));
  res.json({ student, students: service.listStudents({}) });
}));

module.exports = router;
