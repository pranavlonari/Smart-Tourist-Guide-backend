"use strict";

const pool = require("../db");
const { isValidEmail } = require("../validation");

async function getTouristProfile(touristId) {
  const [rows] = await pool.execute(
    `SELECT id, name, email, phone, role, created_at AS createdAt
       FROM tourists WHERE id = ? AND is_active = 1 LIMIT 1`,
    [touristId],
  );
  return rows[0] || null;
}

async function updateTouristProfile(touristId, input) {
  const body = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const phone = typeof body.phone === "string" ? body.phone.trim() : "";

  if (name.length < 2 || name.length > 100) {
    return { error: "Enter a name between 2 and 100 characters." };
  }
  if (!isValidEmail(email)) return { error: "Enter a valid email address." };
  if (phone.length < 7 || phone.length > 30) {
    return { error: "Enter a phone number between 7 and 30 characters." };
  }

  try {
    await pool.execute(
      "UPDATE tourists SET name = ?, email = ?, phone = ? WHERE id = ? AND is_active = 1",
      [name, email, phone, touristId],
    );
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      return { error: "That email address is already used by another account." };
    }
    throw error;
  }

  const user = await getTouristProfile(touristId);
  return user ? { user } : { error: "We couldn't find an active account to update." };
}

module.exports = { getTouristProfile, updateTouristProfile };
