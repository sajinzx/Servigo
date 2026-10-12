const pool = require('../database');

// Fetch pending services booked by a user
exports.getPendingBookings = async (req, res) => {
  const { user_id } = req.params;

  try {
    // Fetch bookings where status is not completed
    const [bookings] = await pool.query(
      `SELECT b.booking_id, b.dateofrequest, b.status, b.price, b.datedelivered, 
              b.payment_status, b.feedback_rating, b.location,
              b.vehicle_number, b.service_id, s.service_name
       FROM bookingreq b
       JOIN service s ON b.service_id = s.service_id
       WHERE b.user_id = ? AND b.status != 'completed'
       ORDER BY b.dateofrequest DESC`,
      [user_id]
    );

    // Format dates to local IST and readable string
    const bookingsFormatted = bookings.map(b => ({
      ...b,
      dateofrequest: b.dateofrequest
        ? new Date(b.dateofrequest).toLocaleString('en-IN', { hour12: true })
        : null,
      datedelivered: b.datedelivered
        ? new Date(b.datedelivered).toLocaleString('en-IN', { hour12: true })
        : null
    }));

    res.status(200).json({ user_id, pendingBookings: bookingsFormatted });
  } catch (err) {
    console.error('Error fetching pending bookings:', err);
    res.status(500).json({ message: 'Server error' });
  }
};
