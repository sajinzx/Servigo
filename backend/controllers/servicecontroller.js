const pool = require('../database');

// Fetch services based on vehicle number
exports.getServicesByVehicle = async (req, res) => {
  const { vehicle_number } = req.params;

  try {
    // Check if vehicle exists in cars table
    const [cars] = await pool.query(
      'SELECT vehicle_number FROM cars WHERE vehicle_number = ?',
      [vehicle_number]
    );

    let vehicleType;

    if (cars.length > 0) {
      vehicleType = 'car';
    } else {
      // Check in bikes table
      const [bikes] = await pool.query(
        'SELECT vehicle_number FROM bikes WHERE vehicle_number = ?',
        [vehicle_number]
      );

      if (bikes.length > 0) {
        vehicleType = 'bike';
      } else {
        return res.status(404).json({ message: 'Vehicle not found' });
      }
    }

    // Fetch services for this type
    // Fetch services for this type
    const [services] = await pool.query(
      'SELECT service_id, service_name, cost AS price, estimated_duration AS duration FROM service WHERE service_id LIKE ?',
      [`${vehicleType.toUpperCase()}_%`]
    );

    res.status(200).json({ vehicle_number, vehicleType, services });

  } catch (err) {
    console.error('Error fetching services:', err);
    res.status(500).json({ message: 'Server error' });
  }
};
