import React, { useEffect, useState } from 'react';
import { fetchVehicles, addVehicle } from '../api';
import { useNavigate } from 'react-router-dom';
import './dashboard.css';

const Dashboard = () => {
  const [vehicles, setVehicles] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const navigate = useNavigate();
  const [form, setForm] = useState({
    vehicle_number: '',
    brand: '',
    model: '',
    year: '',
    fueltype: '',
    type: '',
    seats: '',
    body_type: '',
    engine_cc: '',
  });

  const user_id = localStorage.getItem('user_id'); // user_id stored after login
  console.log("Logged in user_id:", user_id);

  useEffect(() => {
    if (user_id) loadVehicles();
  }, [user_id]);

  const loadVehicles = async () => {
    try {
      const res = await fetchVehicles(user_id);
      setVehicles(res.data);
    } catch (err) {
      console.error('Error fetching vehicles:', err);
    }
  };

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await addVehicle({ ...form, user_id });
      alert('✅ Vehicle added successfully!');
      setShowModal(false);
      loadVehicles(); // Refresh the list
    } catch (err) {
      alert(err.response?.data?.message || 'Error adding vehicle');
    }
  };

  return (
    <div className="dashboard-container">
      <h2 className="dashboard-title">My Vehicles</h2>
      <button className="add-btn" onClick={() => setShowModal(true)}>+ Add Vehicle</button>

      <div className="vehicle-list">
        {vehicles.length === 0 ? (
          <p>No vehicles found.</p>
        ) : (
          vehicles.map((v) => (
            <div key={v.vehicle_number} className="vehicle-card">
              <h3>{v.brand} {v.model}</h3>
              <p><strong>Vehicle No:</strong> {v.vehicle_number}</p>
              <p><strong>Year:</strong> {v.year}</p>
              <p><strong>Fuel:</strong> {v.fueltype}</p>
              {v.seats && <p><strong>Seats:</strong> {v.seats}</p>}
              {v.body_type && <p><strong>Body Type:</strong> {v.body_type}</p>}
              {v.engine_cc && <p><strong>Engine CC:</strong> {v.engine_cc}</p>}
              <button
                className="view-services-btn"
                onClick={() => navigate(`/vehicle/${v.vehicle_number}`)}
              >
                view services
              </button>
            </div>
          ))
        )}
      </div>

      {showModal && (
        <div className="modal-overlay">
          <div className="modal">
            <h3>Add Vehicle</h3>
            <form onSubmit={handleSubmit}>
              <input name="vehicle_number" placeholder="Vehicle Number" onChange={handleChange} required />
              <input name="brand" placeholder="Brand" onChange={handleChange} required />
              <input name="model" placeholder="Model" onChange={handleChange} required />
              <input name="year" placeholder="Year" onChange={handleChange} required />
              <input name="fueltype" placeholder="Fuel Type" onChange={handleChange} required />
              <select name="type" onChange={handleChange} required>
                <option value="">Select Type</option>
                <option value="car">Car</option>
                <option value="bike">Bike</option>
              </select>

              {form.type === 'car' && (
                <>
                  <input name="seats" placeholder="Seats" onChange={handleChange} required />
                  <input name="body_type" placeholder="Body Type" onChange={handleChange} required />
                </>
              )}

              {form.type === 'bike' && (
                <>
                  <input name="engine_cc" placeholder="Engine CC" onChange={handleChange} required />
                </>
              )}

              <div className="modal-buttons">
                <button type="submit">Add</button>
                <button type="button" onClick={() => setShowModal(false)}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
