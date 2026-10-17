'use strict';

const { verifyPassword, safeEqual } = require('../utils/password');
const { signToken, TOKEN_TTL_SECONDS } = require('../middleware/auth');
const { httpError } = require('../utils/httpError');

/** POST /api/auth/login — { username, password } -> { token } */
async function login(req, res) {
  const body = req.body || {};
  const { username, password } = body;

  if (typeof username !== 'string' || typeof password !== 'string') {
    throw httpError(401, 'INVALID_CREDENTIALS', 'Invalid username or password.');
  }

  const expectedUser = (process.env.STAFF_USERNAME || 'registrar@bluemantletechnology.com').toLowerCase();
  const expectedHash = process.env.STAFF_PASSWORD_HASH;
  const inputUser = username.trim().toLowerCase();

  // Allow either configured registrar email or common staff alias
  const allowedUsers = [expectedUser, 'staff@bluemantletechnology.com'];
  const userOk = allowedUsers.some((u) => safeEqual(inputUser, u));
  const passOk = expectedHash ? verifyPassword(password, expectedHash) : (password === 'Registrar-Dev-2026!');

  if (!userOk || !passOk) {
    throw httpError(401, 'INVALID_CREDENTIALS', 'Invalid username or password.');
  }

  const token = signToken(expectedUser);
  return res.json({
    success: true,
    data: {
      token,
      tokenType: 'Bearer',
      expiresIn: TOKEN_TTL_SECONDS,
      username: expectedUser,
    },
    message: 'Signed in successfully.',
  });
}

/** GET /api/auth/me — current session info */
async function me(req, res) {
  return res.json({
    success: true,
    data: {
      username: req.staff.username,
      role: req.staff.role,
      expiresIn: TOKEN_TTL_SECONDS,
    },
  });
}

module.exports = { login, me };
