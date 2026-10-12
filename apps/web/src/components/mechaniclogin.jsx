import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { mechanicLogin } from '../api';
import './mechaniclogin.css';

const MechanicLogin = () => {
  const [formData, setFormData] = useState({
    mechanicId: '',
    password: ''
  });
  const navigate = useNavigate();

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const response = await mechanicLogin(formData);
      localStorage.setItem('mechanicToken', response.data.token);
      localStorage.setItem('mechanicId', response.data.mechanic.mechanic_id);
      navigate('/mechanic-dashboard');
    } catch (error) {
      alert('Login failed: ' + (error.response?.data?.message || error.message));
    }
  };

  return (
    <div className="mechanic-login-container">
      <div className="mechanic-login-card">
        <h2>Mechanic Login</h2>
        <p>Sign in to access your service dashboard</p>

        <form onSubmit={handleSubmit}>
          <label htmlFor="mechanicId">Mechanic ID</label>
          <input
            type="text"
            id="mechanicId"
            name="mechanicId"
            placeholder="Enter Mechanic ID"
            value={formData.mechanicId}
            onChange={handleChange}
            required
          />

          <label htmlFor="password">Password</label>
          <input
            type="password"
            id="password"
            name="password"
            placeholder="Enter Password"
            value={formData.password}
            onChange={handleChange}
            required
          />

          <button type="submit" className="login-btn">Login</button>

          <p className="signup-link">
            Don’t have an account?{' '}
            <span onClick={() => navigate('/mechanic-signup')}>Sign up</span>
          </p>
        </form>
      </div>
    </div>
  );
};

export default MechanicLogin;
