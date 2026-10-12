const express = require('express');
const router = express.Router();
const {
  mechanicSignup,
  mechanicLogin,
  getMechanicServices,
  addService,
  removeService,
  getAvailableServices,
  getServiceRequests,
  getPendingRequests,
  updateRequestStatus,
  toggleServiceAvailability
} = require('../controllers/mechaniccontroller');

// Auth routes
router.post('/signup', mechanicSignup);
router.post('/login', mechanicLogin);

// Service management routes
router.get('/services/:mechanicId', getMechanicServices);
router.get('/available-services/:mechanicId', getAvailableServices);
router.post('/services', addService);
router.delete('/services/:mechanicId/:serviceId', removeService);

// Request management routes
router.get('/requests/:mechanicId', getServiceRequests);
router.get('/pending-requests/:mechanicId', getPendingRequests);
router.put('/requests/:bookingId', updateRequestStatus);

// Service availability toggle
router.put('/services/:mechanicId/:serviceId/toggle', toggleServiceAvailability);

module.exports = router;