/* ==========================================================================
   app.js — Router, navigation shell, boot sequence & global error handling
   ========================================================================== */
(function () {
  'use strict';
  var db = PH5.db, ui = PH5.ui, auth = PH5.auth;
  var esc = ui.escape;

  /* Sidebar definitions per role. Only permitted pages are shown. */
  var NAV = {
    student: [
      { key: 'dashboard', icon: 'fa-gauge-high', label: 'Dashboard' },
      { key: 'fees', icon: 'fa-receipt', label: 'My fees' },
      { key: 'payments', icon: 'fa-credit-card', label: 'My payments' },
      { key: 'attendance', icon: 'fa-calendar-check', label: 'My attendance' },
      { key: 'profile', icon: 'fa-user', label: 'My profile' }
    ],
    class_leader: [
      { key: 'dashboard', icon: 'fa-gauge-high', label: 'Batch overview' },
      { key: 'students', icon: 'fa-users', label: 'All students' },
      { key: 'fees', icon: 'fa-receipt', label: 'Fees and payments' },
      { key: 'payments', icon: 'fa-credit-card', label: 'Batch payments' },
      { key: 'attendance', icon: 'fa-calendar-check', label: 'Attendance' },
      { key: 'subjects', icon: 'fa-flask', label: 'Subjects' },
      { key: 'profile', icon: 'fa-user', label: 'My profile' }
    ],
    admin: [
      { key: 'dashboard', icon: 'fa-gauge-high', label: 'Dashboard' },
      { key: 'students', icon: 'fa-users', label: 'Students' },
      { key: 'fees', icon: 'fa-receipt', label: 'Fee requirements' },
      { key: 'payments', icon: 'fa-circle-dollar-to-slot', label: 'Payments' },
      { key: 'attendanceAdmin', icon: 'fa-clipboard-check', label: 'Subjects & attendance' },
      { key: 'accounts', icon: 'fa-user-lock', label: 'Accounts' },
      { key: 'backup', icon: 'fa-database', label: 'Backup & restore' },
      { key: 'audit', icon: 'fa-clock-rotate-left', label: 'Audit log' }
    ]
  };

  var currentPage = null;

  function pageTitle(key) {
    var role = auth.session().role;
    var item = (NAV[role] || []).find(function (n) { return n.key === key; });
    return item ? item.label : 'Dashboard';
  }

  function buildSidebar() {
    var s = auth.session();
    if (!s) return;
    var nav = NAV[s.role] || [];
    var container = document.getElementById('sidebar-nav');
    container.innerHTML = nav.map(function (item) {
      return '<button class="nav-item" data-page="' + item.key + '">' +
        '<i class="fa-solid ' + item.icon + '"></i><span>' + esc(item.label) + '</span></button>';
    }).join('');

    /* User chip */
    var foot = document.getElementById('sidebar-user');
    var student = db.studentById(s.studentId);
    foot.innerHTML =
      ui.avatar(s.fullName, student ? student.avatarColor : db.avatarColor(s.username)) +
      '<div class="u-txt"><div class="u-name">' + esc(s.fullName) + '</div>' +
      '<div class="u-role">' + esc(auth.roleLabel(s.role)) + '</div></div>';

    /* Topbar role chip */
    var chip = document.getElementById('role-chip');
    chip.className = 'role-chip ' + (s.role === 'admin' ? 'admin' : s.role === 'class_leader' ? 'leader' : '');
    chip.textContent = auth.roleLabel(s.role);
  }

  function showPage(key) {
    var s = auth.session();
    if (!s) { location.href = 'index.html'; return; }
    /* Only allow navigation to items in the role's sidebar. */
    var allowed = (NAV[s.role] || []).some(function (n) { return n.key === key; });
    if (!allowed) key = 'dashboard';

    var page = PH5.pages[key];
    if (!page) { renderError('Unknown page: ' + key); return; }

    var view = document.getElementById('view');
    currentPage = key;
    try {
      page(view, null);
    } catch (err) {
      renderError(err.message || String(err));
    }

    /* Highlight active nav */
    document.querySelectorAll('.nav-item').forEach(function (el) {
      el.classList.toggle('active', el.getAttribute('data-page') === key);
    });
    document.getElementById('crumb').innerHTML = 'Public Health Batch 5 / <b>' + esc(pageTitle(key)) + '</b>';
    document.title = 'Batch Five — ' + pageTitle(key);
    window.scrollTo(0, 0);
    closeMobileMenu();
  }

  function renderError(message) {
    document.getElementById('view').innerHTML =
      '<div class="card"><div class="card-body" style="text-align:center;padding:60px 20px;">' +
        '<div class="empty-ico" style="width:64px;height:64px;margin:0 auto 16px;border-radius:50%;background:var(--danger-soft);color:var(--danger);display:flex;align-items:center;justify-content:center;font-size:24px;"><i class="fa-solid fa-triangle-exclamation"></i></div>' +
        '<h3>Something went wrong</h3>' +
        '<p class="text-muted">' + esc(message || 'An unexpected error occurred.') + '</p>' +
      '</div></div>';
  }

  /* ---------- Forced password change (first sign-in / after reset) ---------- */
  function forcePasswordChange() {
    var s = auth.session();
    if (!s.mustChangePassword) return;

    var m = ui.openModal({
      title: 'Set a new password',
      locked: true,
      body:
        '<p class="text-muted mb-16" style="font-size:13.5px;">For your security you must set a new password before you can continue. Passwords must be at least 6 characters.</p>' +
        '<div class="field"><label>Current password</label><input id="pc-cur" type="password" autocomplete="off"></div>' +
        '<div class="field"><label>New password</label><input id="pc-new" type="password" autocomplete="off"></div>' +
        '<div class="field"><label>Confirm new password</label><input id="pc-confirm" type="password" autocomplete="off"></div>' +
        '<div class="field"><div class="err-msg" id="pc-error"></div></div>',
      footer:
        '<button class="btn btn-primary btn-block" id="pc-save"><i class="fa-solid fa-key"></i> Update password</button>'
    });
    function showErr(msg) {
      var errEl = m.el.querySelector('#pc-error');
      errEl.textContent = msg;
      errEl.style.display = 'block';
    }
    m.el.querySelector('#pc-save').addEventListener('click', function () {
      var cur = m.el.querySelector('#pc-cur').value;
      var neu = m.el.querySelector('#pc-new').value;
      var confirm = m.el.querySelector('#pc-confirm').value;
      if (neu.length < 6) { showErr('New password must be at least 6 characters.'); return; }
      if (neu !== confirm) { showErr('The two passwords do not match.'); return; }
      var btn = this;
      btn.disabled = true;
      auth.changePassword(cur, neu).then(function (res) {
        btn.disabled = false;
        if (!res.ok) { showErr(res.error); return; }
        ui.toast('success', 'Password updated', 'You can now use the system with your new password.');
        m.close();
        showPage('dashboard');
      });
    });
  }

  /* ---------- Mobile menu ---------- */
  function closeMobileMenu() {
    var sb = document.getElementById('sidebar');
    var ov = document.getElementById('sidebar-overlay');
    if (sb) sb.classList.remove('open');
    if (ov) ov.classList.remove('show');
  }

  /* ---------- Boot ---------- */
  function boot() {
    var s = auth.session();
    if (!s) { location.href = 'index.html'; return; }

    var view = document.getElementById('view');
    view.innerHTML =
      '<div class="card"><div class="card-body" style="text-align:center;padding:60px 20px;">' +
        '<div class="empty-ico" style="width:64px;height:64px;margin:0 auto 16px;border-radius:50%;background:var(--royal-100);color:var(--royal-700);display:flex;align-items:center;justify-content:center;font-size:24px;"><i class="fa-solid fa-circle-notch fa-spin"></i></div>' +
        '<h3>Loading your dashboard…</h3>' +
      '</div></div>';

    /* Pull the full dataset into the cache, then render the shell. */
    PH5.api.refresh().then(function () {
      var user = db.userById(s.userId);
      if (!user || !user.isActive) { auth.logout(); location.href = 'index.html'; return; }

      buildSidebar();
      showPage('dashboard');
      bindEvents();
      forcePasswordChange();
    }).catch(function (err) {
      if (err && err.status === 401) { location.href = 'index.html'; return; }
      renderError((err && err.message) || String(err));
    });
  }

  /* One-time event binding (safe to run after the sidebar exists). */
  function bindEvents() {
    /* Navigation clicks */
    document.getElementById('sidebar-nav').addEventListener('click', function (e) {
      var item = e.target.closest('[data-page]');
      if (item) showPage(item.getAttribute('data-page'));
    });
    /* Clicks on elements that request navigation (e.g. dashboard buttons) */
    document.addEventListener('click', function (e) {
      var el = e.target.closest('[data-nav]');
      if (el) { e.preventDefault(); showPage(el.getAttribute('data-nav')); }
    });

    /* Mobile */
    document.getElementById('menu-btn').addEventListener('click', function () {
      document.getElementById('sidebar').classList.add('open');
      document.getElementById('sidebar-overlay').classList.add('show');
    });
    document.getElementById('sidebar-overlay').addEventListener('click', closeMobileMenu);

    /* Logout */
    var doLogout = function () { auth.logout(); location.href = 'index.html'; };
    document.getElementById('logout-btn').addEventListener('click', doLogout);
    var topLogout = document.getElementById('logout-btn-top');
    if (topLogout) topLogout.addEventListener('click', doLogout);
  }

  /* ---------- Global error surfacing ---------- */
  window.addEventListener('error', function (e) {
    try { ui.toast('error', 'Unexpected error', e.message || 'An error occurred on this page.'); } catch (_) {}
  });
  window.addEventListener('unhandledrejection', function (e) {
    try { ui.toast('error', 'Unexpected error', (e.reason && e.reason.message) || 'An asynchronous error occurred.'); } catch (_) {}
  });

  document.addEventListener('DOMContentLoaded', boot);
})();
