'use strict';

const mongoose = require('mongoose');
const Certificate = require('../models/Certificate');
const { escapeRegExp } = require('./sanitize');

/**
 * Resolve a certificate by any accepted identifier:
 *  - MongoDB _id (ObjectId)
 *  - exact certificateId (compact "BMIT/2026/101000015" or spaced "BMIT / 2026 / ...")
 *  - exact marksheetNumber
 *  - bare trailing number ("101000015" matches "BMIT/2026/101000015")
 */
async function resolveCertificate(rawId) {
  if (typeof rawId !== 'string') return null;
  const id = rawId.trim();
  if (!id || id.length > 300) return null;

  if (mongoose.isValidObjectId(id)) {
    const byOid = await Certificate.findById(id);
    if (byOid) return byOid;
  }

  const compact = id.replace(/\s+/g, '');
  const candidates = [id, compact];

  const exact = await Certificate.findOne({
    $or: [{ certificateId: { $in: candidates } }, { marksheetNumber: { $in: candidates } }],
  });
  if (exact) return exact;

  if (/^[A-Za-z0-9_-]{1,64}$/.test(compact)) {
    const bySuffix = await Certificate.findOne({
      certificateId: { $regex: `(^|[\\s\\/])${escapeRegExp(compact)}$` },
    });
    if (bySuffix) return bySuffix;
  }

  return null;
}

module.exports = { resolveCertificate };
