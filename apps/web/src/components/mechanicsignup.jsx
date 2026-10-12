import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { mechanicSignup } from '../api'; // ✅ imported from your api.js
import './MechanicSignup.css';

const MechanicSignup = () => {
  const [formData, setFormData] = useState({
    mechanicId: '',
    numberOfEmployees: '',
    location: '',
    contactNumber: '',
    rating: '',
    password: ''
  });

  const navigate = useNavigate();

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await mechanicSignup(formData);
      alert('Mechanic registered successfully!');
      navigate('/mechanic-login');
    } catch (error) {
      alert('Registration failed: ' + (error.response?.data?.message || error.message));
    }
  };

  return (
    <div className="mechanic-signup-container">
      <div className="mechanic-signup-card">
        <h2>Mechanic Signup</h2>
        <p>Create your mechanic account below</p>

        <form onSubmit={handleSubmit} className="mechanic-signup-form">
          <input
            type="text"
            name="mechanicId"
            placeholder="Mechanic ID (e.g., MECH_1016)"
            value={formData.mechanicId}
            onChange={handleChange}
            required
          />
          <input
            type="number"
            name="numberOfEmployees"
            placeholder="Number of Employees"
            value={formData.numberOfEmployees}
            onChange={handleChange}
            required
          />
          <input
            type="text"
            name="location"
            placeholder="Location"
            value={formData.location}
            onChange={handleChange}
            required
          />
          <input
            type="tel"
            name="contactNumber"
            placeholder="Contact Number"
            value={formData.contactNumber}
            onChange={handleChange}
            required
          />
          <input
            type="number"
            name="rating"
            placeholder="Rating (0–5)"
            min="0"
            max="5"
            step="0.1"
            value={formData.rating}
            onChange={handleChange}
            required
          />
          <input
            type="password"
            name="password"
            placeholder="Password"
            value={formData.password}
            onChange={handleChange}
            required
          />

          <button type="submit" className="signup-btn">Sign Up</button>
        </form>

        <p className="login-link">
          Already have an account?{' '}
          <span onClick={() => navigate('/mechanic-login')}>Login here</span>
        </p>
      </div>
    </div>
  );
};

export default MechanicSignup;
