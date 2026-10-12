const pool = require('../database');

exports.addVehicle = async (req, res) => {
  const {
    vehicle_number,
    user_id,
    brand,
    model,
    year,
    fueltype,
    type, // "car" or "bike"
    seats,
    body_type,
    engine_cc,
  } = req.body;

  try {
    const [existing] = await pool.query(
      'SELECT * FROM vehicles WHERE vehicle_number = ?',
      [vehicle_number]
    );

    if (existing.length > 0) {
      return res.status(400).json({ message: 'Vehicle already exists' });
    }

    await pool.query(
      `INSERT INTO vehicles (vehicle_number, user_id, brand, model, year, fueltype)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [vehicle_number, user_id, brand, model, year, fueltype]
    );

    if (type === 'car') {
      await pool.query(
        `INSERT INTO cars (vehicle_number, seats, body_type)
         VALUES (?, ?, ?)`,
        [vehicle_number, seats, body_type]
      );
    } else if (type === 'bike') {
      await pool.query(
        `INSERT INTO bikes (vehicle_number, engine_cc, type)
         VALUES (?, ?, ?)`,
        [vehicle_number, engine_cc, type]
      );
    }

    res.status(201).json({ message: 'Vehicle added successfully' });
  } catch (err) {
    console.error('Error adding vehicle:', err);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.getVehicles = async (req, res) => {
  const { user_id } = req.params;

  try {
    // Fetch vehicles with type info
    const [vehicles] = await pool.query(
      `
      SELECT 
        v.vehicle_number, v.brand, v.model, v.year, v.fueltype,
        CASE 
          WHEN c.vehicle_number IS NOT NULL THEN 'car'
          WHEN b.vehicle_number IS NOT NULL THEN 'bike'
          ELSE 'unknown'
        END AS type,
        c.seats, c.body_type, b.engine_cc
      FROM vehicles v
      LEFT JOIN cars c ON v.vehicle_number = c.vehicle_number
      LEFT JOIN bikes b ON v.vehicle_number = b.vehicle_number
      WHERE v.user_id = ?
      `,
      [user_id]
    );

    res.status(200).json(vehicles);
  } catch (err) {
    console.error('Error fetching vehicles:', err);
    res.status(500).json({ message: 'Server error' });
  }
};