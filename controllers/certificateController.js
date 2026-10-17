'use strict';

const Certificate = require('../models/Certificate');
const Counter = require('../models/Counter');
const { sanitizeCertificateInput } = require('../utils/certificateInput');
const { resolveCertificate } = require('../utils/resolveCertificate');
const { generateCertificateId } = require('../utils/certificateId');
const { escapeRegExp } = require('../utils/sanitize');
const { buildVerificationUrl } = require('../utils/verificationUrl');
const { httpError } = require('../utils/httpError');
const { ALLOWED_STATUS } = require('../utils/sanitize');

function present(cert) {
  const obj = typeof cert.toJSON === 'function' ? cert.toJSON() : { ...cert };
  obj.verificationUrl = buildVerificationUrl(obj.certificateId);
  return obj;
}

async function createWithRetry(data) {
  let lastErr = null;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const certificateId = await generateCertificateId();
    try {
      return await Certificate.create({ ...data, certificateId });
    } catch (err) {
      if (err && err.code === 11000) {
        const field = Object.keys(err.keyPattern || {})[0] || 'field';
        if (field !== 'certificateId') {
          throw httpError(409, 'DUPLICATE_RECORD', `A certificate with this ${field} already exists.`);
        }
        lastErr = err;
        continue;
      }
      throw err;
    }
  }
  if (lastErr) {
    throw httpError(409, 'DUPLICATE_RECORD', 'Certificate ID collision. Please retry.');
  }
  throw httpError(500, 'ID_ALLOCATION_FAILED', 'Unable to allocate a unique Certificate ID.');
}

/** GET /api/certificates — staff list (search / status / pagination) */
async function list(req, res) {
  const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
  const status = typeof req.query.status === 'string' ? req.query.status.trim() : '';
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);

  const query = {};
  if (status) {
    const normalized = status.toUpperCase();
    if (!ALLOWED_STATUS.includes(normalized)) {
      throw httpError(400, 'VALIDATION_ERROR', `status must be one of: ${ALLOWED_STATUS.join(', ')}.`);
    }
    query.status = normalized;
  }
  if (search) {
    const safe = escapeRegExp(search.slice(0, 100));
    query.$or = [
      { studentName: { $regex: safe, $options: 'i' } },
      { certificateId: { $regex: safe, $options: 'i' } },
      { course: { $regex: safe, $options: 'i' } },
      { marksheetNumber: { $regex: safe, $options: 'i' } },
    ];
  }

  const total = await Certificate.countDocuments(query);
  const certificates = await Certificate.find(query)
    .sort({ createdAt: -1 })
    .skip((page - 1) * limit)
    .limit(limit);

  res.json({
    success: true,
    data: {
      certificates: certificates.map(present),
      pagination: { total, page, totalPages: Math.ceil(total / limit), limit },
    },
  });
}

/** POST /api/certificates — create (server generates the immutable Certificate ID) */
async function create(req, res) {
  const data = sanitizeCertificateInput(req.body, { forUpdate: false });
  const doc = await createWithRetry(data);
  res.status(201).json({
    success: true,
    data: present(doc),
    message: 'Certificate created successfully.',
  });
}

/** POST /api/certificates/bulk — batch create */
async function bulk(req, res) {
  const body = req.body;
  const items = Array.isArray(body)
    ? body
    : body && Array.isArray(body.certificates)
      ? body.certificates
      : null;

  if (!items) {
    throw httpError(
      400,
      'VALIDATION_ERROR',
      'Expected an array of certificates (JSON array or { certificates: [...] }).'
    );
  }
  if (items.length === 0) {
    throw httpError(400, 'VALIDATION_ERROR', 'Certificate list is empty.');
  }
  if (items.length > 50) {
    throw httpError(400, 'VALIDATION_ERROR', 'Maximum 50 certificates per bulk request.');
  }

  const sanitized = items.map((item, index) => {
    try {
      return sanitizeCertificateInput(item, { forUpdate: false });
    } catch (err) {
      err.publicMessage = `Record ${index + 1}: ${err.publicMessage || err.message}`;
      throw err;
    }
  });

  const created = [];
  for (const data of sanitized) {
    created.push(present(await createWithRetry(data)));
  }

  res.status(201).json({
    success: true,
    data: { created, count: created.length },
    message: `${created.length} certificate(s) created.`,
  });
}

/** GET /api/certificates/:id — by _id, full/compact/bare certificate ID or marksheet number */
async function getOne(req, res) {
  const cert = await resolveCertificate(req.params.id);
  if (!cert) throw httpError(404, 'CERTIFICATE_NOT_FOUND', 'Certificate not found.');
  res.json({ success: true, data: present(cert) });
}

/** PUT /api/certificates/:id — update; certificateId is ignored (immutable) */
async function update(req, res) {
  const cert = await resolveCertificate(req.params.id);
  if (!cert) throw httpError(404, 'CERTIFICATE_NOT_FOUND', 'Certificate not found.');

  const data = sanitizeCertificateInput(req.body, { forUpdate: true });
  delete data.certificateId;
  delete data._id;

  const updated = await Certificate.findByIdAndUpdate(cert._id, data, {
    returnDocument: 'after',
    runValidators: true,
  });
  res.json({
    success: true,
    data: present(updated),
    message: 'Certificate updated. Certificate ID and QR URL are unchanged.',
  });
}

/** DELETE /api/certificates/:id — soft revocation (records are never hard-deleted, ADR-004) */
async function remove(req, res) {
  const cert = await resolveCertificate(req.params.id);
  if (!cert) throw httpError(404, 'CERTIFICATE_NOT_FOUND', 'Certificate not found.');

  if (cert.status === 'REVOKED') {
    return res.json({
      success: true,
      data: present(cert),
      message: 'Certificate is already revoked.',
    });
  }

  cert.status = 'REVOKED';
  await cert.save();
  return res.json({
    success: true,
    data: present(cert),
    message: 'Certificate revoked (soft delete). Records are never permanently removed.',
  });
}

module.exports = { list, create, bulk, getOne, update, remove };
