/* ==========================================================================
   db.js — Frontend data layer: thin API client + in-memory cache.
   -------------------------------------------------------------------------
   The backend (Express + SQLite) is the single source of truth. This file:
   - talks to the REST API (/api/*) using the session cookie set at login;
   - keeps a small in-memory cache of the tables the current role may read,
     refreshed at sign-in and after every mutation;
   - keeps the same synchronous read API the portals already use
     (students(), fees(), payments(), …) so page reads are unchanged — every
     write goes through PH5.api and re-syncs the cache.
   ========================================================================== */
(function () {
  'use strict';

  /* ---------- Deterministic 53-bit hash (mirrors the backend seed) ---------- */
  function cyrb53(str, seed) {
    seed = seed || 0;
    var h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
    for (var i = 0; i < str.length; i++) {
      var ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
  }

  var AVATAR_PALETTE = ['#2456c7', '#0f9b96', '#e08f00', '#7c5cd6', '#d6457f', '#0f9d58', '#4a6fa5', '#b0612b'];

  function avatarColor(seedStr) {
    return AVATAR_PALETTE[cyrb53(String(seedStr)) % AVATAR_PALETTE.length];
  }

  function uid(prefix) {
    var rnd = Math.random().toString(36).slice(2, 8) + Math.random().toString(36).slice(2, 8);
    return (prefix || 'id') + '_' + Date.now().toString(36) + rnd;
  }

  function todayISO() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  /* Deterministic phone in the same format the backend seed used. */
  function makePhone(studentId) {
    var h = cyrb53(String(studentId) + '|phone');
    return '+252 6' + String(10 + (h % 8)) + ' ' + String(1000000 + (h % 8999999));
  }

  /* Deterministic student email in the same format the backend seed used. */
  function makeEmail(name, studentId) {
    var parts = String(name).toLowerCase().replace(/[^a-z ]/g, '').trim().split(/\s+/);
    return (parts[0] + '.' + (parts[1] || String(studentId).slice(-3))) + '@student.zamzam.edu.so';
  }

  /* Kept for parity — password hashing now happens on the server only. */
  function hashPassword(pw, salt) { return cyrb53(salt + '|' + pw + '|ph5').toString(36); }
  function makeSalt() { return cyrb53(String(Date.now()) + Math.random()).toString(36).slice(0, 10); }

  /* ---------- In-memory cache (populated from the API at sign-in) ---------- */
  var DB = {
    meta: { schemaVersion: 2, appName: 'Public Health Batch Five Management System', createdAt: null, lastBackupAt: null },
    users: [], students: [], fees: [], payments: [], subjects: [], attendance: [], audit: []
  };

  function ensureDB() { return DB; }

  /* ---------- HTTP client ---------- */
  function request(method, path, body, opts) {
    opts = opts || {};
    return fetch('/api' + path, {
      method: method,
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: body !== undefined ? JSON.stringify(body) : undefined
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (res.ok) return data;
        var err = new Error((data && data.error) || 'Request failed (' + res.status + ').');
        err.status = res.status;
        err.data = data;
        throw err;
      });
    }).catch(function (err) {
      /* Expired / disabled session → drop the mirror and return to the login
         page. Never auto-redirect for login itself (handled in auth.js). */
      if (err && err.status === 401 && !opts.noRedirect) {
        try { sessionStorage.removeItem('ph5_session'); } catch (_) {}
        var here = window.location.pathname || '/';
        if (here.indexOf('index.html') === -1 && here !== '/' && here !== '') {
          window.location.href = 'index.html';
        }
      }
      throw err;
    });
  }

  function get(path) { return request('GET', path); }
  function post(path, body) { return request('POST', path, body); }
  function patch(path, body) { return request('PATCH', path, body); }
  function del(path) { return request('DELETE', path); }

  /* ---------- Load every table the current role may read into the cache ---- */
  function refresh() {
    var s = PH5.auth.session();
    if (!s) {
      var e = new Error('Please sign in to continue.');
      e.status = 401;
      return Promise.reject(e);
    }
    /* Validate the session on the server and mirror the fresh payload. */
    return get('/auth/me').then(function (me) {
      var payload = me.session;
      PH5.auth.setSession({
        id: payload.userId, username: payload.username, fullName: payload.fullName,
        role: payload.role, studentId: payload.studentId || null,
        mustChangePassword: !!payload.mustChangePassword,
        createdAt: payload.createdAt, lastLogin: payload.lastLogin
      });

      var tasks = [
        get('/fees').then(function (r) { DB.fees = r.fees; }),
        get('/practicals').then(function (r) { DB.subjects = r.subjects; }),
        get('/practicals/attendance').then(function (r) { DB.attendance = r.attendance; }),
        get('/students').then(function (r) { DB.students = r.students; }),
        get('/payments').then(function (r) { DB.payments = r.payments; })
      ];
      if (payload.role === 'admin') {
        tasks.push(get('/accounts').then(function (r) { DB.users = r.users; }));
        tasks.push(get('/audit').then(function (r) { DB.audit = r.audit; }));
      }
      return Promise.all(tasks).then(function () {
        /* Make the signed-in user's own account resolvable for every role. */
        DB.users = (DB.users || []).filter(function (u) { return u.id !== payload.userId; });
        DB.users.push({
          id: payload.userId, username: payload.username, fullName: payload.fullName,
          role: payload.role, studentId: payload.studentId || null,
          isActive: true, mustChangePassword: !!payload.mustChangePassword,
          createdAt: payload.createdAt
        });
      });
    });
  }

  /* ---------- Mutations (call the API, then re-sync the cache) ---------- */
  function thenRefresh(p) { return p.then(refresh); }

  function createStudent(payload) { return thenRefresh(post('/students', payload)); }
  function updateStudent(id, payload) { return thenRefresh(patch('/students/' + encodeURIComponent(id), payload)); }
  function updateStudentStatus(id, status) {
    return thenRefresh(patch('/students/' + encodeURIComponent(id) + '/status', { status: status }));
  }
  function deleteStudent(id) { return thenRefresh(del('/students/' + encodeURIComponent(id))); }

  function createFee(payload) { return thenRefresh(post('/fees', payload)); }
  function updateFee(id, payload) { return thenRefresh(patch('/fees/' + encodeURIComponent(id), payload)); }
  function toggleFee(id) { return thenRefresh(post('/fees/' + encodeURIComponent(id) + '/toggle')); }
  function deleteFee(id) { return thenRefresh(del('/fees/' + encodeURIComponent(id))); }

  function createPayment(payload) { return thenRefresh(post('/payments', payload)); }
  function deletePayment(id) { return thenRefresh(del('/payments/' + encodeURIComponent(id))); }

  function createSubject(payload) { return thenRefresh(post('/practicals', payload)); }
  function updateSubject(id, payload) { return thenRefresh(patch('/practicals/' + encodeURIComponent(id), payload)); }
  function toggleSubject(id) { return thenRefresh(post('/practicals/' + encodeURIComponent(id) + '/toggle')); }
  function deleteSubject(id) { return thenRefresh(del('/practicals/' + encodeURIComponent(id))); }

  function openSession(subjectId, date) {
    return thenRefresh(post('/practicals/' + encodeURIComponent(subjectId) + '/sessions', { date: date }));
  }
  function saveAttendance(subjectId, date, entries) {
    return thenRefresh(post('/practicals/' + encodeURIComponent(subjectId) + '/sessions/save', { date: date, entries: entries }));
  }
  function deleteSession(subjectId, date) {
    return thenRefresh(del('/practicals/' + encodeURIComponent(subjectId) + '/sessions/' + encodeURIComponent(date)));
  }

  function createAccount(payload) { return thenRefresh(post('/accounts', payload)); }
  function setAccountActive(id, active) {
    return thenRefresh(patch('/accounts/' + encodeURIComponent(id) + '/active', { active: !!active }));
  }
  function resetPassword(id, newPassword) {
    return thenRefresh(post('/accounts/' + encodeURIComponent(id) + '/reset-password', { newPassword: newPassword }));
  }
  /* Class Leader assignment (admin-only, max two active). Only the role
     changes — the student record, password and all records are preserved. */
  function assignLeader(id) {
    return thenRefresh(patch('/accounts/' + encodeURIComponent(id) + '/leader', { action: 'assign' }));
  }
  function removeLeader(id) {
    return thenRefresh(patch('/accounts/' + encodeURIComponent(id) + '/leader', { action: 'remove' }));
  }

  /* Backup & restore (server-managed SQLite snapshots). */
  function createBackup() { return post('/backup/create'); }
  function listBackups() { return get('/backup'); }
  function restoreBackup(name) { return post('/backup/restore/' + encodeURIComponent(name)); }
  function exportJson() { return get('/backup/export'); }
  function factoryReset() { return post('/backup/reset'); }

  /* ---------- Public API ---------- */
  window.PH5 = window.PH5 || {};

  PH5.api = {
    request: request, get: get, post: post, patch: patch, del: del,
    refresh: refresh,
    createStudent: createStudent, updateStudent: updateStudent,
    updateStudentStatus: updateStudentStatus, deleteStudent: deleteStudent,
    createFee: createFee, updateFee: updateFee, toggleFee: toggleFee, deleteFee: deleteFee,
    createPayment: createPayment, deletePayment: deletePayment,
    createSubject: createSubject, updateSubject: updateSubject,
    toggleSubject: toggleSubject, deleteSubject: deleteSubject,
    openSession: openSession, saveAttendance: saveAttendance, deleteSession: deleteSession,
    createAccount: createAccount, setAccountActive: setAccountActive, resetPassword: resetPassword,
    assignLeader: assignLeader, removeLeader: removeLeader,
    createBackup: createBackup, listBackups: listBackups,
    restoreBackup: restoreBackup, exportJson: exportJson, factoryReset: factoryReset
  };

  /* ---------- Read API (synchronous over the cache) ---------- */
  PH5.db = {
    load: function () {},
    ensure: ensureDB,
    persist: function () {},

    get all() { ensureDB(); return DB; },

    uid: uid,
    avatarColor: avatarColor,
    hashPassword: hashPassword,
    makeSalt: makeSalt,
    makePhone: makePhone,
    makeEmail: makeEmail,
    todayISO: todayISO,

    users: function () { ensureDB(); return DB.users; },
    students: function () { ensureDB(); return DB.students; },
    fees: function () { ensureDB(); return DB.fees; },
    payments: function () { ensureDB(); return DB.payments; },
    subjects: function () { ensureDB(); return DB.subjects; },
    attendance: function () { ensureDB(); return DB.attendance; },
    audit: function () { ensureDB(); return DB.audit; },

    studentById: function (id) {
      ensureDB();
      return DB.students.find(function (s) { return s.id === id || s.studentId === id; });
    },
    feeById: function (id) { ensureDB(); return DB.fees.find(function (f) { return f.id === id; }); },
    subjectById: function (id) { ensureDB(); return DB.subjects.find(function (s) { return s.id === id; }); },
    userById: function (id) {
      ensureDB();
      return DB.users.find(function (u) { return u.id === id || u.username === id; });
    },

    paidFor: function (studentId, feeId) {
      return DB.payments.filter(function (p) { return p.studentId === studentId && p.feeId === feeId; })
        .reduce(function (sum, p) { return sum + p.amount; }, 0);
    },
    paymentsFor: function (studentId, feeId) {
      return DB.payments.filter(function (p) { return p.studentId === studentId && (!feeId || p.feeId === feeId); });
    },
    attendanceFor: function (studentId) {
      return DB.attendance.filter(function (a) { return a.studentId === studentId; });
    },

    activeStudents: function () {
      return DB.students.filter(function (s) { return s.status === 'active'; });
    },
    batchCollected: function (feeId) {
      return DB.payments.filter(function (p) { return p.feeId === feeId; })
        .reduce(function (sum, p) { return sum + p.amount; }, 0);
    },
    totalCollected: function () {
      return DB.payments.reduce(function (sum, p) { return sum + p.amount; }, 0);
    },
    /* Current month in the same YYYY-MM shape as fee.periodKey. Resolved in the
       application timezone (Africa/Mogadishu) to match the backend guard, so a
       browser in another zone renders DUE/NOT DUE exactly like the server. */
    currentPeriodKey: function () {
      try {
        var p = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Africa/Mogadishu', year: 'numeric', month: '2-digit'
        }).formatToParts(new Date());
        return p.find(function (x) { return x.type === 'year'; }).value +
          '-' + p.find(function (x) { return x.type === 'month'; }).value;
      } catch (e) {
        var d = new Date();
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
      }
    },
    /* A monthly fee is "due" once its month has begun. Fees without a period
       key (legacy records) are always treated as due. */
    isDueFee: function (fee) {
      if (!fee || !fee.periodKey) return true;
      return this.currentPeriodKey() >= String(fee.periodKey);
    },
    feeStatusCounts: function (fee) {
      var counts = { paid: 0, partial: 0, unpaid: 0, not_due: 0 };
      if (!this.isDueFee(fee)) { counts.not_due = this.activeStudents().length; return counts; }
      this.activeStudents().forEach(function (s) {
        counts[this.paymentStatus(s.studentId, fee).key]++;
      }.bind(this));
      return counts;
    },

    statsOf: function (rows) {
      var present = rows.filter(function (a) { return a.status === 'present'; }).length;
      var absent = rows.filter(function (a) { return a.status === 'absent'; }).length;
      var late = rows.filter(function (a) { return a.status === 'late'; }).length;
      var excused = rows.filter(function (a) { return a.status === 'excused'; }).length;
      var notMarked = rows.filter(function (a) { return a.status === 'not_marked'; }).length;
      var marked = present + absent;
      return {
        present: present, absent: absent, late: late, excused: excused, notMarked: notMarked,
        total: rows.length, marked: marked,
        rate: marked ? Math.round((present / marked) * 100) : 0
      };
    },
    attendanceStats: function (subjectId, date) {
      return this.statsOf(DB.attendance.filter(function (a) {
        if (subjectId && a.subjectId !== subjectId) return false;
        if (date && a.date !== date) return false;
        return true;
      }));
    },
    studentAttendanceStats: function (studentId) {
      return this.statsOf(DB.attendance.filter(function (a) { return a.studentId === studentId; }));
    },

    paymentStatus: function (studentId, fee) {
      if (!this.isDueFee(fee)) {
        return { key: 'not_due', label: 'NOT DUE', paid: 0, required: fee.amountRequired, notDue: true };
      }
      var paid = this.paidFor(studentId, fee.id);
      if (paid <= 0) return { key: 'unpaid', label: 'UNPAID', paid: paid, required: fee.amountRequired };
      if (paid < fee.amountRequired) return { key: 'partial', label: 'PARTIAL', paid: paid, required: fee.amountRequired };
      return { key: 'paid', label: 'PAID', paid: paid, required: fee.amountRequired };
    },

    sessionExists: function (subjectId, date) {
      return DB.attendance.some(function (a) { return a.subjectId === subjectId && a.date === date; });
    },
    sessionRecords: function (subjectId, date) {
      return DB.attendance.filter(function (a) { return a.subjectId === subjectId && a.date === date; });
    },

    /* Backup helpers kept for parity (the UI calls PH5.api directly now). */
    exportData: function () { return PH5.api.exportJson(); },
    importData: function () { return { ok: false, error: 'Restore is managed from the server backup list.' }; },
    applyImport: function () { return false; },
    factoryReset: function () { return PH5.api.factoryReset(); },
    reSeed: function () { ensureDB(); return DB; }
  };
})();
