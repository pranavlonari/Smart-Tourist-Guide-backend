"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  isValidBookingDate,
  isValidEmail,
  isValidPassword,
  isValidRating,
  serviceTableFor,
} = require("../src/validation");

test("email validation rejects malformed and oversized addresses", () => {
  assert.equal(isValidEmail("traveler@example.com"), true);
  assert.equal(isValidEmail("not-an-email"), false);
  assert.equal(isValidEmail(`${"a".repeat(250)}@example.com`), false);
});

test("password validation accepts the demo minimum and enforces bcrypt byte limits", () => {
  assert.equal(isValidPassword("admin@123"), true);
  assert.equal(isValidPassword("1234567"), false);
  assert.equal(isValidPassword("long-enough-pass"), true);
  assert.equal(isValidPassword("short"), false);
  assert.equal(isValidPassword("é".repeat(37)), false);
});

test("booking dates must be real, future-safe calendar dates within a year", () => {
  const today = new Date();
  const todayIso = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()))
    .toISOString().slice(0, 10);
  assert.equal(isValidBookingDate(todayIso), true);
  assert.equal(isValidBookingDate("2025-02-31"), false);
  assert.equal(isValidBookingDate("not-a-date"), false);
});

test("ratings must be whole numbers from one to five", () => {
  assert.equal(isValidRating(1), true);
  assert.equal(isValidRating(5), true);
  assert.equal(isValidRating(0), false);
  assert.equal(isValidRating(5.5), false);
});

test("booking service lookup only allows known listing tables", () => {
  assert.equal(serviceTableFor("hotel"), "hotels");
  assert.equal(serviceTableFor("place"), "places");
  assert.equal(serviceTableFor("restaurant"), "restaurants");
  assert.equal(serviceTableFor("tourists; DROP TABLE tourists"), null);
});
