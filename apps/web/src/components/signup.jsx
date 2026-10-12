import React, { useState } from 'react';
import { signupUser } from '../api';
import { useNavigate } from 'react-router-dom';
import './signup.css';

const Signup = () => {
  const [form, setForm] = useState({
    name: '',
    phone: '',
    dateofbirth: '',
    email: '',
    password: '',
    office_address_stno: '',
    office_address_city: '',
    office_address_district: '',
    office_address_state: '',
    office_address_country: '',
    home_address_stno: '',
    home_address_city: '',
    home_address_district: '',
    home_address_state: '',
    home_address_country: '',
  });
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await signupUser(form);
      alert('Signup successful!');
      navigate('/login');
    } catch (err) {
      setError(err.response?.data?.message || 'Signup failed');
    }
  };

  return (
    <div className="signup-container">
      <h2 className="head">Signup</h2>
      <form onSubmit={handleSubmit}>
        {/* Basic Info */}
        <h3>Basic Info</h3>
        <input name="name" placeholder="Name" onChange={handleChange} required />
        <input name="phone" placeholder="Phone" onChange={handleChange} required />
        <input type="date" name="dateofbirth" onChange={handleChange} required />
        <input name="email" placeholder="Email" onChange={handleChange} required />
        <input type="password" name="password" placeholder="Password" onChange={handleChange} required />

        {/* Office Address */}
        <h3>Office Address</h3>
        <input name="office_address_stno" placeholder="Street No" onChange={handleChange} required />
        <input name="office_address_city" placeholder="City" onChange={handleChange} required />
        <input name="office_address_district" placeholder="District" onChange={handleChange} required />
        <input name="office_address_state" placeholder="State" onChange={handleChange} required />
        <input name="office_address_country" placeholder="Country" onChange={handleChange} required />

        {/* Home Address */}
        <h3>Home Address</h3>
        <input name="home_address_stno" placeholder="Street No" onChange={handleChange} required />
        <input name="home_address_city" placeholder="City" onChange={handleChange} required />
        <input name="home_address_district" placeholder="District" onChange={handleChange} required />
        <input name="home_address_state" placeholder="State" onChange={handleChange} required />
        <input name="home_address_country" placeholder="Country" onChange={handleChange} required />

        <div className="buttons">
          <button type="submit">Signup</button>
          <button
          type="button"
          className="secondary-btn"
          onClick={() => navigate('/login')}
          >Login
          </button>
        </div>
      </form>

      {error && <p className="error">{error}</p>}
    </div>
  );
};

export default Signup;
