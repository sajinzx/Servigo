const express = require('express');
const router = express.Router();
const { getServicesByVehicle } = require('../controllers/servicecontroller');

router.get('/:vehicle_number', getServicesByVehicle);

module.exports = router;
