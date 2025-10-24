import React from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Signup from './components/signup';
import Login from './components/login';
import Dashboard from './components/dashboard';
import VehicleServices from './components/vehicleservices'; 
import PendingBookings from './components/pendingbookings';
import BookService from './components/bookservice'; // New component for booking location selection
import AdminEntry from './components/firstpage';
import AdminDashboard from './components/admindashboard';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<AdminEntry />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/login" element={<Login />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/vehicle/:vehicle_number" element={<VehicleServices />} />
        <Route path="/bookservice/:vehicle_number/:service_id" element={<BookService />} /> {/* BookService route */}
        <Route path="/pending-bookings" element={<PendingBookings />} />
        <Route path="/admin/dashboard" element={<AdminDashboard />} />
      </Routes>
    </Router>
  );
}

export default App;
