const pool = require('../database');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');

const JWT_SECRET = 'your_jwt_secret_key';

exports.signup = async (req, res) => {
  try {
    const {
      name,
      phone,
      dateofbirth,
      office_address_stno,
      office_address_city,
      office_address_district,
      office_address_state,
      office_address_country,
      home_address_stno,
      home_address_city,
      home_address_district,
      home_address_state,
      home_address_country,
      email,
      password
    } = req.body;
    const [existing] = await pool.query("SELECT * FROM users WHERE email = ?", [email]);
    if (existing.length > 0) {
      return res.status(400).json({ message: "Email already registered" });
    }
    //const hashedPassword = await bcrypt.hash(password, 10);
    const user_id = uuidv4(); 
    const datejoined = new Date();
    
    await pool.query(
      `INSERT INTO users (
        user_id, name, phone, dateofbirth,
        office_address_stno, office_address_city, office_address_district,
        office_address_state, office_address_country,
        home_address_stno, home_address_city, home_address_district,
        home_address_state, home_address_country,
        email, totalspent, password, datejoined
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        user_id, name, phone, dateofbirth,
        office_address_stno, office_address_city, office_address_district,
        office_address_state, office_address_country,
        home_address_stno, home_address_city, home_address_district,
        home_address_state, home_address_country,
        email, 0.00, password, datejoined
      ]
    );
    res.status(201).json({ message: "User registered successfully", user_id });
    } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};

exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const [users] = await pool.query("SELECT * FROM users WHERE email = ?", [email]);
    if (users.length === 0) {
      return res.status(400).json({ message: "Invalid email or password" });
    }

    const user = users[0];
    //const validPassword = await bcrypt.compare(password, user.password);
    
    const validPassword = password === user.password;

    if (!validPassword) {
      return res.status(400).json({ message: "Invalid email or password" });
    }

    const token = jwt.sign(
      { user_id: user.user_id, email: user.email },
      JWT_SECRET,
      { expiresIn: "1h" }
    );

    res.status(200).json({
      message: "Login successful",
      token,
      user: {
        user_id: user.user_id,
        name: user.name,
        email: user.email,
        phone: user.phone,
      },
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
};