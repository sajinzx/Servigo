const express = require('express');
const cors = require('cors');
const app = express();
const authRoutes = require('./routes/auth'); // import router
const vehicleRoutes=require('./routes/vehicle');
const serviceRoutes = require('./routes/service');
const bookingRoutes = require('./routes/booking');
const bookServiceRoutes = require('./routes/bookservice');
const adminDashboardRoutes = require('./routes/admindashboard');




app.use(cors());
app.use(express.json());

// Mount the auth routes here
app.use('/api/auth', authRoutes);
app.use('/api/vehicles', vehicleRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/bookservice', bookServiceRoutes);
app.use('/api/vehicles/services', serviceRoutes);
app.use('/api/admin', adminDashboardRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
