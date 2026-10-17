'use strict';

const { httpError } = require('./httpError');

/** Remove HTML tags, angle brackets and control characters, collapse whitespace. */
function strip(value) {
  return String(value)
    .replace(/<[^>]*>/g, '')
    .replace(/[<>]/g, '')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function text(value, field, options = {}) {
  const { required = true, max = 300 } = options;
  if (value === undefined || value === null || value === '') {
    if (required) throw httpError(400, 'VALIDATION_ERROR', `${field} is required.`);
    return undefined;
  }
  if (typeof value !== 'string') {
    throw httpError(400, 'VALIDATION_ERROR', `${field} must be a string.`);
  }
  const cleaned = strip(value);
  if (!cleaned) {
    if (required) throw httpError(400, 'VALIDATION_ERROR', `${field} is required.`);
    return undefined;
  }
  if (cleaned.length > max) {
    throw httpError(400, 'VALIDATION_ERROR', `${field} must be at most ${max} characters.`);
  }
  return cleaned;
}

function dateValue(value, field, options = {}) {
  const { required = true } = options;
  if (value === undefined || value === null || value === '') {
    if (required) throw httpError(400, 'VALIDATION_ERROR', `${field} is required.`);
    return undefined;
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw httpError(400, 'VALIDATION_ERROR', `${field} must be a valid date.`);
    }
    return value;
  }
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw httpError(400, 'VALIDATION_ERROR', `${field} must be a date string.`);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw httpError(400, 'VALIDATION_ERROR', `${field} must be a valid date.`);
  }
  const year = parsed.getUTCFullYear();
  if (year < 1900 || year > 2100) {
    throw httpError(400, 'VALIDATION_ERROR', `${field} is out of the accepted range.`);
  }
  return parsed;
}

const ALLOWED_STATUS = ['VALID', 'REVOKED', 'SUSPENDED'];

function statusValue(value, field = 'status', options = {}) {
  const { required = false } = options;
  if (value === undefined || value === null || value === '') {
    if (required) throw httpError(400, 'VALIDATION_ERROR', `${field} is required.`);
    return undefined;
  }
  if (typeof value !== 'string') {
    throw httpError(400, 'VALIDATION_ERROR', `${field} must be a string.`);
  }
  const normalized = strip(value).toUpperCase();
  if (!ALLOWED_STATUS.includes(normalized)) {
    throw httpError(
      400,
      'VALIDATION_ERROR',
      `${field} must be one of: ${ALLOWED_STATUS.join(', ')}.`
    );
  }
  return normalized;
}

/**
 * Sanitize a certificate verification ID coming from a URL path.
 * Returns the normalized ID, null when unusable, or throws 400 when excessively long.
 */
function verifyId(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.length > 256) {
    throw httpError(400, 'INVALID_ID', 'Certificate ID is too long.');
  }
  const noTags = strip(trimmed);
  const allowed = noTags.replace(/[^A-Za-z0-9_\-\/ ]/g, '');
  const normalized = allowed.replace(/\s+/g, ' ').trim();
  return normalized || null;
}

function assertObject(body, label = 'Request body') {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw httpError(400, 'VALIDATION_ERROR', `${label} must be a JSON object.`);
  }
  return body;
}

module.exports = {
  strip,
  escapeRegExp,
  text,
  dateValue,
  statusValue,
  verifyId,
  assertObject,
  ALLOWED_STATUS,
};
