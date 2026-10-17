'use strict';

const rateLimit = require('express-rate-limit');

function jsonHandler(req, res, next, options) {
  res.status(options.statusCode || 429).json({
    success: false,
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many requests. Please try again later.',
    },
  });
}

/** 5 failed login attempts per 15 minutes per IP (successful logins are not counted). */
function createLoginLimiter() {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 5,
    skipSuccessfulRequests: true,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: jsonHandler,
    validate: { xForwardedForHeader: false },
  });
}

/** 60 verification requests per minute per IP (public scraping protection). */
function createVerifyLimiter() {
  return rateLimit({
    windowMs: 60 * 1000,
    limit: 60,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: jsonHandler,
    validate: { xForwardedForHeader: false },
  });
}

module.exports = { createLoginLimiter, createVerifyLimiter };
