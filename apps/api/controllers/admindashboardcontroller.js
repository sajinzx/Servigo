const pool = require('../database');
const { v4: uuidv4 } = require('uuid');

// Fetch all bookings that are not delivered
exports.getAllBookings = async (req, res) => {
  try {
    const [bookings] = await pool.query(
      `SELECT b.booking_id, b.dateofrequest, b.status, b.price, b.datedelivered, 
              b.payment_status, b.feedback_rating, b.location,
              b.vehicle_number, b.service_id, s.service_name, b.user_id
       FROM bookingreq b
       JOIN service s ON b.service_id = s.service_id
       WHERE b.status != 'Delivered'
       ORDER BY b.dateofrequest DESC`
    );

    const formattedBookings = bookings.map(b => ({
      ...b,
      dateofrequest: b.dateofrequest ? new Date(b.dateofrequest).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : null,
      datedelivered: b.datedelivered ? new Date(b.datedelivered).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : null
    }));

    res.status(200).json({ bookings: formattedBookings });
  } catch (err) {
    console.error('Error fetching bookings:', err);
    res.status(500).json({ message: 'Server error' });
  }
};

// Accept a booking (set delivered date, payment, and feedback)
exports.acceptBooking = async (req, res) => {
  const { booking_id } = req.params;
  const datedelivered = new Date(); // current date/time

  try {
    await pool.query(
      `UPDATE bookingreq 
       SET status = 'Accepted', datedelivered = ?, payment_status = 'Paid', feedback_rating = 4.5
       WHERE booking_id = ?`,
      [datedelivered, booking_id]
    );
    res.status(200).json({ message: 'Booking accepted and updated successfully' });
  } catch (err) {
    console.error('Error accepting booking:', err);
    res.status(500).json({ message: 'Server error' });
  }
};

// Deliver a booking (move to service_history and delete from bookingreq)
exports.deliverBooking = async (req, res) => {
  const { booking_id } = req.params;
  const datedelivered = new Date();

  try {
    // 1️⃣ Fetch the booking details
    const [bookings] = await pool.query(
      `SELECT * FROM bookingreq WHERE booking_id = ?`,
      [booking_id]
    );

    if (bookings.length === 0) {
      return res.status(404).json({ message: 'Booking not found' });
    }

    const booking = bookings[0];

    // 2️⃣ Insert into service_history
    const history_id = uuidv4();
    await pool.query(
      `INSERT INTO service_history 
        (history_id, booking_id, dateofrequest, datedelivered, status, price, payment_status, feedback_rating, location, user_id, mechanic_id, vehicle_number, service_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        history_id,
        booking.booking_id,
        booking.dateofrequest,
        datedelivered, // use the delivery date here
        'Delivered',   // final status
        booking.price,
        'Paid',        // payment status
        4.5,           // feedback
        booking.location,
        booking.user_id,
        booking.mechanic_id,
        booking.vehicle_number,
        booking.service_id
      ]
    );

    // 3️⃣ Delete from bookingreq
    await pool.query(
      `DELETE FROM bookingreq WHERE booking_id = ?`,
      [booking_id]
    );

    res.status(200).json({ message: 'Booking delivered and moved to service history successfully' });
  } catch (err) {
    console.error('Error delivering booking:', err);
    res.status(500).json({ message: 'Server error' });
  }
};
