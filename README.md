# Public Health Batch Five Management System
### Zamzam University of Science & Technology — Public Health · Batch Five

A complete management system for the **59 registered students of Public Health
Batch Five**, built on **Express + SQLite** (the backend is the single source of
truth) with a browser frontend served from the same server. Data is never kept
in `localStorage` — every read/write goes through the REST API.

`index.html` is a **professional landing page**: a header, hero, three
role-specific portal cards (Student / Class Leaders / Staff-Admin), an info
strip, feature grid, footer, and a **separate sign-in modal per portal**.
No credentials are shown publicly — every sign-in uses the secure
`PH5.auth.login()` session flow (bcrypt hashing + forced password change).

---

## ▶️ How to run

1. `npm install`
2. `npm run seed` — seeds the 59 students + 17 monthly fee requirements
3. `npm run create-admin` — create your admin account (env vars `ADMIN_USERNAME`/`ADMIN_PASSWORD`)
4. `npm start` (or `npm run dev`)
5. Open **http://localhost:3000** → `index.html` (landing + login) and
   **http://localhost:3000/app.html** → portal (after login).

## Demo accounts

> Listed here for development/testing only — never shown on the public page.

| Role        | Username   | Password   | Access |
|-------------|------------|------------|--------|
| Admin/Staff | `admin`    | set by you | Full management of everything |
| Class Leader| created via `npm run create-admin -- --role class-leader` | — | Read-only overview of the whole batch |
| Student     | e.g. `HS231429` | `123456` | Own profile, monthly fees, payments, attendance |

> Every account is forced to **change its password at first sign-in**.

## What's implemented

- **Three roles with role-based access control** — each navigation menu and every
  mutating action is permission-gated (enforced server-side).
- **17 monthly fee requirements** — shared records for Aug 2026 – Dec 2027,
  **$2/month/student**, due on the last day of each month. A month becomes due once
  its month begins; future months render **NOT DUE**.
- **Monthly payment logic** — admins record payments of **only $1 or $2** per
  transaction for the selected month, with **overpayment protection** and a
  **paid-in-full block**; statuses are derived live: $0 → UNPAID, $1 → PARTIAL,
  $2 → PAID.
- **Student portal** — read-only view of own profile, a monthly fee table
  (Month / Required / Paid / Remaining / Status / payment history), attendance.
- **Class-leader portal** — read-only batch overview, all 59 students, the same
  monthly contribution records, payments, attendance.
- **Admin portal** — dashboard with live totals, student management (full CRUD),
  monthly fee requirements, a **payments ledger filtered by month / status /
  search** with a record-payment modal that guards future months, practical
  subjects & attendance, accounts, backup & restore, and a full audit log.
- **Practical subjects & attendance** — subjects are dynamic (admin-created,
  none seeded); attendance per subject + date with Present / Absent / Not Marked,
  bulk "mark all present", and session management.
- **Accounts & backup** — create/reset/deactivate accounts; server-managed SQLite
  snapshot backups (create/list/download/restore), JSON export, and factory reset.
- **Password & security** — bcrypt hashing (cost 10), forced password change on
  first login, admin password reset, audit logging of every critical action,
  login rate limiting, HTTP-only session cookies.
- **59 students** pre-seeded with real names and IDs (HS231401 → HS231459).
- **Responsive** — desktop sidebar, tablet collapsed sidebar, mobile drawer.
- Empty states, search/filter, inline form validation, friendly error handling,
  and a professional navy/royal/teal design.

## Project structure

```
project/
  index.html            Landing page + 3 portal login modals (public)
  app.html              Application shell (sidebar + topbar + page container)
  css/style.css         Design system & responsive layout
  js/
    db.js               API client (PH5.api) + in-memory cache (PH5.db)
    auth.js             Session authentication + RBAC (API-backed)
    ui.js               UI helpers (toasts, modals, confirms, formatters)
    portal-student.js   Student & class-leader portals (monthly fees)
    portal-admin.js     Admin: dashboard, students, fees, payments ledger
    portal-admin2.js    Admin: attendance, accounts, backup, audit
    app.js              Router, navigation, boot, error handling
  backend/
    app.js              Express app + static serving
    database/           schema.sql, db.js (connection + migration), seed.js, roster.js
    services/           fees, payments, dashboard, students, accounts, practicals, backup, audit
    routes/             REST API routes (Zod validation + RBAC middleware)
    middleware/         auth, validate, errors
  tests/                10 files / 69 tests (node:test)
```

## Data model

The backend owns a normalized SQLite schema (`backend/database/schema.sql`):

`users · students · fee_requirements (period_key) · payment_transactions ·
practical_subjects · practical_attendance · audit_logs · sessions`

All balances and statuses are **derived with `SUM(...)` at query time** — never
stored — so totals can never drift from the transaction history.