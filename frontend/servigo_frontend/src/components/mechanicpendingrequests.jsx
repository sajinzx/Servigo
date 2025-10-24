import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getPendingRequests, updateRequestStatus as updateRequestStatusAPI } from '../api';
import './mechanicpendingrequests.css';

const MechanicPendingRequests = () => {
  const [pendingRequests, setPendingRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const mechanicId = localStorage.getItem('mechanicId');

  useEffect(() => {
    fetchPendingRequests();
  }, []);

  const fetchPendingRequests = async () => {
    try {
      const response = await getPendingRequests(mechanicId);
      setPendingRequests(response.data);
    } catch (error) {
      console.error('Error fetching pending requests:', error);
    } finally {
      setLoading(false);
    }
  };

  const updateRequestStatus = async (bookingId, status) => {
    try {
      await updateRequestStatusAPI(bookingId, status);
      fetchPendingRequests();
    } catch (error) {
      alert('Error updating request status');
    }
  };

  if (loading) return <div className="loading">Loading...</div>;

  return (
    <div className="pending-requests-container">
      <div className="header">
        <h1>Pending Requests - {mechanicId}</h1>
        <button className="btn-back" onClick={() => navigate('/modern-mechanic-dashboard')}>
          Back to Dashboard
        </button>
      </div>

      {pendingRequests.length === 0 ? (
        <div className="no-requests">NO PENDING REQUESTS</div>
      ) : (
        <div className="table-wrapper">
          <table className="requests-table">
            <thead>
              <tr>
                <th>Booking ID</th>
                <th>Service</th>
                <th>Customer</th>
                <th>Vehicle</th>
                <th>Location</th>
                <th>Price</th>
                <th>Request Date</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {pendingRequests.map((request, index) => (
                <tr key={request.booking_id} className={index % 2 === 0 ? 'even' : 'odd'}>
                  <td>{request.booking_id}</td>
                  <td>{request.service_name}</td>
                  <td>{request.customer_name}</td>
                  <td>{request.vehicle_number}</td>
                  <td>{request.location}</td>
                  <td>₹{request.price}</td>
                  <td>{new Date(request.dateofrequest).toLocaleDateString()}</td>
                  <td>
                    <span className={`status-badge ${request.status}`}>{request.status.toUpperCase()}</span>
                  </td>
                  <td>
                    <div className="actions">
                      {request.status === 'pending' && (
                        <>
                          <button onClick={() => updateRequestStatus(request.booking_id, 'accepted')} className="btn-accept">Accept</button>
                          <button onClick={() => updateRequestStatus(request.booking_id, 'held')} className="btn-hold">Hold</button>
                        </>
                      )}
                      {request.status === 'held' && (
                        <>
                          <button onClick={() => updateRequestStatus(request.booking_id, 'accepted')} className="btn-accept">Accept</button>
                          <button onClick={() => updateRequestStatus(request.booking_id, 'cancelled')} className="btn-deny">Deny</button>
                        </>
                      )}
                      {request.status === 'accepted' && (
                        <button onClick={() => updateRequestStatus(request.booking_id, 'in_progress')} className="btn-start">Start Work</button>
                      )}
                      {request.status === 'in_progress' && (
                        <button onClick={() => updateRequestStatus(request.booking_id, 'delivered')} className="btn-complete">Complete</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default MechanicPendingRequests;
