'use strict';

const REQUIRED_AT_STARTUP = [
  'MONGODB_URI',
  'JWT_SECRET',
  'CORS_ORIGINS',
  'USER_APP_URL',
  'STAFF_USERNAME',
  'STAFF_PASSWORD_HASH',
];

function isMissing(name) {
  const value = process.env[name];
  return typeof value !== 'string' || value.trim() === '';
}

/**
 * Database configuration gate.
 * There is NO silent in-memory fallback: a missing/invalid MONGODB_URI is a hard failure.
 */
function requireDbConfig() {
  if (isMissing('MONGODB_URI')) {
    const err = new Error(
      'MONGODB_URI is not configured. Refusing to start without an explicit database connection.'
    );
    err.code = 'DB_CONFIG_MISSING';
    err.status = 500;
    err.publicMessage = 'Database configuration missing.';
    throw err;
  }
  const uri = process.env.MONGODB_URI.trim();
  if (!/^mongodb(\+srv)?:\/\//i.test(uri)) {
    const err = new Error('MONGODB_URI must start with mongodb:// or mongodb+srv://');
    err.code = 'DB_CONFIG_INVALID';
    err.status = 500;
    err.publicMessage = 'Database configuration invalid.';
    throw err;
  }
  return uri;
}

/** Fail fast on any missing required runtime environment variable. */
function assertRuntimeEnv() {
  const missingList = REQUIRED_AT_STARTUP.filter(isMissing);
  if (missingList.length > 0) {
    const err = new Error(`Missing required environment variables: ${missingList.join(', ')}`);
    err.code = 'ENV_CONFIG_MISSING';
    err.status = 500;
    err.publicMessage = 'Server configuration incomplete.';
    throw err;
  }
}

function corsOrigins() {
  return (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

module.exports = { requireDbConfig, assertRuntimeEnv, corsOrigins, isMissing };
