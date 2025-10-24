import React from 'react';
import { useNavigate } from 'react-router-dom';
import './firstpage.css';

const AdminEntry = () => {
  const navigate = useNavigate();

  return (
    <div className="entry-container">
      <h1>Welcome! Choose Your Role</h1>

      <div className="buttons-container">
        <button className="role-btn user-btn" onClick={() => navigate('/signup')}>
          User
        </button>

        <button className="role-btn mechanic-btn" onClick={() => navigate('/mechanic-signup')}>
          Mechanic
        </button>

        <button className="role-btn admin-btn" onClick={() => navigate('/admin/dashboard')}>
          Admin
        </button>
      </div>
    </div>
  );
};

export default AdminEntry;
