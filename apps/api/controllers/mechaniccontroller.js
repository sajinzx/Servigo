const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../database');

// Mechanic Signup
exports.mechanicSignup = async (req, res) => {
  try {
    let {
      mechanicId,
      availabilityStatus,
      numberOfEmployees,
      location,
      contactNumber,
      rating,
      password
    } = req.body;

    // ✅ Validation & default values
    if (!mechanicId || !numberOfEmployees || !location || !contactNumber || !rating || !password) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    availabilityStatus = availabilityStatus || 'Available';
    numberOfEmployees = parseInt(numberOfEmployees);
    rating = parseFloat(rating);

    // Check for NaN
    if (isNaN(numberOfEmployees) || isNaN(rating)) {
      return res.status(400).json({ message: 'Number of employees and rating must be numeric' });
    }

    // Insert into mechanic table
    await pool.execute(
      `INSERT INTO mechanic 
        (mechanic_id, availability_status, number_of_employees, location, contact_number, rating, password) 
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [mechanicId, availabilityStatus, numberOfEmployees, location, contactNumber, rating, password]
    );

    res.status(201).json({ message: 'Mechanic registered successfully' });
  } catch (error) {
    console.error('❌ MySQL Error:', error);

    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ message: 'Mechanic ID already exists' });
    }

    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Mechanic Login
exports.mechanicLogin = async (req, res) => {
  const { mechanicId, password } = req.body;

  try {
    const [rows] = await pool.execute('SELECT * FROM mechanic WHERE mechanic_id = ?', [mechanicId]);

    if (rows.length === 0) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    const mechanic = rows[0];
    const isMatch = password === mechanic.password.trim();

    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    const token = jwt.sign({ mechanicId: mechanic.mechanic_id }, 'your-secret-key', { expiresIn: '1h' });

    res.json({
      token,
      mechanic: {
        mechanic_id: mechanic.mechanic_id,
        location: mechanic.location,
        rating: mechanic.rating,
      },
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Get Mechanic Services
exports.getMechanicServices = async (req, res) => {
  const { mechanicId } = req.params;

  try {
    const [rows] = await pool.execute(
      `
      SELECT s.service_id, s.service_name, s.cost, s.estimated_duration,
             CASE 
               WHEN EXISTS (
                 SELECT 1 FROM bookingreq b 
                 WHERE b.mechanic_id = ? AND b.service_id = s.service_id 
                 AND b.status IN ('accepted', 'in_progress')
               ) THEN 'busy'
               ELSE 'available'
             END as availability_status
      FROM mechanic_services ms
      JOIN service s ON ms.service_id = s.service_id
      WHERE ms.mechanic_id = ?
    `,
      [mechanicId, mechanicId]
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Add Service to Mechanic
exports.addService = async (req, res) => {
  const { serviceId, mechanicId } = req.body;

  try {
  await pool.execute(
    'INSERT INTO mechanic_services (mechanic_id, service_id) VALUES (?, ?)',
    [mechanicId, serviceId]
  );
  res.status(201).json({ message: 'Service added successfully' });
} catch (error) {
  if (error.code === 'ER_DUP_ENTRY') {
    return res.status(400).json({ message: 'Service already added for this mechanic' });
  }
  res.status(500).json({ message: 'Server error', error: error.message });
}

};

// Remove Service
exports.removeService = async (req, res) => {
  const { mechanicId, serviceId } = req.params;

  try {
    await pool.execute('DELETE FROM mechanic_services WHERE mechanic_id = ? AND service_id = ?', [mechanicId, serviceId]);
    res.json({ message: 'Service removed successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Get Available Services
exports.getAvailableServices = async (req, res) => {
  const { mechanicId } = req.params;

  try {
    const [rows] = await pool.execute(
      `
      SELECT s.service_id, s.service_name, s.cost, s.estimated_duration
      FROM service s
      WHERE s.service_id NOT IN (
        SELECT ms.service_id FROM mechanic_services ms WHERE ms.mechanic_id = ?
      )
    `,
      [mechanicId]
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Get Service Requests
exports.getServiceRequests = async (req, res) => {
  const { mechanicId } = req.params;

  try {
    const [rows] = await pool.execute(
      `
      SELECT b.booking_id, b.dateofrequest, b.status, b.price, b.location,
             s.service_name, u.name as customer_name, v.vehicle_number, b.service_id
      FROM bookingreq b
      JOIN service s ON b.service_id = s.service_id
      JOIN users u ON b.user_id = u.user_id
      JOIN vehicles v ON b.vehicle_number = v.vehicle_number
      WHERE b.mechanic_id = ? AND b.status IN ('pending', 'held', 'accepted', 'in_progress')
      ORDER BY 
        CASE b.status 
          WHEN 'in_progress' THEN 1
          WHEN 'accepted' THEN 2
          WHEN 'held' THEN 3
          WHEN 'pending' THEN 4
        END,
        b.dateofrequest ASC
    `,
      [mechanicId]
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Get Pending Requests
exports.getPendingRequests = async (req, res) => {
  const { mechanicId } = req.params;

  try {
    const [rows] = await pool.execute(
      `
      SELECT b.booking_id, b.dateofrequest, b.status, b.price, b.location,
             s.service_name, u.name as customer_name, v.vehicle_number, b.service_id
      FROM bookingreq b
      JOIN service s ON b.service_id = s.service_id
      JOIN users u ON b.user_id = u.user_id
      JOIN vehicles v ON b.vehicle_number = v.vehicle_number
      WHERE b.mechanic_id = ? AND b.status IN ('pending', 'held')
      ORDER BY b.dateofrequest ASC
    `,
      [mechanicId]
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Update Request Status
exports.updateRequestStatus = async (req, res) => {
  const { bookingId } = req.params;
  const { status } = req.body;

  try {
    if (status === 'delivered') {
      await pool.execute('UPDATE bookingreq SET status = ?, datedelivered = CURDATE() WHERE booking_id = ?', [
        status,
        bookingId,
      ]);
    } else {
      await pool.execute('UPDATE bookingreq SET status = ? WHERE booking_id = ?', [status, bookingId]);
    }
    res.json({ message: 'Request status updated successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};

// Toggle Service Availability
exports.toggleServiceAvailability = async (req, res) => {
  const { mechanicId, serviceId } = req.params;
  const { action } = req.body; // 'pause' or 'resume'

  try {
    if (action === 'pause') {
      await pool.execute('DELETE FROM mechanic_services WHERE mechanic_id = ? AND service_id = ?', [mechanicId, serviceId]);
    } else if (action === 'resume') {
      await pool.execute('INSERT IGNORE INTO mechanic_services (mechanic_id, service_id) VALUES (?, ?)', [
        mechanicId,
        serviceId,
      ]);
    }
    res.json({ message: `Service ${action}d successfully` });
  } catch (error) {
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};
