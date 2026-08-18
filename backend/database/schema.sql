-- ==========================================================================
-- schema.sql — SQLite schema for the Public Health Batch Five Management System
-- --------------------------------------------------------------------------
-- Normalized tables with primary keys, foreign keys, CHECK constraints and
-- indexes. Calculated totals (balances, statuses, percentages) are derived
-- from source transactions at query time — never stored.
-- ==========================================================================

-- ---- Users / accounts (bcrypt hashes only) ----
CREATE TABLE IF NOT EXISTS users (
  id                    TEXT PRIMARY KEY,
  username              TEXT NOT NULL UNIQUE,
  email                 TEXT,
  full_name             TEXT,
  password_hash         TEXT,
  role                  TEXT NOT NULL CHECK (role IN ('student','class_leader','admin')),
  active                INTEGER NOT NULL DEFAULT 1,
  must_change_password  INTEGER NOT NULL DEFAULT 1,
  last_login            TEXT,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);

-- ---- Students (the 59 members of Batch Five) ----
CREATE TABLE IF NOT EXISTS students (
  id           TEXT PRIMARY KEY,
  student_id   TEXT NOT NULL UNIQUE,
  full_name    TEXT NOT NULL,
  gender       TEXT NOT NULL DEFAULT 'M' CHECK (gender IN ('M','F')),
  phone        TEXT,
  email        TEXT,
  program      TEXT NOT NULL DEFAULT 'Public Health',
  batch        TEXT NOT NULL DEFAULT 'Batch Five',
  status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','graduated')),
  avatar_color TEXT,
  user_id      TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_students_user      ON students(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_students_status           ON students(status);

-- ---- Fee requirements ----
CREATE TABLE IF NOT EXISTS fee_requirements (
  id              TEXT PRIMARY KEY,
  title           TEXT NOT NULL,
  category        TEXT NOT NULL DEFAULT 'General',
  required_amount NUMERIC NOT NULL CHECK (required_amount > 0),
  due_date        TEXT,
  period_key      TEXT NOT NULL UNIQUE,
  description     TEXT,
  active          INTEGER NOT NULL DEFAULT 1,
  created_by      TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

-- ---- Payment transactions (one row per payment; $1 or $2) ----
CREATE TABLE IF NOT EXISTS payment_transactions (
  id                 TEXT PRIMARY KEY,
  transaction_id     TEXT NOT NULL UNIQUE,
  student_id         TEXT NOT NULL,
  fee_requirement_id TEXT NOT NULL,
  amount             NUMERIC NOT NULL CHECK (amount > 0 AND amount <= 2),
  method             TEXT NOT NULL CHECK (method IN ('Cash','Mobile Money','Bank Transfer')),
  reference          TEXT,
  note               TEXT,
  payment_date       TEXT NOT NULL,
  recorded_by        TEXT,
  created_at         TEXT NOT NULL,
  FOREIGN KEY (student_id)         REFERENCES students(student_id) ON DELETE RESTRICT,
  FOREIGN KEY (fee_requirement_id) REFERENCES fee_requirements(id) ON DELETE RESTRICT,
  FOREIGN KEY (recorded_by)        REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_payments_student ON payment_transactions(student_id);
CREATE INDEX IF NOT EXISTS idx_payments_fee     ON payment_transactions(fee_requirement_id);
CREATE INDEX IF NOT EXISTS idx_payments_date    ON payment_transactions(payment_date);
CREATE INDEX IF NOT EXISTS idx_payments_created ON payment_transactions(created_at);

-- ---- Practical subjects (dynamic, admin-managed) ----
CREATE TABLE IF NOT EXISTS practical_subjects (
  id             TEXT PRIMARY KEY,
  subject_name   TEXT NOT NULL,
  code           TEXT,
  practical_date TEXT,
  instructor     TEXT,
  notes          TEXT,
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_by     TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_subjects_status ON practical_subjects(status);

-- ---- Practical attendance (unique per subject + student + date) ----
CREATE TABLE IF NOT EXISTS practical_attendance (
  id                    TEXT PRIMARY KEY,
  practical_subject_id  TEXT NOT NULL,
  student_id            TEXT NOT NULL,
  practical_date        TEXT NOT NULL,
  attendance_status     TEXT NOT NULL CHECK (attendance_status IN ('present','absent','late','excused','not_marked')),
  marked_by             TEXT,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL,
  FOREIGN KEY (practical_subject_id) REFERENCES practical_subjects(id) ON DELETE CASCADE,
  FOREIGN KEY (student_id)           REFERENCES students(student_id) ON DELETE CASCADE,
  UNIQUE (practical_subject_id, student_id, practical_date)
);
CREATE INDEX IF NOT EXISTS idx_attendance_subject ON practical_attendance(practical_subject_id);
CREATE INDEX IF NOT EXISTS idx_attendance_student ON practical_attendance(student_id);
CREATE INDEX IF NOT EXISTS idx_attendance_date    ON practical_attendance(practical_date);

-- ---- Audit log (one row per critical action) ----
CREATE TABLE IF NOT EXISTS audit_logs (
  id          TEXT PRIMARY KEY,
  user_id     TEXT,
  action      TEXT NOT NULL,
  entity_type TEXT,
  entity_id   TEXT,
  old_value   TEXT,
  new_value   TEXT,
  details     TEXT,
  ip_address  TEXT,
  created_at  TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_action  ON audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_audit_user    ON audit_logs(user_id);

-- ---- Persistent session store ----
CREATE TABLE IF NOT EXISTS sessions (
  sid    TEXT PRIMARY KEY,
  sess   TEXT NOT NULL,
  expire INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_expire ON sessions(expire);
