const express = require('express');
const router = express.Router();
const {getAllBookings,acceptBooking,deliverBooking} = require('../controllers/admindashboardcontroller');

// Route to fetch all bookings
router.get('/bookings', getAllBookings);

// Route to accept a booking
router.put('/bookings/accept/:booking_id', acceptBooking);

// Route to mark a booking as delivered
router.put('/bookings/deliver/:booking_id', deliverBooking);

module.exports = router;
