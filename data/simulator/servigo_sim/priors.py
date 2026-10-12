"""Built-in priors for the simulator.

These are hand-written approximations so the simulator runs with no downloads.
If the real datasets are present under data/raw/ (see data/scripts), calibration.py
replaces the vehicle mix and km-per-year with values derived from them.
"""

# (name, lat, lng, weight): Chennai localities, weight ~ share of customers
LOCALITIES = [
    ("Anna Nagar", 13.0850, 80.2101, 1.3),
    ("T Nagar", 13.0418, 80.2341, 1.2),
    ("Velachery", 12.9815, 80.2180, 1.4),
    ("Adyar", 13.0012, 80.2565, 1.1),
    ("Alwarpet", 13.0339, 80.2540, 0.6),
    ("Guindy", 13.0067, 80.2206, 0.9),
    ("Porur", 13.0382, 80.1565, 1.2),
    ("Tambaram", 12.9249, 80.1000, 1.2),
    ("Mylapore", 13.0368, 80.2676, 0.9),
    ("Kodambakkam", 13.0521, 80.2255, 0.9),
    ("Perambur", 13.1143, 80.2329, 0.8),
    ("Nungambakkam", 13.0569, 80.2425, 0.7),
    ("Sholinganallur", 12.9010, 80.2279, 1.3),
    ("Besant Nagar", 13.0002, 80.2668, 0.6),
    ("Egmore", 13.0732, 80.2609, 0.6),
    ("Vadapalani", 13.0500, 80.2121, 0.9),
    ("Ambattur", 13.1143, 80.1548, 1.0),
    ("Chromepet", 12.9516, 80.1462, 0.9),
]

# kind, make, model, fuel, segment, engine_cc, seats, weight
VEHICLE_MIX = [
    ("car", "Maruti Suzuki", "Swift", "petrol", "hatchback", 1197, 5, 1.6),
    ("car", "Maruti Suzuki", "Baleno", "petrol", "hatchback", 1197, 5, 1.2),
    ("car", "Hyundai", "i20", "petrol", "hatchback", 1197, 5, 1.0),
    ("car", "Tata", "Nexon", "petrol", "suv", 1199, 5, 0.9),
    ("car", "Hyundai", "Creta", "diesel", "suv", 1493, 5, 0.9),
    ("car", "Honda", "City", "petrol", "sedan", 1498, 5, 0.8),
    ("car", "Toyota", "Innova Crysta", "diesel", "suv", 2393, 7, 0.6),
    ("car", "Mahindra", "XUV700", "diesel", "suv", 2184, 7, 0.3),
    ("car", "Mercedes-Benz", "C-Class", "petrol", "luxury", 1496, 5, 0.1),
    ("bike", "Hero", "Splendor Plus", "petrol", "commuter", 97, None, 1.8),
    ("bike", "Honda", "Activa 6G", "petrol", "commuter", 109, None, 1.8),
    ("bike", "Bajaj", "Pulsar 150", "petrol", "sports", 149, None, 1.0),
    ("bike", "TVS", "Apache RTR 160", "petrol", "sports", 159, None, 0.8),
    ("bike", "Royal Enfield", "Classic 350", "petrol", "cruiser", 349, None, 0.8),
    ("bike", "KTM", "Duke 390", "petrol", "premium", 373, None, 0.2),
]

SEGMENT_FACTOR = {
    "hatchback": 1.00, "sedan": 1.15, "suv": 1.35, "luxury": 1.80,
    "commuter": 1.00, "sports": 1.25, "cruiser": 1.40, "premium": 1.75,
}

# code, name, kind, category, base_price (taxable), duration_min
SERVICES = [
    ("CAR_001", "Car General Service", "car", "general", 2500, 180),
    ("CAR_002", "Car Oil Change", "car", "oil", 800, 45),
    ("CAR_003", "Car Brake Inspection", "car", "brakes", 1500, 90),
    ("CAR_004", "Car Tire Rotation", "car", "tyres", 1200, 60),
    ("CAR_005", "Car AC Service", "car", "ac", 3000, 120),
    ("CAR_006", "Car Wash & Vacuum", "car", "wash", 700, 30),
    ("CAR_007", "Car Clutch Overhaul", "car", "clutch", 5000, 240),
    ("CAR_008", "Car Wheel Alignment", "car", "tyres", 2000, 75),
    ("CAR_009", "Car Battery Check", "car", "electrical", 1000, 45),
    ("CAR_010", "Car Denting/Painting", "car", "body", 4500, 180),
    ("BIKE_001", "Bike General Service", "bike", "general", 800, 120),
    ("BIKE_002", "Bike Oil Change", "bike", "oil", 350, 30),
    ("BIKE_003", "Bike Brake & Chain Lube", "bike", "brakes", 500, 60),
    ("BIKE_004", "Bike Puncture Repair", "bike", "tyres", 250, 20),
    ("BIKE_005", "Bike Engine Tuning", "bike", "engine", 1500, 180),
    ("BIKE_006", "Bike Water Wash", "bike", "wash", 300, 30),
    ("BIKE_007", "Bike Carburetor Cleaning", "bike", "engine", 600, 45),
    ("BIKE_008", "Bike Clutch Plate Check", "bike", "clutch", 1200, 90),
    ("BIKE_009", "Bike Electrical Checkup", "bike", "electrical", 400, 30),
    ("BIKE_010", "Bike Chain Tightening", "bike", "general", 200, 15),
]

# How likely each service is a priori, and how much the odds rise per 1,000 km since
# the last service (km) and per year of vehicle age (age).
SERVICE_HAZARD = {
    "CAR_001": dict(base=1.0, km=0.45, age=0.05),
    "CAR_002": dict(base=1.2, km=0.40, age=0.00),
    "CAR_003": dict(base=0.5, km=0.12, age=0.12),
    "CAR_004": dict(base=0.4, km=0.10, age=0.03),
    "CAR_005": dict(base=0.5, km=0.00, age=0.15),
    "CAR_006": dict(base=0.9, km=0.00, age=0.00),
    "CAR_007": dict(base=0.1, km=0.05, age=0.20),
    "CAR_008": dict(base=0.4, km=0.08, age=0.02),
    "CAR_009": dict(base=0.3, km=0.00, age=0.25),
    "CAR_010": dict(base=0.15, km=0.00, age=0.04),
    "BIKE_001": dict(base=1.0, km=0.50, age=0.04),
    "BIKE_002": dict(base=1.2, km=0.45, age=0.00),
    "BIKE_003": dict(base=0.5, km=0.15, age=0.08),
    "BIKE_004": dict(base=0.8, km=0.05, age=0.02),
    "BIKE_005": dict(base=0.2, km=0.10, age=0.10),
    "BIKE_006": dict(base=0.8, km=0.00, age=0.00),
    "BIKE_007": dict(base=0.3, km=0.05, age=0.12),
    "BIKE_008": dict(base=0.2, km=0.04, age=0.15),
    "BIKE_009": dict(base=0.3, km=0.00, age=0.18),
    "BIKE_010": dict(base=0.5, km=0.12, age=0.02),
}

# Symptom phrases per service. Three registers: English, Tanglish, Hinglish.
# Each entry is a list of sentences; the generator adds light noise on top.
SYMPTOMS = {
    "CAR_001": [
        "car is due for its regular service", "periodic service needed, done 10000 km since last one",
        "full service please, car feels sluggish overall", "car service pannanum, romba naal aachu",
        "gaadi ki general service karani hai", "yearly maintenance service for my car",
    ],
    "CAR_002": [
        "engine oil needs to be changed", "oil change due, engine sounds rough",
        "oil level low and the oil looks black", "engine oil maathanum", "gaadi ka engine oil badalna hai",
        "oil warning light is on in the dashboard",
    ],
    "CAR_003": [
        "grinding noise when braking", "brakes feel spongy and weak", "brake pedal vibrates when I stop",
        "brake pidikkala, sound varudhu", "brake lagane par awaaz aati hai", "squealing from front wheels while braking",
    ],
    "CAR_004": [
        "tyres are wearing unevenly", "need tyre rotation, front tyres worn out more",
        "tyre rotation due as per the manual", "tyre mela mela theyudhu", "tyre ek taraf se ghis gaye hain",
        "steering wobbles at high speed because of tyres",
    ],
    "CAR_005": [
        "ac is not cooling properly", "air conditioner blowing warm air", "ac makes a noise and smells bad",
        "ac cooling illa, romba veyil", "ac thanda nahi kar raha", "ac gas refill and cleaning needed",
    ],
    "CAR_006": [
        "car needs a wash and interior vacuum", "interior is dusty, need cleaning", "full car wash and vacuum please",
        "car wash pannanum", "gaadi ki safai aur vacuum karna hai", "muddy car after the rain, needs a wash",
    ],
    "CAR_007": [
        "clutch is slipping when I accelerate", "clutch pedal is very hard and gear shifting is rough",
        "burning smell from clutch in traffic", "clutch slip aagudhu", "clutch kharab ho gaya hai gear nahi lag raha",
        "car jerks when I release the clutch",
    ],
    "CAR_008": [
        "car pulls to the left while driving", "steering is off centre, need wheel alignment",
        "alignment and balancing needed after pothole", "vandi oru pakkam izhukkudhu", "gaadi ek side kheench rahi hai",
        "steering vibrates at 80 kmph",
    ],
    "CAR_009": [
        "car does not start in the morning, battery weak", "battery check needed, headlights are dim",
        "battery drains overnight", "battery weak, start aagala", "gaadi start nahi ho rahi battery check karo",
        "dashboard shows battery warning",
    ],
    "CAR_010": [
        "dent on the rear door from a minor accident", "scratches on the bumper need painting",
        "denting and painting for the side panel", "bumper la dent irukku", "gaadi par dent aur scratch hai",
        "paint peeling off the bonnet",
    ],
    "BIKE_001": [
        "bike needs a general service", "bike is due for periodic service", "full service for my bike please",
        "bike service pannanum", "bike ki general service karani hai", "bike pickup is low, needs overall check",
    ],
    "BIKE_002": [
        "bike engine oil change", "oil change due for the bike", "engine sounds noisy, oil is old",
        "bike oil maathanum", "bike ka engine oil badalna hai", "oil change as per 3000 km schedule",
    ],
    "BIKE_003": [
        "bike brakes are weak", "brake squeaks and chain is dry", "chain needs lubrication and brake adjustment",
        "brake pidikkala", "bike ki brake kamzor hai chain lube karo", "chain noise and poor braking",
    ],
    "BIKE_004": [
        "puncture in the rear tyre", "front tyre is flat", "tyre losing air every day",
        "puncture aayiduchu", "bike ka tyre puncture ho gaya", "flat tyre on the way to office",
    ],
    "BIKE_005": [
        "engine is knocking and mileage dropped", "bike jerks while accelerating, needs tuning",
        "engine tuning needed, bike lacks power", "engine sound romba irukku", "bike ka engine tuning karwana hai",
        "mileage has dropped a lot",
    ],
    "BIKE_006": [
        "bike needs a water wash", "bike is covered in mud", "wash and polish for the bike",
        "bike wash pannanum", "bike ki dhulai karni hai", "muddy bike after the rain",
    ],
    "BIKE_007": [
        "bike stalls at traffic lights, carburetor dirty", "carburetor cleaning needed, hard starting",
        "bike pickup is poor and fuel consumption high", "carburetor clean pannanum", "carburetor saaf karwana hai bike start nahi hoti",
        "idle is unstable and bike chokes",
    ],
    "BIKE_008": [
        "bike clutch is slipping", "clutch lever is too hard", "gear shifting is rough, clutch plates worn",
        "clutch slip aagudhu bike la", "bike ka clutch plate check karo", "bike does not pick up speed, clutch issue",
    ],
    "BIKE_009": [
        "headlight and indicator not working", "bike battery gets discharged", "horn and electricals are dead",
        "light eriyala", "bike ki light aur horn kaam nahi kar rahe", "self start not working, electrical issue",
    ],
    "BIKE_010": [
        "chain is loose and making noise", "chain needs tightening", "chain slack, rattles at low speed",
        "chain loose aayiduchu", "bike ki chain dheeli ho gayi hai", "chain adjustment needed",
    ],
}

PREFIXES = ["", "", "", "please ", "urgent: ", "hello, ", "sir, ", "bro "]
SUFFIXES = ["", "", "", " asap", " please help", " pls", " since yesterday", " from last week", " ok?"]
