const express = require('express');
const router = express.Router();
const vehiclecontroller = require('../controllers/vehiclecontroller');
const { addVehicle ,getVehicles} = require('../controllers/vehiclecontroller');


router.post('/addvehicles', vehiclecontroller.addVehicle);
router.get('/:user_id', vehiclecontroller.getVehicles);
module.exports = router;
