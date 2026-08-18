/* ==========================================================================
   portal-admin2.js — Admin/Staff portal part 2
   Practical-subject attendance management, account management, backup &
   restore, and the audit log.
   ========================================================================== */
(function () {
  'use strict';
  var db = PH5.db, ui = PH5.ui, auth = PH5.auth;
  var esc = ui.escape;
  var pages = window.PH5.pages = window.PH5.pages || {};

  function audit(action, entity, id, details) { PH5.audit.log(action, entity, id, details); }

  function download(filename, text, mime) {
    var blob = new Blob([text], { type: mime || 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 400);
  }

  /* ==================================================================
     PRACTICAL SUBJECTS & ATTENDANCE
     ================================================================== */
  function renderAttendanceAdmin(el) {
    var subjects = db.subjects().slice().sort(function (a, b) { return a.name.localeCompare(b.name); });

    /* collect all distinct sessions (subject + date) */
    var sessionMap = {};
    db.attendance().forEach(function (a) {
      var key = a.subjectId + '|' + a.date;
      if (!sessionMap[key]) sessionMap[key] = { subjectId: a.subjectId, date: a.date, count: 0 };
      sessionMap[key].count++;
    });
    var sessions = Object.keys(sessionMap).map(function (k) { return sessionMap[k]; })
      .sort(function (a, b) { return b.date.localeCompare(a.date); });

    el.innerHTML =
      '<div class="page-head"><div><h1>Practical subjects & attendance</h1>' +
        '<div class="subtitle">Dynamic practical subjects and daily attendance marking</div></div>' +
        '<div class="actions"><button class="btn btn-primary" id="subj-add"><i class="fa-solid fa-plus"></i> Add subject</button></div></div>' +

      /* Subject cards */
      '<div class="card mb-24"><div class="card-header"><h3>Practical subjects</h3></div><div class="card-body">' +
        (subjects.length
          ? '<div class="attn-grid">' + subjects.map(function (s) {
              var stats = db.attendanceStats(s.id);
              return '<div class="attn-card">' +
                '<div style="display:flex;justify-content:space-between;align-items:flex-start;">' +
                  '<div><div class="attn-name">' + esc(s.name) + '</div>' +
                  '<div class="attn-id">' + esc(s.code) + ' · ' + esc(s.instructor || 'No instructor') + '</div></div>' +
                  (s.isActive ? '<span class="badge badge-green">ACTIVE</span>' : '<span class="badge badge-grey">INACTIVE</span>') +
                '</div>' +
                '<div class="summary-strip" style="gap:12px;margin:10px 0;">' +
                  '<div class="ss-item"><span class="ss-val" style="font-size:14px;">' + stats.present + '</span><span class="ss-lbl">present</span></div>' +
                  '<div class="ss-item"><span class="ss-val" style="font-size:14px;">' + stats.absent + '</span><span class="ss-lbl">absent</span></div>' +
                  '<div class="ss-item"><span class="ss-val" style="font-size:14px;">' + stats.late + '</span><span class="ss-lbl">late</span></div>' +
                  '<div class="ss-item"><span class="ss-val" style="font-size:14px;">' + stats.excused + '</span><span class="ss-lbl">excused</span></div>' +
                  '<div class="ss-item"><span class="ss-val" style="font-size:14px;">' + stats.notMarked + '</span><span class="ss-lbl">not marked</span></div>' +
                  '<div class="ss-item"><span class="ss-val" style="font-size:14px;">' + stats.rate + '%</span><span class="ss-lbl">rate</span></div>' +
                '</div>' +
                '<div class="attn-actions" style="margin-top:6px;">' +
                  '<button class="btn btn-sm btn-secondary" data-subj-edit="' + esc(s.id) + '"><i class="fa-solid fa-pen"></i></button>' +
                  (s.isActive
                    ? '<button class="btn btn-sm btn-ghost" data-subj-toggle="' + esc(s.id) + '" title="Deactivate"><i class="fa-solid fa-eye-slash"></i></button>'
                    : '<button class="btn btn-sm btn-ghost" data-subj-toggle="' + esc(s.id) + '" title="Activate"><i class="fa-solid fa-eye"></i></button>') +
                  '<button class="btn btn-sm btn-danger" data-subj-del="' + esc(s.id) + '"><i class="fa-solid fa-trash"></i></button>' +
                '</div></div>';
            }).join('') + '</div>'
          : ui.emptyState('fa-flask', 'No practical subjects yet', 'Create a practical subject to start recording attendance.')) +
      '</div></div>' +

      /* Session list */
      '<div class="card"><div class="card-header"><h3>Attendance sessions</h3>' +
        '<button class="btn btn-secondary btn-sm" id="attn-new"><i class="fa-solid fa-calendar-plus"></i> New session</button></div>' +
        '<div class="card-body" style="padding:0;">' +
        (sessions.length
          ? '<div class="table-wrap"><table class="table"><thead><tr><th>Subject</th><th>Date</th><th>Marked</th><th>Not marked</th><th>Rate</th><th class="text-right">Actions</th></tr></thead><tbody>' +
            sessions.map(function (sess) {
              var sub = db.subjectById(sess.subjectId);
              var stats = db.attendanceStats(sess.subjectId, sess.date);
              return '<tr><td><span class="cell-primary">' + esc(sub ? sub.name : sess.subjectId) + '</span>' +
                '<div class="cell-sub">' + esc(sub ? sub.code : '') + '</div></td>' +
                '<td class="nowrap">' + esc(ui.fmtDate(sess.date)) + '</td>' +
                '<td>' + stats.marked + '</td><td>' + stats.notMarked + '</td>' +
                '<td><span class="badge ' + (stats.rate >= 75 ? 'badge-green' : stats.rate >= 50 ? 'badge-amber' : 'badge-red') + '">' + stats.rate + '%</span></td>' +
                '<td><div class="row-actions">' +
                  '<button class="btn btn-sm btn-secondary" data-open="' + esc(sess.subjectId) + '|' + esc(sess.date) + '"><i class="fa-solid fa-clipboard-check"></i> Mark</button>' +
                  '<button class="btn btn-sm btn-ghost" data-sess-del="' + esc(sess.subjectId) + '|' + esc(sess.date) + '" title="Delete session"><i class="fa-solid fa-trash"></i></button>' +
                '</div></td></tr>';
            }).join('') + '</tbody></table></div>'
          : ui.emptyState('fa-calendar-xmark', 'No attendance sessions yet', 'Click "New session" to open a session for a subject and date.')) +
      '</div></div>';

    document.getElementById('subj-add').addEventListener('click', function () { openSubjectModal(null); });
    el.querySelector('.attn-grid') && el.querySelector('.attn-grid').addEventListener('click', function (e) {
      var t = e.target.closest('[data-subj-edit],[data-subj-toggle],[data-subj-del]');
      if (!t) return;
      var id = t.getAttribute('data-subj-edit') || t.getAttribute('data-subj-toggle') || t.getAttribute('data-subj-del');
      var sub = db.subjectById(id);
      if (t.hasAttribute('data-subj-edit')) openSubjectModal(sub);
      else if (t.hasAttribute('data-subj-toggle')) toggleSubject(sub);
      else deleteSubject(sub);
    });
    document.getElementById('attn-new').addEventListener('click', function () { openSessionModal(); });
    el.querySelector('.card:last-child .card-body').addEventListener('click', function (e) {
      var t = e.target.closest('[data-open],[data-sess-del]');
      if (!t) return;
      var val = (t.getAttribute('data-open') || t.getAttribute('data-sess-del')).split('|');
      if (t.hasAttribute('data-open')) openAttendanceMarking(val[0], val[1]);
      else deleteSession(val[0], val[1]);
    });
  }

  function openSubjectModal(subject) {
    var isEdit = !!subject;
    var m = ui.openModal({
      title: isEdit ? 'Edit practical subject' : 'Add practical subject',
      body:
        '<div class="field"><label>Subject name <span class="req">*</span></label><input id="sm-name" value="' + esc(subject ? subject.name : '') + '" placeholder="e.g. Community Health Nursing"></div>' +
        '<div class="field-row">' +
          '<div class="field"><label>Subject code</label><input id="sm-code" value="' + esc(subject ? subject.code : '') + '" placeholder="e.g. PH5-CHN-P"></div>' +
          '<div class="field"><label>Instructor</label><input id="sm-instr" value="' + esc(subject ? subject.instructor : '') + '" placeholder="e.g. Dr. A. Warsame"></div>' +
        '</div>' +
        '<div class="field"><label>Description</label><textarea id="sm-desc" rows="2">' + esc(subject ? subject.description || '' : '') + '</textarea></div>' +
        '<div class="field"><label>Status</label><select id="sm-active">' +
          '<option value="true"' + (subject ? (subject.isActive ? ' selected' : '') : ' selected') + '>Active</option>' +
          '<option value="false"' + (subject && !subject.isActive ? ' selected' : '') + '>Inactive</option></select></div>',
      footer:
        '<button class="btn btn-secondary" id="sm-cancel">Cancel</button>' +
        '<button class="btn btn-primary" id="sm-save"><i class="fa-solid fa-floppy-disk"></i> ' + (isEdit ? 'Save changes' : 'Add subject') + '</button>'
    });
    m.el.querySelector('#sm-cancel').addEventListener('click', m.close);
    m.el.querySelector('#sm-save').addEventListener('click', function () {
      var name = m.el.querySelector('#sm-name').value.trim();
      if (!name) { ui.setFieldError(m.el.querySelector('#sm-name'), true); ui.toast('error', 'Missing name', 'A subject name is required.'); return; }
      var code = m.el.querySelector('#sm-code').value.trim();
      var instr = m.el.querySelector('#sm-instr').value.trim();
      var desc = m.el.querySelector('#sm-desc').value.trim();
      var active = m.el.querySelector('#sm-active').value === 'true';
      var btn = this;
      btn.disabled = true;
      var payload = { name: name, code: code, instructor: instr, description: desc, isActive: active };
      var req = isEdit ? PH5.api.updateSubject(subject.id, payload) : PH5.api.createSubject(payload);
      req.then(function () {
        ui.toast('success', isEdit ? 'Subject updated' : 'Subject added',
          isEdit ? name + ' was saved.' : name + ' is available for attendance.');
        m.close();
        renderAttendanceAdmin(document.getElementById('view'));
      }).catch(function (err) {
        btn.disabled = false;
        ui.toast('error', 'Could not save subject', err.message);
      });
    });
  }

  function toggleSubject(subject) {
    PH5.api.toggleSubject(subject.id).then(function () {
      ui.toast('success', subject.isActive ? 'Subject deactivated' : 'Subject activated',
        subject.name + ' is now ' + (subject.isActive ? 'inactive' : 'active') + '.');
      renderAttendanceAdmin(document.getElementById('view'));
    }).catch(function (err) {
      ui.toast('error', 'Could not toggle subject', err.message);
    });
  }

  function deleteSubject(subject) {
    var linked = db.attendance().filter(function (a) { return a.subjectId === subject.id; }).length;
    var msg = linked > 0
      ? 'This subject has ' + linked + ' attendance record' + (linked === 1 ? '' : 's') + '. Deleting it also deletes those records.'
      : 'This will permanently remove the subject.';
    ui.confirmDialog({ title: 'Delete "' + subject.name + '"?', message: msg, danger: true, confirmText: 'Delete subject' }).then(function (ok) {
      if (!ok) return;
      PH5.api.deleteSubject(subject.id).then(function () {
        ui.toast('success', 'Subject deleted', subject.name + ' was removed.');
        renderAttendanceAdmin(document.getElementById('view'));
      }).catch(function (err) {
        ui.toast('error', 'Could not delete subject', err.message);
      });
    });
  }

  /* Session picker (new session = create blank records for all active students) */
  function openSessionModal() {
    var subjects = db.subjects().filter(function (s) { return s.isActive; });
    var m = ui.openModal({
      title: 'Open a new attendance session',
      body:
        (subjects.length
          ? '<div class="field"><label>Subject</label><select id="sess-subj">' + subjects.map(function (s) { return '<option value="' + esc(s.id) + '">' + esc(s.name) + '</option>'; }).join('') + '</select></div>' +
            '<div class="field"><label>Date</label><input id="sess-date" type="date" value="' + db.todayISO() + '"></div>' +
            '<div class="field"><div class="hint"><i class="fa-solid fa-circle-info"></i> This opens a session for every active student with a default status of "Not marked". You can then mark attendance in bulk.</div></div>'
          : '<p class="text-muted">No active practical subjects exist. Add a subject first.</p>'),
      footer:
        '<button class="btn btn-secondary" id="sess-cancel">Cancel</button>' +
        '<button class="btn btn-primary" id="sess-start"' + (subjects.length ? '' : ' disabled') + '><i class="fa-solid fa-calendar-plus"></i> Open session</button>'
    });
    m.el.querySelector('#sess-cancel').addEventListener('click', m.close);
    m.el.querySelector('#sess-start').addEventListener('click', function () {
      var subjectId = m.el.querySelector('#sess-subj').value;
      var date = m.el.querySelector('#sess-date').value;
      if (db.sessionExists(subjectId, date)) {
        ui.toast('warning', 'Session already exists', 'This subject already has attendance records for that date.');
        m.close();
        renderAttendanceAdmin(document.getElementById('view'));
        return;
      }
      var btn = this;
      btn.disabled = true;
      PH5.api.openSession(subjectId, date).then(function () {
        var count = db.sessionRecords(subjectId, date).length;
        ui.toast('success', 'Session opened', 'Mark attendance for ' + count + ' students.');
        m.close();
        openAttendanceMarking(subjectId, date);
      }).catch(function (err) {
        btn.disabled = false;
        ui.toast('error', 'Could not open session', err.message);
      });
    });
  }

  /* Interactive attendance marking grid (draft → save) */
  function openAttendanceMarking(subjectId, date) {
    var sub = db.subjectById(subjectId);
    var records = db.sessionRecords(subjectId, date);
    var students = db.students().slice().sort(function (a, b) { return a.fullName.localeCompare(b.fullName); });
    var draft = {};
    records.forEach(function (r) { draft[r.studentId] = r.status; });
    // Any active student with no record is treated as not-marked.
    students.forEach(function (s) { if (draft[s.studentId] === undefined) draft[s.studentId] = 'not_marked'; });

    document.getElementById('view').innerHTML =
      '<div class="page-head"><div><h1>Mark attendance</h1>' +
        '<div class="subtitle">' + esc(sub ? sub.name : subjectId) + ' · ' + esc(ui.fmtDate(date)) + ' · <b id="attn-progress"></b></div></div>' +
        '<div class="actions no-print">' +
          '<button class="btn btn-secondary btn-sm" id="am-back"><i class="fa-solid fa-arrow-left"></i> Back</button>' +
          '<button class="btn btn-primary" id="am-all-present"><i class="fa-solid fa-user-check"></i> Mark all present</button>' +
          '<button class="btn btn-primary" id="am-save"><i class="fa-solid fa-floppy-disk"></i> Save attendance</button>' +
        '</div></div>' +
      '<div class="card"><div class="card-body">' +
        '<div class="attn-grid" id="am-grid"></div>' +
      '</div></div>';

    var gridEl = document.getElementById('am-grid');
    var progressEl = document.getElementById('attn-progress');

    function render() {
      var counts = { present: 0, absent: 0, late: 0, excused: 0, not_marked: 0 };
      students.forEach(function (s) { counts[draft[s.studentId]]++; });
      progressEl.textContent = counts.present + ' present · ' + counts.absent + ' absent · ' + counts.late + ' late · ' + counts.excused + ' excused · ' + counts.not_marked + ' not marked';
      gridEl.innerHTML = students.map(function (s) {
        var st = draft[s.studentId];
        return '<div class="attn-card"><div class="attn-name">' + esc(s.fullName) + '</div>' +
          '<div class="attn-id">' + esc(s.studentId) + '</div>' +
          '<div class="attn-actions">' +
            '<button type="button" class="attn-btn present' + (st === 'present' ? ' active' : '') + '" data-sid="' + esc(s.studentId) + '" data-st="present"><i class="fa-solid fa-user-check"></i>Present</button>' +
            '<button type="button" class="attn-btn late' + (st === 'late' ? ' active' : '') + '" data-sid="' + esc(s.studentId) + '" data-st="late"><i class="fa-solid fa-clock"></i>Late</button>' +
            '<button type="button" class="attn-btn absent' + (st === 'absent' ? ' active' : '') + '" data-sid="' + esc(s.studentId) + '" data-st="absent"><i class="fa-solid fa-user-xmark"></i>Absent</button>' +
            '<button type="button" class="attn-btn excused' + (st === 'excused' ? ' active' : '') + '" data-sid="' + esc(s.studentId) + '" data-st="excused"><i class="fa-solid fa-user-shield"></i>Excused</button>' +
            '<button type="button" class="attn-btn not-marked' + (st === 'not_marked' ? ' active' : '') + '" data-sid="' + esc(s.studentId) + '" data-st="not_marked"><i class="fa-solid fa-circle-minus"></i>—</button>' +
          '</div></div>';
      }).join('');
    }

    gridEl.addEventListener('click', function (e) {
      var t = e.target.closest('[data-sid]');
      if (!t) return;
      draft[t.getAttribute('data-sid')] = t.getAttribute('data-st');
      render();
    });
    document.getElementById('am-all-present').addEventListener('click', function () {
      students.forEach(function (s) { draft[s.studentId] = 'present'; });
      render();
    });
    document.getElementById('am-back').addEventListener('click', function () { renderAttendanceAdmin(document.getElementById('view')); });
    document.getElementById('am-save').addEventListener('click', function () {
      var entries = students.map(function (s) {
        return { studentId: s.studentId, status: draft[s.studentId] || 'not_marked' };
      });
      var btn = this;
      btn.disabled = true;
      PH5.api.saveAttendance(subjectId, date, entries).then(function () {
        ui.toast('success', 'Attendance saved', 'Session saved for ' + entries.length + ' students.');
        renderAttendanceAdmin(document.getElementById('view'));
      }).catch(function (err) {
        btn.disabled = false;
        ui.toast('error', 'Could not save attendance', err.message);
      });
    });
    render();
  }

  function deleteSession(subjectId, date) {
    var sub = db.subjectById(subjectId);
    var count = db.sessionRecords(subjectId, date).length;
    ui.confirmDialog({
      title: 'Delete this session?',
      message: 'Delete the attendance session for "' + (sub ? sub.name : subjectId) + '" on ' + ui.fmtDate(date) + ' (' + count + ' records)?',
      danger: true, confirmText: 'Delete session'
    }).then(function (ok) {
      if (!ok) return;
      PH5.api.deleteSession(subjectId, date).then(function () {
        ui.toast('success', 'Session deleted', 'The session and its ' + count + ' records were removed.');
        renderAttendanceAdmin(document.getElementById('view'));
      }).catch(function (err) {
        ui.toast('error', 'Could not delete session', err.message);
      });
    });
  }

  /* ==================================================================
     ACCOUNTS
     ================================================================== */
  /* Filter state lives outside the re-rendered markup so searches and role
     filters survive table refreshes after every account mutation. */
  var accountsState = { q: '', role: '' };

  function leaderCount() {
    return db.users().filter(function (u) { return u.role === 'class_leader' && u.isActive; }).length;
  }

  function renderAccounts(el) {
    var count = leaderCount();
    el.innerHTML =
      '<div class="page-head"><div><h1>Accounts & users</h1>' +
        '<div class="subtitle">Login accounts, roles and password management</div></div>' +
        '<div class="actions">' +
          '<span class="badge ' + (count >= 2 ? 'badge-green' : 'badge-amber') + '" id="acct-leader-count" ' +
            'title="Active Class Leaders / maximum 2" style="font-size:12.5px;padding:8px 12px;white-space:nowrap;">' +
            '<i class="fa-solid fa-user-tie"></i> Class Leaders: ' + count + '/2</span>' +
          '<button class="btn btn-primary" id="acct-add"><i class="fa-solid fa-user-plus"></i> Create account</button>' +
        '</div></div>' +
      '<div class="card">' +
        '<div class="toolbar">' +
          '<div class="search-box"><i class="fa-solid fa-magnifying-glass"></i><input id="acct-search" value="' + esc(accountsState.q) + '" placeholder="Search name, username, student ID…"></div>' +
          '<select id="acct-role">' +
            '<option value="">All roles</option>' +
            '<option value="admin"' + (accountsState.role === 'admin' ? ' selected' : '') + '>Admin / Staff</option>' +
            '<option value="class_leader"' + (accountsState.role === 'class_leader' ? ' selected' : '') + '>Class Leader</option>' +
            '<option value="student"' + (accountsState.role === 'student' ? ' selected' : '') + '>Student</option>' +
          '</select>' +
          '<span class="result-count" id="acct-count"></span>' +
        '</div>' +
        '<div class="card-body" style="padding:0;"><div class="table-wrap"><table class="table"><thead><tr>' +
          '<th>User</th><th>Role</th><th>Linked student</th><th>Status</th><th>Must change password</th><th class="text-right">Actions</th>' +
        '</tr></thead><tbody id="acct-tbody"></tbody></table></div></div>' +
      '</div>';

    renderAccountsTable();
    document.getElementById('acct-add').addEventListener('click', function () { openAccountModal(); });
    document.getElementById('acct-search').addEventListener('input', function (e) {
      accountsState.q = e.target.value;
      renderAccountsTable();
    });
    document.getElementById('acct-role').addEventListener('change', function (e) {
      accountsState.role = e.target.value;
      renderAccountsTable();
    });
    el.querySelector('.card').addEventListener('click', onAccountsClick);
  }

  function renderAccountsTable() {
    var all = db.users().slice().sort(function (a, b) { return a.fullName.localeCompare(b.fullName); });
    var q = accountsState.q.toLowerCase().trim();
    var role = accountsState.role;
    var count = leaderCount();

    var filtered = all.filter(function (u) {
      if (role && u.role !== role) return false;
      if (!q) return true;
      return (u.fullName + ' ' + u.username + ' ' + (u.studentId || '')).toLowerCase().indexOf(q) !== -1;
    });

    var tbody = document.getElementById('acct-tbody');
    if (!tbody) return;
    var countEl = document.getElementById('acct-count');
    if (countEl) countEl.textContent = filtered.length + ' of ' + all.length + ' accounts';

    tbody.innerHTML = filtered.length ? filtered.map(function (u) {
      var me = auth.session().userId === u.id;
      var isLeader = u.role === 'class_leader';
      var canAssign = u.role === 'student' && u.isActive && !!u.studentId;
      var atLimit = count >= 2;
      return '<tr><td><div class="flex gap-8" style="align-items:center;">' + ui.avatar(u.fullName, db.avatarColor(u.username), 32) +
        '<div><div class="cell-primary">' + esc(u.fullName) + (me ? ' <span class="badge badge-blue">YOU</span>' : '') + '</div>' +
        '<div class="cell-sub">@' + esc(u.username) + '</div></div></div></td>' +
        '<td>' + esc(auth.roleLabel(u.role)) + '</td>' +
        '<td>' + (u.studentId ? '<span class="badge badge-navy">' + esc(u.studentId) + '</span>' : '<span class="text-muted">—</span>') + '</td>' +
        '<td>' + (u.isActive ? ui.statusBadge('active') : '<span class="badge badge-grey">INACTIVE</span>') + '</td>' +
        '<td>' + (u.mustChangePassword ? '<span class="badge badge-amber">YES</span>' : '<span class="badge badge-grey">no</span>') + '</td>' +
        '<td><div class="row-actions">' +
          '<button class="btn btn-sm btn-secondary" data-reset="' + esc(u.id) + '" title="Reset password to 123456"><i class="fa-solid fa-key"></i> Reset</button>' +
          (canAssign
            ? '<button class="btn btn-sm ' + (atLimit ? 'btn-ghost' : 'btn-secondary') + '" data-assign-leader="' + esc(u.id) + '"' +
              (atLimit ? ' disabled' : '') + ' title="' + (atLimit ? 'Maximum of two class leaders reached' : 'Assign as Class Leader') + '">' +
              '<i class="fa-solid fa-user-tie"></i> Assign as Class Leader</button>'
            : '') +
          (isLeader
            ? '<button class="btn btn-sm btn-ghost" data-remove-leader="' + esc(u.id) + '" title="Remove Class Leader"><i class="fa-solid fa-user-minus"></i> Remove Class Leader</button>'
            : '') +
          (u.isActive
            ? '<button class="btn btn-sm btn-ghost" data-toggle="' + esc(u.id) + '" title="Deactivate"><i class="fa-solid fa-user-slash"></i></button>'
            : '<button class="btn btn-sm btn-ghost" data-toggle="' + esc(u.id) + '" title="Activate"><i class="fa-solid fa-user-check"></i></button>') +
        '</div></td></tr>';
    }).join('')
      : '<tr><td colspan="6" style="padding:28px;text-align:center;color:var(--muted);">' +
        '<i class="fa-solid fa-user-slash" style="font-size:22px;margin-bottom:8px;display:block;color:var(--muted);"></i>' +
        'No accounts match your search or filter.</td></tr>';
  }

  function onAccountsClick(e) {
    var t = e.target.closest('[data-reset],[data-toggle],[data-assign-leader],[data-remove-leader]');
    if (!t) return;
    var id = t.getAttribute('data-reset') || t.getAttribute('data-toggle') ||
      t.getAttribute('data-assign-leader') || t.getAttribute('data-remove-leader');
    var u = db.userById(id);
    if (!u) return;
    if (t.hasAttribute('data-reset')) resetPassword(u);
    else if (t.hasAttribute('data-assign-leader')) assignClassLeader(u);
    else if (t.hasAttribute('data-remove-leader')) removeClassLeader(u);
    else toggleAccount(u);
  }

  function assignClassLeader(u) {
    var student = db.studentById(u.studentId);
    var name = student ? student.fullName : u.fullName;
    ui.confirmDialog({
      title: 'Assign as Class Leader',
      message: 'Make ' + name + ' (' + u.studentId + ') one of the two Class Leaders for Batch Five? They keep the same account, password and student record, and gain read access to the whole batch.',
      confirmText: 'Assign as Class Leader'
    }).then(function (ok) {
      if (!ok) return;
      PH5.api.assignLeader(u.id).then(function () {
        ui.toast('success', 'Class Leader assigned', name + ' (' + u.studentId + ') can now sign in as a Class Leader.');
        renderAccounts(document.getElementById('view'));
      }).catch(function (err) {
        ui.toast('error', 'Could not assign Class Leader', err.message);
      });
    });
  }

  function removeClassLeader(u) {
    var student = db.studentById(u.studentId);
    var name = student ? student.fullName : u.fullName;
    ui.confirmDialog({
      title: 'Remove Class Leader',
      message: 'Remove ' + name + (u.studentId ? ' (' + u.studentId + ')' : '') + ' as a Class Leader? They become a regular student account again. The account, student record, password, fees, payments and attendance are all preserved.',
      danger: true, confirmText: 'Remove Class Leader'
    }).then(function (ok) {
      if (!ok) return;
      PH5.api.removeLeader(u.id).then(function () {
        ui.toast('success', 'Class Leader removed', name + ' is a student account again.');
        renderAccounts(document.getElementById('view'));
      }).catch(function (err) {
        ui.toast('error', 'Could not remove Class Leader', err.message);
      });
    });
  }

  function openAccountModal() {
    var students = db.students().slice().sort(function (a, b) { return a.fullName.localeCompare(b.fullName); });
    var m = ui.openModal({
      title: 'Create login account',
      body:
        '<div class="field"><label>Username <span class="req">*</span></label><input id="acm-username" placeholder="e.g. hannah.admin"></div>' +
        '<div class="field"><label>Full name <span class="req">*</span></label><input id="acm-name" placeholder="e.g. Hannah Ali"></div>' +
        '<div class="field-row">' +
          '<div class="field"><label>Role</label><select id="acm-role"><option value="admin">Admin / Staff</option><option value="class_leader">Class Leader</option><option value="student">Student</option></select></div>' +
          '<div class="field"><label>Initial password</label><input id="acm-pass" value="123456"></div>' +
        '</div>' +
        '<div class="field"><label>Link to student (optional)</label><select id="acm-student"><option value="">— None —</option>' +
          students.map(function (s) { return '<option value="' + esc(s.studentId) + '">' + esc(s.fullName) + ' (' + esc(s.studentId) + ')</option>'; }).join('') + '</select></div>' +
        '<div class="field"><div class="hint"><i class="fa-solid fa-circle-info"></i> New accounts must change their password at first sign-in.</div></div>',
      footer:
        '<button class="btn btn-secondary" id="acm-cancel">Cancel</button>' +
        '<button class="btn btn-primary" id="acm-save"><i class="fa-solid fa-user-plus"></i> Create account</button>'
    });
    m.el.querySelector('#acm-cancel').addEventListener('click', m.close);
    m.el.querySelector('#acm-save').addEventListener('click', function () {
      var username = m.el.querySelector('#acm-username').value.trim();
      var name = m.el.querySelector('#acm-name').value.trim();
      var role = m.el.querySelector('#acm-role').value;
      var pass = m.el.querySelector('#acm-pass').value;
      var studentId = m.el.querySelector('#acm-student').value;
      if (!username || !name) { ui.toast('error', 'Missing information', 'Username and full name are required.'); return; }
      var btn = this;
      btn.disabled = true;
      auth.createUser({ username: username, fullName: name, role: role, password: pass, studentId: studentId || null })
        .then(function (res) {
          if (!res.ok) { btn.disabled = false; ui.toast('error', 'Could not create account', res.error); return; }
          ui.toast('success', 'Account created', name + ' can now sign in as ' + username + '.');
          m.close();
          renderAccounts(document.getElementById('view'));
        });
    });
  }

  function resetPassword(u) {
    ui.confirmDialog({
      title: 'Reset password for ' + u.fullName + '?',
      message: 'Their password will be reset to 123456 and they will be required to change it at next sign-in.',
      confirmText: 'Reset password'
    }).then(function (ok) {
      if (!ok) return;
      PH5.api.resetPassword(u.id, '123456').then(function () {
        ui.toast('success', 'Password reset', 'Password for ' + u.fullName + ' is now 123456 (change required at sign-in).');
        renderAccounts(document.getElementById('view'));
      }).catch(function (err) {
        ui.toast('error', 'Could not reset password', err.message);
      });
    });
  }

  function toggleAccount(u) {
    var s = auth.session();
    if (u.id === s.userId) { ui.toast('warning', 'Cannot deactivate', 'You cannot deactivate your own account.'); return; }
    PH5.api.setAccountActive(u.id, !u.isActive).then(function () {
      ui.toast('success', 'Account ' + (u.isActive ? 'deactivated' : 'activated'),
        u.fullName + ' ' + (u.isActive ? 'cannot sign in.' : 'can sign in again.'));
      renderAccounts(document.getElementById('view'));
    }).catch(function (err) {
      ui.toast('error', 'Could not update account', err.message);
    });
  }

  /* ==================================================================
     BACKUP
     ================================================================== */
  function renderBackup(el) {
    var counts = [
      ['Students', db.students().length, 'fa-users'],
      ['Fee requirements', db.fees().length, 'fa-receipt'],
      ['Payments', db.payments().length, 'fa-credit-card'],
      ['Practical subjects', db.subjects().length, 'fa-flask'],
      ['Attendance records', db.attendance().length, 'fa-calendar-check'],
      ['User accounts', db.users().length, 'fa-user-lock'],
      ['Audit events', db.audit().length, 'fa-clock-rotate-left']
    ];

    var backupListEl = '<div class="mb-16" id="bk-list"><div class="hint"><i class="fa-solid fa-circle-info"></i> Loading backups…</div></div>';

    el.innerHTML =
      '<div class="page-head"><div><h1>Accounts & backup</h1>' +
        '<div class="subtitle">Data protection, server-side snapshots, export and factory reset</div></div></div>' +
      '<div class="widget-grid">' +
        '<div class="card"><div class="card-header"><h3>Backup & restore</h3></div><div class="card-body">' +
          '<p class="text-muted mb-16" style="font-size:13.5px;">Create a snapshot of the live database on the server, download it, or restore the system to a previous snapshot. Keep copies safe.</p>' +
          '<div class="flex gap-8" style="flex-wrap:wrap;margin-bottom:16px;">' +
            '<button class="btn btn-primary" id="bk-create"><i class="fa-solid fa-database"></i> Create backup</button>' +
            '<button class="btn btn-secondary" id="bk-export"><i class="fa-solid fa-download"></i> Export JSON</button>' +
          '</div>' +
          backupListEl +
        '</div></div>' +
        '<div class="card"><div class="card-header"><h3>Database summary</h3></div><div class="card-body" style="padding:8px 22px;">' +
          counts.map(function (c) {
            return '<div class="list-item"><div class="li-ico" style="width:36px;text-align:center;color:var(--royal-600);"><i class="fa-solid ' + c[2] + '"></i></div>' +
              '<div class="li-main"><div class="li-title">' + c[0] + '</div></div><div class="li-sub" style="font-weight:700;color:var(--ink);">' + c[1] + '</div></div>';
          }).join('') +
        '</div></div>' +
      '</div>' +
      '<div class="card"><div class="card-header"><h3>Danger zone</h3></div><div class="card-body">' +
        '<p class="text-muted mb-16" style="font-size:13.5px;">Factory reset wipes every record and restores the original demo data (' + db.students().length + ' students, default accounts). This cannot be undone — create a backup first.</p>' +
        '<button class="btn btn-danger" id="bk-reset"><i class="fa-solid fa-rotate-left"></i> Factory reset</button>' +
      '</div></div>';

    function renderList(backups) {
      var note = document.getElementById('bk-list');
      if (!backups.length) {
        note.innerHTML = '<div class="hint"><i class="fa-solid fa-circle-info"></i> No backups yet. Click "Create backup" to make your first snapshot.</div>';
        return;
      }
      note.innerHTML =
        '<div class="form-section-title">Server snapshots</div>' +
        '<div class="table-wrap"><table class="table"><thead><tr><th>Backup</th><th>Size</th><th>Created</th><th class="text-right">Actions</th></tr></thead><tbody>' +
        backups.map(function (b) {
          var size = (b.size / 1024).toFixed(1) + ' KB';
          return '<tr><td class="nowrap"><span class="cell-primary">' + esc(b.name) + '</span></td>' +
            '<td class="text-muted">' + esc(size) + '</td>' +
            '<td class="text-muted nowrap">' + esc(ui.fmtDateTime(b.modified)) + '</td>' +
            '<td><div class="row-actions">' +
              '<a class="btn btn-sm btn-secondary" href="/api/backup/download/' + encodeURIComponent(b.name) + '"><i class="fa-solid fa-download"></i> Download</a>' +
              '<button class="btn btn-sm btn-danger" data-restore="' + esc(b.name) + '"><i class="fa-solid fa-rotate-left"></i> Restore</button>' +
            '</div></td></tr>';
        }).join('') + '</tbody></table></div>';
      note.querySelectorAll('[data-restore]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var name = btn.getAttribute('data-restore');
          ui.confirmDialog({
            title: 'Restore "' + name + '"?',
            message: 'Restoring replaces ALL current data with this snapshot. The page will reload after restore.',
            danger: true, confirmText: 'Restore backup'
          }).then(function (ok) {
            if (!ok) return;
            btn.disabled = true;
            PH5.api.restoreBackup(name).then(function () {
              ui.toast('success', 'Backup restored', 'The database was restored from ' + name + '. Please sign in again.');
              setTimeout(function () { auth.logout(); location.href = 'index.html'; }, 900);
            }).catch(function (err) {
              btn.disabled = false;
              ui.toast('error', 'Restore failed', err.message);
            });
          });
        });
      });
    }

    PH5.api.listBackups().then(function (res) { renderList(res.backups || []); })
      .catch(function (err) {
        document.getElementById('bk-list').innerHTML = '<div class="hint" style="color:var(--danger);"><i class="fa-solid fa-triangle-exclamation"></i> Could not load backups: ' + esc(err.message) + '</div>';
      });

    document.getElementById('bk-create').addEventListener('click', function () {
      var btn = this;
      btn.disabled = true;
      PH5.api.createBackup().then(function (res) {
        ui.toast('success', 'Backup created', 'Snapshot saved on the server.');
        renderList(res.backups || []);
        btn.disabled = false;
      }).catch(function (err) {
        btn.disabled = false;
        ui.toast('error', 'Could not create backup', err.message);
      });
    });

    document.getElementById('bk-export').addEventListener('click', function () {
      var btn = this;
      btn.disabled = true;
      PH5.api.exportJson().then(function (dump) {
        download('ph5-backup-' + db.todayISO() + '.json', JSON.stringify(dump, null, 2));
        ui.toast('success', 'Backup exported', 'Your JSON export has been downloaded.');
        btn.disabled = false;
      }).catch(function (err) {
        btn.disabled = false;
        ui.toast('error', 'Could not export backup', err.message);
      });
    });

    document.getElementById('bk-reset').addEventListener('click', function () {
      ui.confirmDialog({
        title: 'Factory reset?',
        message: 'This will erase ALL current data and restore the original demo dataset. Are you absolutely sure?',
        danger: true, confirmText: 'Yes, reset everything'
      }).then(function (ok) {
        if (!ok) return;
        PH5.api.factoryReset().then(function () {
          auth.logout();
          ui.toast('success', 'System reset', 'The system was reset to its original demo state.');
          setTimeout(function () { location.href = 'index.html'; }, 900);
        }).catch(function (err) {
          ui.toast('error', 'Reset failed', err.message);
        });
      });
    });
  }

  /* ==================================================================
     AUDIT LOG
     ================================================================== */
  function renderAudit(el) {
    var logs = db.audit().slice().sort(function (a, b) { return b.timestamp.localeCompare(a.timestamp); });
    var actions = {};
    logs.forEach(function (l) { actions[l.action] = true; });
    var actionList = Object.keys(actions).sort();

    el.innerHTML =
      '<div class="page-head"><div><h1>Audit log</h1>' +
        '<div class="subtitle">A trail of every important action across the system</div></div>' +
        '<div class="actions"><button class="btn btn-secondary" id="aud-export"><i class="fa-solid fa-file-export"></i> Export</button></div></div>' +
      '<div class="card">' +
        '<div class="toolbar">' +
          '<div class="search-box"><i class="fa-solid fa-magnifying-glass"></i><input id="aud-search" placeholder="Search actor, details…"></div>' +
          '<select id="aud-action"><option value="">All actions</option>' + actionList.map(function (a) { return '<option value="' + esc(a) + '">' + esc(a.replace(/_/g, ' ')) + '</option>'; }).join('') + '</select>' +
          '<span class="result-count" id="aud-count"></span>' +
        '</div>' +
        '<div class="card-body" style="padding:0;" id="aud-list"></div>' +
      '</div>';

    function renderList() {
      var q = document.getElementById('aud-search').value.toLowerCase();
      var action = document.getElementById('aud-action').value;
      var filtered = logs.filter(function (l) {
        if (action && l.action !== action) return false;
        if (!q) return true;
        return (l.actorName + ' ' + l.details + ' ' + l.entity).toLowerCase().indexOf(q) !== -1;
      });
      document.getElementById('aud-count').textContent = filtered.length + ' events';
      document.getElementById('aud-list').innerHTML = filtered.length
        ? '<div class="table-wrap"><table class="table"><thead><tr><th>When</th><th>Actor</th><th>Role</th><th>Action</th><th>Details</th></tr></thead><tbody>' +
          filtered.map(function (l) {
            var roleBadge = l.role === 'admin' ? 'badge-blue' : l.role === 'class_leader' ? 'badge-amber' : l.role === 'student' ? 'badge-green' : 'badge-grey';
            return '<tr><td class="nowrap text-muted" style="font-size:12.5px;">' + esc(ui.fmtDateTime(l.timestamp)) + '</td>' +
              '<td><span class="cell-primary">' + esc(l.actorName) + '</span></td>' +
              '<td><span class="badge ' + roleBadge + '">' + esc(l.role) + '</span></td>' +
              '<td><span class="badge badge-navy">' + esc(l.action.replace(/_/g, ' ')) + '</span></td>' +
              '<td class="text-muted">' + esc(l.details) + '</td></tr>';
          }).join('') + '</tbody></table></div>'
        : ui.emptyState('fa-clock-rotate-left', 'No audit events found', 'Try a different search or filter.');
    }

    document.getElementById('aud-search').addEventListener('input', renderList);
    document.getElementById('aud-action').addEventListener('change', renderList);
    document.getElementById('aud-export').addEventListener('click', function () {
      download('ph5-audit-' + db.todayISO() + '.json', JSON.stringify(logs, null, 2));
      audit('AUDIT_EXPORT', 'audit', 'ph5_audit', 'Audit log exported (' + logs.length + ' events)');
      ui.toast('success', 'Audit log exported', 'Downloaded ' + logs.length + ' audit events.');
    });
    renderList();
  }

  pages.attendanceAdmin = function (el) { auth.requirePermission('attendance.manage'); renderAttendanceAdmin(el); };
  pages.accounts = function (el) { auth.requirePermission('accounts.manage'); renderAccounts(el); };
  pages.backup = function (el) { auth.requirePermission('backup.manage'); renderBackup(el); };
  pages.audit = function (el) { auth.requirePermission('audit.view'); renderAudit(el); };
})();
