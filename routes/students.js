'use strict';

const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const ctrl = require('../controllers/studentController');

router.use(requireAuth);

router.get('/', ctrl.list);
router.get('/:id', ctrl.detail);
router.delete('/:id', ctrl.destroy);

module.exports = router;
