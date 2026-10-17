'use strict';

const mongoose = require('mongoose');

const CertificateSchema = new mongoose.Schema(
  {
    certificateId: {
      type: String,
      required: [true, 'Certificate ID is required'],
      unique: true,
      trim: true,
      index: true,
    },
    studentName: {
      type: String,
      required: [true, 'Student name is required'],
      trim: true,
      maxlength: 200,
    },
    course: {
      type: String,
      required: [true, 'Course name is required'],
      trim: true,
      maxlength: 200,
    },
    marksheetNumber: {
      type: String,
      required: [true, 'Marksheet number is required'],
      unique: true,
      trim: true,
      maxlength: 100,
    },
    issueDate: {
      type: Date,
      required: [true, 'Issue date is required'],
    },
    result: {
      type: String,
      required: [true, 'Result is required'],
      trim: true,
      maxlength: 100,
      default: 'DISTINCTION',
    },
    status: {
      type: String,
      enum: ['VALID', 'REVOKED', 'SUSPENDED'],
      default: 'VALID',
      index: true,
    },
    institutionName: {
      type: String,
      default: 'Bluemantle Institute of Technology',
      maxlength: 200,
    },
    affiliation: {
      type: String,
      default: 'Aligned with Skill India Mission',
      maxlength: 200,
    },
    contactDetails: {
      type: String,
      default: 'verification@bluemantletechnology.com',
      maxlength: 200,
    },
    remarks: {
      type: String,
      default: '',
      maxlength: 1000,
    },
  },
  { timestamps: true }
);

CertificateSchema.set('toJSON', { versionKey: false });

module.exports = mongoose.models.Certificate || mongoose.model('Certificate', CertificateSchema);
