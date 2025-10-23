import React from 'react';
import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';
import Signup from './components/signup';
import Login from './components/login';
import Dashboard from './components/dashboard';

function App() {
  return (
    <Router>
      
      <Routes>
        <Route path="/signup" element={<Signup />} />
        <Route path="/login" element={<Login />} />
        <Route path="/dashboard" element={<Dashboard />} />

      </Routes>
    </Router>
  );
}

export default App;
