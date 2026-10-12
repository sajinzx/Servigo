const express = require('express');
const router = express.Router();
const { getPendingBookings } = require('../controllers/bookingcontroller');

// Get pending bookings for a user
router.get('/:user_id', getPendingBookings);

module.exports = router;
