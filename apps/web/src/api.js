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

export const getAllBookings = () => API.get('/admin/bookings');
export const acceptBooking = (booking_id) => API.put(`/admin/bookings/accept/${booking_id}`);
export const deliverBooking = (booking_id) => API.put(`/admin/bookings/deliver/${booking_id}`);

// 🧰 Mechanic-related APIs
export const mechanicSignup = async (mechanicData) => {
  return await API.post('/mechanic/signup', mechanicData);
};

export const mechanicLogin = async (credentials) => {
  return await API.post('/mechanic/login', credentials);
};



export const getMechanicServices = async (mechanicId) => {
  return await API.get(`/mechanic/services/${mechanicId}`);
};

// api.js
export const getAvailableServices = async (mechanicId) => {
  if (!mechanicId) return []; // safety
  try {
    const response = await axios.get(`/mechanic/available-services/${mechanicId}`);
    return response.data; // should be array
  } catch (error) {
    console.error('Error fetching available services:', error);
    return [];
  }
};


export const addService = async (mechanicId, serviceId) => {
  return await API.post('/mechanic/services', { mechanicId, serviceId });
};

export const removeService = async (mechanicId, serviceId) => {
  return await API.delete(`/mechanic/services/${mechanicId}/${serviceId}`);
};

export const getServiceRequests = async (mechanicId) => {
  return await API.get(`/mechanic/requests/${mechanicId}`);
};



export const getPendingRequests = async (mechanicId) => {
  return await API.get(`/mechanic/pending-requests/${mechanicId}`);
};

export const updateRequestStatus = async (bookingId, status) => {
  return await API.put(`/mechanic/request/${bookingId}`, { status });
};



