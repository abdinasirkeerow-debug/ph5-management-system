# Public Health Batch Five Management System — Final Integration Report

## Executive Summary

The system runs a **fully API-backed** architecture: an Express/SQLite backend is the single source of truth, and the frontend communicates via async `fetch()` with HTTP-only session cookies, preserving synchronous read accessors through an in-memory cache refreshed after every mutation.

Fees are modelled as **17 shared monthly requirements** (Aug 2026 – Dec 2027, **$2/month per student**). There are no per-student fee rows and no demo subjects. All balances, statuses and totals are **derived at query time** — never stored.

**Server-side enforcement**: the backend itself rejects every payment for a future NOT-DUE month (HTTP 409) using the application timezone — the UI guard is a convenience, not the gate. A rejected payment writes **no transaction row**.

**Verification status**: the safe in-place migration was run on the existing dev database, the authoritative seed applied, and all **10 test files / 73 tests pass** against isolated databases.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│  Browser (Single-Page App)                                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐             │
│  │  index.html │  │  app.html   │  │  PH5 Namespace│             │
│  │  (login)    │  │  (portal)   │  │  ┌─────────┐ │             │
│  └──────┬──────┘  └──────┬──────┘  │  │PH5.api  │ │  fetch()  │
│         │                │         │  │(async)  │───────────┐   │
│         └────────────────┘         │  └─────────┘           │   │
│                                    │  ┌─────────┐           │   │
│                                    │  │PH5.db   │  ◀────────┘   │
│                                    │  │(sync)   │  in-mem cache │
│                                    │  └─────────┘               │
│                                    └─────────────┘             │
└─────────────────────────────────────────────────────────────────┘
                            │  HTTP/JSON + cookie
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│  Express Server (port 3000)                                     │
│  ┌──────────────────────┐  ┌────────────────────────────────┐  │
│  │  Static files        │  │  REST API (/api/*)             │  │
│  │  /index.html         │  │  ┌──────┐┌──────┐┌──────────┐  │  │
│  │  /app.html           │  │  │Auth  ││Students│Fees      │  │  │
│  │  /js/*.js            │  │  │      ││      ││          │  │  │
│  └──────────────────────┘  │  │Payments│Practicals│Accounts│  │  │
│                            │  │Backup│Audit │Dashboard │  │  │
│                            │  └──────┘└──────┘└──────────┘  │  │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │  SQLite (WAL mode, FK, 8 tables)                        │ │
│  └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

---

## The 17 Monthly Fee Model

- **17 fee requirements**, one per month, `period_key` `2026-08` → `2027-12`.
- Each: title `Monthly Contribution — {Month Year}`, **$2**, `due_date` = last day of the month, active.
- **Shared records** — one row per month for the whole batch, not per-student rows.
- **A month becomes due once its month begins** (`period_key <= today's YYYY-MM`, resolved in the **application timezone**, Africa/Mogadishu). Future months render **NOT DUE** everywhere (student portal, leader portal, admin ledger) and the payment modal refuses to record against them.
- **The backend enforces the NOT-DUE rule server-side**: `recordPayment` compares `fee.period_key` to `currentPeriodKey()` (Africa/Mogadishu) and rejects a future month with `409 Payment cannot be recorded because this monthly fee is not due yet.` — a rejected attempt writes **no transaction** and **no audit row**.
- Payment status per student per month: `$0 → UNPAID`, `$1 → PARTIAL`, `$2 → PAID`.
- **Overpayment is impossible** — a transaction can never push a student past their remaining balance; a fully-paid month rejects further payments (409). Payments **never auto-apply across months**.
- Admin records a payment by selecting the correct month; the UI pre-selects the current month.

## Safe In-Place Migration

The existing dev DB was created under an older schema that had **no `period_key` column**. `CREATE TABLE IF NOT EXISTS` cannot alter an existing table, so `backend/database/db.js` runs an idempotent migration after loading the schema:

1. `PRAGMA table_info(fee_requirements)` → if `period_key` is missing:
2. Inside `BEGIN IMMEDIATE … COMMIT`, clears the un-mappable legacy demo data (`payment_transactions`, `fee_requirements`, `practical_attendance`, `practical_subjects`) — **students and their login accounts are preserved**.
3. `ALTER TABLE fee_requirements ADD COLUMN period_key TEXT` (SQLite cannot add a `NOT NULL` column via ALTER; `schema.sql` supplies `NOT NULL UNIQUE` for fresh DBs).
4. `CREATE UNIQUE INDEX uq_fee_requirements_period_key` (partial, `WHERE period_key IS NOT NULL`) restores the uniqueness invariant on the migrated column.
5. `ensureSeeded()` then seeds the 17 monthly fees. Re-running is a no-op.

Fresh databases skip the migration entirely (`schema.sql` already declares `period_key TEXT NOT NULL UNIQUE`).

---

## Files Modified

| File | Status | Description |
|------|--------|-------------|
| `backend/database/schema.sql` | **Updated** | `fee_requirements.period_key TEXT NOT NULL UNIQUE` for fresh DBs |
| `backend/database/db.js` | **Updated** | One-time `migrateSchema()` — legacy DBs get `period_key` via ALTER + partial unique index, demo data cleared |
| `backend/database/seed.js` | **Updated** | `seedMonthlyFees()` — 17 fees Aug 2026–Dec 2027 ($2, due last day); **no demo subjects/payments** |
| `backend/services/fees.service.js` | **Updated** | `periodKey` required on create, duplicate period → 409 |
| `backend/services/payments.service.js` | **Updated** | `$1`/`$2` validation, overpayment/paid-in-full guards in `BEGIN IMMEDIATE`, **server-side NOT-DUE guard** (`period_key > currentPeriodKey()` → 409, before any insert), `periodKey` + status filters |
| `backend/services/dashboard.service.js` | **Updated** | `isCurrentOrPastMonth()` (now timezone-aware, shares `currentPeriodKey()` with the payment guard), `dueFeeCount`/`futureFeeCount`, `totalScheduledAll`, NOT DUE statuses |
| `backend/utils/helpers.js` | **Updated** | `currentPeriodKey()` — YYYY-MM resolved in `config.appTimezone` via `Intl.DateTimeFormat` |
| `backend/config/env.js` | **Updated** | `appTimezone` (from `APP_TIMEZONE`, default `Africa/Mogadishu`) |
| `.env.example` | **Updated** | `APP_TIMEZONE=Africa/Mogadishu` documented |
| `backend/routes/payments.routes.js` | **Updated** | `periodKey`, `status`, `search` query filters |
| `js/db.js` | **Updated** | `currentPeriodKey()` (Africa/Mogadishu — matches backend), `isDueFee()`, NOT DUE statuses in `paymentStatus()`/`feeStatusCounts()` |
| `js/ui.js` | **Updated** | `not_due` badge |
| `js/portal-student.js` | **Updated** | Monthly fee table (Month, Required, Paid, Remaining, Status, history); NOT DUE; leader read-only views exposed as `PH5.leaderFees`/`PH5.leaderPayments` |
| `js/portal-admin.js` | **Updated** | Monthly contributions dashboard; fees table with Period key; **Payments page as a monthly ledger** (month select, status filter, name/ID search, record for selected month, NOT DUE guard); delegates leader pages |
| `tests/*.test.js` | **Updated** | Fees (17), payments (fresh-fee scenarios + period/status filters + **server-side guard tests**), dashboard (date-aware, timezone-aware) |

---

## Key Design Decisions

### 1. In-Memory Cache + Async Refresh
```javascript
// db.js — refresh() fetches all tables the current role can read
function refresh() {
  return get('/auth/me').then(function (me) {
    PH5.auth.setSession(me.session);           // mirror session
    var tasks = [ get('/fees'), get('/practicals'), get('/practicals/attendance'),
                  get('/students'), get('/payments') ];
    if (me.session.role === 'admin') {
      tasks.push(get('/accounts'), get('/audit'));
    }
    return Promise.all(tasks).then(function () {
      /* Inject current user into DB.users so userById() works for all roles */
    });
  });
}

// After EVERY mutation: thenRefresh(apiCall) → refresh() re-syncs cache
function thenRefresh(p) { return p.then(refresh); }
function createStudent(payload) { return thenRefresh(post('/students', payload)); }
```
**Why**: Preserves `db.students()` synchronous reads in portals — render code stays unchanged.

### 2. Totals Are Derived, Never Stored
`SUM(payment_transactions.amount)` per student/fee drives every status and dashboard number live, so totals can never drift from the transaction history.

### 3. Due-vs-Future Is Date-Driven and Timezone-Aware
Backend (`isCurrentOrPastMonth` → `currentPeriodKey()`) and frontend (`isDueFee` → `currentPeriodKey()`) both resolve the current month in **Africa/Mogadishu** via `Intl.DateTimeFormat`, so a UTC-hosted server and a browser in any time zone agree on which month has begun. On **2026-08-09** exactly one month (August 2026) is due; the remaining 16 are NOT DUE. The `APP_TIMEZONE` env var (default `Africa/Mogadishu`) makes this configurable without code changes.

### 4. Server-Side NOT-DUE Guard (Not Just Frontend)
`recordPayment` compares `fee.period_key` against `currentPeriodKey()` *before* opening any transaction. A future month is rejected with `409`, **no transaction row is written**, and **no audit row is created** — the rejection is a pure, side-effect-free check. The UI's disabled save button is a UX convenience; the backend is the actual gate.

### 5. Role-Based Data Visibility
`refresh()` only fetches tables the role may read: all roles read students/fees/payments/practicals/attendance; admin additionally reads accounts/audit.

### 6. Backup & Restore
Server-managed SQLite snapshots (`VACUUM INTO`): create → never-overwrite timestamped `.db`, list, download, restore (swaps live DB, forces re-login), JSON export, factory reset to the authoritative 59 students.

---

## API Surface (Frontend Consumes)

| Endpoint | Method | Auth | Response Shape (what `refresh()` expects) |
|----------|--------|------|-------------------------------------------|
| `/api/auth/me` | GET | ✓ | `{ session: { userId, username, fullName, role, studentId, mustChangePassword, lastLogin } }` |
| `/api/auth/login` | POST | ✗ | `{ session: {...}, user: {...} }` |
| `/api/auth/logout` | POST | ✓ | `{ ok: true }` |
| `/api/auth/change-password` | POST | ✓ | `{ ok: true, session: {...} }` |
| `/api/students` | GET | ✓ | `{ students: [...] }` (student role → own row only) |
| `/api/students` | POST | admin | `{ student, students: [...] }` |
| `/api/students/:id` | PATCH | admin | `{ student, students: [...] }` (id change blocked if payments exist → 409) |
| `/api/students/:id/status` | PATCH | admin | `{ student, students: [...] }` |
| `/api/students/:id` | DELETE | admin | `{ student, students: [...] }` (soft-suspend) |
| `/api/fees` | GET | ✓ | `{ fees: [...] }` — includes `periodKey` |
| `/api/fees` | POST | admin | `{ fee, fees: [...] }`; `periodKey` required, duplicate → 409 |
| `/api/fees/:id` | PATCH | admin | `{ fee, fees: [...] }` |
| `/api/fees/:id/toggle` | POST | admin | `{ fee, fees: [...] }` |
| `/api/fees/:id` | DELETE | admin | `{ ...result, fees: [...] }`; blocked if payments recorded → 409 |
| `/api/payments` | GET | ✓ | `{ payments: [...] }` (includes `recordedByName`, `periodKey`); filters: `studentId`, `feeId`, `periodKey`, `status`, `method`, `search` |
| `/api/payments` | POST | admin | `{ payment, payments: [...] }`; `$1`/`$2` only, overpayment/paid-in-full → 409 |
| `/api/payments/:id` | DELETE | admin | `{ ...result, payments: [...] }` (audited) |
| `/api/practicals` | GET | ✓ | `{ subjects: [...] }` |
| `/api/practicals` | POST | admin | `{ subject, subjects: [...] }` |
| `/api/practicals/:id` | PATCH | admin | `{ subject, subjects: [...] }` |
| `/api/practicals/:id/toggle` | POST | admin | `{ subject, subjects: [...] }` |
| `/api/practicals/:id` | DELETE | admin | `{ ...result, subjects: [...] }` |
| `/api/practicals/attendance` | GET | ✓ | `{ attendance: [...] }` |
| `/api/practicals/:id/sessions` | POST | admin | `{ attendance: [...] }` |
| `/api/practicals/:id/sessions/save` | POST | admin | `{ attendance: [...] }` |
| `/api/practicals/:id/sessions/:date` | DELETE | admin | `{ ...result, allAttendance: [...] }` |
| `/api/accounts` | GET | admin | `{ users: [...] }` |
| `/api/accounts` | POST | admin | `{ user, users: [...] }` |
| `/api/accounts/:id/active` | PATCH | admin | `{ user, users: [...] }` |
| `/api/accounts/:id/reset-password` | POST | admin | `{ ok: true, user }` |
| `/api/dashboard/summary` | GET | leader/admin | `{ summary: { totalRequired, totalScheduledAll, totalCollected, dueFeeCount, futureFeeCount, feeBreakdown, statusCounts, ... } }` |
| `/api/dashboard/me` | GET | student | `{ summary: { totalRequired, totalPaid, totalRemaining, feeStatuses[], ... } }` |
| `/api/backup` | GET | admin | `{ backups: [{name,size,modified},...] }` |
| `/api/backup/create` | POST | admin | `{ ok: true, backup, backups: [...] }` |
| `/api/backup/download/:name` | GET | admin | File download (`.db`) |
| `/api/backup/restore/:name` | POST | admin | `{ ok: true, filename }` |
| `/api/backup/export` | GET | admin | `{ meta, users, students, fees, payments, subjects, attendance, audit }` |
| `/api/backup/reset` | POST | admin | `{ ok: true, students: 59 }` |
| `/api/audit` | GET | admin | `{ audit: [...] }` |
| `/api/health` | GET | ✗ | `{ ok, database: 'sqlite', students }` |

---

## Security Posture

| Layer | Mechanism |
|-------|-----------|
| **Transport** | Same-origin only; HTTPS in production (Helmet + HSTS) |
| **Auth** | HTTP-only session cookie (express-session + SQLiteSessionStore), `bcryptjs` (cost 10) |
| **Session** | 8-hour TTL, rolling, destroyed on logout |
| **Rate limiting** | Login: 20 req/15min; API: 1000 req/15min |
| **RBAC** | Backend middleware: `requireAuth`, `requireRole(...)` — enforced server-side |
| **Audit** | Every mutation writes an immutable `audit_logs` row (actor, action, entity, details, IP) |
| **Input validation** | Zod schemas on every mutating endpoint |
| **CSRF** | SameSite cookie + API-only mutations (no form POSTs) |
| **SQL injection** | Parameterized queries only (`db.prepare().run(...)`) |
| **Password policy** | Min 6 chars, forced change on first login / admin reset |

---

## Database Schema (8 Tables)

```sql
users                -- login accounts (id, username, email, full_name, password_hash, role, active, must_change_password, last_login, created_at, updated_at)
students             -- 59 batch students (id, student_id, full_name, gender, phone, email, program='Public Health', batch='Batch Five', status, avatar_color, user_id FK, created_at, updated_at)
fee_requirements     -- 17 monthly fees (id, title, category, required_amount, due_date, period_key UNIQUE, description, active, created_by FK, created_at, updated_at)
payment_transactions -- $1/$2 payments (id, transaction_id, student_id FK, fee_requirement_id FK, amount CHECK(0<amount<=2), method, reference, note, payment_date, recorded_by FK, created_at)
practical_subjects   -- dynamic practicals (id, subject_name, code, practical_date, instructor, notes, status, created_by FK, created_at, updated_at)
practical_attendance -- attendance marks (id, practical_subject_id FK, student_id FK, practical_date, attendance_status, marked_by FK, created_at, updated_at)
audit_logs           -- immutable trail (id, user_id FK, action, entity_type, entity_id, old_value, new_value, details, ip_address, created_at)
sessions             -- express-session store (sid, sess JSON, expire)
```

---

## Default Credentials

| Role | Username | Password | Notes |
|------|----------|----------|-------|
| **Admin** | `admin` | set by you | Created via `npm run create-admin` (env vars `ADMIN_USERNAME`/`ADMIN_PASSWORD`) |
| **Class Leader** | — | — | Created via `npm run create-admin -- --role class-leader` |
| **Student** | `<STUDENT_ID>` (e.g. `HS231401`) | `123456` | Auto-created with each student; forced change on first sign-in |

**Seed script** creates the **59 students** (`HS231401`–`HS231459`) with deterministic accounts and the **17 monthly fee requirements** — it creates **no** demo subjects, payments, or attendance.

---

## Run Commands

```bash
# 1. Install dependencies
npm install

# 2. Seed / migrate the database (59 students + 17 monthly fees)
npm run seed

# 3. Create an admin account (customize via env vars)
ADMIN_USERNAME=admin ADMIN_PASSWORD=Admin123 ADMIN_FULL_NAME="System Admin" npm run create-admin

# 4. Run tests (10 files, 73 tests — all must pass)
npm test

# 5. Start server (serves frontend + API on :3000)
APP_TIMEZONE=Africa/Mogadishu npm start   # timezone defaults to Africa/Mogadishu
# or for dev with auto-reload:
npm run dev

# 6. Open browser
# http://localhost:3000  → index.html (landing + login)
# http://localhost:3000/app.html  → portal (after login)
```

> The migration runs automatically the first time the app opens an old-format `app.db`. It preserves all 59 students and their logins.

---

## Verified Database State (Dev `backend/data/app.db`, 2026-08-09)

```
students                 59
users                    60  (59 student logins + 1 admin)
fee_requirements         17
payment_transactions      0
practical_subjects        0
practical_attendance      0
```

**Fee schedule** — 17 rows, `2026-08`…`2027-12`, $2 each, due on the last day of each month, all active.

**Calculated totals** (as of 2026-08-09, i.e. August is the only month that has begun):
- Due now (Aug 2026): 59 students × $2 = **$118**
- Scheduled for all 17 months: 59 × 17 × $2 = **$2,006**
- Collected: **$0** · Remaining: **$1,886** to collect across the schedule once all months are due (paid-to-date $0)

Live smoke test of the running server against this DB: health ok (59 students), student login ok, 17 fees returned, student summary shows 1 due / 16 not-due months.

---

## Test Results — 10 files / 73 tests (all passing)

```
accounts.test.js    6   audit.test.js      5   auth.test.js       8
backup.test.js      6   dashboard.test.js  4   fees.test.js       8
health.test.js      3   payments.test.js  15   practicals.test.js 9
students.test.js    9
```

Coverage highlights:
- **fees**: exactly 17 seeded months, correct titles/amounts, duplicate `period_key` rejected (409), guarded deletion.
- **payments**: `$1`/`$2` only, 403 for non-admins, recorded-by attribution, overpayment impossible (409), paid-in-full block, partial→paid flows, live dashboard deltas, audited deletion, period/status filters, and the **server-side NOT-DUE guard**: current-month succeeds, past-month succeeds, future-month rejected with the exact 409 message, rejected payment writes no transaction row.
- **dashboard**: batch summary (date-aware due counts, total required/collected/scheduled), per-student summary, live updates after a payment, NOT DUE handling.
- **practicals**: 0 seeded subjects, session open/save/mass-action, student own-row visibility, leader read-only.
- **students**: own-record visibility, leader read-all, admin CRUD, id-change guard, soft-suspend blocks login.
- **backup/accounts/audit/auth/health**: admin-only guards, snapshot restore, account lifecycle, audit trail, rate limiting, seed integrity.

---

## Migration Checklist (All Complete)

- [x] `period_key` migration for existing DBs (PRAGMA check → ALTER → partial unique index, one-time demo-data cleanup)
- [x] 17 monthly fee requirements seeded (Aug 2026–Dec 2027, $2, due last day)
- [x] 59 students preserved; 0 demo subjects / payments / attendance
- [x] Monthly payment logic: UNPAID/PARTIAL/PAID, overpayment + paid-in-full rejected
- [x] NOT DUE rendering for future months across all portals + payment-modal guard
- [x] **Server-side NOT-DUE guard**: `recordPayment` rejects future months (409, fixed message) in Africa/Mogadishu time, before any insert — no transaction, no audit row
- [x] Admin payments page as a monthly ledger (month, status, search filters)
- [x] Class leader read-only monthly views
- [x] Backend dashboard totals derived live (due vs scheduled)
- [x] All 10 test files / 73 tests pass
- [x] Server smoke-tested against the migrated dev DB
- [x] Temporary verification scripts removed

---

## Known Limitations / Future Work

| Item | Status |
|------|--------|
| Offline support | Not implemented — requires service worker + IndexedDB sync |
| Real-time updates (SSE/WS) | Not implemented — manual refresh after mutations |
| File upload (receipts) | Not implemented — payment reference field only |
| Bulk student import | Not implemented — one-by-one via modal |
| Multi-batch support | Schema supports `batch` column; UI is Batch Five only |

---

## Rollback Plan

The dev DB migration is one-way on disk; to roll the **code** back, restore the pre-migration frontend/backend files from version control. A fresh `npm run seed` + `npm run create-admin` rebuilds the authoritative state at any time.

---

**Report generated**: 2026-08-09  
**System**: Public Health Batch Five Management System — Zamzam University of Science & Technology  
**Status**: ✅ 17 monthly fees · API-backed · migration verified · server-side NOT-DUE guard enforced · 73/73 tests passing
