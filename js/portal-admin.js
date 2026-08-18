/* ==========================================================================
   portal-admin.js — Admin/Staff portal part 1
   Admin dashboard, student management (full CRUD), fee requirements (CRUD),
   and the payment-recording module ($1/$2 transactions, overpayment guard).
   ========================================================================== */
(function () {
  'use strict';
  var db = PH5.db, ui = PH5.ui, auth = PH5.auth;
  var esc = ui.escape;
  var pages = window.PH5.pages = window.PH5.pages || {};

  var METHODS = ['Cash', 'Mobile Money', 'Bank Transfer'];
  var GENDERS = [{ v: 'M', l: 'Male' }, { v: 'F', l: 'Female' }];

  function audit(action, entity, id, details) { PH5.audit.log(action, entity, id, details); }

  /* ==================================================================
     ADMIN DASHBOARD
     ================================================================== */
  pages.adminDashboard = function (el) {
    var students = db.students();
    var activeFees = db.fees().filter(function (f) { return f.isActive; })
      .slice().sort(function (a, b) { return String(a.periodKey || '').localeCompare(String(b.periodKey || '')); });
    var dueFees = activeFees.filter(function (f) { return db.isDueFee(f); });
    var collected = db.totalCollected();
    var dueNow = dueFees.reduce(function (s, f) { return s + f.amountRequired * students.length; }, 0);
    var scheduled = activeFees.reduce(function (s, f) { return s + f.amountRequired * students.length; }, 0);
    var attn = db.attendanceStats(null);
    var recents = db.payments().slice().sort(function (a, b) { return b.date.localeCompare(a.date); }).slice(0, 6);
    var logs = db.audit().slice().sort(function (a, b) { return b.timestamp.localeCompare(a.timestamp); }).slice(0, 7);

    el.innerHTML =
      '<div class="page-head"><div><h1>Administration dashboard</h1>' +
        '<div class="subtitle">Public Health · Batch Five · ' + students.length + ' students · Overview of fees, payments and attendance</div></div>' +
        '<div class="actions">' +
          '<button class="btn btn-primary" data-nav="payments"><i class="fa-solid fa-circle-dollar-to-slot"></i> Record payment</button>' +
          '<button class="btn btn-secondary" data-nav="students"><i class="fa-solid fa-user-plus"></i> Manage students</button>' +
        '</div></div>' +
      '<div class="stat-grid">' +
        ui.statCard('fa-users', 'navy', students.length, 'Registered students') +
        ui.statCard('fa-circle-dollar-to-slot', 'teal', ui.money(collected), 'Total collected') +
        ui.statCard('fa-calendar-check', 'amber', ui.money(dueNow), 'Due now (Aug – Dec 2026)') +
        ui.statCard('fa-receipt', 'blue', ui.money(scheduled), 'Scheduled total (to Dec 2027)') +
      '</div>' +
      '<div class="widget-grid">' +
        '<div class="card"><div class="card-header"><h3>Monthly contributions — batch progress</h3></div><div class="card-body" style="padding:0;">' +
          '<div class="table-wrap"><table class="table"><thead><tr><th>Month</th><th class="text-right">Expected</th><th class="text-right">Collected</th><th>Distribution</th><th>Status</th></tr></thead><tbody>' +
          activeFees.map(function (f) {
            var due = db.isDueFee(f);
            var c = db.batchCollected(f.id);
            var counts = db.feeStatusCounts(f);
            var exp = f.amountRequired * students.length;
            var pct = exp ? Math.round((c / exp) * 100) : 0;
            return '<tr><td><span class="cell-primary">' + esc(f.title) + '</span>' +
              '<div class="cell-sub">Period ' + esc(f.periodKey || '') + ' · Due ' + esc(ui.fmtDate(f.dueDate)) + '</div></td>' +
              '<td class="text-right money">' + ui.money(exp) + '</td>' +
              '<td class="text-right money text-success">' + ui.money(c) + '</td>' +
              '<td>' + (due
                ? '<span class="badge badge-green">' + counts.paid + '</span> <span class="badge badge-amber">' + counts.partial + '</span> <span class="badge badge-red">' + counts.unpaid + '</span>'
                : '<span class="text-muted">—</span>') + '</td>' +
              '<td>' + (due ? '<span class="badge badge-navy">' + pct + '%</span>' : ui.statusBadge('not_due')) + '</td></tr>';
          }).join('') +
          '</tbody></table></div></div></div>' +
        '<div class="card"><div class="card-header"><h3>Recent activity</h3></div><div class="card-body" style="padding:12px 22px;">' +
          (logs.length ? logs.map(function (l) {
            return '<div class="list-item"><div class="li-main"><div class="li-title">' + esc(l.action.replace(/_/g, ' ').toLowerCase().replace(/^\w/, function (c) { return c.toUpperCase(); })) + '</div>' +
              '<div class="li-sub">' + esc(l.actorName) + ' · ' + esc(l.details) + '</div></div>' +
              '<span class="text-muted" style="font-size:12px;white-space:nowrap;">' + ui.timeAgo(l.timestamp) + '</span></div>';
          }).join('') : ui.emptyState('fa-clock-rotate-left', 'No activity yet', 'Actions will be logged here.')) +
        '</div></div>' +
      '</div>' +
      '<div class="card"><div class="card-header"><h3>Recent payments</h3></div><div class="card-body" style="padding:0;">' +
        (recents.length ? '<div class="table-wrap"><table class="table"><thead><tr><th>Student</th><th>Date</th><th>Fee</th><th>Method</th><th class="text-right">Amount</th></tr></thead><tbody>' +
          recents.map(function (p) {
            var student = db.studentById(p.studentId) || {};
            var fee = db.feeById(p.feeId);
            return '<tr><td><div class="flex gap-8" style="align-items:center;">' + ui.avatar(student.fullName, student.avatarColor) +
              '<div><div class="cell-primary">' + esc(student.fullName || p.studentId) + '</div><div class="cell-sub">' + esc(student.studentId || '') + '</div></div></div></td>' +
              '<td class="nowrap">' + esc(ui.fmtDate(p.date)) + '</td>' +
              '<td>' + esc(fee ? fee.title : p.feeId) + '</td>' +
              '<td>' + esc(p.method) + '</td>' +
              '<td class="text-right money text-success">' + ui.money(p.amount) + '</td></tr>';
          }).join('') + '</tbody></table></div>'
          : ui.emptyState('fa-credit-card', 'No payments recorded yet', 'Record the first payment to see it here.')) +
      '</div></div>';
  };

  /* ==================================================================
     STUDENTS — full CRUD
     ================================================================== */
  function renderStudents(el) {
    var students = db.students().slice().sort(function (a, b) { return a.fullName.localeCompare(b.fullName); });

    el.innerHTML =
      '<div class="page-head"><div><h1>Student management</h1>' +
        '<div class="subtitle">Full records for all ' + students.length + ' students of Public Health Batch Five</div></div>' +
        '<div class="actions"><button class="btn btn-primary" id="stu-add"><i class="fa-solid fa-user-plus"></i> Add student</button></div></div>' +
      '<div class="card">' +
        '<div class="toolbar">' +
          '<div class="search-box"><i class="fa-solid fa-magnifying-glass"></i><input id="stu-search" placeholder="Search name or student ID…"></div>' +
          '<select id="stu-status"><option value="">All statuses</option><option value="active">Active</option><option value="suspended">Suspended</option><option value="graduated">Graduated</option></select>' +
          '<span class="result-count" id="stu-count"></span>' +
        '</div>' +
        '<div class="card-body" style="padding:0;" id="stu-list"></div>' +
      '</div>';

    function renderList() {
      var q = document.getElementById('stu-search').value.toLowerCase();
      var status = document.getElementById('stu-status').value;
      var filtered = students.filter(function (s) {
        if (status && s.status !== status) return false;
        if (!q) return true;
        return (s.fullName + ' ' + s.studentId + ' ' + (s.phone || '') + ' ' + (s.email || '')).toLowerCase().indexOf(q) !== -1;
      });
      document.getElementById('stu-count').textContent = filtered.length + ' of ' + students.length + ' students';
      var listEl = document.getElementById('stu-list');
      if (!filtered.length) {
        listEl.innerHTML = ui.emptyState('fa-users-slash', 'No students found', 'Try a different search term or clear the status filter.');
        return;
      }
      listEl.innerHTML =
        '<div class="table-wrap"><table class="table"><thead><tr>' +
          '<th>Student</th><th>Gender</th><th>Phone</th><th>Email</th><th>Status</th><th>Fees</th><th class="text-right">Actions</th>' +
        '</tr></thead><tbody>' +
        filtered.map(function (s) {
          var activeFees = db.fees().filter(function (f) { return f.isActive && db.isDueFee(f); });
          var paidFees = activeFees.filter(function (f) { return db.paidFor(s.studentId, f.id) >= f.amountRequired; }).length;
          return '<tr>' +
            '<td><div class="flex gap-8" style="align-items:center;">' + ui.avatar(s.fullName, s.avatarColor) +
              '<div><div class="cell-primary">' + esc(s.fullName) + '</div><div class="cell-sub">' + esc(s.studentId) + '</div></div></div></td>' +
            '<td>' + esc(s.gender === 'M' ? 'Male' : s.gender === 'F' ? 'Female' : '—') + '</td>' +
            '<td>' + esc(s.phone || '—') + '</td>' +
            '<td class="text-muted">' + esc(s.email || '—') + '</td>' +
            '<td>' + ui.statusBadge(s.status) + '</td>' +
            '<td><span class="badge badge-navy">' + paidFees + '/' + activeFees.length + ' months</span></td>' +
            '<td><div class="row-actions">' +
              '<button class="btn btn-sm btn-secondary" data-view="' + esc(s.id) + '"><i class="fa-solid fa-eye"></i></button>' +
              '<button class="btn btn-sm btn-secondary" data-edit="' + esc(s.id) + '"><i class="fa-solid fa-pen"></i></button>' +
              (s.status === 'active'
                ? '<button class="btn btn-sm btn-ghost" data-suspend="' + esc(s.id) + '" title="Suspend"><i class="fa-solid fa-user-slash"></i></button>'
                : '<button class="btn btn-sm btn-ghost" data-activate="' + esc(s.id) + '" title="Reactivate"><i class="fa-solid fa-user-check"></i></button>') +
              '<button class="btn btn-sm btn-danger" data-del="' + esc(s.id) + '" title="Delete"><i class="fa-solid fa-trash"></i></button>' +
            '</div></td></tr>';
        }).join('') +
        '</tbody></table></div>';
    }

    document.getElementById('stu-search').addEventListener('input', renderList);
    document.getElementById('stu-status').addEventListener('change', renderList);
    document.getElementById('stu-add').addEventListener('click', function () { openStudentModal(null); });
    document.getElementById('stu-list').addEventListener('click', function (e) {
      var t = e.target.closest('[data-view],[data-edit],[data-del],[data-suspend],[data-activate]');
      if (!t) return;
      var id = (t.getAttribute('data-view') || t.getAttribute('data-edit') || t.getAttribute('data-del') || t.getAttribute('data-suspend') || t.getAttribute('data-activate'));
      var student = db.studentById(id);
      if (t.hasAttribute('data-view')) openStudentView(student);
      else if (t.hasAttribute('data-edit')) openStudentModal(student);
      else if (t.hasAttribute('data-del')) deleteStudent(student);
      else if (t.hasAttribute('data-suspend')) setStudentStatus(student, 'suspended');
      else if (t.hasAttribute('data-activate')) setStudentStatus(student, 'active');
    });
    renderList();
  }

  function openStudentModal(student) {
    var isEdit = !!student;
    var m = ui.openModal({
      title: isEdit ? 'Edit student' : 'Add student',
      body:
        '<div class="field"><label>Full name <span class="req">*</span></label><input id="sm-name" value="' + esc(student ? student.fullName : '') + '" placeholder="e.g. Abdihalim Adam Abdi"></div>' +
        '<div class="field-row">' +
          '<div class="field"><label>Student ID <span class="req">*</span></label><input id="sm-sid" value="' + esc(student ? student.studentId : '') + '" placeholder="e.g. HS231429"></div>' +
          '<div class="field"><label>Gender</label><select id="sm-gender">' + GENDERS.map(function (g) { return '<option value="' + g.v + '"' + (student && student.gender === g.v ? ' selected' : '') + '>' + g.l + '</option>'; }).join('') + '</select></div>' +
        '</div>' +
        '<div class="field-row">' +
          '<div class="field"><label>Phone</label><input id="sm-phone" value="' + esc(student ? student.phone || '' : '') + '" placeholder="+252 6X XXX XXXX"></div>' +
          '<div class="field"><label>Email</label><input id="sm-email" value="' + esc(student ? student.email || '' : '') + '" placeholder="name@student.zamzam.edu.so"></div>' +
        '</div>' +
        '<div class="field"><label>Status</label><select id="sm-status">' +
          '<option value="active"' + (student && student.status === 'active' ? ' selected' : '') + '>Active</option>' +
          '<option value="suspended"' + (student && student.status === 'suspended' ? ' selected' : '') + '>Suspended</option>' +
          '<option value="graduated"' + (student && student.status === 'graduated' ? ' selected' : '') + '>Graduated</option></select></div>' +
        (isEdit ? '' : '<div class="field"><div class="hint"><i class="fa-solid fa-circle-info"></i> A login account will be created automatically. Username: the Student ID. Initial password: <b>123456</b> (must be changed at first sign-in).</div></div>'),
      footer:
        '<button class="btn btn-secondary" id="sm-cancel">Cancel</button>' +
        '<button class="btn btn-primary" id="sm-save"><i class="fa-solid fa-floppy-disk"></i> ' + (isEdit ? 'Save changes' : 'Add student') + '</button>'
    });
    m.el.querySelector('#sm-cancel').addEventListener('click', m.close);
    m.el.querySelector('#sm-save').addEventListener('click', function () {
      var name = m.el.querySelector('#sm-name').value.trim();
      var sid = m.el.querySelector('#sm-sid').value.trim().toUpperCase();
      var gender = m.el.querySelector('#sm-gender').value;
      var phone = m.el.querySelector('#sm-phone').value.trim();
      var email = m.el.querySelector('#sm-email').value.trim();
      var status = m.el.querySelector('#sm-status').value;

      var ok = true;
      ui.setFieldError(m.el.querySelector('#sm-name'), !name); if (!name) ok = false;
      ui.setFieldError(m.el.querySelector('#sm-sid'), !sid); if (!sid) ok = false;
      if (!ok) { ui.toast('error', 'Missing information', 'Full name and Student ID are required.'); return; }

      var clash = db.students().find(function (s) { return s.studentId === sid && (!student || s.id !== student.id); });
      if (clash) { ui.setFieldError(m.el.querySelector('#sm-sid'), true); ui.toast('error', 'Duplicate Student ID', 'Another student already has the ID ' + sid + '.'); return; }
      if (!isEdit) {
        var clashUser = db.users().find(function (u) { return u.username.toLowerCase() === sid.toLowerCase(); });
        if (clashUser) { ui.setFieldError(m.el.querySelector('#sm-sid'), true); ui.toast('error', 'Username taken', 'A login account with the username ' + sid + ' already exists.'); return; }
      }

      var btn = this;
      btn.disabled = true;
      if (isEdit) {
        PH5.api.updateStudent(student.id, {
          fullName: name, studentId: sid, gender: gender,
          phone: phone || null, email: email || null
        }).then(function () {
          /* Status is managed by a dedicated endpoint on the backend. */
          return status !== student.status ? PH5.api.updateStudentStatus(student.id, status) : null;
        }).then(function () {
          ui.toast('success', 'Student updated', name + ' was saved successfully.');
          m.close();
          renderStudents(document.getElementById('view'));
        }).catch(function (err) {
          btn.disabled = false;
          ui.toast('error', 'Could not update student', err.message);
        });
      } else {
        PH5.api.createStudent({
          fullName: name, studentId: sid, gender: gender,
          phone: phone || makeDefaultPhone(sid),
          email: email || makeDefaultEmail(name, sid),
          status: status, password: '123456'
        }).then(function () {
          ui.toast('success', 'Student added', name + ' (' + sid + ') is now registered and can sign in with password 123456.');
          m.close();
          renderStudents(document.getElementById('view'));
        }).catch(function (err) {
          btn.disabled = false;
          ui.toast('error', 'Could not add student', err.message);
        });
      }
    });
  }

  function makeDefaultPhone(sid) { var h = 0; for (var i = 0; i < sid.length; i++) h = (h * 31 + sid.charCodeAt(i)) >>> 0; return '+252 6' + (10 + h % 8) + ' ' + (1000000 + h % 8999999); }
  function makeDefaultEmail(name, sid) { var parts = name.toLowerCase().replace(/[^a-z ]/g, '').trim().split(/\s+/); return (parts[0] + '.' + (parts[1] || sid.slice(-3))) + '@student.zamzam.edu.so'; }

  function openStudentView(student) {
    var activeFees = db.fees().filter(function (f) { return f.isActive; })
      .slice().sort(function (a, b) { return String(a.periodKey || '').localeCompare(String(b.periodKey || '')); });
    var dueFees = activeFees.filter(function (f) { return db.isDueFee(f); });
    var pays = db.paymentsFor(student.studentId).slice().sort(function (a, b) { return b.date.localeCompare(a.date); });
    var attn = db.studentAttendanceStats(student.studentId);
    var totalRequired = dueFees.reduce(function (s, f) { return s + f.amountRequired; }, 0);
    var totalPaid = dueFees.reduce(function (s, f) { return s + db.paidFor(student.studentId, f.id); }, 0);

    var m = ui.openModal({
      size: 'lg', locked: true,
      title: 'Student record',
      body:
        '<div style="display:flex;align-items:center;gap:16px;margin-bottom:20px;">' +
          ui.avatar(student.fullName, student.avatarColor, 58) +
          '<div><h2 style="font-size:18px;">' + esc(student.fullName) + '</h2>' +
          '<div class="text-muted" style="font-size:13px;">' + esc(student.studentId) + ' · Public Health · Batch Five</div>' +
          '<div style="margin-top:6px;">' + ui.statusBadge(student.status) + '</div></div></div>' +
        '<div class="stat-grid" style="margin-bottom:20px;">' +
          ui.statCard('fa-receipt', 'navy', ui.money(totalRequired), 'Fees required') +
          ui.statCard('fa-circle-dollar-to-slot', 'teal', ui.money(totalPaid), 'Paid') +
          ui.statCard('fa-arrow-trend-up', 'amber', ui.money(Math.max(0, totalRequired - totalPaid)), 'Balance') +
          ui.statCard('fa-calendar-check', 'green', attn.rate + '%', 'Attendance') +
        '</div>' +
        '<div class="field-row mb-16">' +
          ui.fieldHTML('Gender', '<div style="padding-top:7px;">' + esc(student.gender === 'M' ? 'Male' : student.gender === 'F' ? 'Female' : '—') + '</div>') +
          ui.fieldHTML('Phone', '<div style="padding-top:7px;">' + esc(student.phone || '—') + '</div>') +
          ui.fieldHTML('Email', '<div style="padding-top:7px;">' + esc(student.email || '—') + '</div>') +
        '</div>' +
        '<div class="form-section-title">Fee status</div>' +
        activeFees.map(function (f) {
          var st = db.paymentStatus(student.studentId, f);
          var pct = Math.min(100, Math.round((st.paid / st.required) * 100));
          return '<div class="flex-between mb-8"><span>' + esc(f.title) + '</span><span class="flex gap-12" style="align-items:center;">' +
            '<span class="text-muted" style="font-size:12.5px;">' + ui.money(st.paid) + ' / ' + ui.money(st.required) + '</span>' + ui.statusBadge(st.key) + '</span></div>' +
            '<div class="progress ' + (st.key === 'paid' ? 'progress-green' : st.key === 'partial' ? 'progress-amber' : 'progress-blue') + ' mb-16"><span style="width:' + pct + '%"></span></div>';
        }).join('') +
        '<div class="form-section-title">Payment history (' + pays.length + ')</div>' +
        '<div class="table-wrap"><table class="table"><thead><tr><th>Date</th><th>Fee</th><th>Method</th><th>Reference</th><th class="text-right">Amount</th></tr></thead><tbody>' +
        (pays.length ? pays.map(function (p) {
          var fee = db.feeById(p.feeId);
          return '<tr><td class="nowrap">' + esc(ui.fmtDate(p.date)) + '</td><td>' + esc(fee ? fee.title : p.feeId) + '</td><td>' + esc(p.method) + '</td><td class="text-muted">' + esc(p.reference) + '</td><td class="text-right money text-success">' + ui.money(p.amount) + '</td></tr>';
        }).join('') : '<tr><td colspan="5" class="text-muted" style="text-align:center;padding:14px;">No payments recorded.</td></tr>') + '</tbody></table></div>',
      footer: '<button class="btn btn-primary" id="sv-edit"><i class="fa-solid fa-pen"></i> Edit</button>'
    });
    m.el.querySelector('#sv-edit').addEventListener('click', function () { m.close(); openStudentModal(student); });
  }

  function setStudentStatus(student, status) {
    PH5.api.updateStudentStatus(student.id, status).then(function () {
      ui.toast('success', 'Status updated', student.fullName + ' is now ' + status + '.');
      renderStudents(document.getElementById('view'));
    }).catch(function (err) {
      ui.toast('error', 'Could not update status', err.message);
    });
  }

  function deleteStudent(student) {
    var hasPayments = db.paymentsFor(student.studentId).length > 0;
    var hasAttendance = db.attendanceFor(student.studentId).length > 0;
    var warning = hasPayments || hasAttendance
      ? 'This student has ' + (hasPayments ? 'payment records' : '') + (hasPayments && hasAttendance ? ' and ' : '') + (hasAttendance ? 'attendance records' : '') +
        ' in the system. Deleting the student will also deactivate their login account. Their past transactions remain in the audit log.'
      : 'This will permanently remove the student from the register and deactivate their login account.';

    ui.confirmDialog({
      title: 'Delete ' + student.fullName + '?',
      message: warning, danger: true, confirmText: 'Delete student',
    }).then(function (ok) {
      if (!ok) return;
      PH5.api.deleteStudent(student.id).then(function () {
        ui.toast('success', 'Student deleted', student.fullName + ' was removed from the register.');
        renderStudents(document.getElementById('view'));
      }).catch(function (err) {
        ui.toast('error', 'Could not delete student', err.message);
      });
    });
  }

  /* ==================================================================
     FEES — CRUD
     ================================================================== */
  function renderFees(el) {
    var fees = db.fees().slice().sort(function (a, b) { return String(a.periodKey || a.title).localeCompare(String(b.periodKey || b.title)); });
    el.innerHTML =
      '<div class="page-head"><div><h1>Fee requirements</h1>' +
        '<div class="subtitle">Monthly contribution requirements for Public Health Batch Five (Aug 2026 – Dec 2027)</div></div>' +
        '<div class="actions"><button class="btn btn-primary" id="fee-add"><i class="fa-solid fa-plus"></i> Add fee requirement</button></div></div>' +
      '<div class="card"><div class="card-body" style="padding:0;">' +
      '<div class="table-wrap"><table class="table"><thead><tr>' +
        '<th>Fee</th><th>Category</th><th>Period key</th><th class="text-right">Amount</th><th>Due date</th><th class="text-right">Collected</th><th>Status</th><th class="text-right">Actions</th>' +
      '</tr></thead><tbody>' +
      fees.map(function (f) {
        var due = db.isDueFee(f);
        return '<tr><td><span class="cell-primary">' + esc(f.title) + '</span><div class="cell-sub">' + esc(f.description || '') + '</div></td>' +
          '<td>' + esc(f.category) + '</td>' +
          '<td><span class="badge badge-navy">' + esc(f.periodKey || '—') + '</span></td>' +
          '<td class="text-right money">' + ui.money(f.amountRequired) + '</td>' +
          '<td>' + esc(ui.fmtDate(f.dueDate)) + '</td>' +
          '<td class="text-right money text-success">' + ui.money(db.batchCollected(f.id)) + '</td>' +
          '<td>' + (f.isActive ? (due ? '<span class="badge badge-green">ACTIVE · DUE</span>' : '<span class="badge badge-grey">ACTIVE · NOT DUE</span>') : '<span class="badge badge-grey">INACTIVE</span>') + '</td>' +
          '<td><div class="row-actions">' +
            '<button class="btn btn-sm btn-secondary" data-edit="' + esc(f.id) + '"><i class="fa-solid fa-pen"></i></button>' +
            (f.isActive
              ? '<button class="btn btn-sm btn-ghost" data-toggle="' + esc(f.id) + '" title="Deactivate"><i class="fa-solid fa-eye-slash"></i></button>'
              : '<button class="btn btn-sm btn-ghost" data-toggle="' + esc(f.id) + '" title="Activate"><i class="fa-solid fa-eye"></i></button>') +
            '<button class="btn btn-sm btn-danger" data-del="' + esc(f.id) + '"><i class="fa-solid fa-trash"></i></button>' +
          '</div></td></tr>';
      }).join('') +
      '</tbody></table></div></div></div>';

    document.getElementById('fee-add').addEventListener('click', function () { openFeeModal(null); });
    el.querySelector('.card').addEventListener('click', function (e) {
      var t = e.target.closest('[data-edit],[data-toggle],[data-del]');
      if (!t) return;
      var id = t.getAttribute('data-edit') || t.getAttribute('data-toggle') || t.getAttribute('data-del');
      var fee = db.feeById(id);
      if (t.hasAttribute('data-edit')) openFeeModal(fee);
      else if (t.hasAttribute('data-toggle')) toggleFee(fee);
      else deleteFee(fee);
    });
  }

  function openFeeModal(fee) {
    var isEdit = !!fee;
    var m = ui.openModal({
      title: isEdit ? 'Edit fee requirement' : 'Add fee requirement',
      body:
        '<div class="field"><label>Fee title <span class="req">*</span></label><input id="fm-title" value="' + esc(fee ? fee.title : '') + '" placeholder="e.g. Monthly Contribution — August 2026"></div>' +
        '<div class="field-row">' +
          '<div class="field"><label>Period key <span class="req">*</span></label><input id="fm-period" value="' + esc(fee ? fee.periodKey : '') + '" placeholder="YYYY-MM, e.g. 2026-08"></div>' +
          '<div class="field"><label>Category</label><input id="fm-cat" value="' + esc(fee ? fee.category : '') + '" placeholder="e.g. Monthly, Tuition, Practical"></div>' +
        '</div>' +
        '<div class="field-row">' +
          '<div class="field"><label>Amount required ($) <span class="req">*</span></label><input id="fm-amt" type="number" min="1" step="0.01" value="' + esc(fee ? fee.amountRequired : '') + '" placeholder="e.g. 2"></div>' +
          '<div class="field"><label>Due date</label><input id="fm-due" type="date" value="' + esc(fee ? fee.dueDate : '') + '"></div>' +
        '</div>' +
        '<div class="field-row">' +
          '<div class="field"><label>Status</label><select id="fm-active">' +
            '<option value="true"' + (fee ? (fee.isActive ? ' selected' : '') : ' selected') + '>Active</option>' +
            '<option value="false"' + (fee && !fee.isActive ? ' selected' : '') + '>Inactive</option></select></div>' +
        '</div>' +
        '<div class="field"><label>Description</label><textarea id="fm-desc" rows="2" placeholder="What this fee covers…">' + esc(fee ? fee.description || '' : '') + '</textarea></div>',
      footer:
        '<button class="btn btn-secondary" id="fm-cancel">Cancel</button>' +
        '<button class="btn btn-primary" id="fm-save"><i class="fa-solid fa-floppy-disk"></i> ' + (isEdit ? 'Save changes' : 'Add fee') + '</button>'
    });
    m.el.querySelector('#fm-cancel').addEventListener('click', m.close);
    m.el.querySelector('#fm-save').addEventListener('click', function () {
      var title = m.el.querySelector('#fm-title').value.trim();
      var period = m.el.querySelector('#fm-period').value.trim();
      var cat = m.el.querySelector('#fm-cat').value.trim();
      var amt = parseFloat(m.el.querySelector('#fm-amt').value);
      var due = m.el.querySelector('#fm-due').value;
      var desc = m.el.querySelector('#fm-desc').value.trim();
      var active = m.el.querySelector('#fm-active').value === 'true';

      var ok = true;
      ui.setFieldError(m.el.querySelector('#fm-title'), !title); if (!title) ok = false;
      ui.setFieldError(m.el.querySelector('#fm-period'), !/^\d{4}-\d{2}$/.test(period)); if (!/^\d{4}-\d{2}$/.test(period)) ok = false;
      ui.setFieldError(m.el.querySelector('#fm-amt'), !(amt > 0)); if (!(amt > 0)) ok = false;
      if (!ok) { ui.toast('error', 'Missing information', 'Title, a period key (YYYY-MM) and a positive amount are required.'); return; }

      var btn = this;
      btn.disabled = true;
      var payload = {
        title: title, periodKey: period, category: cat || 'General', amountRequired: amt,
        dueDate: due || '', description: desc, isActive: active
      };
      var req = isEdit ? PH5.api.updateFee(fee.id, payload) : PH5.api.createFee(payload);
      req.then(function () {
        ui.toast('success', isEdit ? 'Fee updated' : 'Fee added',
          isEdit ? title + ' was saved.' : title + ' is now published to the batch.');
        m.close();
        renderFees(document.getElementById('view'));
      }).catch(function (err) {
        btn.disabled = false;
        ui.toast('error', 'Could not save fee', err.message);
      });
    });
  }

  function toggleFee(fee) {
    PH5.api.toggleFee(fee.id).then(function () {
      ui.toast('success', fee.isActive ? 'Fee deactivated' : 'Fee activated',
        fee.title + ' is now ' + (fee.isActive ? 'inactive' : 'active') + '.');
      renderFees(document.getElementById('view'));
    }).catch(function (err) {
      ui.toast('error', 'Could not toggle fee', err.message);
    });
  }

  function deleteFee(fee) {
    var linked = db.payments().filter(function (p) { return p.feeId === fee.id; }).length;
    if (linked > 0) {
      ui.confirmDialog({
        title: 'Cannot delete "' + fee.title + '"',
        message: linked + ' payment' + (linked === 1 ? ' has' : 's have') + ' already been recorded against this fee. Deactivate it instead to stop new payments while keeping history.',
        confirmText: 'OK', warn: true
      }).then(function () {});
      return;
    }
    ui.confirmDialog({
      title: 'Delete "' + fee.title + '"?',
      message: 'This permanently removes the fee requirement. No payments are linked to it, so it is safe to delete.',
      danger: true, confirmText: 'Delete fee'
    }).then(function (ok) {
      if (!ok) return;
      PH5.api.deleteFee(fee.id).then(function () {
        ui.toast('success', 'Fee deleted', fee.title + ' was removed.');
        renderFees(document.getElementById('view'));
      }).catch(function (err) {
        ui.toast('error', 'Could not delete fee', err.message);
      });
    });
  }

  /* ==================================================================
     PAYMENTS — recording with $1/$2 limit & overpayment guard
     ================================================================== */
  function renderPayments(el) {
    var fees = db.fees().filter(function (f) { return f.isActive; })
      .slice().sort(function (a, b) { return String(a.periodKey || '').localeCompare(String(b.periodKey || '')); });
    var currentPeriod = db.currentPeriodKey();
    var defaultPeriod = fees.some(function (f) { return f.periodKey === currentPeriod; })
      ? currentPeriod : (fees[0] ? fees[0].periodKey : '');
    var pays = db.payments().slice().sort(function (a, b) { return b.date.localeCompare(a.date); });

    el.innerHTML =
      '<div class="page-head"><div><h1>Payments</h1>' +
        '<div class="subtitle">Monthly contribution ledger — filter by month and status, search by student, record payments</div></div>' +
        '<div class="actions"><button class="btn btn-primary" id="pay-add"><i class="fa-solid fa-circle-dollar-to-slot"></i> Record payment</button></div></div>' +
      '<div class="card">' +
        '<div class="toolbar">' +
          '<select id="pay-period" style="min-width:280px;">' + fees.map(function (f) {
            return '<option value="' + esc(f.periodKey) + '"' + (f.periodKey === defaultPeriod ? ' selected' : '') + '>' +
              esc(f.periodKey + ' · ' + f.title) + '</option>';
          }).join('') + '</select>' +
          '<select id="pay-status"><option value="">All statuses</option>' +
            '<option value="unpaid">Unpaid</option><option value="partial">Partial</option><option value="paid">Paid</option></select>' +
          '<div class="search-box"><i class="fa-solid fa-magnifying-glass"></i><input id="pay-search" placeholder="Search student name or ID…"></div>' +
          '<span class="result-count" id="pay-count"></span>' +
        '</div>' +
        '<div class="card-body" style="padding:0;" id="pay-ledger"></div>' +
      '</div>' +
      '<div class="card"><div class="card-header"><h3 id="pay-tx-head">Payment transactions</h3></div>' +
        '<div class="card-body" style="padding:0;" id="pay-list"></div>' +
      '</div>';

    function render() {
      var period = document.getElementById('pay-period').value;
      var status = document.getElementById('pay-status').value;
      var q = document.getElementById('pay-search').value.toLowerCase();
      var fee = fees.filter(function (f) { return f.periodKey === period; })[0];

      if (!fee) {
        document.getElementById('pay-count').textContent = '0';
        document.getElementById('pay-ledger').innerHTML = ui.emptyState('fa-calendar-xmark', 'No fee for this month', 'Select a month from the schedule.');
        document.getElementById('pay-list').innerHTML = '';
        return;
      }

      var due = db.isDueFee(fee);
      var students = db.students().slice().sort(function (a, b) { return a.fullName.localeCompare(b.fullName); });
      var rows = students.map(function (s) {
        var st = db.paymentStatus(s.studentId, fee);
        if (status && st.key !== status) return null;
        if (q && (s.fullName + ' ' + s.studentId).toLowerCase().indexOf(q) === -1) return null;
        var remaining = Math.max(0, fee.amountRequired - st.paid);
        var payBtn = due && st.key !== 'paid'
          ? '<button class="btn btn-sm btn-primary" data-pay="' + esc(s.studentId) + '"><i class="fa-solid fa-circle-dollar-to-slot"></i> Record</button>'
          : '';
        return '<tr><td><div class="flex gap-8" style="align-items:center;">' + ui.avatar(s.fullName, s.avatarColor) +
          '<div><div class="cell-primary">' + esc(s.fullName) + '</div><div class="cell-sub">' + esc(s.studentId) + '</div></div></div></td>' +
          '<td class="text-right money text-success">' + ui.money(st.paid) + '</td>' +
          '<td class="text-right money ' + (st.key === 'paid' ? 'text-success' : st.key === 'partial' ? 'text-warning' : 'text-danger') + '">' +
            ui.money(due ? remaining : 0) + '</td>' +
          '<td>' + (due ? ui.statusBadge(st.key) : ui.statusBadge('not_due')) + '</td>' +
          '<td class="text-right">' + payBtn + '</td></tr>';
      }).filter(Boolean);

      document.getElementById('pay-count').textContent = rows.length + ' of ' + students.length + ' students';
      document.getElementById('pay-ledger').innerHTML =
        '<div style="padding:10px 22px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:12px;">' +
          '<span class="form-section-title" style="margin:0;">' + esc(fee.title) + '</span>' +
          (due ? '<span class="text-muted" style="font-size:12px;">Due ' + esc(ui.fmtDate(fee.dueDate)) + '</span>' : ui.statusBadge('not_due')) +
        '</div>' +
        (rows.length
          ? '<div class="table-wrap"><table class="table"><thead><tr><th>Student</th><th class="text-right">Paid</th><th class="text-right">Remaining</th><th>Status</th><th class="text-right">Actions</th></tr></thead><tbody>' + rows.join('') + '</tbody></table></div>'
          : ui.emptyState('fa-users-slash', 'No students match', 'Try clearing the status or search filters.'));

      var txns = pays.filter(function (p) {
        var pf = db.feeById(p.feeId);
        return pf && pf.periodKey === period;
      });
      if (status) {
        txns = txns.filter(function (p) { return db.paymentStatus(p.studentId, db.feeById(p.feeId)).key === status; });
      }
      document.getElementById('pay-tx-head').textContent = 'Payment transactions — ' + period;
      document.getElementById('pay-list').innerHTML = txns.length
        ? '<div class="table-wrap"><table class="table"><thead><tr><th>Student</th><th>Date</th><th>Method</th><th>Reference</th><th>Recorded by</th><th class="text-right">Amount</th><th class="text-right">Actions</th></tr></thead><tbody>' +
          txns.map(function (p) {
            var student = db.studentById(p.studentId) || {};
            return '<tr><td><div class="flex gap-8" style="align-items:center;">' + ui.avatar(student.fullName, student.avatarColor) +
              '<div><div class="cell-primary">' + esc(student.fullName || p.studentId) + '</div><div class="cell-sub">' + esc(student.studentId || '') + '</div></div></div></td>' +
              '<td class="nowrap">' + esc(ui.fmtDate(p.date)) + '</td>' +
              '<td>' + esc(p.method) + '</td>' +
              '<td class="text-muted">' + esc(p.reference) + '</td>' +
              '<td class="text-muted">' + esc(p.recordedByName || '—') + '</td>' +
              '<td class="text-right money text-success">' + ui.money(p.amount) + '</td>' +
              '<td><div class="row-actions"><button class="btn btn-sm btn-ghost" data-del="' + esc(p.id) + '" title="Delete payment"><i class="fa-solid fa-trash"></i></button></div></td></tr>';
          }).join('') + '</tbody></table></div>'
        : ui.emptyState('fa-credit-card', 'No transactions for this month', 'Record a payment for ' + esc(fee.title) + ' to see it here.');
    }

    document.getElementById('pay-period').addEventListener('change', render);
    document.getElementById('pay-status').addEventListener('change', render);
    document.getElementById('pay-search').addEventListener('input', render);
    document.getElementById('pay-add').addEventListener('click', function () {
      var period = document.getElementById('pay-period').value;
      var fee = fees.filter(function (f) { return f.periodKey === period; })[0];
      openPaymentModal({ feeId: fee ? fee.id : null });
    });
    document.getElementById('pay-ledger').addEventListener('click', function (e) {
      var t = e.target.closest('[data-pay]');
      if (!t) return;
      var period = document.getElementById('pay-period').value;
      var fee = fees.filter(function (f) { return f.periodKey === period; })[0];
      openPaymentModal({ studentId: t.getAttribute('data-pay'), feeId: fee ? fee.id : null });
    });
    document.getElementById('pay-list').addEventListener('click', function (e) {
      var t = e.target.closest('[data-del]');
      if (!t) return;
      var p = db.payments().find(function (x) { return x.id === t.getAttribute('data-del'); });
      if (p) deletePayment(p);
    });
    render();
  }

  function deletePayment(p) {
    var student = db.studentById(p.studentId) || {};
    ui.confirmDialog({
      title: 'Delete this payment?',
      message: 'Delete the ' + ui.money(p.amount) + ' ' + p.method + ' payment recorded for ' + (student.fullName || p.studentId) + ' on ' + ui.fmtDate(p.date) + '? This cannot be undone.',
      danger: true, confirmText: 'Delete payment'
    }).then(function (ok) {
      if (!ok) return;
      PH5.api.deletePayment(p.id).then(function () {
        ui.toast('success', 'Payment deleted', 'The payment was removed and balances were recalculated.');
        renderPayments(document.getElementById('view'));
      }).catch(function (err) {
        ui.toast('error', 'Could not delete payment', err.message);
      });
    });
  }

  /* The payment recording modal with live overpayment protection.
     preset: { studentId?, feeId? } pre-selects a student and/or month. */
  function openPaymentModal(preset) {
    preset = preset || {};
    var students = db.students().slice().sort(function (a, b) { return a.fullName.localeCompare(b.fullName); });
    var fees = db.fees().filter(function (f) { return f.isActive; })
      .slice().sort(function (a, b) { return String(a.periodKey || '').localeCompare(String(b.periodKey || '')); });
    if (!fees.length) {
      ui.toast('warning', 'No active fee requirements', 'Create a fee requirement before recording payments.');
      return;
    }
    var presetStudent = preset.studentId
      ? db.students().find(function (s) { return s.studentId === preset.studentId || s.id === preset.studentId; })
      : null;
    var initialFeeId = preset.feeId || (fees[0] ? fees[0].id : null);
    var today = db.todayISO();

    var m = ui.openModal({
      size: 'lg', locked: false,
      title: 'Record payment',
      body:
        '<div class="field"><label>Student <span class="req">*</span></label>' +
          '<input id="pm-student-search" placeholder="Type to filter students…" style="margin-bottom:8px;">' +
          '<select id="pm-student" style="width:100%;">' +
            '<option value="">— Select student —</option>' +
            students.map(function (s) { return '<option value="' + esc(s.id) + '"' + (presetStudent && presetStudent.id === s.id ? ' selected' : '') + '>' + esc(s.fullName) + ' (' + esc(s.studentId) + ')</option>'; }).join('') +
          '</select></div>' +
        '<div class="field"><label>Month <span class="req">*</span></label>' +
          '<select id="pm-fee">' + fees.map(function (f) { return '<option value="' + esc(f.id) + '"' + (f.id === initialFeeId ? ' selected' : '') + '>' + esc((f.periodKey ? f.periodKey + ' · ' : '') + f.title) + ' — ' + ui.money(f.amountRequired) + '</option>'; }).join('') + '</select></div>' +
        '<div id="pm-statusbox" class="mb-16"></div>' +
        '<div class="form-section-title">Amount (limited to $1 or $2)</div>' +
        '<div class="amount-tiles">' +
          '<button type="button" class="amount-tile" data-amt="1">$1<small>1 dollar</small></button>' +
          '<button type="button" class="amount-tile" data-amt="2">$2<small>2 dollars</small></button>' +
        '</div>' +
        '<div class="form-section-title">Payment method</div>' +
        '<div class="method-tiles">' +
          METHODS.map(function (mm, i) {
            var ic = ['fa-money-bill-1', 'fa-mobile-screen-button', 'fa-building-columns'][i];
            return '<button type="button" class="method-tile' + (i === 0 ? ' selected' : '') + '" data-method="' + mm + '"><i class="fa-solid ' + ic + '"></i>' + mm + '</button>';
          }).join('') +
        '</div>' +
        '<div class="field-row">' +
          '<div class="field"><label>Date</label><input id="pm-date" type="date" value="' + today + '"></div>' +
          '<div class="field"><label>Reference</label><input id="pm-ref" placeholder="e.g. RCP-1001 (optional)"></div>' +
        '</div>' +
        '<div class="field"><label>Note</label><input id="pm-note" placeholder="Optional note"></div>',
      footer:
        '<button class="btn btn-secondary" id="pm-cancel">Cancel</button>' +
        '<button class="btn btn-success" id="pm-save" disabled><i class="fa-solid fa-check"></i> Save payment</button>'
    });

    var state = {
      studentId: presetStudent ? presetStudent.id : null,
      feeId: initialFeeId, amount: null, method: 'Cash'
    };

    /* Live filter for the student select */
    var searchInput = m.el.querySelector('#pm-student-search');
    var select = m.el.querySelector('#pm-student');
    searchInput.addEventListener('input', function () {
      var q = searchInput.value.toLowerCase();
      Array.prototype.forEach.call(select.options, function (opt) {
        if (!opt.value) return;
        opt.style.display = (opt.textContent.toLowerCase().indexOf(q) !== -1 || !q) ? '' : 'none';
      });
    });

    function refresh() {
      var student = db.studentById(state.studentId);
      var fee = db.feeById(state.feeId);
      var box = m.el.querySelector('#pm-statusbox');
      var saveBtn = m.el.querySelector('#pm-save');
      if (!student || !fee) {
        box.innerHTML = '<div class="notice"><i class="fa-solid fa-circle-info"></i> Select a student and a month to see the balance.</div>';
        saveBtn.disabled = true;
        return;
      }
      if (!db.isDueFee(fee)) {
        box.innerHTML = '<div class="field"><div class="hint" style="color:var(--warning);"><i class="fa-solid fa-calendar-minus"></i> ' +
          esc(fee.title) + ' is NOT DUE yet. Payments can only be recorded once the month begins (due ' + esc(ui.fmtDate(fee.dueDate)) + ').</div></div>';
        saveBtn.disabled = true;
        m.el.querySelectorAll('.amount-tile').forEach(function (tile) {
          tile.classList.remove('selected');
          tile.style.opacity = '0.35';
          tile.style.pointerEvents = 'none';
        });
        return;
      }
      var paid = db.paidFor(student.studentId, fee.id);
      var remaining = fee.amountRequired - paid;
      var isPaid = remaining <= 0;

      /* Only allow tiles that do not overpay. */
      m.el.querySelectorAll('.amount-tile').forEach(function (tile) {
        var amt = Number(tile.getAttribute('data-amt'));
        var allowed = amt <= remaining;
        tile.classList.toggle('selected', allowed && amt === state.amount);
        tile.style.opacity = allowed ? '1' : '0.35';
        tile.style.pointerEvents = allowed ? 'auto' : 'none';
      });

      if (isPaid) {
        box.innerHTML = '<div class="field"><div class="hint" style="color:var(--danger);"><i class="fa-solid fa-triangle-exclamation"></i> This fee is already fully paid (' + ui.money(paid) + ' of ' + ui.money(fee.amountRequired) + '). No further payment can be recorded.</div></div>';
        saveBtn.disabled = true;
        return;
      }
      box.innerHTML =
        '<div class="field"><label>Balance for ' + esc(fee.title) + '</label>' +
        '<div class="summary-strip"><div class="ss-item"><span class="ss-val">' + ui.money(paid) + '</span><span class="ss-lbl">Already paid</span></div>' +
        '<div class="ss-item"><span class="ss-val text-warning">' + ui.money(remaining) + '</span><span class="ss-lbl">Remaining</span></div>' +
        '<div class="ss-item"><span class="ss-val">' + ui.money(fee.amountRequired) + '</span><span class="ss-lbl">Required</span></div></div></div>';
      saveBtn.disabled = !(state.amount && state.amount <= remaining);
    }

    select.addEventListener('change', function () { state.studentId = select.value; refresh(); });
    m.el.querySelector('#pm-fee').addEventListener('change', function (e) { state.feeId = e.target.value; state.amount = null; m.el.querySelectorAll('.amount-tile').forEach(function (t) { t.classList.remove('selected'); }); refresh(); });
    m.el.querySelectorAll('.amount-tile').forEach(function (tile) {
      tile.addEventListener('click', function () {
        state.amount = Number(tile.getAttribute('data-amt'));
        m.el.querySelectorAll('.amount-tile').forEach(function (t) { t.classList.toggle('selected', t === tile); });
        refresh();
      });
    });
    m.el.querySelectorAll('.method-tile').forEach(function (tile) {
      tile.addEventListener('click', function () {
        state.method = tile.getAttribute('data-method');
        m.el.querySelectorAll('.method-tile').forEach(function (t) { t.classList.toggle('selected', t === tile); });
      });
    });

    m.el.querySelector('#pm-cancel').addEventListener('click', m.close);
    m.el.querySelector('#pm-save').addEventListener('click', function () {
      var student = db.studentById(state.studentId);
      var fee = db.feeById(state.feeId);
      var amount = state.amount;
      var paid = db.paidFor(student.studentId, fee.id);
      var remaining = fee.amountRequired - paid;

      if (amount !== 1 && amount !== 2) { ui.toast('error', 'Invalid amount', 'Only $1 or $2 transactions are allowed.'); return; }
      if (amount > remaining) {
        ui.toast('error', 'Overpayment blocked', 'Recording ' + ui.money(amount) + ' would exceed the remaining balance of ' + ui.money(remaining) + '. The maximum allowed payment is ' + ui.money(Math.min(2, remaining)) + '.');
        return;
      }
      var ref = m.el.querySelector('#pm-ref').value.trim() || 'RCP-' + String(Date.now()).slice(-6) + '-' + student.studentId.slice(-3);
      var btn = this;
      btn.disabled = true;
      PH5.api.createPayment({
        studentId: student.studentId, feeId: fee.id, amount: amount,
        method: state.method, reference: ref,
        note: m.el.querySelector('#pm-note').value.trim() || '',
        date: m.el.querySelector('#pm-date').value || today
      }).then(function () {
        var newPaid = paid + amount;
        ui.toast('success', 'Payment recorded', ui.money(amount) + ' saved for ' + student.fullName + '. Balance is now ' + ui.money(Math.max(0, fee.amountRequired - newPaid)) + '.');
        m.close();
        renderPayments(document.getElementById('view'));
      }).catch(function (err) {
        btn.disabled = false;
        ui.toast('error', 'Payment blocked', err.message);
      });
    });

    refresh();
  }

  /* Page registrations with explicit role dispatch. This file loads after
     portal-student.js, so it owns these page keys — and the admin CRUD must
     NEVER render for a student or leader. Students get their own read-only
     records; leaders get the batch read-only views; only admins render the
     mutating UIs. (The backend enforces the same rule with requireRole.) */
  function noPermission() {
    throw new Error('You do not have permission to perform this action.');
  }

  pages.students = function (el) {
    var role = auth.session().role;
    if (role === 'class_leader') { PH5.leaderStudents(el); return; }
    if (role !== 'admin') noPermission();
    renderStudents(el);
  };
  pages.fees = function (el) {
    var role = auth.session().role;
    if (role === 'class_leader') { PH5.leaderFees(el); return; }
    if (role === 'student') { PH5.studentFees(el); return; }
    if (role !== 'admin') noPermission();
    renderFees(el);
  };
  pages.payments = function (el) {
    var role = auth.session().role;
    if (role === 'class_leader') { PH5.leaderPayments(el); return; }
    if (role === 'student') { PH5.studentPayments(el); return; }
    if (role !== 'admin') noPermission();
    renderPayments(el);
  };
})();
