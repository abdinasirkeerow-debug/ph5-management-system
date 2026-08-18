/* ==========================================================================
   app.js — Express application factory (no listen here; server.js and the
   tests start it). Serves the frontend and the REST API from one server.
   ========================================================================== */
'use strict';

const express = require('express');
const helmet = require('helmet');
const session = require('express-session');
const rateLimit = require('express-rate-limit');
const config = require('./config/env');
const { getDb } = require('./database/db');
const { SQLiteSessionStore } = require('./database/session-store');
const routes = require('./routes');
const { notFoundApi, errorHandler } = require('./middleware/errors');

function createApp() {
  const db = getDb();
  const app = express();
  // Trust the reverse proxy (Railway) for secure cookies + req.ip only in
  // production; locally the client connects directly, so no proxy to trust.
  app.set('trust proxy', config.isProd ? 1 : false);

  /* Security headers (CSP disabled: the frontend uses Google Fonts, the
     Font Awesome CDN and an inline bootstrap script — it is served locally). */
  app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
  }));

  app.use(express.json({ limit: '512kb' }));

  /* Persistent, HTTP-only, SameSite=Strict session cookies. */
  app.use(session({
    name: config.sessionCookieName,
    secret: config.sessionSecret,
    store: new SQLiteSessionStore(),
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: 'strict',
      secure: config.isProd,
      maxAge: config.sessionMaxAgeMs
    }
  }));

  /* Rate limiting. */
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many sign-in attempts. Please try again later.' }
  });
  app.use('/api/auth/login', loginLimiter);

  const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 1000,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests. Please try again later.' }
  });
  app.use('/api', apiLimiter);

  /* Frontend (index.html, app.html, css/, js/) from the project root. */
  app.use(express.static(config.root));

  /* REST API. */
  app.use('/api', routes);
  app.use('/api', notFoundApi);

  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
