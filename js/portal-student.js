/* ==========================================================================
   portal-student.js — Student & Class Leader portals
   Student: read-only access to own profile, fees, payments and attendance.
   Class Leader: read-only overview of the whole batch (all 59 students).
   ========================================================================== */
(function () {
  'use strict';
  var db = PH5.db, ui = PH5.ui, auth = PH5.auth;
  var esc = ui.escape;
  var pages = window.PH5.pages = window.PH5.pages || {};

  function myStudent() {
    var s = auth.session();
    return db.studentById(s.studentId);
  }

  /* '2026-08' → 'Aug 2026' (used in leader dashboard/labels). */
  function monthLabel(periodKey) {
    if (!periodKey) return '';
    var parts = String(periodKey).split('-');
    var d = new Date(Number(parts[0]), Number(parts[1]) - 1, 1);
    return d.toLocaleString('en-US', { month: 'short', year: 'numeric' });
  }

  /* Shared: a monthly fee table (Month, Required, Paid, Remaining, Status,
     Payment history). Future months render as NOT DUE. */
  function studentFeeBlocks(student) {
    var fees = db.fees().filter(function (f) { return f.isActive; })
      .slice().sort(function (a, b) { return String(a.periodKey || '').localeCompare(String(b.periodKey || '')); });
    if (!fees.length) {
      return ui.emptyState('fa-receipt', 'No fee requirements yet',
        'The administrator has not published any fee requirements for this batch.');
    }
    var rows = fees.map(function (fee) {
      var st = db.paymentStatus(student.studentId, fee);
      var notDue = st.key === 'not_due';
      var remaining = Math.max(0, fee.amountRequired - st.paid);
      var history = db.paymentsFor(student.studentId, fee.id);
      var period = fee.periodKey || ui.fmtDate(fee.dueDate);

      var historyRow = history.length
        ? '<tr class="fee-history-row" id="hist-' + esc(fee.id) + '" hidden>' +
            '<td colspan="6" style="padding:0;background:#f8fafc;">' +
              '<table class="table" style="margin:0;"><thead><tr><th>Date</th><th>Method</th><th>Reference</th><th class="text-right">Amount</th></tr></thead><tbody>' +
              history.map(function (p) {
                return '<tr><td>' + esc(ui.fmtDate(p.date)) + '</td>' +
                  '<td>' + esc(p.method) + '</td>' +
                  '<td>' + esc(p.reference) + '</td>' +
                  '<td class="text-right money text-success">' + ui.money(p.amount) + '</td></tr>';
              }).join('') +
              '</tbody></table>' +
            '</td></tr>'
        : '';

      return '<tr>' +
        '<td><span class="cell-primary">' + esc(fee.title) + '</span>' +
          '<div class="cell-sub">Period ' + esc(period) + ' · Due ' + esc(ui.fmtDate(fee.dueDate)) + '</div></td>' +
        '<td class="text-right money">' + ui.money(fee.amountRequired) + '</td>' +
        '<td class="text-right money ' + (st.paid > 0 ? 'text-success' : '') + '">' + ui.money(st.paid) + '</td>' +
        '<td class="text-right money ' + (notDue ? '' : st.key === 'paid' ? 'text-success' : st.key === 'partial' ? 'text-warning' : 'text-danger') + '">' +
          ui.money(notDue ? 0 : remaining) + '</td>' +
        '<td>' + (notDue ? ui.statusBadge('not_due') : ui.statusBadge(st.key)) + '</td>' +
        '<td class="text-right">' + (history.length
          ? '<button type="button" class="btn btn-sm btn-ghost" data-hist-toggle="' + esc(fee.id) + '">' + history.length + ' payment' + (history.length === 1 ? '' : 's') + '</button>'
          : '<span class="text-muted">—</span>') + '</td>' +
        '</tr>' + historyRow;
    }).join('');

    return '<div class="table-wrap"><table class="table"><thead><tr>' +
      '<th>Month</th><th class="text-right">Required</th><th class="text-right">Paid</th><th class="text-right">Remaining</th><th>Status</th><th class="text-right">Payment history</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table></div>';
  }

  /* Expand/collapse the payment-history rows inside the monthly fee table. */
  document.addEventListener('click', function (e) {
    var t = e.target && e.target.closest ? e.target.closest('[data-hist-toggle]') : null;
    if (!t) return;
    var row = document.getElementById('hist-' + t.getAttribute('data-hist-toggle'));
    if (row) row.hidden = !row.hidden;
  });

  /* Expand/collapse the per-student payment history rows on the leader Fees page. */
  document.addEventListener('click', function (e) {
    var t = e.target && e.target.closest ? e.target.closest('[data-lhist]') : null;
    if (!t) return;
    var parts = t.getAttribute('data-lhist').split('|');
    var row = document.getElementById('lhist-' + parts[0] + '-' + parts[1]);
    if (row) row.hidden = !row.hidden;
  });

  /* ================= Student dashboard ================= */
  function studentDashboard(el) {
    var s = auth.session();
    var st = myStudent();
    if (!st) { el.innerHTML = ui.emptyState('fa-user-slash', 'Student record not found', 'Contact the administrator.'); return; }
    var activeFees = db.fees().filter(function (f) { return f.isActive; });
    var dueFees = activeFees.filter(function (f) { return db.isDueFee(f); });
    var totalRequired = dueFees.reduce(function (s2, f) { return s2 + f.amountRequired; }, 0);   // due months only
    var totalScheduledAll = activeFees.reduce(function (s2, f) { return s2 + f.amountRequired; }, 0); // all 17 months
    var totalPaid = dueFees.reduce(function (s2, f) { return s2 + db.paidFor(st.studentId, f.id); }, 0);
    var attn = db.studentAttendanceStats(st.studentId);
    var recents = db.paymentsFor(st.studentId).slice().sort(function (a, b) { return b.date.localeCompare(a.date); }).slice(0, 5);

    var greeting = new Date().getHours() < 12 ? 'Good morning' : (new Date().getHours() < 18 ? 'Good afternoon' : 'Good evening');

    el.innerHTML =
      '<div class="page-head">' +
        '<div style="display:flex;align-items:center;gap:16px;">' +
          ui.avatar(st.fullName, st.avatarColor, 56) +
          '<div><h1>' + greeting + ', ' + esc(st.fullName.split(' ')[0]) + '</h1>' +
          '<div class="subtitle">Student ID <b>' + esc(st.studentId) + '</b> · Public Health · Batch Five</div></div>' +
        '</div>' +
      '</div>' +
      '<div class="stat-grid">' +
        ui.statCard('fa-receipt', 'navy', ui.money(totalRequired), 'Fees due now') +
        ui.statCard('fa-circle-dollar-to-slot', 'teal', ui.money(totalPaid), 'Total paid') +
        ui.statCard('fa-arrow-trend-up', totalPaid >= totalRequired ? 'green' : 'amber', ui.money(Math.max(0, totalRequired - totalPaid)), 'Due balance') +
        ui.statCard('fa-calendar-plus', 'blue', ui.money(totalScheduledAll), 'Scheduled total (Aug 2026 – Dec 2027)') +
      '</div>' +
      '<div class="widget-grid">' +
        '<div class="card widget-full"><div class="card-header"><h3>My monthly fees</h3></div><div class="card-body" style="padding:0;">' +
          studentFeeBlocks(st) + '</div></div>' +
      '</div>' +
      '<div class="card"><div class="card-header"><h3>Recent payments</h3></div><div class="card-body" style="padding:0;">' +
        recentTable(recents, true) + '</div></div>';
  }

  function recentTable(pays, showStudent) {
    if (!pays.length) {
      return ui.emptyState('fa-credit-card', 'No payments yet', 'Payments you make toward your fees will appear here.');
    }
    return '<div class="table-wrap"><table class="table"><thead><tr>' +
      (showStudent ? '<th>Date</th>' : '<th>Student</th><th>Date</th>') +
      '<th>Fee</th><th>Method</th><th>Reference</th><th class="text-right">Amount</th></tr></thead><tbody>' +
      pays.map(function (p) {
        var fee = db.feeById(p.feeId);
        return '<tr>' +
          (showStudent ? '<td class="cell-primary nowrap">' + esc(ui.fmtDate(p.date)) + '</td>' :
            '<td><span class="cell-primary">' + esc((db.studentById(p.studentId) || {}).fullName || p.studentId) + '</span></td>' +
            '<td class="nowrap">' + esc(ui.fmtDate(p.date)) + '</td>') +
          '<td>' + esc(fee ? fee.title : p.feeId) + '</td>' +
          '<td>' + esc(p.method) + '</td>' +
          '<td class="text-muted">' + esc(p.reference) + '</td>' +
          '<td class="text-right money text-success">' + ui.money(p.amount) + '</td>' +
        '</tr>';
      }).join('') + '</tbody></table></div>';
  }

  /* ================= Class-leader dashboard ================= */
  function leaderDashboard(el) {
    var students = db.students();
    var fees = db.fees().filter(function (f) { return f.isActive; })
      .slice().sort(function (a, b) { return String(a.periodKey || '').localeCompare(String(b.periodKey || '')); });
    var dueFees = fees.filter(function (f) { return db.isDueFee(f); });
    var totalCollected = db.totalCollected();
    var attn = db.attendanceStats(null);
    var totalScheduledAll = fees.reduce(function (s, f) { return s + f.amountRequired * students.length; }, 0);
    var dueNow = dueFees.reduce(function (s, f) { return s + f.amountRequired * students.length; }, 0);
    var totalOutstanding = Math.max(0, dueNow - totalCollected);
    var recents = db.payments().slice().sort(function (a, b) { return b.date.localeCompare(a.date); }).slice(0, 6);
    var currentPeriod = db.currentPeriodKey();
    var currentFee = fees.filter(function (f) { return f.periodKey === currentPeriod; })[0];

    el.innerHTML =
      '<div class="page-head"><div><h1>Batch overview</h1>' +
        '<div class="subtitle">Public Health · Batch Five · ' + students.length + ' registered students</div></div>' +
      '</div>' +
      '<div class="stat-grid">' +
        ui.statCard('fa-users', 'navy', students.length, 'Total students') +
        ui.statCard('fa-calendar-check', 'blue', currentFee ? ui.money(currentFee.amountRequired) : '—',
          'Current monthly fee' + (currentFee ? ' · ' + monthLabel(currentFee.periodKey) : '')) +
        ui.statCard('fa-circle-dollar-to-slot', 'teal', ui.money(totalCollected), 'Total collected') +
        ui.statCard('fa-arrow-trend-up', 'amber', ui.money(totalOutstanding), 'Total outstanding') +
      '</div>' +
      '<div class="card"><div class="card-header"><h3>Attendance summary</h3></div><div class="card-body">' +
        '<div class="summary-strip">' +
          '<div class="ss-item"><span class="ss-val text-success">' + attn.present + '</span><span class="ss-lbl">present</span></div>' +
          '<div class="ss-item"><span class="ss-val" style="color:var(--warning);">' + attn.absent + '</span><span class="ss-lbl">absent</span></div>' +
          '<div class="ss-item"><span class="ss-val" style="color:var(--warning);">' + attn.late + '</span><span class="ss-lbl">late</span></div>' +
          '<div class="ss-item"><span class="ss-val" style="color:var(--info);">' + attn.excused + '</span><span class="ss-lbl">excused</span></div>' +
          '<div class="ss-item"><span class="ss-val" style="color:var(--muted);">' + attn.notMarked + '</span><span class="ss-lbl">not marked</span></div>' +
          '<div class="ss-item"><span class="ss-val">' + attn.rate + '%</span><span class="ss-lbl">attendance rate</span></div>' +
        '</div></div></div>' +
      '<div class="card"><div class="card-header"><h3>Monthly contributions — batch progress</h3></div>' +
        '<div class="card-body" style="padding:0;">' +
        '<div class="table-wrap"><table class="table"><thead><tr>' +
          '<th>Month</th><th class="text-right">Required/student</th><th class="text-right">Expected</th><th class="text-right">Collected</th>' +
          '<th>Paid / Partial / Unpaid</th><th>Status</th></tr></thead><tbody>' +
        fees.map(function (f) {
          var due = db.isDueFee(f);
          var collected = db.batchCollected(f.id);
          var counts = db.feeStatusCounts(f);
          var expected = f.amountRequired * students.length;
          return '<tr><td><span class="cell-primary">' + esc(f.title) + '</span>' +
            '<div class="cell-sub">Period ' + esc(f.periodKey || '') + ' · Due ' + esc(ui.fmtDate(f.dueDate)) + '</div></td>' +
            '<td class="text-right money">' + ui.money(f.amountRequired) + '</td>' +
            '<td class="text-right money">' + ui.money(expected) + '</td>' +
            '<td class="text-right money text-success">' + ui.money(collected) + '</td>' +
            '<td>' + (due
              ? '<span class="nowrap">' + counts.paid + ' / ' + counts.partial + ' / ' + counts.unpaid + '</span>'
              : '<span class="text-muted">—</span>') + '</td>' +
            '<td>' + (due ? '<span class="badge badge-blue"><i class="fa-solid fa-calendar-check"></i>DUE</span>' : ui.statusBadge('not_due')) + '</td></tr>';
        }).join('') +
        '</tbody></table></div></div></div>' +
      '<div class="card"><div class="card-header"><h3>Recent batch payments</h3></div>' +
        '<div class="card-body" style="padding:0;">' + recentTable(recents, false) + '</div></div>';
  }

  /* ================= Fees page ================= */
  function studentFees(el) { var st = myStudent(); if (!st) { el.innerHTML = ''; return; } el.innerHTML = '<div class="page-head"><div><h1>My fees</h1><div class="subtitle">Fee requirements for Public Health Batch Five</div></div></div><div class="card"><div class="card-body">' + studentFeeBlocks(st) + '</div></div>'; }

  function leaderFees(el) {
    var fees = db.fees().filter(function (f) { return f.isActive; })
      .slice().sort(function (a, b) { return String(a.periodKey || '').localeCompare(String(b.periodKey || '')); });
    if (!fees.length) { el.innerHTML = ui.emptyState('fa-receipt', 'No fee requirements yet', 'The administrator will publish fee requirements here.'); return; }
    var students = db.students();
    var currentPeriod = db.currentPeriodKey();
    var defaultPeriod = fees.some(function (f) { return f.periodKey === currentPeriod; }) ? currentPeriod : fees[0].periodKey;

    el.innerHTML =
      '<div class="page-head"><div><h1>Fees and payments</h1><div class="subtitle">Read-only monthly fee status for every student</div></div></div>' +

      /* Per-student monthly status (the section required by the portal spec). */
      '<div class="card"><div class="card-header"><h3>Student fee status</h3></div>' +
        '<div class="toolbar">' +
          '<select id="lf-month" style="min-width:280px;">' + fees.map(function (f) {
            return '<option value="' + esc(f.periodKey) + '"' + (f.periodKey === defaultPeriod ? ' selected' : '') + '>' +
              esc(f.periodKey + ' · ' + f.title) + '</option>';
          }).join('') + '</select>' +
          '<div class="search-box"><i class="fa-solid fa-magnifying-glass"></i><input id="lf-search" placeholder="Search name or ID…"></div>' +
          '<span class="result-count" id="lf-count"></span>' +
        '</div>' +
        '<div class="card-body" style="padding:0;" id="lf-list"></div>' +
      '</div>' +

      /* Batch overview (all months). */
      '<div class="card"><div class="card-header"><h3>Batch overview</h3></div><div class="card-body" style="padding:0;">' +
      '<div class="table-wrap"><table class="table"><thead><tr>' +
        '<th>Month</th><th class="text-right">Required/student</th><th class="text-right">Expected</th><th class="text-right">Collected</th>' +
        '<th>Paid / Partial / Unpaid</th><th>Due date</th><th>Status</th></tr></thead><tbody>' +
      fees.map(function (f) {
        var due = db.isDueFee(f);
        var collected = db.batchCollected(f.id);
        var counts = db.feeStatusCounts(f);
        var expected = f.amountRequired * students.length;
        return '<tr><td><span class="cell-primary">' + esc(f.title) + '</span>' +
          '<div class="cell-sub">Period ' + esc(f.periodKey || '') + (f.description ? ' · ' + esc(f.description) : '') + '</div></td>' +
          '<td class="text-right money">' + ui.money(f.amountRequired) + '</td>' +
          '<td class="text-right money">' + ui.money(expected) + '</td>' +
          '<td class="text-right money text-success">' + ui.money(collected) + '</td>' +
          '<td>' + (due
            ? '<span class="nowrap">' + counts.paid + ' / ' + counts.partial + ' / ' + counts.unpaid + '</span>'
            : '<span class="text-muted">—</span>') + '</td>' +
          '<td>' + esc(ui.fmtDate(f.dueDate)) + '</td>' +
          '<td>' + (due ? '<span class="badge badge-blue"><i class="fa-solid fa-calendar-check"></i>DUE</span>' : ui.statusBadge('not_due')) + '</td></tr>';
      }).join('') + '</tbody></table></div></div></div>';

    /* Per-student ledger for the selected month, with expandable history. */
    function renderList() {
      var period = document.getElementById('lf-month').value;
      var q = document.getElementById('lf-search').value.toLowerCase();
      var fee = fees.filter(function (f) { return f.periodKey === period; })[0];
      if (!fee) {
        document.getElementById('lf-list').innerHTML = ui.emptyState('fa-calendar-xmark', 'No fee for this month', 'Select a month from the schedule.');
        return;
      }
      var due = db.isDueFee(fee);
      var rows = students.map(function (s) {
        var st = db.paymentStatus(s.studentId, fee);
        if (q && (s.fullName + ' ' + s.studentId).toLowerCase().indexOf(q) === -1) return null;
        var remaining = Math.max(0, fee.amountRequired - st.paid);
        var history = db.paymentsFor(s.studentId, fee.id).slice().sort(function (a, b) { return b.date.localeCompare(a.date); });
        var histRow = history.length
          ? '<tr class="fee-history-row" id="lhist-' + esc(fee.id) + '-' + esc(s.studentId) + '" hidden>' +
              '<td colspan="6" style="padding:0;background:#f8fafc;">' +
                '<table class="table" style="margin:0;"><thead><tr><th>Date</th><th>Method</th><th>Reference</th><th class="text-right">Amount</th></tr></thead><tbody>' +
                history.map(function (p) {
                  return '<tr><td>' + esc(ui.fmtDate(p.date)) + '</td>' +
                    '<td>' + esc(p.method) + '</td>' +
                    '<td>' + esc(p.reference) + '</td>' +
                    '<td class="text-right money text-success">' + ui.money(p.amount) + '</td></tr>';
                }).join('') +
                '</tbody></table>' +
              '</td></tr>'
          : '';
        return '<tr>' +
          '<td><div class="flex gap-8" style="align-items:center;">' + ui.avatar(s.fullName, s.avatarColor) +
            '<div><div class="cell-primary">' + esc(s.fullName) + '</div><div class="cell-sub">' + esc(s.studentId) + '</div></div></div></td>' +
          '<td class="text-right money">' + ui.money(st.required) + '</td>' +
          '<td class="text-right money ' + (st.paid > 0 ? 'text-success' : '') + '">' + ui.money(st.paid) + '</td>' +
          '<td class="text-right money ' + (st.key === 'paid' ? 'text-success' : st.key === 'partial' ? 'text-warning' : 'text-danger') + '">' +
            ui.money(due ? remaining : 0) + '</td>' +
          '<td>' + (due ? ui.statusBadge(st.key) : ui.statusBadge('not_due')) + '</td>' +
          '<td class="text-right">' + (history.length
            ? '<button type="button" class="btn btn-sm btn-ghost" data-lhist="' + esc(fee.id) + '|' + esc(s.studentId) + '">' + history.length + ' payment' + (history.length === 1 ? '' : 's') + '</button>'
            : '<span class="text-muted">—</span>') + '</td>' +
          '</tr>' + histRow;
      }).filter(Boolean);
      document.getElementById('lf-count').textContent = rows.length + ' of ' + students.length + ' students';
      document.getElementById('lf-list').innerHTML =
        '<div style="padding:10px 22px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:12px;">' +
          '<span class="form-section-title" style="margin:0;">' + esc(fee.title) + '</span>' +
          (due ? '<span class="text-muted" style="font-size:12px;">Due ' + esc(ui.fmtDate(fee.dueDate)) + ' · ' + ui.money(fee.amountRequired) + ' per student</span>' : ui.statusBadge('not_due')) +
        '</div>' +
        (rows.length
          ? '<div class="table-wrap"><table class="table"><thead><tr><th>Student</th><th class="text-right">Required</th><th class="text-right">Paid</th><th class="text-right">Remaining</th><th>Status</th><th class="text-right">Payment history</th></tr></thead><tbody>' + rows.join('') + '</tbody></table></div>'
          : ui.emptyState('fa-users-slash', 'No students match', 'Try clearing the search.'));
    }

    document.getElementById('lf-month').addEventListener('change', renderList);
    document.getElementById('lf-search').addEventListener('input', renderList);
    renderList();
  }

  /* ================= Payments page ================= */
  function studentPayments(el) {
    var st = myStudent(); if (!st) { el.innerHTML = ''; return; }
    var pays = db.paymentsFor(st.studentId).slice().sort(function (a, b) { return b.date.localeCompare(a.date); });
    el.innerHTML =
      '<div class="page-head"><div><h1>My payments</h1><div class="subtitle">Your payment history toward batch fees</div></div></div>' +
      '<div class="card"><div class="card-body" style="padding:0;">' +
      (pays.length ? '<div class="table-wrap"><table class="table"><thead><tr><th>Date</th><th>Fee</th><th>Method</th><th>Reference</th><th>Recorded by</th><th class="text-right">Amount</th></tr></thead><tbody>' +
        pays.map(function (p) {
          var fee = db.feeById(p.feeId);
          return '<tr><td class="nowrap">' + esc(ui.fmtDate(p.date)) + '</td>' +
            '<td>' + esc(fee ? ((fee.periodKey ? fee.periodKey + ' · ' : '') + fee.title) : p.feeId) + '</td>' +
            '<td>' + esc(p.method) + '</td>' +
            '<td class="text-muted">' + esc(p.reference) + '</td>' +
            '<td class="text-muted">' + esc(p.recordedByName || '—') + '</td>' +
            '<td class="text-right money text-success">' + ui.money(p.amount) + '</td></tr>';
        }).join('') + '</tbody></table></div>'
        : ui.emptyState('fa-credit-card', 'No payments yet', 'Your payment history will appear here once the administrator records a payment for you.')) +
      '</div></div>';
  }

  function leaderPayments(el) {
    var pays = db.payments().slice().sort(function (a, b) { return b.date.localeCompare(a.date); });
    var fees = db.fees();
    var total = db.totalCollected();
    el.innerHTML =
      '<div class="page-head"><div><h1>Batch payments</h1><div class="subtitle">Read-only payment history for all ' + db.students().length + ' students</div></div>' +
        '<div class="actions"><div class="badge badge-teal" style="background:var(--teal-100);color:var(--teal-700);"><i class="fa-solid fa-circle-dollar-to-slot"></i> Total collected: ' + ui.money(total) + '</div></div></div>' +
      '<div class="card">' +
        '<div class="toolbar">' +
          '<div class="search-box"><i class="fa-solid fa-magnifying-glass"></i><input id="pay-search" placeholder="Search student, reference, method…"></div>' +
          '<select id="pay-period"><option value="">All months</option>' + fees.map(function (f) { return '<option value="' + esc(f.periodKey || '') + '">' + esc((f.periodKey ? f.periodKey + ' · ' : '') + f.title) + '</option>'; }).join('') + '</select>' +
          '<span class="result-count" id="pay-count"></span>' +
        '</div>' +
        '<div class="card-body" style="padding:0;" id="pay-list"></div>' +
      '</div>';
    function renderPayments() {
      var q = document.getElementById('pay-search').value;
      var period = document.getElementById('pay-period').value;
      var filtered = pays.filter(function (p) {
        var student = db.studentById(p.studentId) || {};
        var fee = db.feeById(p.feeId);
        if (period && (!fee || fee.periodKey !== period)) return false;
        var hay = (student.fullName || '') + ' ' + (student.studentId || '') + ' ' + (p.reference || '') + ' ' + (p.method || '');
        return !q || hay.toLowerCase().indexOf(q.toLowerCase()) !== -1;
      });
      document.getElementById('pay-count').textContent = filtered.length + ' payment' + (filtered.length === 1 ? '' : 's');
      document.getElementById('pay-list').innerHTML = filtered.length
        ? '<div class="table-wrap"><table class="table"><thead><tr><th>Student</th><th>Date</th><th>Fee</th><th>Method</th><th>Reference</th><th class="text-right">Amount</th></tr></thead><tbody>' +
          filtered.map(function (p) {
            var student = db.studentById(p.studentId) || {};
            var fee = db.feeById(p.feeId);
            return '<tr><td><div class="flex gap-8" style="align-items:center;">' + ui.avatar(student.fullName, student.avatarColor) +
              '<div><div class="cell-primary">' + esc(student.fullName || p.studentId) + '</div><div class="cell-sub">' + esc(student.studentId || '') + '</div></div></div></td>' +
              '<td class="nowrap">' + esc(ui.fmtDate(p.date)) + '</td>' +
              '<td>' + esc(fee ? ((fee.periodKey ? fee.periodKey + ' · ' : '') + fee.title) : p.feeId) + '</td>' +
              '<td>' + esc(p.method) + '</td>' +
              '<td class="text-muted">' + esc(p.reference) + '</td>' +
              '<td class="text-right money text-success">' + ui.money(p.amount) + '</td></tr>';
          }).join('') + '</tbody></table></div>'
        : ui.emptyState('fa-credit-card', 'No matching payments', 'Try adjusting your search or filters.');
    }
    document.getElementById('pay-search').addEventListener('input', renderPayments);
    document.getElementById('pay-period').addEventListener('change', renderPayments);
    renderPayments();
  }

  /* ================= Attendance page ================= */
  function studentAttendance(el) {
    var st = myStudent(); if (!st) { el.innerHTML = ''; return; }
    var subjects = db.subjects().filter(function (s) { return s.isActive; });
    var attn = db.studentAttendanceStats(st.studentId);
    var rows = db.attendanceFor(st.studentId).slice().sort(function (a, b) { return b.date.localeCompare(a.date); });

    el.innerHTML =
      '<div class="page-head"><div><h1>My attendance</h1><div class="subtitle">Practical sessions for Public Health Batch Five</div></div></div>' +
      '<div class="stat-grid">' +
        ui.statCard('fa-user-check', 'green', attn.present, 'Present') +
        ui.statCard('fa-user-xmark', 'red', attn.absent, 'Absent') +
        ui.statCard('fa-clock', 'amber', attn.late, 'Late') +
        ui.statCard('fa-user-shield', 'blue', attn.excused, 'Excused') +
        ui.statCard('fa-circle-minus', 'navy', attn.notMarked, 'Not marked') +
        ui.statCard('fa-percent', 'teal', attn.rate + '%', 'Attendance rate') +
      '</div>' +
      '<div class="card"><div class="card-header"><h3>Practical subjects</h3></div><div class="card-body">' +
      '<div class="attn-grid">' +
      subjects.map(function (sub) {
        var subRows = db.attendanceFor(st.studentId).filter(function (a) { return a.subjectId === sub.id; });
        var present = subRows.filter(function (a) { return a.status === 'present'; }).length;
        var absent = subRows.filter(function (a) { return a.status === 'absent'; }).length;
        var late = subRows.filter(function (a) { return a.status === 'late'; }).length;
        var excused = subRows.filter(function (a) { return a.status === 'excused'; }).length;
        var pct = subRows.length ? Math.round((present / subRows.length) * 100) : 0;
        return '<div class="attn-card"><div class="attn-name">' + esc(sub.name) + '</div>' +
          '<div class="attn-id">' + esc(sub.code) + ' · ' + subRows.length + ' session' + (subRows.length === 1 ? '' : 's') + '</div>' +
          '<div class="summary-strip mb-8"><div class="ss-item"><span class="ss-val">' + pct + '%</span><span class="ss-lbl">rate</span></div>' +
          '<div class="ss-item"><span class="ss-val text-success" style="font-size:13px;">' + present + 'P</span></div>' +
          '<div class="ss-item"><span class="ss-val text-danger" style="font-size:13px;">' + absent + 'A</span></div>' +
          '<div class="ss-item"><span class="ss-val" style="font-size:13px;color:var(--warning);">' + late + 'L</span></div>' +
          '<div class="ss-item"><span class="ss-val" style="font-size:13px;color:var(--info);">' + excused + 'E</span></div></div>' +
          '<div class="progress ' + (pct >= 75 ? 'progress-green' : pct >= 50 ? 'progress-amber' : 'progress-blue') + '"><span style="width:' + pct + '%"></span></div></div>';
      }).join('') +
      '</div></div></div>' +
      '<div class="card"><div class="card-header"><h3>Session history</h3></div><div class="card-body" style="padding:0;">' +
      (rows.length ? '<div class="table-wrap"><table class="table"><thead><tr><th>Date</th><th>Subject</th><th>Status</th></tr></thead><tbody>' +
        rows.map(function (a) {
          var sub = db.subjectById(a.subjectId);
          return '<tr><td class="nowrap">' + esc(ui.fmtDate(a.date)) + '</td><td>' + esc(sub ? sub.name : a.subjectId) + '</td><td>' + ui.statusBadge(a.status) + '</td></tr>';
        }).join('') + '</tbody></table></div>'
        : ui.emptyState('fa-calendar-xmark', 'No sessions recorded', 'Attendance for your practical sessions will appear here once the administrator marks them.')) +
      '</div></div>';
  }

  function leaderAttendance(el) {
    var subjects = db.subjects().filter(function (s) { return s.isActive; });
    var sessions = [];
    var today = db.todayISO();
    // Default to the most recent existing session, else today.
    var allDates = db.attendance().map(function (a) { return a.date; });
    var defaultDate = allDates.length ? allDates.slice().sort().pop() : today;
    var defaultSubject = subjects.length ? subjects[0].id : '';

    function render() {
      var subjectId = document.getElementById('attn-subject').value;
      var date = document.getElementById('attn-date').value;
      if (!subjectId || !date) { document.getElementById('attn-table').innerHTML = ui.emptyState('fa-calendar-xmark', 'Select a subject and date', 'Choose a practical subject and a session date to view attendance.'); return; }
      var rows = db.sessionRecords(subjectId, date);
      var sub = db.subjectById(subjectId);
      var stats = db.attendanceStats(subjectId, date);
      document.getElementById('attn-head').innerHTML =
        'Session: <b>' + esc(sub ? sub.name : subjectId) + '</b> · ' + esc(ui.fmtDate(date)) + ' — ' +
        stats.present + ' present, ' + stats.absent + ' absent, ' + stats.late + ' late, ' + stats.excused + ' excused, ' + stats.notMarked + ' not marked.';
      document.getElementById('attn-table').innerHTML = rows.length
        ? '<div class="table-wrap"><table class="table"><thead><tr><th>#</th><th>Student</th><th>Status</th></tr></thead><tbody>' +
          rows.map(function (a, i) {
            var student = db.studentById(a.studentId) || {};
            return '<tr><td>' + (i + 1) + '</td>' +
              '<td><div class="flex gap-8" style="align-items:center;">' + ui.avatar(student.fullName, student.avatarColor) +
              '<div><div class="cell-primary">' + esc(student.fullName || a.studentId) + '</div><div class="cell-sub">' + esc(student.studentId || '') + '</div></div></div></td>' +
              '<td>' + ui.statusBadge(a.status) + '</td></tr>';
          }).join('') + '</tbody></table></div>'
        : ui.emptyState('fa-calendar-xmark', 'No attendance recorded', 'The administrator has not marked attendance for this session yet.');
    }

    /* Per-student present/absent/late/excused totals (the section required by
       the portal spec). Rate mirrors the batch formula: present over marked. */
    var perStudentRows = db.students().slice().sort(function (a, b) { return a.fullName.localeCompare(b.fullName); }).map(function (s) {
      var st = db.studentAttendanceStats(s.studentId);
      var marked = st.present + st.absent;
      var rate = marked ? Math.round((st.present / marked) * 100) : 0;
      return '<tr>' +
        '<td><div class="flex gap-8" style="align-items:center;">' + ui.avatar(s.fullName, s.avatarColor) +
          '<div><div class="cell-primary">' + esc(s.fullName) + '</div><div class="cell-sub">' + esc(s.studentId) + '</div></div></div></td>' +
        '<td class="text-right">' + st.present + '</td>' +
        '<td class="text-right">' + st.absent + '</td>' +
        '<td class="text-right">' + st.late + '</td>' +
        '<td class="text-right">' + st.excused + '</td>' +
        '<td class="text-right">' + st.notMarked + '</td>' +
        '<td class="text-right"><span class="badge ' + (rate >= 75 ? 'badge-green' : rate >= 50 ? 'badge-amber' : 'badge-red') + '">' + rate + '%</span></td></tr>';
    }).join('');

    el.innerHTML =
      '<div class="page-head"><div><h1>Batch attendance</h1><div class="subtitle">Read-only attendance records for all students</div></div></div>' +
      '<div class="stat-grid">' + (function () {
        var a = db.attendanceStats(null);
        return ui.statCard('fa-user-check', 'green', a.present, 'Present (all sessions)') +
          ui.statCard('fa-user-xmark', 'red', a.absent, 'Absent') +
          ui.statCard('fa-clock', 'amber', a.late, 'Late') +
          ui.statCard('fa-user-shield', 'blue', a.excused, 'Excused') +
          ui.statCard('fa-circle-minus', 'navy', a.notMarked, 'Not marked') +
          ui.statCard('fa-percent', 'teal', a.rate + '%', 'Overall rate');
      })() + '</div>' +
      '<div class="card">' +
        '<div class="toolbar">' +
          '<select id="attn-subject" style="min-width:220px;">' + subjects.map(function (s) { return '<option value="' + esc(s.id) + '"' + (s.id === defaultSubject ? ' selected' : '') + '>' + esc(s.name) + '</option>'; }).join('') + '</select>' +
          '<input type="date" id="attn-date" value="' + esc(defaultDate) + '" style="border:1px solid var(--border-strong);border-radius:var(--radius-sm);padding:9px 12px;background:#fbfcfe;">' +
          '<span class="result-count" id="attn-head"></span>' +
        '</div>' +
        '<div class="card-body" style="padding:0;" id="attn-table"></div>' +
      '</div>' +
      '<div class="card"><div class="card-header"><h3>Per-student attendance summary</h3></div><div class="card-body" style="padding:0;">' +
        '<div class="table-wrap"><table class="table"><thead><tr>' +
          '<th>Student</th><th class="text-right">Present</th><th class="text-right">Absent</th><th class="text-right">Late</th><th class="text-right">Excused</th><th class="text-right">Not marked</th><th class="text-right">Rate</th>' +
        '</tr></thead><tbody>' + perStudentRows + '</tbody></table></div>' +
      '</div></div>';
    document.getElementById('attn-subject').addEventListener('change', render);
    document.getElementById('attn-date').addEventListener('change', render);
    render();
  }

  /* ================= All students (class-leader, read-only) ================= */
  function leaderStudents(el) {
    var students = db.students().slice().sort(function (a, b) { return a.fullName.localeCompare(b.fullName); });
    el.innerHTML =
      '<div class="page-head"><div><h1>All students</h1>' +
        '<div class="subtitle">Read-only directory of all ' + students.length + ' students in the batch</div></div></div>' +
      '<div class="card">' +
        '<div class="toolbar">' +
          '<div class="search-box"><i class="fa-solid fa-magnifying-glass"></i><input id="ls-search" placeholder="Search name, ID, phone…"></div>' +
          '<select id="ls-status"><option value="">All statuses</option><option value="active">Active</option><option value="suspended">Suspended</option><option value="graduated">Graduated</option></select>' +
          '<span class="result-count" id="ls-count"></span>' +
        '</div>' +
        '<div class="card-body" style="padding:0;" id="ls-list"></div>' +
      '</div>';

    function renderList() {
      var q = document.getElementById('ls-search').value.toLowerCase();
      var status = document.getElementById('ls-status').value;
      var filtered = students.filter(function (s) {
        if (status && s.status !== status) return false;
        if (!q) return true;
        return (s.fullName + ' ' + s.studentId + ' ' + (s.phone || '') + ' ' + (s.email || '')).toLowerCase().indexOf(q) !== -1;
      });
      document.getElementById('ls-count').textContent = filtered.length + ' of ' + students.length + ' students';
      var listEl = document.getElementById('ls-list');
      if (!filtered.length) { listEl.innerHTML = ui.emptyState('fa-users-slash', 'No students found', 'Try a different search term.'); return; }
      listEl.innerHTML = '<div class="table-wrap"><table class="table"><thead><tr>' +
        '<th>Student</th><th>Gender</th><th>Phone</th><th>Account status</th><th class="text-right">Total paid</th><th class="text-right">Actions</th></tr></thead><tbody>' +
        filtered.map(function (s) {
          var total = db.paymentsFor(s.studentId).reduce(function (sum, p) { return sum + p.amount; }, 0);
          return '<tr><td><div class="flex gap-8" style="align-items:center;">' + ui.avatar(s.fullName, s.avatarColor) +
            '<div><div class="cell-primary">' + esc(s.fullName) + '</div><div class="cell-sub">' + esc(s.studentId) + '</div></div></div></td>' +
            '<td>' + esc(s.gender === 'M' ? 'Male' : s.gender === 'F' ? 'Female' : '—') + '</td>' +
            '<td>' + esc(s.phone || '—') + '</td>' +
            '<td>' + ui.statusBadge(s.status) + '</td>' +
            '<td class="text-right money text-success">' + ui.money(total) + '</td>' +
            '<td class="text-right">' +
              '<button type="button" class="btn btn-sm btn-secondary" data-view="' + esc(s.studentId) + '"><i class="fa-solid fa-eye"></i> View details</button>' +
            '</td></tr>';
        }).join('') + '</tbody></table></div>';
    }
    document.getElementById('ls-search').addEventListener('input', renderList);
    document.getElementById('ls-status').addEventListener('change', renderList);
    document.getElementById('ls-list').addEventListener('click', function (e) {
      var t = e.target.closest('[data-view]');
      if (!t) return;
      var s = students.find(function (x) { return x.studentId === t.getAttribute('data-view'); });
      if (s) studentProfileModal(s);
    });
    renderList();
  }

  /* Read-only student profile (class-leader "View details") — no edit controls,
     no password material. Shows profile, fee status and payment history. */
  function studentProfileModal(student) {
    var activeFees = db.fees().filter(function (f) { return f.isActive; })
      .slice().sort(function (a, b) { return String(a.periodKey || '').localeCompare(String(b.periodKey || '')); });
    var dueFees = activeFees.filter(function (f) { return db.isDueFee(f); });
    var pays = db.paymentsFor(student.studentId).slice().sort(function (a, b) { return b.date.localeCompare(a.date); });
    var attn = db.studentAttendanceStats(student.studentId);
    var totalRequired = dueFees.reduce(function (s, f) { return s + f.amountRequired; }, 0);
    var totalPaid = dueFees.reduce(function (s, f) { return s + db.paidFor(student.studentId, f.id); }, 0);

    var m = ui.openModal({
      size: 'lg', locked: true,
      title: 'Student details',
      body:
        '<div style="display:flex;align-items:center;gap:16px;margin-bottom:20px;">' +
          ui.avatar(student.fullName, student.avatarColor, 58) +
          '<div><h2 style="font-size:18px;">' + esc(student.fullName) + '</h2>' +
          '<div class="text-muted" style="font-size:13px;">' + esc(student.studentId) + ' · ' + esc(student.program || 'Public Health') + ' · ' + esc(student.batch || 'Batch Five') + '</div>' +
          '<div style="margin-top:6px;">' + ui.statusBadge(student.status) + '</div></div></div>' +
        '<div class="stat-grid" style="margin-bottom:20px;">' +
          ui.statCard('fa-receipt', 'navy', ui.money(totalRequired), 'Fees required (due)') +
          ui.statCard('fa-circle-dollar-to-slot', 'teal', ui.money(totalPaid), 'Paid') +
          ui.statCard('fa-arrow-trend-up', 'amber', ui.money(Math.max(0, totalRequired - totalPaid)), 'Balance') +
          ui.statCard('fa-calendar-check', 'green', attn.rate + '%', 'Attendance rate') +
        '</div>' +
        '<div class="field-row mb-16">' +
          ui.fieldHTML('Gender', '<div style="padding-top:7px;">' + esc(student.gender === 'M' ? 'Male' : student.gender === 'F' ? 'Female' : '—') + '</div>') +
          ui.fieldHTML('Phone', '<div style="padding-top:7px;">' + esc(student.phone || '—') + '</div>') +
          ui.fieldHTML('Email', '<div style="padding-top:7px;">' + esc(student.email || '—') + '</div>') +
        '</div>' +
        '<div class="form-section-title">Attendance summary</div>' +
        '<div class="summary-strip mb-16">' +
          '<div class="ss-item"><span class="ss-val text-success">' + attn.present + '</span><span class="ss-lbl">present</span></div>' +
          '<div class="ss-item"><span class="ss-val" style="color:var(--warning);">' + attn.absent + '</span><span class="ss-lbl">absent</span></div>' +
          '<div class="ss-item"><span class="ss-val" style="color:var(--warning);">' + attn.late + '</span><span class="ss-lbl">late</span></div>' +
          '<div class="ss-item"><span class="ss-val" style="color:var(--info);">' + attn.excused + '</span><span class="ss-lbl">excused</span></div>' +
          '<div class="ss-item"><span class="ss-val" style="color:var(--muted);">' + attn.notMarked + '</span><span class="ss-lbl">not marked</span></div>' +
        '</div>' +
        '<div class="form-section-title">Fee status</div>' +
        activeFees.map(function (f) {
          var st = db.paymentStatus(student.studentId, f);
          var pct = st.required ? Math.min(100, Math.round((st.paid / st.required) * 100)) : 0;
          return '<div class="flex-between mb-8"><span>' + esc(f.title) + '</span><span class="flex gap-12" style="align-items:center;">' +
            '<span class="text-muted" style="font-size:12.5px;">' + ui.money(st.paid) + ' / ' + ui.money(st.required) + '</span>' + ui.statusBadge(st.key) + '</span></div>' +
            '<div class="progress ' + (st.key === 'paid' ? 'progress-green' : st.key === 'partial' ? 'progress-amber' : st.key === 'not_due' ? 'progress-blue' : 'progress-blue') + ' mb-16"><span style="width:' + pct + '%"></span></div>';
        }).join('') +
        '<div class="form-section-title">Payment history (' + pays.length + ')</div>' +
        '<div class="table-wrap"><table class="table"><thead><tr><th>Date</th><th>Fee</th><th>Method</th><th>Reference</th><th class="text-right">Amount</th></tr></thead><tbody>' +
        (pays.length ? pays.map(function (p) {
          var fee = db.feeById(p.feeId);
          return '<tr><td class="nowrap">' + esc(ui.fmtDate(p.date)) + '</td><td>' + esc(fee ? fee.title : p.feeId) + '</td><td>' + esc(p.method) + '</td><td class="text-muted">' + esc(p.reference) + '</td><td class="text-right money text-success">' + ui.money(p.amount) + '</td></tr>';
        }).join('') : '<tr><td colspan="5" class="text-muted" style="text-align:center;padding:14px;">No payments recorded.</td></tr>') + '</tbody></table></div>',
      footer: '<button class="btn btn-primary" id="sp-close"><i class="fa-solid fa-xmark"></i> Close</button>'
    });
    m.el.querySelector('#sp-close').addEventListener('click', m.close);
  }

  /* ================= Profile page ================= */
  function profile(el) {
    var s = auth.session();
    var st = db.studentById(s.studentId);
    var isStudent = s.role === 'student';
    el.innerHTML =
      '<div class="page-head"><div><h1>My profile</h1><div class="subtitle">Your account details on the ' +
        esc('Public Health Batch Five Management System') + '</div></div></div>' +
      '<div class="card" style="max-width:640px;"><div class="card-body">' +
        '<div style="display:flex;align-items:center;gap:18px;margin-bottom:22px;">' +
          ui.avatar(s.fullName, st ? st.avatarColor : null, 68) +
          '<div><h2>' + esc(s.fullName) + '</h2>' +
          '<div style="display:flex;gap:8px;margin-top:6px;flex-wrap:wrap;">' +
            '<span class="badge badge-navy">' + esc(auth.roleLabel(s.role)) + '</span>' +
            (isStudent ? '<span class="badge badge-teal" style="background:var(--teal-100);color:var(--teal-700);">Batch Five</span>' : '') +
          '</div></div></div>' +
        '<div class="field-row">' +
          ui.fieldHTML('Student ID', '<div class="cell-primary" style="padding-top:8px;">' + esc(st ? st.studentId : s.username) + '</div>') +
          ui.fieldHTML('Username', '<div class="cell-primary" style="padding-top:8px;">' + esc(s.username) + '</div>') +
        '</div>' +
        (isStudent && st ? '<div class="field-row">' +
          ui.fieldHTML('Gender', '<div class="cell-primary" style="padding-top:8px;">' + esc(st.gender === 'M' ? 'Male' : st.gender === 'F' ? 'Female' : st.gender) + '</div>') +
          ui.fieldHTML('Status', '<div style="padding-top:6px;">' + ui.statusBadge(st.status) + '</div>') +
        '</div>' +
        '<div class="field-row">' +
          ui.fieldHTML('Phone', '<div class="cell-primary" style="padding-top:8px;">' + esc(st.phone || '—') + '</div>') +
          ui.fieldHTML('Email', '<div class="cell-primary" style="padding-top:8px;">' + esc(st.email || '—') + '</div>') +
        '</div>'
        : '<div class="field">' + ui.fieldHTML('Role scope', '<div class="cell-primary" style="padding-top:8px;">' + esc(isStudent ? '' : 'Read-only access to the whole Public Health Batch Five cohort') + '</div>') + '</div>') +
        '<div class="field mt-16" style="border-top:1px solid var(--border);padding-top:16px;">' +
          ui.fieldHTML('Account created', '<div class="cell-sub" style="padding-top:8px;">' + esc(ui.fmtDateTime((db.userById(s.userId) || {}).createdAt)) + '</div>') +
        '</div>' +
      '</div></div>';
  }

  /* ================= Subjects (class-leader, read-only) ================= */
  function leaderSubjects(el) {
    var subjects = db.subjects().filter(function (s) { return s.isActive; })
      .slice().sort(function (a, b) { return a.name.localeCompare(b.name); });
    el.innerHTML =
      '<div class="page-head"><div><h1>Subjects</h1>' +
        '<div class="subtitle">Read-only academic overview of practical subjects</div></div></div>' +
      '<div class="card"><div class="card-header"><h3>Practical subjects</h3></div><div class="card-body">' +
        (subjects.length
          ? '<div class="attn-grid">' + subjects.map(function (s) {
              var stats = db.attendanceStats(s.id);
              var dates = {};
              db.attendance().forEach(function (a) { if (a.subjectId === s.id) dates[a.date] = true; });
              var sessionCount = Object.keys(dates).length;
              var rate = stats.marked ? stats.rate + '%' : '—';
              return '<div class="attn-card">' +
                '<div style="display:flex;justify-content:space-between;align-items:flex-start;">' +
                  '<div><div class="attn-name">' + esc(s.name) + '</div>' +
                  '<div class="attn-id">' + esc(s.code || '—') + (s.instructor ? ' · ' + esc(s.instructor) : '') + '</div></div>' +
                  '<span class="badge badge-green">ACTIVE</span>' +
                '</div>' +
                (s.description ? '<div class="text-muted" style="font-size:12.5px;margin:8px 0;">' + esc(s.description) + '</div>' : '') +
                '<div class="summary-strip" style="gap:12px;margin:10px 0;">' +
                  '<div class="ss-item"><span class="ss-val" style="font-size:14px;">' + sessionCount + '</span><span class="ss-lbl">sessions</span></div>' +
                  '<div class="ss-item"><span class="ss-val" style="font-size:14px;">' + stats.present + '</span><span class="ss-lbl">present</span></div>' +
                  '<div class="ss-item"><span class="ss-val" style="font-size:14px;">' + stats.absent + '</span><span class="ss-lbl">absent</span></div>' +
                  '<div class="ss-item"><span class="ss-val" style="font-size:14px;">' + stats.late + '</span><span class="ss-lbl">late</span></div>' +
                  '<div class="ss-item"><span class="ss-val" style="font-size:14px;">' + stats.excused + '</span><span class="ss-lbl">excused</span></div>' +
                  '<div class="ss-item"><span class="ss-val" style="font-size:14px;">' + stats.notMarked + '</span><span class="ss-lbl">not marked</span></div>' +
                  '<div class="ss-item"><span class="ss-val" style="font-size:14px;">' + rate + '</span><span class="ss-lbl">rate</span></div>' +
                '</div>' +
                '<div class="progress ' + (stats.marked && stats.rate >= 75 ? 'progress-green' : stats.marked && stats.rate >= 50 ? 'progress-amber' : 'progress-blue') + '"><span style="width:' + (stats.marked ? stats.rate : 0) + '%"></span></div>' +
              '</div>';
            }).join('') + '</div>'
          : ui.emptyState('fa-flask', 'No practical subjects yet', 'The administrator will publish practical subjects here.')) +
      '</div></div>';
  }

  pages.dashboard = function (el) {
    var role = auth.session().role;
    if (role === 'student') studentDashboard(el);
    else if (role === 'class_leader') leaderDashboard(el);
    else pages.adminDashboard(el);
  };
  pages.fees = function (el) {
    var role = auth.session().role;
    if (role === 'student') studentFees(el);
    else leaderFees(el);
  };
  pages.payments = function (el) {
    var role = auth.session().role;
    if (role === 'student') studentPayments(el);
    else leaderPayments(el);
  };
  pages.attendance = function (el) {
    var role = auth.session().role;
    if (role === 'student') studentAttendance(el);
    else leaderAttendance(el);
  };
  pages.profile = profile;
  /* The Class Leaders Portal's Subjects section. Admins fall back to the
     attendance management page; students are denied. */
  pages.subjects = function (el) {
    var role = auth.session().role;
    if (role === 'class_leader') { leaderSubjects(el); return; }
    if (role === 'admin' && PH5.pages.attendanceAdmin) { PH5.pages.attendanceAdmin(el); return; }
    throw new Error('You do not have permission to perform this action.');
  };
  /* Exposed for the admin portal to delegate to when the viewer is a leader. */
  PH5.leaderStudents = leaderStudents;
  PH5.leaderFees = leaderFees;
  PH5.leaderPayments = leaderPayments;
  PH5.leaderSubjects = leaderSubjects;
  /* Read-only student views, exposed so the admin portal (loaded after this
     file) can route students to their own data instead of the admin CRUD. */
  PH5.studentFees = studentFees;
  PH5.studentPayments = studentPayments;
})();
