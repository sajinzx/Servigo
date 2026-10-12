import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { fetchVehicleServices, bookService } from '../api';
import './vehicleservices.css';

const VehicleServices = () => {
  const { vehicle_number } = useParams();
  const navigate = useNavigate();
  const [services, setServices] = useState([]);
  const [vehicleType, setVehicleType] = useState('');
  const [loading, setLoading] = useState(true);

  const user_id = localStorage.getItem('user_id');

  // Booking modal states
  const [selectedService, setSelectedService] = useState(null);
  const [location, setLocation] = useState('');
  const [showModal, setShowModal] = useState(false);

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

  const handleBookClick = (service) => {
    setSelectedService(service);
    setShowModal(true);
  };

  const handleBookingSubmit = async () => {
    if (!location) {
      alert('Please select a location');
      return;
    }

    try {
      const res = await bookService({
        user_id,
        vehicle_number,
        service_id: selectedService.service_id,
        price: selectedService.price,
        location
      });

      alert(`Service booked! Assigned mechanic: ${res.data.assignedMechanic}`);
      setShowModal(false);
    } catch (err) {
      console.error(err);
      alert(err.response?.data?.message || 'Booking failed');
    }
  };

  return (
    <div className="services-container">
      <div className="top-buttons">
        <button className="back-btn" onClick={() => navigate('/dashboard')}>
          ← Back
        </button>
        <button
          className="pending-btn"
          onClick={() => navigate('/pending-bookings')}
        >
          View Pending Services
        </button>
      </div>

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
                  <button className="book-btn" onClick={() => handleBookClick(s)}>
                    Book Service
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Booking Modal */}
          {showModal && (
            <div className="modal-overlay">
              <div className="modal">
                <h3>Choose Location</h3>
                <select value={location} onChange={(e) => setLocation(e.target.value)}>
                  <option value="">Select Location</option>
                  <option value="Home">Home</option>
                  <option value="Office">Office</option>
                  <option value="Other">Other</option>
                </select>
                {location === 'Other' && (
                  <input
                    type="text"
                    placeholder="Enter your city"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                  />
                )}
                <div className="modal-buttons">
                  <button className="confirm-btn" onClick={handleBookingSubmit}>
                    Confirm Booking
                  </button>
                  <button className="cancel-btn" onClick={() => setShowModal(false)}>
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default VehicleServices;
