'use strict';

const jwt = require('jsonwebtoken');
const { httpError } = require('../utils/httpError');

const TOKEN_TTL = '8h';
const TOKEN_TTL_SECONDS = 8 * 60 * 60;

function signToken(username) {
  return jwt.sign({ sub: username, role: 'staff' }, process.env.JWT_SECRET, {
    expiresIn: TOKEN_TTL,
    issuer: 'bmit-backend',
  });
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [type, token] = header.split(' ');
  if (type !== 'Bearer' || !token || typeof token !== 'string') {
    return next(
      httpError(401, 'UNAUTHORIZED', 'Authentication required. Please sign in.')
    );
  }
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET, { issuer: 'bmit-backend' });
    req.staff = { username: payload.sub, role: payload.role || 'staff' };
    return next();
  } catch {
    return next(
      httpError(401, 'INVALID_TOKEN', 'Session expired or invalid. Please sign in again.')
    );
  }
}

module.exports = { signToken, requireAuth, TOKEN_TTL, TOKEN_TTL_SECONDS };
