/* ==========================================================================
   seed.js — Idempotently seeds the authoritative Batch Five dataset:
   the 59 students + login accounts, fee requirements and practical subjects.
   Safe to run any number of times (no duplicates are ever created).
   ========================================================================== */
'use strict';

require('dotenv').config();
const { getDb } = require('../backend/database/db');
const seed = require('../backend/database/seed');

const db = getDb();
const counts = seed.ensureSeeded(db);

const feeCount = db.prepare('SELECT COUNT(*) AS c FROM fee_requirements').get().c;
const subjectCount = db.prepare('SELECT COUNT(*) AS c FROM practical_subjects').get().c;
const userCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;

console.log('');
console.log('Seed complete (idempotent — no duplicates created).');
console.log('  students :', counts.students);
console.log('  accounts :', userCount, '(59 student logins + any staff accounts)');
console.log('  fees     :', feeCount);
console.log('  subjects :', subjectCount);
console.log('');
console.log('Next: create your admin account with  npm run create-admin');
