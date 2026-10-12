const express = require('express');
const router = express.Router();
const { getServiceHistory } = require('../controllers/usercontroller');

// Get service history for a user
router.get('/service-history/:userId', getServiceHistory);

module.exports = router;