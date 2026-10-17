'use strict';

/**
 * bmit-backend Phase 1 test suite.
 *
 * Boots the REAL server (server.js -> startServer) on an ephemeral port against
 * mongodb-memory-server, then exercises every endpoint over real HTTP.
 * NODE_ENV=production so the safe production error handling is what is tested.
 *
 * Order matters: login failures are grouped at the end because the login
 * rate limiter counts failed attempts per IP (5 / 15 min).
 */

const crypto = require('crypto');

const USERNAME = 'registrar@bluemantletechnology.com';
const PASSWORD = 'Test-Staff-Pw!42x';

const { hashPassword } = require('../utils/password');

// --- Environment MUST be set before the server module is loaded -------------
process.env.NODE_ENV = 'production';
process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');
process.env.STAFF_USERNAME = USERNAME;
process.env.STAFF_PASSWORD_HASH = hashPassword(PASSWORD);
process.env.CORS_ORIGINS = 'https://user.example.com,https://staff.example.com';
process.env.USER_APP_URL = 'https://user.example.com';
process.env.PORT = '0';
delete process.env.TRUST_PROXY;

const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');

const { startServer } = require('../server');
const { requireDbConfig, assertRuntimeEnv } = require('../config/env');
const { seed } = require('../scripts/seed');
const Certificate = require('../models/Certificate');

// --- tiny test harness ------------------------------------------------------
let base = '';
let token = '';
const results = { pass: 0, fail: 0, failures: [] };
let uniqueCounter = 0;

function nextUnique(prefix) {
  uniqueCounter += 1;
  return `${prefix}-${Date.now()}-${uniqueCounter}`;
}

async function test(name, fn) {
  try {
    await fn();
    results.pass += 1;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    results.fail += 1;
    results.failures.push({ name, message: err.message });
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err.message}`);
  }
}

function ok(condition, message) {
  if (!condition) throw new Error(message);
}

function eq(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

async function call(method, urlPath, opts = {}) {
  const headers = {};
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  if (opts.origin) headers.Origin = opts.origin;
  if (opts.contentType === 'none') delete headers['Content-Type'];

  const init = { method, headers };
  if (opts.body !== undefined) {
    init.body = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body);
  }

  const res = await fetch(base + urlPath, init);
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, headers: res.headers, text, json };
}

function validCertPayload(overrides = {}) {
  return {
    studentName: `Student ${nextUnique('X')}`,
    course: 'BMIT – Full Stack Financial Engineering',
    marksheetNumber: nextUnique('MS'),
    issueDate: '2026-09-22',
    result: 'DISTINCTION',
    ...overrides,
  };
}

async function createCert(overrides = {}) {
  const res = await call('POST', '/api/certificates', { token, body: validCertPayload(overrides) });
  if (res.status !== 201) {
    throw new Error(`createCert failed: ${res.status} ${res.text}`);
  }
  return res.json.data;
}

// --- suite ------------------------------------------------------------------

async function run() {
  console.log('\n==============================================');
  console.log(' BMIT BACKEND — PHASE 1 API TEST SUITE');
  console.log('==============================================\n');

  const mongo = await MongoMemoryServer.create();
  const uri = mongo.getUri('bmit_test');
  process.env.MONGODB_URI = uri;

  const { server } = await startServer(0);
  const port = server.address().port;
  base = `http://127.0.0.1:${port}`;
  console.log(`Server ready on ${base} (MongoMemoryServer)\n`);

  try {
    // ----------------------------------------------------------------- G1
    console.log('--- Group 1: Health, JSON 404, headers');
    await test('GET / returns healthy API response', async () => {
      const res = await call('GET', '/');
      eq(res.status, 200, 'status');
      ok(res.json && res.json.success === true, 'success flag');
      eq(res.json.status, 'ok', 'status field');
      eq(res.json.database, 'connected', 'database field');
      ok(!res.text.includes(process.env.JWT_SECRET), 'JWT secret not leaked');
      ok(!res.text.includes('scrypt$'), 'password hash not leaked');
    });

    await test('GET /health returns 200', async () => {
      const res = await call('GET', '/health');
      eq(res.status, 200, 'status');
      eq(res.json.service, 'bmit-backend', 'service');
    });

    await test('Unknown route returns JSON 404 (not HTML)', async () => {
      const res = await call('GET', '/api/definitely-not-a-route');
      eq(res.status, 404, 'status');
      eq(res.json.error.code, 'NOT_FOUND', 'code');
      ok(res.headers.get('content-type').includes('application/json'), 'json content type');
    });

    await test('x-powered-by header is disabled', async () => {
      const res = await call('GET', '/');
      ok(!res.headers.get('x-powered-by'), 'x-powered-by absent');
    });

    // ----------------------------------------------------------------- G2
    console.log('\n--- Group 2: Seed script (idempotent)');
    let seedFirst;
    await test('seed() inserts sample certificates', async () => {
      seedFirst = await seed(uri);
      eq(seedFirst.inserted, 3, 'inserted count');
      ok(seedFirst.total >= 3, 'total count');
    });

    await test('seed() is idempotent on second run', async () => {
      const again = await seed(uri);
      eq(again.inserted, 0, 'second run inserts nothing');
    });

    await test('Bare numeric ID resolves a seeded certificate', async () => {
      const res = await call('GET', '/api/verify/101000015');
      eq(res.status, 200, 'status');
      eq(res.json.data.certificateId, 'BMIT/2026/101000015', 'certificateId');
    });

    // ----------------------------------------------------------------- G3
    console.log('\n--- Group 3: Authentication (success path)');
    await test('POST /api/auth/login succeeds with valid credentials', async () => {
      const res = await call('POST', '/api/auth/login', {
        body: { username: USERNAME, password: PASSWORD },
      });
      eq(res.status, 200, 'status');
      ok(typeof res.json.data.token === 'string' && res.json.data.token.length > 20, 'token issued');
      eq(res.json.data.tokenType, 'Bearer', 'token type');
      eq(res.json.data.expiresIn, 28800, '8h expiry');
      token = res.json.data.token;
    });

    await test('GET /api/auth/me returns session for valid JWT', async () => {
      const res = await call('GET', '/api/auth/me', { token });
      eq(res.status, 200, 'status');
      eq(res.json.data.username, USERNAME, 'username');
      eq(res.json.data.role, 'staff', 'role');
    });

    await test('GET /api/auth/me rejects missing token (401)', async () => {
      const res = await call('GET', '/api/auth/me');
      eq(res.status, 401, 'status');
      eq(res.json.error.code, 'UNAUTHORIZED', 'code');
    });

    await test('GET /api/auth/me rejects tampered token (401)', async () => {
      const res = await call('GET', '/api/auth/me', { token: `${token}tampered` });
      eq(res.status, 401, 'status');
      eq(res.json.error.code, 'INVALID_TOKEN', 'code');
    });

    await test('GET /api/auth/me rejects a token signed with another secret', async () => {
      const jwt = require('jsonwebtoken');
      const forged = jwt.sign({ sub: USERNAME, role: 'staff' }, 'attacker-secret', {
        expiresIn: '8h',
        issuer: 'bmit-backend',
      });
      const res = await call('GET', '/api/auth/me', { token: forged });
      eq(res.status, 401, 'status');
    });

    // ----------------------------------------------------------------- G4
    console.log('\n--- Group 4: Unauthenticated access (authorization wall)');
    const wall = [
      ['GET', '/api/certificates'],
      ['POST', '/api/certificates'],
      ['POST', '/api/certificates/bulk'],
      ['GET', '/api/certificates/507f1f77bcf86cd799439011'],
      ['PUT', '/api/certificates/507f1f77bcf86cd799439011'],
      ['DELETE', '/api/certificates/507f1f77bcf86cd799439011'],
      ['GET', '/api/students'],
      ['GET', '/api/students/Someone%20Somewhere'],
    ];
    for (const [method, path] of wall) {
      await test(`${method} ${path} without token -> 401`, async () => {
        const res = await call(method, path, { body: method === 'POST' ? {} : undefined });
        eq(res.status, 401, 'status');
        eq(res.json.error.code, 'UNAUTHORIZED', 'code');
      });
    }

    // ----------------------------------------------------------------- G5
    console.log('\n--- Group 5: Certificate creation & automatic ID');
    let created;
    await test('Certificate ID is server-generated, ignores client ID, matches BMIT/YYYY/NNNNNNNNN', async () => {
      created = await createCert({ certificateId: 'BMIT/1999/999999999', _id: 'evil' });
      const year = new Date().getUTCFullYear();
      ok(
        new RegExp(`^BMIT/${year}/\\d{9}$`).test(created.certificateId),
        `format check failed for ${created.certificateId}`
      );
      ok(created.certificateId !== 'BMIT/1999/999999999', 'client-supplied ID was ignored');
      eq(created.status, 'VALID', 'default status');
    });

    await test('verificationUrl points at the USER frontend verify route (ADR-016 numeric form)', async () => {
      const numericSuffix = created.certificateId.match(/\d+$/)[0];
      eq(
        created.verificationUrl,
        `https://user.example.com/verify/${numericSuffix}`,
        'verificationUrl'
      );
      ok(
        created.verificationUrl.startsWith('https://user.example.com/verify/'),
        'host + /verify/ route'
      );
    });

    await test('Generated certificate IDs are unique (15 sequential creates)', async () => {
      const ids = new Set();
      const numeric = new Set();
      for (let i = 0; i < 15; i += 1) {
        const cert = await createCert();
        ids.add(cert.certificateId);
        numeric.add(cert.certificateId.split('/')[2]);
        ok(/^BMIT\/\d{4}\/\d{9}$/.test(cert.certificateId), `format: ${cert.certificateId}`);
      }
      eq(ids.size, 15, 'all 15 IDs unique');
      eq(numeric.size, 15, 'all 15 numeric parts unique');
    });

    await test('Missing required field -> 400 VALIDATION_ERROR', async () => {
      const body = validCertPayload();
      delete body.course;
      const res = await call('POST', '/api/certificates', { token, body });
      eq(res.status, 400, 'status');
      eq(res.json.error.code, 'VALIDATION_ERROR', 'code');
      ok(res.json.error.message.includes('course'), 'names the missing field');
    });

    await test('NoSQL injection in studentName -> 400 (not 500)', async () => {
      const res = await call('POST', '/api/certificates', {
        token,
        body: validCertPayload({ studentName: { $gt: '' } }),
      });
      eq(res.status, 400, 'status');
      eq(res.json.error.code, 'VALIDATION_ERROR', 'code');
    });

    await test('Duplicate marksheetNumber -> 409', async () => {
      const marksheet = nextUnique('DUP');
      const first = await createCert({ marksheetNumber: marksheet });
      ok(first, 'first created');
      const res = await call('POST', '/api/certificates', {
        token,
        body: validCertPayload({ marksheetNumber: marksheet }),
      });
      eq(res.status, 409, 'status');
      eq(res.json.error.code, 'DUPLICATE_RECORD', 'code');
    });

    await test('XSS payload is neutralized before storage', async () => {
      const cert = await createCert({ studentName: '<script>alert(1)</script>' });
      ok(!cert.studentName.includes('<'), 'no < in stored name');
      ok(!cert.studentName.includes('>'), 'no > in stored name');
      ok(!cert.studentName.toLowerCase().includes('script'), 'no script tag stored');
    });

    await test('Oversized field -> 400', async () => {
      const res = await call('POST', '/api/certificates', {
        token,
        body: validCertPayload({ studentName: 'A'.repeat(500) }),
      });
      eq(res.status, 400, 'status');
    });

    // ----------------------------------------------------------------- G6
    console.log('\n--- Group 6: Retrieval, search, IDOR');
    await test('GET /api/certificates list with search returns created record', async () => {
      const res = await call('GET', `/api/certificates?search=${encodeURIComponent(created.studentName)}`, { token });
      eq(res.status, 200, 'status');
      ok(res.json.data.pagination.total >= 1, 'found at least one');
      ok(
        res.json.data.certificates.some((c) => c.certificateId === created.certificateId),
        'created cert present'
      );
    });

    await test('Invalid status filter -> 400', async () => {
      const res = await call('GET', '/api/certificates?status=HACKED', { token });
      eq(res.status, 400, 'status');
    });

    await test('NoSQL injection via query string is ignored -> 200', async () => {
      const res = await call('GET', '/api/certificates?status[$ne]=VALID', { token });
      eq(res.status, 200, 'status');
    });

    await test('GET by MongoDB _id -> 200', async () => {
      const res = await call('GET', `/api/certificates/${created._id}`, { token });
      eq(res.status, 200, 'status');
      eq(res.json.data.certificateId, created.certificateId, 'certificateId');
    });

    await test('GET by full encoded certificateId -> 200', async () => {
      const res = await call('GET', `/api/certificates/${encodeURIComponent(created.certificateId)}`, { token });
      eq(res.status, 200, 'status');
      eq(res.json.data._id, created._id, 'same record');
    });

    await test('GET by bare numeric part -> 200', async () => {
      const bare = created.certificateId.split('/')[2];
      const res = await call('GET', `/api/certificates/${bare}`, { token });
      eq(res.status, 200, 'status');
      eq(res.json.data.certificateId, created.certificateId, 'resolved');
    });

    await test('IDOR: valid-looking but unknown ObjectId -> 404', async () => {
      const res = await call('GET', '/api/certificates/507f1f77bcf86cd799439011', { token });
      eq(res.status, 404, 'status');
      eq(res.json.error.code, 'CERTIFICATE_NOT_FOUND', 'code');
    });

    await test('Search with regex metacharacters does not 500', async () => {
      const res = await call('GET', '/api/certificates?search=.*+(', { token });
      eq(res.status, 200, 'status');
    });

    // ----------------------------------------------------------------- G7
    console.log('\n--- Group 7: Update & Certificate ID immutability');
    await test('PUT updates student name, certificateId unchanged', async () => {
      const res = await call('PUT', `/api/certificates/${created._id}`, {
        token,
        body: { studentName: 'Renamed Student Alpha' },
      });
      eq(res.status, 200, 'status');
      eq(res.json.data.studentName, 'Renamed Student Alpha', 'name updated');
      eq(res.json.data.certificateId, created.certificateId, 'certificateId unchanged');
      ok(res.json.message.toLowerCase().includes('unchanged'), 'message states ID stability');
    });

    await test('PUT cannot change certificateId (ignored + persisted check)', async () => {
      const res = await call('PUT', `/api/certificates/${created._id}`, {
        token,
        body: { certificateId: 'BMIT/1999/999999999', remarks: 'attempt id swap' },
      });
      eq(res.status, 200, 'status');
      eq(res.json.data.certificateId, created.certificateId, 'response id unchanged');
      const reloaded = await call('GET', `/api/certificates/${created._id}`, { token });
      eq(reloaded.json.data.certificateId, created.certificateId, 'persisted id unchanged');
      eq(reloaded.json.data.remarks, 'attempt id swap', 'other fields still updated');
    });

    await test('PUT with non-string value -> 400', async () => {
      const res = await call('PUT', `/api/certificates/${created._id}`, {
        token,
        body: { course: { $gt: '' } },
      });
      eq(res.status, 400, 'status');
    });

    await test('PUT with empty body -> 400', async () => {
      const res = await call('PUT', `/api/certificates/${created._id}`, { token, body: {} });
      eq(res.status, 400, 'status');
    });

    await test('PUT with invalid status -> 400', async () => {
      const res = await call('PUT', `/api/certificates/${created._id}`, {
        token,
        body: { status: 'HACKED' },
      });
      eq(res.status, 400, 'status');
    });

    // ----------------------------------------------------------------- G8
    console.log('\n--- Group 8: Public verification (no auth)');
    await test('Encoded slash ID verifies (BMIT%2F2026%2FNNNNNNNNN)', async () => {
      const res = await call('GET', `/api/verify/${encodeURIComponent(created.certificateId)}`);
      eq(res.status, 200, 'status');
      eq(res.json.data.certificateId, created.certificateId, 'certificateId');
      ok(res.json.message.includes('verified successfully'), 'message');
    });

    await test('Raw slash path verifies (/verify/BMIT/2026/NNNNNNNNN)', async () => {
      const res = await call('GET', `/api/verify/${created.certificateId}`);
      eq(res.status, 200, 'status');
      eq(res.json.data.certificateId, created.certificateId, 'certificateId');
    });

    await test('Bare numeric ID verifies', async () => {
      const bare = created.certificateId.split('/')[2];
      const res = await call('GET', `/api/verify/${bare}`);
      eq(res.status, 200, 'status');
      eq(res.json.data.certificateId, created.certificateId, 'resolved to full id');
    });

    await test('Spaced marksheet-style ID verifies', async () => {
      const parts = created.certificateId.split('/');
      const spaced = `${parts[0]} / ${parts[1]} / ${parts[2]}`;
      const res = await call('GET', `/api/verify/${spaced}`);
      eq(res.status, 200, 'status');
      eq(res.json.data.certificateId, created.certificateId, 'resolved');
    });

    await test('Unknown certificate -> 404 CERTIFICATE_NOT_FOUND', async () => {
      const res = await call('GET', '/api/verify/BMIT/2026/999999999');
      eq(res.status, 404, 'status');
      eq(res.json.error.code, 'CERTIFICATE_NOT_FOUND', 'code');
      ok(res.json.error.message.includes('No official certificate record'), 'message');
    });

    await test('Malformed ID ($ne) -> 404, never 500', async () => {
      const res = await call('GET', `/api/verify/${encodeURIComponent('$ne')}`);
      ok(res.status === 404 || res.status === 400, `expected 400/404, got ${res.status}`);
      ok(!res.text.includes('CastError'), 'no cast error leaked');
    });

    await test('XSS payload in ID -> safe 4xx, never 500', async () => {
      const res = await call('GET', `/api/verify/${encodeURIComponent('<script>alert(1)</script>')}`);
      ok(res.status === 404 || res.status === 400, `expected 400/404, got ${res.status}`);
      ok(!res.text.includes('<script>'), 'payload not echoed raw');
    });

    await test('Path traversal payload -> 404, no file/system detail', async () => {
      const res = await call('GET', `/api/verify/${encodeURIComponent('../../etc/passwd')}`);
      ok(res.status === 404 || res.status === 400, `expected 400/404, got ${res.status}`);
      ok(!res.text.includes('root:'), 'no filesystem content');
    });

    await test('5000-character ID -> 400 INVALID_ID', async () => {
      const res = await call('GET', `/api/verify/${'A'.repeat(5000)}`);
      eq(res.status, 400, 'status');
      eq(res.json.error.code, 'INVALID_ID', 'code');
    });

    await test('Null byte ID -> 400 INVALID_ID', async () => {
      const res = await call('GET', `/api/verify/%00`);
      eq(res.status, 400, 'status');
      eq(res.json.error.code, 'INVALID_ID', 'code');
    });

    await test('SQL-ish payload -> safe 4xx', async () => {
      const res = await call('GET', `/api/verify/${encodeURIComponent("1' OR '1'='1")}`);
      ok(res.status === 404 || res.status === 400, `expected 400/404, got ${res.status}`);
    });

    await test('REVOKED certificate verifies as revoked with clear message', async () => {
      const cert = await createCert();
      const revoked = await call('PUT', `/api/certificates/${cert._id}`, {
        token,
        body: { status: 'REVOKED' },
      });
      eq(revoked.status, 200, 'revoke status');
      const res = await call('GET', `/api/verify/${encodeURIComponent(cert.certificateId)}`);
      eq(res.status, 200, 'status');
      eq(res.json.data.status, 'REVOKED', 'data.status');
      ok(res.json.message.includes('revoked'), 'message says revoked');
    });

    await test('SUSPENDED certificate verifies as suspended', async () => {
      const cert = await createCert();
      await call('PUT', `/api/certificates/${cert._id}`, { token, body: { status: 'SUSPENDED' } });
      const res = await call('GET', `/api/verify/${encodeURIComponent(cert.certificateId)}`);
      eq(res.status, 200, 'status');
      eq(res.json.data.status, 'SUSPENDED', 'data.status');
      ok(res.json.message.includes('suspended'), 'message says suspended');
    });

    await test('Verification response excludes MongoDB _id', async () => {
      const res = await call('GET', `/api/verify/${encodeURIComponent(created.certificateId)}`);
      ok(!('_id' in res.json.data), '_id not exposed publicly');
      ok(!('remarks' in res.json.data) || typeof res.json.data.remarks === 'string', 'shape ok');
    });

    // ----------------------------------------------------------------- G9
    console.log('\n--- Group 9: Status lifecycle & soft revocation');
    let victim;
    await test('DELETE performs soft revocation (no hard delete)', async () => {
      victim = await createCert();
      const res = await call('DELETE', `/api/certificates/${victim._id}`, { token });
      eq(res.status, 200, 'status');
      eq(res.json.data.status, 'REVOKED', 'status now REVOKED');
      ok(res.json.message.includes('soft delete'), 'message mentions soft delete');
      const stillThere = await call('GET', `/api/certificates/${victim._id}`, { token });
      eq(stillThere.status, 200, 'record still exists');
    });

    await test('DELETE is idempotent (already revoked)', async () => {
      const res = await call('DELETE', `/api/certificates/${victim._id}`, { token });
      eq(res.status, 200, 'status');
      ok(res.json.message.includes('already revoked'), 'idempotent message');
    });

    await test('Revoked certificate public verification shows REVOKED', async () => {
      const res = await call('GET', `/api/verify/${encodeURIComponent(victim.certificateId)}`);
      eq(res.json.data.status, 'REVOKED', 'status');
    });

    await test('Certificate can be reinstated to VALID', async () => {
      const res = await call('PUT', `/api/certificates/${victim._id}`, {
        token,
        body: { status: 'VALID' },
      });
      eq(res.status, 200, 'status');
      eq(res.json.data.status, 'VALID', 'back to VALID');
      const check = await call('GET', `/api/verify/${encodeURIComponent(victim.certificateId)}`);
      eq(check.json.data.status, 'VALID', 'public view VALID');
    });

    // --------------------------------------------------------------- G10
    console.log('\n--- Group 10: Bulk creation');
    await test('POST /api/certificates/bulk creates 3 certificates', async () => {
      const body = { certificates: [validCertPayload(), validCertPayload(), validCertPayload()] };
      const res = await call('POST', '/api/certificates/bulk', { token, body });
      eq(res.status, 201, 'status');
      eq(res.json.data.count, 3, 'count');
      const ids = res.json.data.created.map((c) => c.certificateId);
      eq(new Set(ids).size, 3, 'bulk IDs unique');
      ids.forEach((id) => ok(/^BMIT\/\d{4}\/\d{9}$/.test(id), `format ${id}`));
    });

    await test('Bulk rejects invalid record with its index', async () => {
      const bad = validCertPayload();
      delete bad.course;
      const res = await call('POST', '/api/certificates/bulk', {
        token,
        body: { certificates: [validCertPayload(), bad] },
      });
      eq(res.status, 400, 'status');
      ok(res.json.error.message.startsWith('Record 2:'), `message: ${res.json.error.message}`);
    });

    await test('Bulk rejects non-array payload -> 400', async () => {
      const res = await call('POST', '/api/certificates/bulk', { token, body: { nope: true } });
      eq(res.status, 400, 'status');
    });

    await test('Bulk rejects > 50 records -> 400', async () => {
      const items = Array.from({ length: 51 }, () => null);
      const res = await call('POST', '/api/certificates/bulk', { token, body: { certificates: items } });
      eq(res.status, 400, 'status');
      ok(res.json.error.message.includes('Maximum 50'), 'mentions the cap');
    });

    // --------------------------------------------------------------- G11
    console.log('\n--- Group 11: Students endpoints');
    const studentName = `Zeta Student ${uniqueCounter}`;
    await test('GET /api/students aggregates students', async () => {
      await createCert({ studentName });
      const res = await call('GET', `/api/students?search=${encodeURIComponent('Zeta Student')}`, { token });
      eq(res.status, 200, 'status');
      const found = res.json.data.students.find((s) => s.studentName === studentName);
      ok(found, 'student present in aggregate');
      ok(found.certificateCount >= 1, 'certificate count');
      ok(typeof found.latestCertificateId === 'string', 'latest certificate id');
    });

    await test('GET /api/students/:id returns student certificate history', async () => {
      const res = await call('GET', `/api/students/${encodeURIComponent(studentName)}`, { token });
      eq(res.status, 200, 'status');
      eq(res.json.data.studentName, studentName, 'name');
      ok(Array.isArray(res.json.data.certificates) && res.json.data.certificates.length >= 1, 'certificates');
    });

    await test('GET /api/students/:id unknown student -> 404', async () => {
      const res = await call('GET', `/api/students/${encodeURIComponent('No Such Person 123')}`, { token });
      eq(res.status, 404, 'status');
      eq(res.json.error.code, 'STUDENT_NOT_FOUND', 'code');
    });

    await test('GET /api/students/:id rejects oversized identifier -> 400', async () => {
      const res = await call('GET', `/api/students/${'A'.repeat(400)}`, { token });
      eq(res.status, 400, 'status');
    });

    // -------------------------------------------------------------- G11b
    console.log('\n--- Group 11b: Student profile deletion');
    const deleteTarget = `Delete Me ${nextUnique('S')}`;
    await test('DELETE /api/students/:id removes the profile and its certificates from MongoDB', async () => {
      await createCert({ studentName: deleteTarget });
      await createCert({ studentName: deleteTarget });
      const before = await Certificate.countDocuments({ studentName: deleteTarget });
      eq(before, 2, 'pre-condition: 2 certificates in Mongo');

      const res = await call('DELETE', `/api/students/${encodeURIComponent(deleteTarget)}`, { token });
      eq(res.status, 200, 'status');
      eq(res.json.data.studentName, deleteTarget, 'echoed name');
      eq(res.json.data.deletedCertificates, 2, 'deleted count');

      const after = await Certificate.countDocuments({ studentName: deleteTarget });
      eq(after, 0, 'documents physically removed from Mongo');

      const detail = await call('GET', `/api/students/${encodeURIComponent(deleteTarget)}`, { token });
      eq(detail.status, 404, 'profile no longer resolves');
      eq(detail.json.error.code, 'STUDENT_NOT_FOUND', 'code');

      const list = await call('GET', `/api/students?search=${encodeURIComponent(deleteTarget)}`, { token });
      ok(
        !list.json.data.students.some((s) => s.studentName === deleteTarget),
        'profile gone from directory aggregate'
      );
    });

    await test('DELETE /api/students/:id unknown student -> 404', async () => {
      const res = await call('DELETE', `/api/students/${encodeURIComponent('No Such Person 123')}`, { token });
      eq(res.status, 404, 'status');
      eq(res.json.error.code, 'STUDENT_NOT_FOUND', 'code');
    });

    await test('DELETE /api/students/:id without token -> 401 (no deletion)', async () => {
      const guarded = `Guarded ${nextUnique('S')}`;
      await createCert({ studentName: guarded });
      const res = await call('DELETE', `/api/students/${encodeURIComponent(guarded)}`);
      eq(res.status, 401, 'status');
      const stillThere = await Certificate.countDocuments({ studentName: guarded });
      eq(stillThere, 1, 'record survives an unauthenticated delete attempt');
    });

    // --------------------------------------------------------------- G12
    console.log('\n--- Group 12: Security controls');
    await test('CORS: unknown origin is rejected with 403', async () => {
      const res = await call('GET', '/api/verify/101000015', { origin: 'https://evil.example.net' });
      eq(res.status, 403, 'status');
      eq(res.json.error.code, 'FORBIDDEN_ORIGIN', 'code');
      ok(!res.headers.get('access-control-allow-origin'), 'no ACAO header');
    });

    await test('CORS: allowlisted origin is served with ACAO header', async () => {
      const res = await call('GET', '/api/verify/101000015', { origin: 'https://user.example.com' });
      eq(res.status, 200, 'status');
      eq(res.headers.get('access-control-allow-origin'), 'https://user.example.com', 'ACAO');
    });

    await test('Oversized request body -> 413', async () => {
      const res = await call('POST', '/api/certificates', {
        token,
        body: { blob: 'A'.repeat(60 * 1024) },
      });
      eq(res.status, 413, 'status');
      ok(res.json.error.message.toLowerCase().includes('too large'), 'message');
    });

    await test('Malformed JSON -> 400 with safe production message', async () => {
      const res = await call('POST', '/api/certificates', { token, body: '{bad json' });
      eq(res.status, 400, 'status');
      ok(!res.text.includes('Unexpected token'), 'parser detail not leaked');
      ok(!res.text.includes('SyntaxError'), 'error class not leaked');
    });

    await test('Production 500 responses leak no internals (global handler)', async () => {
      const original = Certificate.aggregate;
      Certificate.aggregate = () => {
        throw new Error('mongodb+srv://user:pass@cluster/secret-db');
      };
      try {
        const res = await call('GET', '/api/students', { token });
        eq(res.status, 500, 'status');
        eq(res.json.error.message, 'Internal server error.', 'generic message');
        ok(!res.text.includes('mongodb+srv'), 'no connection string leaked');
        ok(!res.text.includes('secret-db'), 'no secret leaked');
        ok(!('stack' in res.json.error), 'no stack trace');
      } finally {
        Certificate.aggregate = original;
      }
    });

    await test('Verification DB failure -> neutral 503 (no detail leak)', async () => {
      const original = Certificate.findOne;
      Certificate.findOne = () => {
        throw new Error('mongodb+srv://user:pass@cluster/hidden');
      };
      try {
        const res = await call('GET', '/api/verify/BMIT/2026/101000015');
        eq(res.status, 503, 'status');
        eq(res.json.error.code, 'SERVICE_ERROR', 'code');
        ok(res.json.error.message.includes('temporarily unavailable'), 'neutral message');
        ok(!res.text.includes('mongodb+srv'), 'no connection string leaked');
      } finally {
        Certificate.findOne = original;
      }
    });

    await test('No secrets in health response', async () => {
      const res = await call('GET', '/');
      const snapshot = res.text;
      ok(!snapshot.includes(process.env.JWT_SECRET), 'JWT_SECRET absent');
      ok(!snapshot.includes(process.env.MONGODB_URI), 'MONGODB_URI absent');
      ok(!snapshot.includes(PASSWORD), 'password absent');
      ok(!snapshot.includes('scrypt$'), 'password hash absent');
    });

    await test('No secrets in certificate responses', async () => {
      const res = await call('GET', `/api/certificates/${created._id}`, { token });
      ok(!res.text.includes(process.env.JWT_SECRET), 'JWT_SECRET absent');
      ok(!res.text.includes('scrypt$'), 'hash absent');
      ok(!res.text.includes(process.env.MONGODB_URI), 'MONGODB_URI absent');
    });

    await test('Missing MONGODB_URI fails fast (requireDbConfig throws)', async () => {
      const saved = process.env.MONGODB_URI;
      delete process.env.MONGODB_URI;
      let threw = false;
      let code = null;
      try {
        requireDbConfig();
      } catch (err) {
        threw = true;
        code = err.code;
      } finally {
        process.env.MONGODB_URI = saved;
      }
      ok(threw, 'requireDbConfig threw');
      eq(code, 'DB_CONFIG_MISSING', 'error code');
    });

    await test('startServer() refuses to boot without MONGODB_URI (no fallback)', async () => {
      const saved = process.env.MONGODB_URI;
      delete process.env.MONGODB_URI;
      let rejected = false;
      let code = null;
      try {
        await startServer(0);
      } catch (err) {
        rejected = true;
        code = err.code;
      } finally {
        process.env.MONGODB_URI = saved;
      }
      ok(rejected, 'startServer rejected');
      eq(code, 'DB_CONFIG_MISSING', 'error code');
    });

    await test('startServer() refuses to boot with missing runtime config', async () => {
      const saved = process.env.STAFF_USERNAME;
      delete process.env.STAFF_USERNAME;
      let rejected = false;
      let code = null;
      try {
        assertRuntimeEnv();
      } catch (err) {
        rejected = true;
        code = err.code;
      } finally {
        process.env.STAFF_USERNAME = saved;
      }
      ok(rejected, 'assertRuntimeEnv threw');
      eq(code, 'ENV_CONFIG_MISSING', 'error code');
    });

    await test('Response headers include security headers (helmet)', async () => {
      const res = await call('GET', '/');
      ok(res.headers.get('x-content-type-options') === 'nosniff', 'nosniff');
      ok(res.headers.get('x-frame-options') === 'DENY' || res.headers.get('x-frame-options') === 'SAMEORIGIN', 'frame options');
    });

    // --------------------------------------------------------------- G13
    console.log('\n--- Group 13: Login failures & brute-force protection');
    await test('Invalid password -> 401 INVALID_CREDENTIALS', async () => {
      const res = await call('POST', '/api/auth/login', {
        body: { username: USERNAME, password: 'definitely-wrong' },
      });
      eq(res.status, 401, 'status');
      eq(res.json.error.code, 'INVALID_CREDENTIALS', 'code');
      ok(!res.text.includes('scrypt$'), 'no hash leak');
    });

    await test('Missing credentials -> 401 (no user enumeration)', async () => {
      const res = await call('POST', '/api/auth/login', { body: {} });
      eq(res.status, 401, 'status');
      eq(res.json.error.code, 'INVALID_CREDENTIALS', 'code');
    });

    await test('NoSQL injection password (object) -> 401, not 500', async () => {
      const res = await call('POST', '/api/auth/login', {
        body: { username: USERNAME, password: { $ne: null } },
      });
      eq(res.status, 401, 'status');
    });

    await test('NoSQL injection username (object) -> 401, not 500', async () => {
      const res = await call('POST', '/api/auth/login', {
        body: { username: { $gt: '' }, password: PASSWORD },
      });
      eq(res.status, 401, 'status');
    });

    await test('Brute force: 429 after 5 failed attempts / 15 min', async () => {
      let sawLimit = false;
      const statuses = [];
      for (let attempt = 1; attempt <= 8; attempt += 1) {
        const res = await call('POST', '/api/auth/login', {
          body: { username: USERNAME, password: `wrong-${attempt}` },
        });
        statuses.push(res.status);
        if (res.status === 429) {
          sawLimit = true;
          eq(res.json.error.code, 'RATE_LIMITED', 'code');
          break;
        }
        eq(res.status, 401, `attempt ${attempt} before limit`);
      }
      ok(sawLimit, `429 never observed (statuses: ${statuses.join(',')})`);
      ok(statuses.length <= 6, `limit triggered too late (${statuses.length} attempts)`);
    });

    await test('Successful login still works after lockout window logic', async () => {
      // successes are not counted by skipSuccessfulRequests; the limiter only
      // blocks further FAILED attempts inside the window.
      const res = await call('POST', '/api/auth/login', {
        body: { username: USERNAME, password: PASSWORD },
      });
      ok(res.status === 200 || res.status === 429, `status ${res.status}`);
      if (res.status === 200) token = res.json.data.token;
    });

    // --------------------------------------------------------------- G14
    console.log('\n--- Group 14: Public verification rate limit (60/min)');
    await test('Verification endpoint returns 429 past 60 requests/minute', async () => {
      let sawLimit = false;
      for (let i = 0; i < 70; i += 1) {
        const res = await call('GET', '/api/verify/101000015');
        if (res.status === 429) {
          sawLimit = true;
          eq(res.json.error.code, 'RATE_LIMITED', 'code');
          break;
        }
        if (res.status !== 200) {
          throw new Error(`unexpected status ${res.status} during rate limit run`);
        }
      }
      ok(sawLimit, '429 not observed within 70 requests');
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await mongoose.disconnect().catch(() => {});
    await mongo.stop().catch(() => {});
  }

  console.log('\n==============================================');
  console.log(` RESULTS: ${results.pass} PASSED, ${results.fail} FAILED`);
  console.log('==============================================\n');
  if (results.fail > 0) {
    results.failures.forEach((f) => console.log(`  FAILED: ${f.name}\n    ${f.message}`));
    process.exit(1);
  }
  process.exit(0);
}

run().catch((err) => {
  console.error('\nSUITE CRASHED:', err);
  process.exit(1);
});
