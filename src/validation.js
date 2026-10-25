"use strict";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const allowedServiceTables = Object.freeze({
  hotel: "hotels",
  place: "places",
  restaurant: "restaurants",
});

function isValidEmail(value) {
  return typeof value === "string" && value.length <= 254 && emailPattern.test(value);
}

function isValidPassword(value) {
  return typeof value === "string"
    && Buffer.byteLength(value, "utf8") >= 8
    && Buffer.byteLength(value, "utf8") <= 72;
}

function isValidBookingDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return false;
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const date = Date.parse(`${value}T00:00:00.000Z`);
  return date >= today && date <= today + 366 * 24 * 60 * 60 * 1000;
}

function serviceTableFor(value) {
  return allowedServiceTables[value] || null;
}

function isValidRating(value) {
  return Number.isInteger(value) && value >= 1 && value <= 5;
}

module.exports = {
  isValidBookingDate,
  isValidEmail,
  isValidPassword,
  isValidRating,
  serviceTableFor,
};
