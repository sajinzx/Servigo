import React, { useEffect, useState } from 'react';
import { fetchPendingBookings } from '../api';
import "./pendingbookings.css";

const PendingBookings = () => {
  const [bookings, setBookings] = useState([]);
  const user_id = localStorage.getItem('user_id');

  useEffect(() => {
    if (user_id) loadPendingBookings();
  }, [user_id]);

  const loadPendingBookings = async () => {
    try {
      const res = await fetchPendingBookings(user_id);
      setBookings(res.data.pendingBookings);
    } catch (err) {
      console.error('Error fetching pending bookings:', err);
    }
  };

  return (
    <div>
      <h2>Pending Bookings</h2>
      {bookings.length === 0 ? (
        <p>No pending bookings.</p>
      ) : (
        bookings.map((b) => (
          <div key={b.booking_id} className="booking-card">
            <p><strong>Vehicle:</strong> {b.vehicle_number}</p>
            <p><strong>Service:</strong> {b.service_name}</p>
            <p><strong>Status:</strong> {b.status}</p>
            <p><strong>Price:</strong> ₹{b.price}</p>
            <p><strong>Requested on:</strong> {b.dateofrequest}</p>
          </div>
        ))
      )}
    </div>
  );
};

export default PendingBookings;
