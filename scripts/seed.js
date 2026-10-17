'use strict';

/**
 * Idempotent sample-data seeder.
 * Requires an explicit MONGODB_URI — never falls back to an in-memory database
 * and never wipes existing records (duplicates are skipped).
 */
const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '..', '.env'), quiet: true });
dotenv.config({ path: path.join(__dirname, '..', '.env.local'), quiet: true });

const mongoose = require('mongoose');
const { requireDbConfig } = require('../config/env');
const { connectDB, disconnectDB } = require('../db/connect');
const Certificate = require('../models/Certificate');
const Counter = require('../models/Counter');

const SAMPLES = [
  {
    certificateId: 'BMIT/2026/101000015',
    studentName: 'Alex Chen',
    course: 'BMIT – Full Stack Financial Engineering',
    marksheetNumber: 'BMIT / 2026 / MS / 101000015',
    issueDate: new Date('2026-09-22'),
    result: 'DISTINCTION',
    status: 'VALID',
  },
  {
    certificateId: 'BMIT/2026/101000016',
    studentName: 'Priya Sharma',
    course: 'BMIT – Data Science',
    marksheetNumber: 'BMIT / 2026 / MS / 101000016',
    issueDate: new Date('2026-09-20'),
    result: 'DISTINCTION',
    status: 'VALID',
  },
  {
    certificateId: 'BMIT/2026/101000099',
    studentName: 'Rahul Nair',
    course: 'BMIT – Artificial Intelligence & Machine Learning',
    marksheetNumber: 'BMIT / 2026 / MS / 101000099',
    issueDate: new Date('2026-09-18'),
    result: 'PASS',
    status: 'REVOKED',
    remarks: 'Revoked by Academic Registrar (sample record).',
  },
];

async function seed(uri) {
  const connectionUri = uri || requireDbConfig();
  if (mongoose.connection.readyState === 0) {
    await connectDB(connectionUri);
  }

  let inserted = 0;
  for (const sample of SAMPLES) {
    const found = await Certificate.exists({ certificateId: sample.certificateId });
    if (found) continue;
    try {
      await Certificate.create(sample);
      inserted += 1;
    } catch (err) {
      if (err && err.code === 11000) continue;
      throw err;
    }
  }

  // Keep the ID counter ahead of any explicitly seeded number.
  const maxSeeded = SAMPLES.reduce((max, item) => {
    const numeric = Number(item.certificateId.split('/')[2]);
    return numeric > max ? numeric : max;
  }, 100000000);
  const seq = maxSeeded - 100000000;
  await Counter.updateOne(
    { _id: 'cert-2026' },
    { $max: { seq } },
    { upsert: true }
  );

  return { inserted, total: await Certificate.countDocuments(), connection: mongoose.connection.name };
}

module.exports = { seed, SAMPLES };

if (require.main === module) {
  seed()
    .then((result) => {
      // eslint-disable-next-line no-console
      console.log(
        `[seed] inserted=${result.inserted} total=${result.total} db=${result.connection}`
      );
      return disconnectDB();
    })
    .then(() => process.exit(0))
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error(`[seed] FATAL: ${err.message}`);
      process.exit(1);
    });
}
