import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { fetchVehicleServices } from '../api'; // imported from api.js
import './vehicleservices.css';

const VehicleServices = () => {
  const { vehicle_number } = useParams(); // from route param
  const [services, setServices] = useState([]);
  const [vehicleType, setVehicleType] = useState('');
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    if (vehicle_number) getServices();
  }, [vehicle_number]);

  const getServices = async () => {
    try {
      const res = await fetchVehicleServices(vehicle_number);
      setServices(res.data.services);
      setVehicleType(res.data.vehicleType);
    } catch (err) {
      console.error('Error fetching vehicle services:', err);
      alert('Unable to fetch services for this vehicle.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="services-container">
      <button className="back-btn" onClick={() => navigate('/dashboard')}>
        ← Back
      </button>

      {loading ? (
        <p>Loading services...</p>
      ) : (
        <>
          <h2 className="services-title">
            {vehicleType ? `${vehicleType.toUpperCase()} Services` : 'Vehicle Services'}
          </h2>

          {services.length === 0 ? (
            <p>No services available for this vehicle.</p>
          ) : (
            <div className="services-list">
              {services.map((s) => (
                <div key={s.service_id} className="service-card">
                  <h3>{s.service_name}</h3>
                  <p><strong>Price:</strong> ₹{s.price}</p>
                  <p><strong>Duration:</strong> {s.duration} mins</p>
                  <button className="book-btn">Book Service</button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default VehicleServices;
