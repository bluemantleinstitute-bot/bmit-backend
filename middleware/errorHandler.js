'use strict';

const { httpError } = require('../utils/httpError');

const KNOWN_CODES = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  429: 'RATE_LIMITED',
  500: 'INTERNAL_ERROR',
  503: 'SERVICE_UNAVAILABLE',
};

function notFoundHandler(req, res) {
  const route = `${req.method} ${String(req.originalUrl || req.url).slice(0, 200)}`;
  res.status(404).json({
    success: false,
    error: { code: 'NOT_FOUND', message: `Route not found: ${route}` },
  });
}

function messageFor(err, status, isProd) {
  if (err && err.publicMessage) return err.publicMessage;
  if (err && err.type === 'entity.too.large') return 'Request body too large.';
  if (err && err.type === 'entity.parse.failed') {
    return isProd ? 'Malformed JSON body.' : err.message;
  }
  if (status >= 500) return 'Internal server error.';
  if (isProd) return status === 413 ? 'Request body too large.' : 'Invalid request.';
  return (err && err.message) || 'Request failed.';
}

function codeFor(err, status) {
  if (err && typeof err.code === 'string' && /^[A-Z_]+$/.test(err.code) && err.code !== 'ERR') {
    if (status < 500) return err.code;
    if (KNOWN_CODES[status] !== 'INTERNAL_ERROR') return err.code;
  }
  if (err && err.type === 'entity.too.large') return 'PAYLOAD_TOO_LARGE';
  if (err && err.type === 'entity.parse.failed') return 'BAD_REQUEST';
  return KNOWN_CODES[status] || 'INTERNAL_ERROR';
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const status = Number(err.status || err.statusCode || 500);
  const isProd = process.env.NODE_ENV === 'production';

  // Full detail stays in server logs only — never in the response body.
  // eslint-disable-next-line no-console
  console.error(`[error] ${req.method} ${req.originalUrl} -> ${status}:`, err.message);

  if (res.headersSent) return;

  const payload = {
    success: false,
    error: {
      code: codeFor(err, status),
      message: messageFor(err, status, isProd),
    },
  };

  res.status(status).json(payload);
}

module.exports = { notFoundHandler, errorHandler, httpError };
