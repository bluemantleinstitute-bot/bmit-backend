'use strict';

const router = require('express').Router();
const { login, me } = require('../controllers/authController');
const { requireAuth } = require('../middleware/auth');
const { createLoginLimiter } = require('../middleware/rateLimit');

const loginLimiter = createLoginLimiter();

router.post('/login', loginLimiter, login);
router.get('/me', requireAuth, me);

module.exports = router;
