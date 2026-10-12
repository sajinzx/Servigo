create database ServiGo;
use ServiGo;
CREATE TABLE users (
    user_id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(100),
    phone VARCHAR(15),
    dateofbirth DATE,

    -- Office address fields
    office_address_stno VARCHAR(20),
    office_address_city VARCHAR(50),
    office_address_district VARCHAR(50),
    office_address_state VARCHAR(50),
    office_address_country VARCHAR(50),

    -- Home address fields
    home_address_stno VARCHAR(20),
    home_address_city VARCHAR(50),
    home_address_district VARCHAR(50),
    home_address_state VARCHAR(50),
    home_address_country VARCHAR(50),

    email VARCHAR(100),
    totalspent DECIMAL(20,2),
    password VARCHAR(255),
    datejoined DATE
);

CREATE TABLE vehicles (
    vehicle_number VARCHAR(20) PRIMARY KEY,
    user_id VARCHAR(50),
    brand VARCHAR(50),
    model VARCHAR(50),
    year YEAR,
    fueltype VARCHAR(20),
    
    FOREIGN KEY (user_id) REFERENCES users(user_id)
);

CREATE TABLE cars (
    vehicle_number VARCHAR(20) PRIMARY KEY,
    seats INT,
    body_type VARCHAR(50),
    FOREIGN KEY (vehicle_number) REFERENCES vehicles(vehicle_number)
);

CREATE TABLE bikes (
    vehicle_number VARCHAR(20) PRIMARY KEY,
    engine_cc INT,
    type VARCHAR(50),
    FOREIGN KEY (vehicle_number) REFERENCES vehicles(vehicle_number)
);

CREATE TABLE mechanic (
    mechanic_id VARCHAR(50) PRIMARY KEY,
    availability_status VARCHAR(20),
    number_of_employees INT,
    location VARCHAR(100),
    contact_number VARCHAR(15),
    rating FLOAT CHECK (rating BETWEEN 0 AND 5),
    password VARCHAR(255)
);

CREATE TABLE service(
	service_id varchar(50) PRIMARY KEY,
    cost INT,
    estimated_duration INT,
    service_name varchar(50)
);

CREATE TABLE bookingreq (
    booking_id VARCHAR(50) PRIMARY KEY,
    dateofrequest DATE,
    status VARCHAR(50),
    price INT,
    datedelivered DATE,
    payment_status VARCHAR(50),
    feedback_rating FLOAT CHECK (feedback_rating BETWEEN 0 AND 5),
    location VARCHAR(50),

	user_id VARCHAR(50),
    mechanic_id VARCHAR(50),
    vehicle_number VARCHAR(50),
    service_id VARCHAR(50),

	FOREIGN KEY (user_id) REFERENCES users(user_id),
    FOREIGN KEY (mechanic_id) REFERENCES mechanic(mechanic_id),
    FOREIGN KEY (vehicle_number) REFERENCES vehicles(vehicle_number),
    FOREIGN KEY (service_id) REFERENCES service(service_id)
);

CREATE TABLE mechanic_services (
    mechanic_id VARCHAR(50),
    service_id VARCHAR(50),
    PRIMARY KEY (mechanic_id, service_id),
    FOREIGN KEY (mechanic_id) REFERENCES mechanic(mechanic_id),
    FOREIGN KEY (service_id) REFERENCES service(service_id)
);

CREATE TABLE service_history (
    history_id VARCHAR(50) PRIMARY KEY,  -- can reuse booking_id or generate new UUID
    booking_id VARCHAR(50),              -- original booking ID
    dateofrequest DATETIME,
    datedelivered DATETIME,
    status VARCHAR(50),
    price INT,
    payment_status VARCHAR(50),
    feedback_rating FLOAT CHECK (feedback_rating BETWEEN 0 AND 5),
    location VARCHAR(50),

    user_id VARCHAR(50),
    mechanic_id VARCHAR(50),
    vehicle_number VARCHAR(50),
    service_id VARCHAR(50),

    FOREIGN KEY (user_id) REFERENCES users(user_id),
    FOREIGN KEY (mechanic_id) REFERENCES mechanic(mechanic_id),
    FOREIGN KEY (vehicle_number) REFERENCES vehicles(vehicle_number),
    FOREIGN KEY (service_id) REFERENCES service(service_id)
);

INSERT INTO mechanic (mechanic_id, availability_status, number_of_employees, location, contact_number, rating)
VALUES
('MECH_1001', 'Available', 5, 'AnnaNagarChennai', '9840012345', 4.5),
('MECH_1002', 'Busy', 8, 'TNagarChennai', '9840056789', 4.2),
('MECH_1003', 'Available', 3, 'VelacheryChennai', '9884011111', 3.8),
('MECH_1004', 'On-call', 2, 'AdyarChennai', '9790022222', 4.8),
('MECH_1005', 'Closed', 6, 'KoramangalaBangalore', '9900033333', 4.0),
('MECH_1006', 'Available', 10, 'IndiranagarBangalore', '9910044444', 4.7),
('MECH_1007', 'Available', 4, 'BandraMumbai', '9820055555', 4.1),
('MECH_1008', 'Busy', 7, 'AndheriMumbai', '9821066666', 3.9),
('MECH_1009', 'Available', 3, 'KoregaonParkPune', '9500077777', 4.6),
('MECH_1010', 'On-call', 1, 'JubileeHillsHyderabad', '9600088888', 4.3),
('MECH_1011', 'Available', 5, 'ConnaughtPlaceDelhi', '9810099999', 4.4),
('MECH_1012', 'Busy', 12, 'SaltLakeKolkata', '9330010101', 4.0),
('MECH_1013', 'Available', 4, 'AlwarpetChennai', '9840122233', 3.7),
('MECH_1014', 'Available', 6, 'WhitefieldBangalore', '9980044455', 4.1),
('MECH_1015', 'Closed', 9, 'HitechCityHyderabad', '9700066677', 4.9);

INSERT INTO service (service_id, cost, estimated_duration, service_name)
VALUES
-- Car Services
	('CAR_001', 2500, 180, 'Car General Service'),
	('CAR_002', 800, 45, 'Car Oil Change'),
	('CAR_003', 1500, 90, 'Car Brake Inspection'),
	('CAR_004', 1200, 60, 'Car Tire Rotation'),
	('CAR_005', 3000, 120, 'Car AC Service'),
	('CAR_006', 700, 30, 'Car Wash & Vacuum'),
	('CAR_007', 5000, 240, 'Car Clutch Overhaul'),
	('CAR_008', 2000, 75, 'Car Wheel Alignment'),
	('CAR_009', 1000, 45, 'Car Battery Check'),
	('CAR_010', 4500, 180, 'Car Denting/Painting'),

-- Bike Services
('BIKE_001', 800, 120, 'Bike General Service'),
('BIKE_002', 350, 30, 'Bike Oil Change'),
('BIKE_003', 500, 60, 'Bike Brake & Chain Lube'),
('BIKE_004', 250, 20, 'Bike Puncture Repair'),
('BIKE_005', 1500, 180, 'Bike Engine Tuning'),
('BIKE_006', 300, 30, 'Bike Water Wash'),
('BIKE_007', 600, 45, 'Bike Carburetor Cleaning'),
('BIKE_008', 1200, 90, 'Bike Clutch Plate Check'),
('BIKE_009', 400, 30, 'Bike Electrical Checkup'),
('BIKE_010', 200, 15, 'Bike Chain Tightening');

INSERT INTO mechanic_services (mechanic_id, service_id)
VALUES
-- MECH_1001 (AnnaNagar - Car Specialist)
('MECH_1001', 'CAR_001'),
('MECH_1001', 'CAR_002'),
('MECH_1001', 'CAR_004'),
('MECH_1001', 'CAR_008'),

-- MECH_1002 (TNagar - Larger Car Shop)
('MECH_1002', 'CAR_001'),
('MECH_1002', 'CAR_002'),
('MECH_1002', 'CAR_003'),
('MECH_1002', 'CAR_005'),
('MECH_1002', 'CAR_007'),
('MECH_1002', 'CAR_010'),

-- MECH_1003 (Velachery - Bike Specialist)
('MECH_1003', 'BIKE_001'),
('MECH_1003', 'BIKE_002'),
('MECH_1003', 'BIKE_003'),
('MECH_1003', 'BIKE_005'),

-- MECH_1004 (Adyar - On-call, Basic Services for Both)
('MECH_1004', 'CAR_002'),
('MECH_1004', 'CAR_009'),
('MECH_1004', 'BIKE_002'),
('MECH_1004', 'BIKE_004'),

-- MECH_1005 (Koramangala - Car Specialist)
('MECH_1005', 'CAR_001'),
('MECH_1005', 'CAR_003'),
('MECH_1005', 'CAR_006'),
('MECH_1005', 'CAR_008'),

-- MECH_1006 (Indiranagar - Large Shop, Both)
('MECH_1006', 'CAR_001'),
('MECH_1006', 'CAR_002'),
('MECH_1006', 'CAR_008'),
('MECH_1006', 'BIKE_001'),
('MECH_1006', 'BIKE_002'),
('MECH_1006', 'BIKE_003'),
('MECH_1006', 'BIKE_007'),

-- MECH_1007 (Bandra - Car Specialist)
('MECH_1007', 'CAR_002'),
('MECH_1007', 'CAR_005'),
('MECH_1007', 'CAR_006'),
('MECH_1007', 'CAR_009'),

-- MECH_1008 (Andheri - Bike Specialist)
('MECH_1008', 'BIKE_001'),
('MECH_1008', 'BIKE_003'),
('MECH_1008', 'BIKE_005'),
('MECH_1008', 'BIKE_008'),
('MECH_1008', 'BIKE_010'),

-- MECH_1009 (Koregaon Park - Services Both)
('MECH_1009', 'CAR_001'),
('MECH_1009', 'CAR_002'),
('MECH_1009', 'BIKE_001'),
('MECH_1009', 'BIKE_002'),  -- <-- Fixed typo here
('MECH_1009', 'BIKE_005'),

-- MECH_1010 (Jubilee Hills - On-call Car)
('MECH_1010', 'CAR_001'),
('MECH_1010', 'CAR_002'),
('MECH_1010', 'CAR_009'),

-- MECH_1011 (Connaught Place - Services Both)
('MECH_1011', 'CAR_004'),
('MECH_1011', 'CAR_006'),
('MECH_1011', 'BIKE_004'),
('MECH_1011', 'BIKE_006'),

-- MECH_1Team: 1012 (Salt Lake - Large Car Shop)
('MECH_1012', 'CAR_001'),
('MECH_1012', 'CAR_002'),
('MECH_1012', 'CAR_003'),
('MECH_1012', 'CAR_005'),  -- <-- Fixed typo here
('MECH_1012', 'CAR_008'),
('MECH_1012', 'CAR_010'),

-- MECH_1013 (Alwarpet - Bike Specialist)
('MECH_1013', 'BIKE_001'),
('MECH_1013', 'BIKE_002'),
('MECH_1013','BIKE_007'),
('MECH_1013', 'BIKE_009'),

-- MECH_1014 (Whitefield - Services Both)
('MECH_1014', 'CAR_001'),
('MECH_1014', 'CAR_005'),
('MECH_1014', 'CAR_008'),
('MECH_1014', 'BIKE_001'),
('MECH_1014', 'BIKE_003'),

-- MECH_1015 (Hitech City - Car AC/Electrical Specialist)
('MECH_1015', 'CAR_001'),
('MECH_1015', 'CAR_005'),
('MECH_1015', 'CAR_008'),
('MECH_1015', 'CAR_009');

select * from mechanic_services;
select * from service;
select * from bookingreq;
select * from service_history;
select * from bookingreq;
commit;

