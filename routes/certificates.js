'use strict';

const router = require('express').Router();
const { requireAuth } = require('../middleware/auth');
const ctrl = require('../controllers/certificateController');

// Every certificate management endpoint is staff-only.
router.use(requireAuth);

router.get('/', ctrl.list);
router.post('/', ctrl.create);
router.post('/bulk', ctrl.bulk);
router.get('/:id', ctrl.getOne);
router.put('/:id', ctrl.update);
router.delete('/:id', ctrl.remove);

module.exports = router;
