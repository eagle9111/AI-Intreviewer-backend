import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import fs from 'fs';
dotenv.config();

const db = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
   ssl: {
    ca: fs.readFileSync(process.env.CA)
   }
 });

export default db;
