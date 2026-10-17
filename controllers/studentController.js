'use strict';

const Certificate = require('../models/Certificate');
const { escapeRegExp } = require('../utils/sanitize');
const { buildVerificationUrl } = require('../utils/verificationUrl');
const { httpError } = require('../utils/httpError');

function decorate(cert) {
  const obj = cert.toJSON();
  obj.verificationUrl = buildVerificationUrl(obj.certificateId);
  return obj;
}

/** GET /api/students — students aggregated from their certificates */
async function list(req, res) {
  const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
  const match = search
    ? { studentName: { $regex: escapeRegExp(search.slice(0, 100)), $options: 'i' } }
    : {};

  const students = await Certificate.aggregate([
    { $match: match },
    { $sort: { issueDate: -1, createdAt: -1 } },
    {
      $group: {
        _id: '$studentName',
        studentName: { $first: '$studentName' },
        certificateCount: { $sum: 1 },
        latestCertificateId: { $first: '$certificateId' },
        latestIssueDate: { $first: '$issueDate' },
        statuses: { $addToSet: '$status' },
      },
    },
    { $sort: { studentName: 1 } },
    { $limit: 200 },
  ]);

  res.json({ success: true, data: { students, count: students.length } });
}

/** GET /api/students/:id — :id is the student name (URL-encoded) */
async function detail(req, res) {
  const raw = req.params.id;
  if (typeof raw !== 'string' || !raw.trim() || raw.length > 200) {
    throw httpError(400, 'VALIDATION_ERROR', 'Invalid student identifier.');
  }
  const name = raw.trim();
  const certificates = await Certificate.find({
    studentName: { $regex: `^${escapeRegExp(name)}$`, $options: 'i' },
  }).sort({ issueDate: -1 });

  if (certificates.length === 0) {
    throw httpError(404, 'STUDENT_NOT_FOUND', 'No certificates found for this student.');
  }

  res.json({
    success: true,
    data: {
      studentName: certificates[0].studentName,
      certificateCount: certificates.length,
      certificates: certificates.map(decorate),
    },
  });
}

/**
 * DELETE /api/students/:id — permanently remove a student profile.
 *
 * Students are a projection of the `certificates` collection (grouped by
 * `studentName`), so deleting the profile means hard-deleting every
 * certificate that belongs to that name. This is the one destructive
 * operation in the system (ADR-004 covers certificate status only) and is
 * therefore auth-gated and audited through the returned count.
 */
async function destroy(req, res) {
  const raw = req.params.id;
  if (typeof raw !== 'string' || !raw.trim() || raw.length > 200) {
    throw httpError(400, 'VALIDATION_ERROR', 'Invalid student identifier.');
  }
  const name = raw.trim();
  const match = { studentName: { $regex: `^${escapeRegExp(name)}$`, $options: 'i' } };

  const certificates = await Certificate.find(match).select('certificateId studentName');
  if (certificates.length === 0) {
    throw httpError(404, 'STUDENT_NOT_FOUND', 'No certificates found for this student.');
  }

  const result = await Certificate.deleteMany(match);

  res.json({
    success: true,
    data: {
      studentName: certificates[0].studentName,
      deletedCertificates: result.deletedCount,
    },
  });
}

module.exports = { list, detail, destroy };
