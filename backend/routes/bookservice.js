const express = require('express');
const router = express.Router();
const { bookService } = require('../controllers/bookservicecontroller');

// Route to book a service
router.post('/', bookService);

module.exports = router;
