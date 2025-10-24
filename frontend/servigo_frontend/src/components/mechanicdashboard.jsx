import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getMechanicServices,
  addMechanicService,
  removeMechanicService,
  getServiceRequests
} from '../api';
import './mechanicdashboard.css';

const ModernMechanicDashboard = () => {
  const [mechanicServices, setMechanicServices] = useState([]);
  const [allServices, setAllServices] = useState([]);
  const [requests, setRequests] = useState([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedServiceId, setSelectedServiceId] = useState('');
  const [loading, setLoading] = useState(true);

  const navigate = useNavigate();
  const mechanicId = localStorage.getItem('mechanicId') || 'MECH_1001';

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [servicesRes, requestsRes] = await Promise.all([
        getMechanicServices(mechanicId),
        getServiceRequests(mechanicId)
      ]);

      setMechanicServices(servicesRes.data);
      setRequests(requestsRes.data);
      // Assuming allServices is returned from same API, you can adjust
      setAllServices(servicesRes.data); 
    } catch (error) {
      console.error('Failed to load data', error);
    } finally {
      setLoading(false);
    }
  };

  const addService = async () => {
    if (!selectedServiceId) return;
    try {
      await addMechanicService(mechanicId, selectedServiceId);
      setShowAddModal(false);
      setSelectedServiceId('');
      fetchData();
    } catch (error) {
      alert('Error adding service');
    }
  };

  const removeService = async (serviceId) => {
    try {
      await removeMechanicService(mechanicId, serviceId);
      fetchData();
    } catch (error) {
      alert('Error removing service');
    }
  };

  const getServiceStatus = (serviceId) => {
    const activeRequest = requests.find(
      r => r.service_id === serviceId && ['accepted', 'in_progress'].includes(r.status)
    );
    return activeRequest ? 'BUSY' : 'AVAILABLE';
  };

  const logout = () => {
    localStorage.removeItem('mechanicId');
    localStorage.removeItem('mechanicToken');
    navigate('/');
  };

  if (loading) return <div className="dashboard-loading">Loading dashboard...</div>;

  return (
    <div className="dashboard-container">
      <header className="dashboard-header">
        <h1>Mechanic Dashboard</h1>
        <div className="dashboard-mechanicId">{mechanicId}</div>
        <div className="dashboard-header-buttons">
          <button onClick={() => navigate('/mechanic-pending-requests')} className="btn-primary">
            Pending Requests
          </button>
          <button onClick={logout} className="btn-secondary">
            Logout
          </button>
        </div>
      </header>

      <main className="dashboard-main">
        <section className="dashboard-section">
          <div className="section-header">
            <h2>My Services</h2>
            <button onClick={() => setShowAddModal(true)} className="btn-primary">
              + Add Service
            </button>
          </div>

          <div className="services-list">
            {mechanicServices.length === 0 && (
              <div className="empty-state">
                <p>No services added yet</p>
                <p>Click "Add Service" to get started</p>
              </div>
            )}

            {mechanicServices.map(service => {
              const status = getServiceStatus(service.service_id);
              return (
                <div key={service.service_id} className="service-card">
                  <div className="card-header">
                    <h3>{service.service_name}</h3>
                    <span className={`status-badge ${status === 'BUSY' ? 'busy' : 'available'}`}>
                      {status}
                    </span>
                  </div>
                  <div className="service-details">
                    <span className="cost">₹{service.cost}</span>
                    <span className="duration">{service.estimated_duration} mins</span>
                  </div>
                  <button
                    onClick={() => removeService(service.service_id)}
                    disabled={status === 'BUSY'}
                    className={`btn-remove ${status === 'BUSY' ? 'disabled' : ''}`}
                  >
                    {status === 'BUSY' ? 'In Use' : 'Remove'}
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      </main>

      {showAddModal && (
        <div className="modal-overlay">
          <div className="modal">
            <h3>Add New Service</h3>
            <select value={selectedServiceId} onChange={(e) => setSelectedServiceId(e.target.value)}>
              <option value="">Select a service</option>
              {allServices.map(service => (
                <option key={service.service_id} value={service.service_id}>
                  {service.service_name} - ₹{service.cost} ({service.estimated_duration} mins)
                </option>
              ))}
            </select>
            <div className="modal-actions">
              <button onClick={() => setShowAddModal(false)} className="btn-secondary">Cancel</button>
              <button onClick={addService} disabled={!selectedServiceId} className="btn-primary">
                Add Service
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ModernMechanicDashboard;
