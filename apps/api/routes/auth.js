// routes/auth.js
const express = require('express');
const router = express.Router();
const { signup, login } = require('../controllers/authcontroller'); // Make sure 'C' is correct

// Define your routes


router.post('/signup', signup);
router.post('/login', login);

module.exports = router;
