/* ==========================================================================
   create-admin.js — Create (or reset) a staff/leader/student login account.
   --------------------------------------------------------------------------
   Reads credentials from environment variables or prompts interactively.
   Only the bcrypt password hash is stored — never the plain text.

   Examples:
     npm run create-admin
     ADMIN_USERNAME=admin ADMIN_PASSWORD='s3cret!' ADMIN_FULL_NAME='Admin' npm run create-admin
     npm run create-admin -- --username leader --role class-leader --full-name "Class Leader"
   ========================================================================== */
'use strict';

require('dotenv').config();
const readline = require('readline');
const bcrypt = require('bcryptjs');
const { getDb } = require('../backend/database/db');
const { uid, nowISO } = require('../backend/utils/helpers');
const { writeAudit } = require('../backend/services/audit.service');

const args = process.argv.slice(2);
const argVal = (name) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : undefined;
};

const ROLES = ['admin', 'class_leader', 'student'];

function normalizeRole(role) {
  let r = String(role || 'admin').toLowerCase();
  if (r === 'class-leader' || r === 'leader') r = 'class_leader';
  return ROLES.includes(r) ? r : null;
}

function prompt(text) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(text, (a) => { rl.close(); resolve(a.trim()); }));
}

/* Password input without echo. */
function promptHidden(text) {
  return new Promise((resolve) => {
    process.stdout.write(text);
    const muted = { write: () => false };
    const rl = readline.createInterface({ input: process.stdin, output: muted, terminal: true });
    rl.on('line', (line) => {
      rl.close();
      process.stdout.write('\n');
      resolve(line);
    });
  });
}

async function main() {
  const db = getDb();

  let username = argVal('username') || process.env.ADMIN_USERNAME;
  let password = argVal('password') || process.env.ADMIN_PASSWORD;
  let fullName = argVal('full-name') || process.env.ADMIN_FULL_NAME;
  let role = normalizeRole(argVal('role') || process.env.ADMIN_ROLE);

  if (!role) {
    console.error('Invalid role. Use: admin | class-leader | student');
    process.exit(1);
  }

  if (!username) {
    username = await prompt(`Username (login) [${role}]: `);
  }
  if (!fullName) {
    fullName = (await prompt(`Full name [${username}]: `)) || username;
  }
  if (!password) {
    password = await promptHidden(`Password for "${username}" (hidden): `);
  }
  if (!password || password.length < 6) {
    console.error('Password must be at least 6 characters.');
    process.exit(1);
  }
  if (!username) {
    console.error('Username is required.');
    process.exit(1);
  }

  const existing = db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(username);
  const now = nowISO();
  const hash = bcrypt.hashSync(password, 10);

  if (existing) {
    db.prepare(
      'UPDATE users SET password_hash = ?, full_name = ?, role = ?, active = 1, must_change_password = 0, updated_at = ? WHERE id = ?'
    ).run(hash, fullName, role, now, existing.id);
    writeAudit({ id: existing.id, username, fullName, role }, 'ADMIN_SCRIPT_RESET', 'user', existing.id,
      `Credentials reset via create-admin script (${role})`);
    console.log(`\nUpdated existing account "${username}" (${role}).`);
  } else {
    const id = uid('usr');
    db.prepare(
      `INSERT INTO users (id, username, email, full_name, password_hash, role, active, must_change_password, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    ).run(id, username, null, fullName, hash, role, 1, 0, now, now);
    writeAudit({ id, username, fullName, role }, 'ADMIN_SCRIPT_CREATE', 'user', id,
      `Account created via create-admin script (${role})`);
    console.log(`\nCreated account "${username}" (${role}).`);
  }

  console.log('Only a bcrypt hash of the password is stored.');
  console.log('You can now run:  npm run dev   and sign in at http://localhost:3000\n');
}

main().catch((err) => {
  console.error('Failed:', err.message || err);
  process.exit(1);
});
