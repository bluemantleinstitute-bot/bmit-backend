'use strict';

const router = require('express').Router();
const { verify } = require('../controllers/verifyController');
const { createVerifyLimiter } = require('../middleware/rateLimit');

const verifyLimiter = createVerifyLimiter();

// Public: no authentication. Wildcard captures raw and encoded slashed IDs.
router.get('/*splat', verifyLimiter, verify);

module.exports = router;
