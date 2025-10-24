# 🚗 ServiGo

**ServiGo** is a smart vehicle service management platform that bridges the gap between customers and skilled mechanics. It allows users to easily access vehicle services through a web  app, track service history,  and ensure timely maintenance — all while helping local mechanics grow their business.

---

## 🌟 Features

### 🧑‍🔧 For Customers

- 📅 **Book vehicle services** in a few clicks  
- 📜 **Track complete service history** of vehicles   
- 💬 **Real-time status updates** and communication with mechanics  

### 🛠️ For Mechanics
- 📲 **Register and manage service requests**  
- 📈 **Expand customer reach** through the ServiGo network  
- 🧾 **Maintain service records** and payment details digitally  
- ⭐ **Build trust** through verified customer reviews  

---

## 🧩 Tech Stack

| Layer | Technology |
|-------|-------------|
| **Frontend** | React.js, CSS |
| **Backend** | Node.js, Express.js |
| **Database** | MySQL |
| **Authentication** | JWT (JSON Web Token) |
| **API Testing** | Postman |
| **Version Control** | Git & GitHub |

---

## ⚙️ Project Setup

### 🔧 Backend Setup
```bash
# Clone the repository
git clone https://github.com/sajinzx/servigo.git
cd servigo/backend

# Install dependencies
npm install

# Setup environment variables
# Create a .env file and add:
# DB_HOST=localhost
# DB_USER=root
# DB_PASSWORD=yourpassword
# DB_NAME=ServiGo
# JWT_SECRET=your_jwt_secret

# Run the server
node server.js

# Run Frontend
cd ../frontend

# Install dependencies
npm install

# Start the frontend
npm run dev

# Frontend runs on
http://localhost:5173

