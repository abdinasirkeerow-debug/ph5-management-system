/* ==========================================================================
   errors.js — 404 for unknown API routes and the global error handler.
   Stack traces, SQL and internal paths are never exposed to the browser.
   ========================================================================== */
'use strict';

function notFoundApi(req, res) {
  res.status(404).json({ error: 'Not found.' });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  let status = err.status || 500;
  if (status < 400 || status >= 600) status = 500;
  if (status >= 500) {
    // Server-side log only — never sent to the client.
    console.error('[error]', err);
  }
  const message = status >= 500
    ? 'An unexpected error occurred. Please try again.'
    : (err.message || 'Request failed.');
  res.status(status).json({ error: message });
}

module.exports = { notFoundApi, errorHandler };
