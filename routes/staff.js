const express = require('express');
const { protect } = require('../middleware/authMiddleware');
const { resolveActiveStore, requireStorePermission } = require('../middleware/storeMiddleware');
const storeCtrl = require('../controllers/storeController');

const router = express.Router();

router.post('/accept-invite', protect, storeCtrl.acceptInvite);
router.post('/invite', protect, resolveActiveStore, requireStorePermission('manage_staff'), storeCtrl.inviteStaff);

module.exports = router;
