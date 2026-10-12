import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import './mechanicpendingrequests.css';

const MechanicPendingRequests = () => {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(null); // track which request is updating
  const navigate = useNavigate();
  const mechanicId = localStorage.getItem('mechanicId');

  useEffect(() => {
    fetchRequests();
  }, []);

  const fetchRequests = async () => {
    try {
      setLoading(true);
      const response = await axios.get(
        `http://localhost:3000/api/mechanic/pending-requests/${mechanicId}`
      );
      setRequests(response.data || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleStatusUpdate = async (bookingId, newStatus) => {
    try {
      setUpdating(bookingId);
      await axios.put(
        `http://localhost:3000/api/mechanic/requests/${bookingId}`,
        { status: newStatus }
      );
      // Refetch the latest data
      fetchRequests();
    } catch (err) {
      console.error(err);
      alert('Failed to update request status.');
    } finally {
      setUpdating(null);
    }
  };

  if (loading) return <div className="loading">Loading...</div>;

  return (
    <div className="pending-container">
      <div className="pending-header">
        <h1>Pending Requests - {mechanicId}</h1>
        <button className="btn-primary" onClick={() => navigate('/mechanic-dashboard')}>
          Back to Dashboard
        </button>
      </div>

      {requests.length === 0 ? (
        <div className="empty-state">NO PENDING REQUESTS</div>
      ) : (
        <div className="table-wrapper">
          <table className="pending-table">
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
              {requests.map((req, idx) => (
                <tr key={req.booking_id} className={idx % 2 === 0 ? 'even' : ''}>
                  <td>{req.booking_id}</td>
                  <td>{req.service_name}</td>
                  <td>{req.customer_name}</td>
                  <td>{req.vehicle_number}</td>
                  <td>{req.location}</td>
                  <td>₹{req.price}</td>
                  <td>{new Date(req.dateofrequest).toLocaleDateString()}</td>
                  <td>
                    <span className={`status-badge ${req.status}`}>
                      {req.status.toUpperCase()}
                    </span>
                  </td>
                  <td className="actions">
                    {req.status === 'pending' && (
                      <>
                        <button
                          disabled={updating === req.booking_id}
                          className="btn-accept"
                          onClick={() => handleStatusUpdate(req.booking_id, 'accepted')}
                        >
                          Accept
                        </button>
                        <button
                          disabled={updating === req.booking_id}
                          className="btn-hold"
                          onClick={() => handleStatusUpdate(req.booking_id, 'held')}
                        >
                          Hold
                        </button>
                      </>
                    )}

                    {req.status === 'held' && (
                      <>
                        <button
                          disabled={updating === req.booking_id}
                          className="btn-accept"
                          onClick={() => handleStatusUpdate(req.booking_id, 'accepted')}
                        >
                          Accept
                        </button>
                        <button
                          disabled={updating === req.booking_id}
                          className="btn-deny"
                          onClick={() => handleStatusUpdate(req.booking_id, 'cancelled')}
                        >
                          Deny
                        </button>
                      </>
                    )}

                    {req.status === 'accepted' && (
                      <button
                        disabled={updating === req.booking_id}
                        className="btn-start"
                        onClick={() => handleStatusUpdate(req.booking_id, 'in_progress')}
                      >
                        Start Work
                      </button>
                    )}

                    {req.status === 'in_progress' && (
                      <button
                        disabled={updating === req.booking_id}
                        className="btn-complete"
                        onClick={() => handleStatusUpdate(req.booking_id, 'delivered')}
                      >
                        Complete
                      </button>
                    )}
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
