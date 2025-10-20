const mysql = require('mysql2');

async function main() {
  // Create a connection pool with promise support
  const pool = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: 'localhost@123',
    database: 'ServiGo',
  }).promise();

}

main();
