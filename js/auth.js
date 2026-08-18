/* ==========================================================================
   auth.js — Authentication, RBAC & session mirror (API-backed)
   -------------------------------------------------------------------------
   Login is username/password verified by the backend. The session cookie is
   set server-side (HTTP-only) and mirrored into sessionStorage for fast,
   synchronous reads of the current user's identity. Every protected route is
   enforced on the backend — the role checks here are a navigation convenience
   only and cannot be bypassed by a stray page.
   ========================================================================== */
(function () {
  'use strict';

  var SESSION_KEY = 'ph5_session';

  var ROLE_LABELS = {
    admin: 'Admin / Staff',
    class_leader: 'Class Leader',
    student: 'Student'
  };

  /* Permissions per role. 'admin' bypasses all checks. */
  var PERMS = {
    student: [
      'dashboard', 'profile.view', 'fees.view', 'payments.view', 'attendance.view',
      'password.change'
    ],
    class_leader: [
      'dashboard', 'profile.view', 'students.view', 'fees.view', 'payments.view',
      'attendance.view', 'password.change'
    ],
    admin: null // means: everything
  };

  function session() {
    try {
      var raw = sessionStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  /* Store the session mirror. Accepts either a user object ({ id }) or the
     backend session payload ({ userId }). */
  function setSession(u) {
    var s = {
      userId: u.id || u.userId,
      username: u.username,
      fullName: u.fullName,
      role: u.role,
      studentId: u.studentId || null,
      mustChangePassword: !!u.mustChangePassword,
      createdAt: u.createdAt || null
    };
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
    return s;
  }

  function clearSession() { sessionStorage.removeItem(SESSION_KEY); }

  /* ---------- Login (async) ---------- */
  function login(username, password) {
    if (!username || !password) {
      return Promise.resolve({ ok: false, error: 'Enter your username and password.' });
    }
    return PH5.api.request('POST', '/auth/login',
      { username: String(username).trim(), password: String(password) }, { noRedirect: true })
      .then(function (data) {
        setSession(data.session);
        return { ok: true, session: data.session };
      })
      .catch(function (err) {
        return { ok: false, error: err.message || 'Sign-in failed.' };
      });
  }

  function logout() {
    try {
      PH5.api.request('POST', '/auth/logout', undefined, { noRedirect: true }).catch(function () {});
    } catch (_) { /* ignore — the cookie may already be gone */ }
    clearSession();
  }

  /* ---------- Password change (async) ---------- */
  function changePassword(currentPw, newPw) {
    return PH5.api.request('POST', '/auth/change-password',
      { currentPassword: currentPw, newPassword: newPw })
      .then(function (data) {
        setSession(data.session);
        return { ok: true, session: data.session };
      })
      .catch(function (err) {
        return { ok: false, error: err.message || 'Could not change the password.' };
      });
  }

  /* ---------- Account creation (admin, async) ---------- */
  function createUser(account) {
    return PH5.api.createAccount({
      username: account.username,
      fullName: account.fullName,
      role: account.role,
      password: account.password || '123456',
      studentId: account.studentId || null
    }).then(function () {
      return { ok: true };
    }).catch(function (err) {
      return { ok: false, error: err.message };
    });
  }

  /* ---------- Role-based access control (UI convenience) ---------- */
  function can(role, action) {
    if (role === 'admin') return true;
    var list = PERMS[role];
    if (!list) return false;
    return list.indexOf(action) !== -1;
  }
  function currentCan(action) {
    var s = session();
    return !!s && can(s.role, action);
  }
  function requirePermission(action) {
    var s = session();
    if (!s) throw new Error('Your session has expired. Please sign in again.');
    if (!can(s.role, action)) throw new Error('You do not have permission to perform this action.');
  }

  PH5.auth = {
    login: login,
    logout: logout,
    session: session,
    setSession: setSession,
    clearSession: clearSession,
    changePassword: changePassword,
    can: can,
    currentCan: currentCan,
    requirePermission: requirePermission,
    createUser: createUser,
    roleLabel: function (r) { return ROLE_LABELS[r] || r; }
  };

  /* Audit logging now happens on the server (single authoritative trail).
     Kept as a no-op so existing call sites remain valid. */
  PH5.audit = {
    log: function () { return null; }
  };
})();
