"use strict";

const mysql = require("mysql2/promise");

const ssl = process.env.DB_SSL_REQUIRED === "true"
  ? { rejectUnauthorized: false }
  : undefined;

const pool = mysql.createPool({
  host: process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || "roam_tourism",
  ssl,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
  dateStrings: true,
});

module.exports = pool;
