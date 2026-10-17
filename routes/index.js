'use strict';

const router = require('express').Router();

router.use('/auth', require('./auth'));
router.use('/certificates', require('./certificates'));
router.use('/verify', require('./verify'));
router.use('/students', require('./students'));

module.exports = router;
