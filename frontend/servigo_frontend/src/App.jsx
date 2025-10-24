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
import MechanicSignup from './components/mechanicsignup';
import MechanicLogin from './components/mechaniclogin';
import ModernMechanicDashboard from './components/mechanicdashboard';
import MechanicPendingRequests from './components/mechanicpendingrequests';


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
        <Route path="/mechanic-signup" element={<MechanicSignup />} />
        <Route path="/mechanic-login" element={<MechanicLogin />} />
        <Route path="/mechanic-dashboard" element={<ModernMechanicDashboard />} />
        <Route path="/mechanic-pending-requests" element={<MechanicPendingRequests />} />
      </Routes>
    </Router>
  );
}

export default App;
