/* ==========================================================================
   ui.js — Shared UI helpers: toasts, modals, confirms, formatters, builders
   ========================================================================== */
(function () {
  'use strict';

  function escape(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function money(n) {
    var v = Number(n) || 0;
    return '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function fmtDate(d) {
    if (!d) return '—';
    var date = new Date(d);
    if (isNaN(date.getTime())) return d;
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function fmtDateTime(d) {
    if (!d) return '—';
    var date = new Date(d);
    if (isNaN(date.getTime())) return d;
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) +
      ', ' + date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  function timeAgo(iso) {
    if (!iso) return '—';
    var then = new Date(iso).getTime();
    var diff = Date.now() - then;
    if (isNaN(diff) || diff < 0) return fmtDateTime(iso);
    var mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + ' min ago';
    var hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + ' hr' + (hrs > 1 ? 's' : '') + ' ago';
    var days = Math.floor(hrs / 24);
    if (days < 30) return days + ' day' + (days > 1 ? 's' : '') + ' ago';
    return fmtDate(iso);
  }

  /* ---------- Toast ---------- */
  var toastContainer = null;
  function ensureToasts() {
    if (!toastContainer) {
      toastContainer = document.getElementById('toast-container');
      if (!toastContainer) {
        toastContainer = document.createElement('div');
        toastContainer.id = 'toast-container';
        document.body.appendChild(toastContainer);
      }
    }
    return toastContainer;
  }
  function toast(type, title, msg) {
    var icons = { success: 'fa-circle-check', error: 'fa-circle-xmark', warning: 'fa-triangle-exclamation', info: 'fa-circle-info' };
    var el = document.createElement('div');
    el.className = 'toast ' + (type || 'info');
    el.innerHTML =
      '<i class="fa-solid ' + (icons[type] || icons.info) + '"></i>' +
      '<div><div class="toast-title">' + escape(title) + '</div>' +
      (msg ? '<div class="toast-msg">' + escape(msg) + '</div>' : '') + '</div>';
    ensureToasts().appendChild(el);
    setTimeout(function () {
      el.classList.add('hide');
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 220);
    }, 3600);
  }

  /* ---------- Modal ---------- */
  var activeModal = null;
  var escapeKeyHandler = null;
  
  function openModal(opts) {
    closeModal();
    var backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop open' + (opts.size === 'lg' ? '' : '');
    var modal = document.createElement('div');
    modal.className = 'modal' + (opts.size === 'lg' ? ' modal-lg' : '');
    modal.innerHTML =
      '<div class="modal-head">' +
        '<h3>' + escape(opts.title || '') + '</h3>' +
        '<button type="button" class="modal-close" aria-label="Close"><i class="fa-solid fa-xmark"></i></button>' +
      '</div>' +
      '<div class="modal-body">' + (opts.body || '') + '</div>' +
      (opts.footer ? '<div class="modal-foot">' + opts.footer + '</div>' : '');
    backdrop.appendChild(modal);
    backdrop.addEventListener('click', function (e) { if (e.target === backdrop && !opts.locked) closeModal(); });
    modal.querySelector('.modal-close').addEventListener('click', function () { if (!opts.locked) closeModal(); });
    
    // Add Escape key handler
    if (!opts.locked) {
      escapeKeyHandler = function (e) {
        if (e.key === 'Escape') {
          closeModal();
        }
      };
      document.addEventListener('keydown', escapeKeyHandler);
    }
    
    document.body.appendChild(backdrop);
    activeModal = backdrop;
    return {
      el: backdrop,
      modalEl: modal,
      bodyEl: modal.querySelector('.modal-body'),
      footEl: modal.querySelector('.modal-foot'),
      close: closeModal
    };
  }
  
  function closeModal() {
    if (activeModal) {
      if (activeModal.parentNode) activeModal.parentNode.removeChild(activeModal);
      activeModal = null;
      if (escapeKeyHandler) {
        document.removeEventListener('keydown', escapeKeyHandler);
        escapeKeyHandler = null;
      }
    }
  }

  /* ---------- Confirm dialog (Promise based) ---------- */
  function confirmDialog(opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var backdrop = document.createElement('div');
      backdrop.className = 'modal-backdrop open confirm-dialog';
      var kind = opts.danger ? 'danger' : (opts.warn ? 'warn' : 'info');
      var icons = { danger: 'fa-triangle-exclamation', warn: 'fa-circle-exclamation', info: 'fa-circle-question' };
      backdrop.innerHTML =
        '<div class="modal">' +
          '<div class="modal-body">' +
            '<div class="confirm-icon ' + kind + '"><i class="fa-solid ' + icons[kind] + '"></i></div>' +
            '<h3>' + escape(opts.title || 'Are you sure?') + '</h3>' +
            '<p>' + escape(opts.message || '') + '</p>' +
            '<div class="flex" style="justify-content:center;gap:10px;margin-top:20px;">' +
              '<button type="button" class="btn btn-secondary" data-act="cancel">Cancel</button>' +
              '<button type="button" class="btn ' + (opts.danger ? 'btn-danger' : 'btn-primary') + '" data-act="ok">' +
                escape(opts.confirmText || 'Confirm') + '</button>' +
            '</div>' +
          '</div>' +
        '</div>';
      backdrop.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-act]');
        if (e.target === backdrop || btn) {
          document.body.removeChild(backdrop);
          resolve(btn ? btn.getAttribute('data-act') === 'ok' : false);
        }
      });
      document.body.appendChild(backdrop);
    });
  }

  /* ---------- Prompt dialog (single input, Promise based) ---------- */
  function promptDialog(opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var backdrop = document.createElement('div');
      backdrop.className = 'modal-backdrop open';
      backdrop.innerHTML =
        '<div class="modal">' +
          '<div class="modal-head"><h3>' + escape(opts.title || 'Input') + '</h3>' +
          '<button type="button" class="modal-close"><i class="fa-solid fa-xmark"></i></button></div>' +
          '<div class="modal-body">' +
            (opts.message ? '<p class="text-muted mb-16" style="font-size:13.5px;">' + escape(opts.message) + '</p>' : '') +
            '<div class="field"><input type="' + (opts.type || 'text') + '" value="' + escape(opts.value || '') +
              '" placeholder="' + escape(opts.placeholder || '') + '" autocomplete="off"></div>' +
          '</div>' +
          '<div class="modal-foot">' +
            '<button type="button" class="btn btn-secondary" data-act="cancel">Cancel</button>' +
            '<button type="button" class="btn btn-primary" data-act="ok">' + escape(opts.confirmText || 'OK') + '</button>' +
          '</div>' +
        '</div>';
      var input = backdrop.querySelector('input');
      function done(act) {
        document.body.removeChild(backdrop);
        resolve(act === 'ok' ? input.value : null);
      }
      backdrop.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-act]');
        if (e.target === backdrop || btn) done(btn ? btn.getAttribute('data-act') : 'cancel');
      });
      input.addEventListener('keydown', function (e) { if (e.key === 'Enter') done('ok'); });
      document.body.appendChild(backdrop);
      setTimeout(function () { input.focus(); }, 30);
    });
  }

  /* ---------- Badges ---------- */
  function statusBadge(statusKey) {
    var map = {
      paid: ['badge-green', 'PAID', 'fa-circle-check'],
      partial: ['badge-amber', 'PARTIAL', 'fa-circle-half-stroke'],
      unpaid: ['badge-red', 'UNPAID', 'fa-circle-xmark'],
      present: ['badge-green', 'PRESENT', 'fa-user-check'],
      absent: ['badge-red', 'ABSENT', 'fa-user-xmark'],
      late: ['badge-amber', 'LATE', 'fa-clock'],
      excused: ['badge-blue', 'EXCUSED', 'fa-user-shield'],
      not_marked: ['badge-grey', 'NOT MARKED', 'fa-circle-minus'],
      active: ['badge-green', 'ACTIVE', 'fa-circle-check'],
      suspended: ['badge-amber', 'SUSPENDED', 'fa-circle-pause'],
      graduated: ['badge-blue', 'GRADUATED', 'fa-graduation-cap'],
      not_due: ['badge-grey', 'NOT DUE', 'fa-calendar-minus'],
      paid_label: ['badge-green', 'PAID', 'fa-circle-check']
    };
    var m = map[statusKey];
    if (!m) return '<span class="badge badge-grey">' + escape(statusKey) + '</span>';
    return '<span class="badge ' + m[0] + '"><i class="fa-solid ' + m[2] + '"></i>' + m[1] + '</span>';
  }

  function avatar(name, color, size) {
    var initials = String(name || '?').split(/\s+/).map(function (w) { return w[0] || ''; }).slice(0, 2).join('').toUpperCase();
    var style = 'background:' + (color || '#2456c7') + ';' + (size ? 'width:' + size + 'px;height:' + size + 'px;font-size:' + Math.round(size * 0.36) + 'px;' : '');
    return '<span class="avatar" style="' + style + '">' + escape(initials) + '</span>';
  }

  /* ---------- Empty state ---------- */
  function emptyState(icon, title, msg, actionHtml) {
    return '<div class="empty-state">' +
      '<div class="empty-ico"><i class="fa-solid ' + (icon || 'fa-inbox') + '"></i></div>' +
      '<h3>' + escape(title || 'Nothing here yet') + '</h3>' +
      '<p>' + escape(msg || '') + '</p>' +
      (actionHtml ? actionHtml : '') +
    '</div>';
  }

  function statCard(icon, iconClass, value, label) {
    return '<div class="stat-card">' +
      '<div class="stat-ico ' + (iconClass || 'navy') + '"><i class="fa-solid ' + icon + '"></i></div>' +
      '<div><div class="stat-val">' + value + '</div><div class="stat-lbl">' + escape(label) + '</div></div>' +
    '</div>';
  }

  /* ---------- Form helpers ---------- */
  /* Collect values of inputs inside an element; returns plain object. */
  function formValues(root) {
    var out = {};
    var els = root.querySelectorAll('[name]');
    els.forEach(function (el) {
      if (el.type === 'checkbox') { out[el.name] = el.checked; return; }
      if (el.type === 'radio') { if (el.checked) out[el.name] = el.value; return; }
      out[el.name] = el.value;
    });
    return out;
  }

  function setFieldError(field, hasError) {
    if (!field) return;
    if (hasError) { field.classList.add('invalid'); field.closest('.field') && field.closest('.field').classList.add('invalid'); }
    else { field.classList.remove('invalid'); field.closest('.field') && field.closest('.field').classList.remove('invalid'); }
  }

  function clearFormErrors(root) {
    root.querySelectorAll('.invalid').forEach(function (el) { el.classList.remove('invalid'); });
  }

  function fieldHTML(label, inputHTML, opts) {
    opts = opts || {};
    return '<div class="field">' +
      '<label>' + escape(label) + (opts.required ? ' <span class="req">*</span>' : '') + '</label>' +
      inputHTML +
      (opts.hint ? '<div class="hint">' + escape(opts.hint) + '</div>' : '') +
      (opts.error ? '<div class="err-msg">' + escape(opts.error) + '</div>' : '') +
    '</div>';
  }

  function searchFilter(list, query, fields) {
    if (!query) return list;
    var q = String(query).toLowerCase().trim();
    return list.filter(function (item) {
      return fields.some(function (f) {
        return String(item[f] !== undefined ? item[f] : f).toLowerCase().indexOf(q) !== -1;
      });
    });
  }

  function fmtMoney(n) { return money(n); }

  PH5.ui = {
    escape: escape, money: money, fmtMoney: money,
    fmtDate: fmtDate, fmtDateTime: fmtDateTime, timeAgo: timeAgo,
    toast: toast, openModal: openModal, closeModal: closeModal,
    confirmDialog: confirmDialog, promptDialog: promptDialog,
    statusBadge: statusBadge, avatar: avatar, emptyState: emptyState,
    statCard: statCard, formValues: formValues,
    setFieldError: setFieldError, clearFormErrors: clearFormErrors,
    fieldHTML: fieldHTML, searchFilter: searchFilter
  };
})();
