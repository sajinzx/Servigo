const express = require('express');
const cors = require('cors');
const app = express();
const authRoutes = require('./routes/auth'); // import router
const vehicleRoutes=require('./routes/vehicle');

app.use(cors());
app.use(express.json());

// Mount the auth routes here
app.use('/api/auth', authRoutes);
app.use('/api/vehicles', vehicleRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
