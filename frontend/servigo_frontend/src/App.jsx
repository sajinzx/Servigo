import React from 'react';
import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';
import Signup from './components/signup';
import Login from './components/login';
import Dashboard from './components/dashboard';
import VehicleServices from './components/vehicleservices'; 

function App() {
  return (
    <Router>
      
      <Routes>
        <Route path="/signup" element={<Signup />} />
        <Route path="/login" element={<Login />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/vehicle/:vehicle_number" element={<VehicleServices />} />
      </Routes>
    </Router>
  );
}

export default App;
