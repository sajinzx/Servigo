import React, { useEffect, useState } from 'react';
import { getAllBookings, acceptBooking, deliverBooking } from '../api'; // import API calls
import './admindashboard.css';

const AdminDashboard = () => {
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchBookings();
  }, []);

  const fetchBookings = async () => {
    try {
      const res = await getAllBookings();
      setBookings(res.data.bookings);
    } catch (err) {
      console.error('Error fetching bookings:', err);
      alert('Failed to fetch bookings');
    } finally {
      setLoading(false);
    }
  };

  const handleAccept = async (booking_id) => {
    try {
      await acceptBooking(booking_id);
      alert('Booking accepted successfully!');
      fetchBookings(); // refresh list
    } catch (err) {
      console.error(err);
      alert('Failed to accept booking');
    }
  };

  const handleDeliver = async (booking_id) => {
    try {
      await deliverBooking(booking_id);
      alert('Booking delivered successfully!');
      fetchBookings(); // refresh list
    } catch (err) {
      console.error(err);
      alert('Failed to deliver booking');
    }
  };

  return (
    <div className="admin-dashboard-container">
      <h2>Admin Dashboard</h2>
      {loading ? (
        <p>Loading bookings...</p>
      ) : bookings.length === 0 ? (
        <p>No bookings available.</p>
      ) : (
        <table className="bookings-table">
          <thead>
            <tr>
              <th>Booking ID</th>
              <th>Vehicle</th>
              <th>Service</th>
              <th>Date of Request</th>
              <th>Status</th>
              <th>Price</th>
              <th>Location</th>
              <th>Payment</th>
              <th>Feedback</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {bookings.map((b) => (
              <tr key={b.booking_id}>
                <td>{b.booking_id}</td>
                <td>{b.vehicle_number}</td>
                <td>{b.service_name}</td>
                <td>{new Date(b.dateofrequest).toLocaleString()}</td>
                <td>{b.status}</td>
                <td>₹{b.price}</td>
                <td>{b.location}</td>
                <td>{b.payment_status}</td>
                <td>{b.feedback_rating || '-'}</td>
                <td>
                  {b.status === 'Pending' && (
                    <button onClick={() => handleAccept(b.booking_id)}>Accept</button>
                  )}
                  {b.status === 'Accepted' && (
                    <button onClick={() => handleDeliver(b.booking_id)}>Deliver</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};

export default AdminDashboard;
