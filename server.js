/* ==========================================================================
   server.js — Entry point. Starts the Express server (frontend + API).
   Run with:  npm start   |   npm run dev   (auto-restart via --watch)
   ========================================================================== */
'use strict';

require('dotenv').config();
const config = require('./backend/config/env');
const { createApp } = require('./backend/app');
const { closeDb } = require('./backend/database/db');

const app = createApp();

// Bind 0.0.0.0 so Railway/Nixpacks can route external traffic into the container.
const server = app.listen(config.port, config.host, () => {
  console.log('='.repeat(60));
  console.log('  Public Health Batch Five Management System — Zamzam University');
  console.log('  Serving frontend + API at  http://' + config.host + ':' + config.port);
  console.log('  Database: ' + config.dbPath);
  console.log('='.repeat(60));
});

/* Graceful shutdown — close the HTTP server (draining in-flight requests) and
   close the SQLite connection so WAL data is checkpointed. Railway sends
   SIGTERM on restarts/deploys; without this, sessions/audit writes can be lost. */
function shutdown(signal) {
  console.log('\nReceived ' + signal + ' — shutting down gracefully...');
  server.close(() => {
    closeDb();
    process.exit(0);
  });
  // Hard-exit safety net in case a request never finishes.
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
