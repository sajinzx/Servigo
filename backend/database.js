const mysql = require('mysql2');

async function main() {
  const pool = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: 'localhost@123',
    database: 'ServiGo',
  }).promise();

  const [rows] = await pool.query("SELECT * FROM users");
  console.log(rows);

  await pool.end();
}


main();

