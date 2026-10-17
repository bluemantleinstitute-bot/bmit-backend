'use strict';

const crypto = require('crypto');

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, keylen: 64 };
const PREFIX = 'scrypt';

/** Hash a password with node:crypto scrypt. Format: scrypt$<salt_hex>$<hash_hex> */
function hashPassword(password) {
  if (typeof password !== 'string' || password.length === 0) {
    throw new Error('Password must be a non-empty string.');
  }
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(password, salt, SCRYPT_PARAMS.keylen, {
    N: SCRYPT_PARAMS.N,
    r: SCRYPT_PARAMS.r,
    p: SCRYPT_PARAMS.p,
  });
  return `${PREFIX}$${salt.toString('hex')}$${derived.toString('hex')}`;
}

/** Constant-time verification. Never throws on malformed stored values. */
function verifyPassword(password, stored) {
  if (typeof password !== 'string' || typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== PREFIX) return false;
  const salt = Buffer.from(parts[1], 'hex');
  const expected = Buffer.from(parts[2], 'hex');
  if (salt.length === 0 || expected.length === 0) return false;
  let derived;
  try {
    derived = crypto.scryptSync(password, salt, expected.length, {
      N: SCRYPT_PARAMS.N,
      r: SCRYPT_PARAMS.r,
      p: SCRYPT_PARAMS.p,
    });
  } catch {
    return false;
  }
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

/** Length-independent constant-time string comparison (used for usernames). */
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

module.exports = { hashPassword, verifyPassword, safeEqual };
