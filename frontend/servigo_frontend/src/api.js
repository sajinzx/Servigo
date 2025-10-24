import axios from 'axios';

const API = axios.create({
  baseURL: 'http://localhost:3000/api', // your backend URL
});

export const signupUser = async (userData) => {
  return await API.post('/auth/signup', userData);
};

export const loginUser = async (credentials) => {
  return await API.post('/auth/login', credentials);
};

// Fetch all vehicles of a user
export const fetchVehicles = async (userId) => {
  return await API.get(`/vehicles/${userId}`);
};

// Add a new vehicle
export const addVehicle = async (vehicleData) => {
  return await API.post('/vehicles/addvehicles', vehicleData);
};


export const fetchVehicleServices = async (vehicle_number) => {
  return await API.get(`/vehicles/services/${vehicle_number}`);
};

export const fetchPendingBookings = (user_id) => {
  return API.get(`/bookings/${user_id}`);
};


export const bookService = async (bookingData) => {
  return await API.post('/bookservice', bookingData);
};
