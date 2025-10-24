import React, { useState, useRef, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { bookService } from '../api';
import './bookservice.css';

const BookService = () => {
  const { vehicle_number, service_id } = useParams();
  const navigate = useNavigate();
  const inputRef = useRef(null);

  const [selectedOption, setSelectedOption] = useState('');
  const [customLocation, setCustomLocation] = useState('');

  // Focus the input when "other" option is selected
  useEffect(() => {
    if (selectedOption === 'other' && inputRef.current) {
      inputRef.current.focus();
    }
  }, [selectedOption]);

  const handleBook = async () => {
    const user_id = localStorage.getItem('user_id');

    let finalLocation = '';
    if (!selectedOption) {
      alert('Please select a location');
      return;
    }

    if (selectedOption === 'other') {
      if (!customLocation.trim()) {
        alert('Please enter your city for the new location');
        return;
      }
      finalLocation = customLocation.trim();
    } else {
      finalLocation = selectedOption;
    }

    try {
      const res = await bookService({
        user_id,
        vehicle_number,
        service_id,
        location: finalLocation
      });

      alert(`Service booked successfully! Assigned Mechanic: ${res.data.assignedMechanic}`);
      navigate('/pending-bookings');
    } catch (err) {
      console.error('Error booking service:', err);
      alert(err.response?.data?.message || 'Error booking service');
    }
  };

  const handleInputChange = (e) => {
    setCustomLocation(e.target.value);
  };

  const handleInputMouseDown = (e) => {
    e.stopPropagation();
    e.preventDefault();
  };

  const handleInputClick = (e) => {
    e.stopPropagation();
  };

  const handleKeyDown = (e) => {
    e.stopPropagation();
  };

  return (
    <div className="bookservice-container">
      <h2>Choose Service Location</h2>

      <div className="location-options">
        <label>
          <input
            type="radio"
            name="location"
            value="home"
            checked={selectedOption === 'home'}
            onChange={(e) => setSelectedOption(e.target.value)}
          />
          Home
        </label>

        <label>
          <input
            type="radio"
            name="location"
            value="office"
            checked={selectedOption === 'office'}
            onChange={(e) => setSelectedOption(e.target.value)}
          />
          Office
        </label>

        <label>
          <input
            type="radio"
            name="location"
            value="other"
            checked={selectedOption === 'other'}
            onChange={(e) => setSelectedOption(e.target.value)}
          />
          Other
        </label>

        {selectedOption === 'other' && (
          <div 
            className="new-location-input" 
            onClick={handleInputClick}
            onMouseDown={handleInputMouseDown}
          >
            <input
              ref={inputRef}
              type="text"
              placeholder="Enter your city"
              value={customLocation}
              onChange={handleInputChange}
              onClick={handleInputClick}
              onMouseDown={handleInputMouseDown}
              onKeyDown={handleKeyDown}
              onFocus={handleInputClick}
            />
          </div>
        )}
      </div>

      <div className="bookservice-buttons">
        <button className="confirm-btn" onClick={handleBook}>
          Confirm Booking
        </button>
        <button className="cancel-btn" onClick={() => navigate(-1)}>
          Cancel
        </button>
      </div>
    </div>
  );
};

export default BookService;