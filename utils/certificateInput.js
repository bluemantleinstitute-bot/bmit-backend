'use strict';

const { text, dateValue, statusValue, assertObject } = require('./sanitize');
const { httpError } = require('./httpError');

const CREATE_REQUIRED = ['studentName', 'course', 'marksheetNumber', 'issueDate', 'result'];

/**
 * Whitelist + sanitize certificate input.
 * `certificateId` is NEVER read: the ID is server-generated and immutable.
 */
function sanitizeCertificateInput(body, options = {}) {
  const { forUpdate = false } = options;
  assertObject(body);

  const out = {};
  const fields = {
    studentName: () => text(body.studentName, 'studentName', { required: !forUpdate, max: 200 }),
    course: () => text(body.course, 'course', { required: !forUpdate, max: 200 }),
    marksheetNumber: () =>
      text(body.marksheetNumber, 'marksheetNumber', { required: !forUpdate, max: 100 }),
    issueDate: () => dateValue(body.issueDate, 'issueDate', { required: !forUpdate }),
    result: () => text(body.result, 'result', { required: !forUpdate, max: 100 }),
    status: () => statusValue(body.status),
    institutionName: () =>
      text(body.institutionName, 'institutionName', { required: false, max: 200 }),
    affiliation: () => text(body.affiliation, 'affiliation', { required: false, max: 200 }),
    contactDetails: () => text(body.contactDetails, 'contactDetails', { required: false, max: 200 }),
    remarks: () => text(body.remarks, 'remarks', { required: false, max: 1000 }),
  };

  if (forUpdate) {
    const updatable = ['studentName', 'course', 'marksheetNumber', 'issueDate', 'result', 'status', 'institutionName', 'affiliation', 'contactDetails', 'remarks'];
    const present = updatable.filter((key) => body[key] !== undefined);
    if (present.length === 0) {
      throw httpError(400, 'VALIDATION_ERROR', 'No updatable fields were provided.');
    }
    for (const key of present) {
      const value = fields[key]();
      if (value !== undefined) out[key] = value;
    }
    return out;
  }

  for (const key of CREATE_REQUIRED) {
    if (body[key] === undefined || body[key] === null || body[key] === '') {
      throw httpError(400, 'VALIDATION_ERROR', `${key} is required.`);
    }
  }
  for (const [key, read] of Object.entries(fields)) {
    const value = read();
    if (value !== undefined) out[key] = value;
  }
  return out;
}

module.exports = { sanitizeCertificateInput };
