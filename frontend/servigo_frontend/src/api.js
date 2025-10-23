import axios from 'axios';

// Base URL of your backend
const API = axios.create({
  baseURL: 'http://localhost:3000/api',
});

// Signup request
export const signupUser = async (userData) => {
  return await API.post('/auth/signup', userData);
};

// Login request
export const loginUser = async (credentials) => {
  return await API.post('/auth/login', credentials);
};
