const pool = require('../database');

// Get Service History for a user
exports.getServiceHistory = async (req, res) => {
  const { userId } = req.params;

  try {
    console.log('Fetching service history for user:', userId);

    // Check if service_history table exists
    const [tableCheck] = await pool.execute('SHOW TABLES LIKE "service_history"');
    if (tableCheck.length === 0) {
      console.log('Service_history table does not exist');
      return res.json([]);
    }

    const [rows] = await pool.execute(
      `
      SELECT 
        sh.history_id,
        sh.booking_id,
        sh.dateofrequest,
        sh.datedelivered,
        sh.status,
        sh.price,
        sh.payment_status,
        sh.feedback_rating,
        sh.location,
        sh.mechanic_id,
        sh.vehicle_number,
        s.service_name
      FROM service_history sh
      JOIN service s ON sh.service_id = s.service_id
      WHERE sh.user_id = ?
      ORDER BY sh.dateofrequest DESC
      `,
      [userId]
    );

    console.log('Found service history records:', rows.length);
    res.json(rows);
  } catch (error) {
    console.error('Error fetching service history:', error);
    res.status(500).json({ message: 'Server error', error: error.message });
  }
};
