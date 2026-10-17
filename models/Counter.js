'use strict';

const mongoose = require('mongoose');

/** Atomic per-year sequence used to allocate BMIT/YYYY/NNNNNNNNN certificate IDs. */
const CounterSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  seq: { type: Number, required: true, default: 0 },
});

module.exports = mongoose.models.Counter || mongoose.model('Counter', CounterSchema);
