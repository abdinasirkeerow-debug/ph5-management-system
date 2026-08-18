/* ==========================================================================
   validate.js — Zod body-validation middleware.
   ========================================================================== */
'use strict';

const { z } = require('zod');
const { httpError } = require('../utils/helpers');

function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const issue = result.error.issues[0];
      const msg = issue && issue.message ? issue.message : 'Invalid input.';
      return next(httpError(400, msg));
    }
    req.body = result.data;
    next();
  };
}

module.exports = { validate, z };
