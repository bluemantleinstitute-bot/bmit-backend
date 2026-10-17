'use strict';

const crypto = require('crypto');
const Counter = require('../models/Counter');
const Certificate = require('../models/Certificate');

const ID_PATTERN = /^BMIT\/\d{4}\/\d{9}$/;

/**
 * Allocate the next certificate number for the current year using an atomic
 * database counter (no Math.random anywhere). Returns BMIT/YYYY/NNNNNNNNN.
 */
async function nextCertificateNumber() {
  const year = new Date().getUTCFullYear();
  const key = `cert-${year}`;
  const counter = await Counter.findOneAndUpdate(
    { _id: key },
    { $inc: { seq: 1 } },
    { returnDocument: 'after', upsert: true, setDefaultsOnInsert: true }
  );
  const seq = Number.isInteger(counter.seq) ? counter.seq : 1;
  // Keep the numeric part at 9 digits: 100000000 .. 999999999
  const numeric = 100000000 + (seq % 900000000);
  return { year, certificateId: `BMIT/${year}/${numeric}` };
}

/** Cryptographic fallback (never Math.random) if the counter is exhausted/collides. */
async function randomCertificateNumber() {
  const year = new Date().getUTCFullYear();
  const numeric = crypto.randomInt(100000000, 1000000000);
  return { year, certificateId: `BMIT/${year}/${numeric}` };
}

/**
 * Generate a certificate ID that is guaranteed not to exist yet:
 * counter first, crypto random fallback, unique index as the final authority.
 */
async function generateCertificateId() {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate =
      attempt < 5 ? await nextCertificateNumber() : await randomCertificateNumber();
    if (ID_PATTERN.test(candidate.certificateId)) {
      const clash = await Certificate.exists({ certificateId: candidate.certificateId });
      if (!clash) return candidate.certificateId;
    }
  }
  const err = new Error('Unable to allocate a unique Certificate ID.');
  err.code = 'ID_ALLOCATION_FAILED';
  err.status = 500;
  err.publicMessage = 'Unable to allocate a unique Certificate ID. Please retry.';
  throw err;
}

function isValidCertificateIdFormat(id) {
  return typeof id === 'string' && ID_PATTERN.test(id);
}

module.exports = { generateCertificateId, isValidCertificateIdFormat, ID_PATTERN };
