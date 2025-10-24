const pool = require('../database');
const { v4: uuidv4 } = require('uuid');

// Book a service and assign an available mechanic
exports.bookService = async (req, res) => {
  const {
    user_id,
    vehicle_number,
    service_id,
    price,
    location
  } = req.body;

  if (!user_id || !vehicle_number || !service_id || !price || !location) {
    return res.status(400).json({ message: 'Missing required fields' });
  }

  try {
    // 1. Find mechanics who can do this service
    const [mechanics] = await pool.query(
      `SELECT m.mechanic_id, m.availability_status, m.rating
       FROM mechanic_services ms
       JOIN mechanic m ON ms.mechanic_id = m.mechanic_id
       WHERE ms.service_id = ? AND m.availability_status = 'Available'
       ORDER BY m.rating DESC`,
      [service_id]
    );

    if (mechanics.length === 0) {
      return res.status(404).json({ message: 'No available mechanic found for this service' });
    }

    // Pick the top mechanic (highest rating)
    const assignedMechanic = mechanics[0].mechanic_id;

    // 2. Insert booking
    const booking_id = uuidv4();
    const dateofrequest = new Date();

    await pool.query(
      `INSERT INTO bookingreq
        (booking_id, dateofrequest, status, price, datedelivered, payment_status, feedback_rating, location, user_id, mechanic_id, vehicle_number, service_id)
       VALUES (?, ?, 'Pending', ?, NULL, 'Pending', NULL, ?, ?, ?, ?, ?)`,
      [booking_id, dateofrequest, price, location, user_id, assignedMechanic, vehicle_number, service_id]
    );

    res.status(201).json({ message: 'Service booked successfully', booking_id, assignedMechanic });
  } catch (err) {
    console.error('Error booking service:', err);
    res.status(500).json({ message: 'Server error' });
  }
};
