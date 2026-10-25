"use strict";

require("dotenv").config();

const bcrypt = require("bcryptjs");
const pool = require("../src/db");

if (process.env.NODE_ENV === "production") {
  throw new Error("Demo accounts must not be seeded in production.");
}

const accounts = [
  {
    name: "System Administrator",
    email: process.env.DEMO_ADMIN_EMAIL || "admin@gmail.com",
    phone: "9999999999",
    password: process.env.DEMO_ADMIN_PASSWORD || "admin@123",
    role: "system_administrator",
  },
  {
    name: "Demo Tourist",
    email: process.env.DEMO_TOURIST_EMAIL || "demo.tourist@gmail.com",
    phone: "9876543210",
    password: process.env.DEMO_TOURIST_PASSWORD || "tourist@123",
    role: "tourist",
  },
];

async function seedDemoAccounts() {
  try {
    for (const account of accounts) {
      const passwordHash = await bcrypt.hash(account.password, 12);
      await pool.execute(
        `INSERT INTO tourists (name, email, phone, password_hash, role, is_active)
         VALUES (?, ?, ?, ?, ?, 1)
         ON DUPLICATE KEY UPDATE name = VALUES(name), phone = VALUES(phone),
           password_hash = VALUES(password_hash), role = VALUES(role), is_active = 1`,
        [account.name, account.email, account.phone, passwordHash, account.role],
      );
    }
    console.log("Demo administrator and tourist accounts are ready.");
  } finally {
    await pool.end();
  }
}

seedDemoAccounts().catch((error) => {
  console.error("Demo account setup failed:", error);
  process.exitCode = 1;
});
