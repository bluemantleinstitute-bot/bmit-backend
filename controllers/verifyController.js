'use strict';

const Certificate = require('../models/Certificate');
const { verifyId, escapeRegExp } = require('../utils/sanitize');
const { buildVerificationUrl } = require('../utils/verificationUrl');
const { httpError } = require('../utils/httpError');

/**
 * GET /api/verify/*splat
 * Accepts:
 *   /api/verify/BMIT/2026/101000015   (raw slash segments)
 *   /api/verify/BMIT%2F2026%2F101000015 (encoded slash, single segment)
 *   /api/verify/101000015             (bare numeric)
 *   /api/verify/BMIT / 2026 / 101000015 (spaced marksheet style)
 */
async function verify(req, res) {
  const splat = req.params.splat;
  const raw = Array.isArray(splat) ? splat.join('/') : String(splat || '');

  const id = verifyId(raw);
  if (!id) throw httpError(400, 'INVALID_ID', 'Invalid certificate ID format.');

  const compact = id.replace(/\s+/g, '');
  const candidates = [id, compact];

  const conditions = [
    { certificateId: { $in: candidates } },
    { marksheetNumber: { $in: candidates } },
  ];
  if (/^[A-Za-z0-9_-]{1,64}$/.test(compact)) {
    conditions.push({
      certificateId: { $regex: `(^|[\\s\\/])${escapeRegExp(compact)}$` },
    });
  }

  let certificate;
  try {
    certificate = await Certificate.findOne({ $or: conditions });
  } catch {
    throw httpError(
      503,
      'SERVICE_ERROR',
      'Verification service is temporarily unavailable. Please try again shortly.'
    );
  }

  if (!certificate) {
    throw httpError(
      404,
      'CERTIFICATE_NOT_FOUND',
      `No official certificate record found for verification ID: ${id.slice(0, 64)}`
    );
  }

  const message =
    certificate.status === 'REVOKED'
      ? 'This certificate has been officially revoked.'
      : certificate.status === 'SUSPENDED'
        ? 'This certificate has been suspended and is pending registrar review.'
        : 'Certificate verified successfully.';

  // Public projection: never expose _id, remarks or internal timestamps.
  const doc = certificate.toJSON();
  const data = {
    certificateId: doc.certificateId,
    studentName: doc.studentName,
    course: doc.course,
    marksheetNumber: doc.marksheetNumber,
    issueDate: doc.issueDate,
    result: doc.result,
    status: doc.status,
    institutionName: doc.institutionName,
    affiliation: doc.affiliation,
    contactDetails: doc.contactDetails,
    verificationUrl: buildVerificationUrl(doc.certificateId),
  };

  res.json({ success: true, data, message });
}

module.exports = { verify };
