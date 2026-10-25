"use strict";

const { Router } = require("express");
const bcrypt = require("bcryptjs");
const { rateLimit } = require("express-rate-limit");
const pool = require("../db");
const { createBooking, getAvailability, processPayment } = require("../services/travel");
const { getTouristProfile, updateTouristProfile } = require("../services/profile");
const {
  isValidEmail,
  isValidPassword,
  isValidRating,
} = require("../validation");

const router = Router();
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many sign-in attempts. Please try again in a little while." },
});

async function requireUser(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ error: "Please sign in to continue." });
  }
  const [users] = await pool.execute("SELECT is_active FROM tourists WHERE id = ? LIMIT 1", [req.session.user.id]);
  if (!users.length || !users[0].is_active) {
    return res.status(403).json({ error: "This account is unavailable. Contact the site administrator." });
  }
  return next();
}

function publicUser(row) {
  return { id: row.id, name: row.name, email: row.email, role: row.role };
}

function validateTouristFields(body, registering) {
  body = body && typeof body === "object" && !Array.isArray(body) ? body : {};
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const phone = typeof body.phone === "string" ? body.phone.trim() : "";
  const password = body.password;

  if (registering && (name.length < 2 || name.length > 100)) {
    return { error: "Please enter a name between 2 and 100 characters." };
  }
  if (!isValidEmail(email)) return { error: "Please enter a valid email address." };
  if (registering && (phone.length < 7 || phone.length > 30)) {
    return { error: "Please enter a valid phone number." };
  }
  if (!isValidPassword(password)) {
    return { error: "Your password must be between 10 and 72 bytes." };
  }
  return { name, email, phone, password };
}

router.get("/health", async (req, res) => {
  await pool.query("SELECT 1");
  res.json({ status: "ok" });
});

router.get("/auth/session", (req, res) => {
  res.json({ user: req.session.user || null });
});

router.post("/auth/register", authLimiter, async (req, res) => {
  const fields = validateTouristFields(req.body, true);
  if (fields.error) return res.status(400).json({ error: fields.error });

  const passwordHash = await bcrypt.hash(fields.password, 12);
  let result;
  try {
    [result] = await pool.execute(
      "INSERT INTO tourists (name, email, phone, password_hash) VALUES (?, ?, ?, ?)",
      [fields.name, fields.email, fields.phone, passwordHash],
    );
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ error: "An account with that email already exists. Try signing in." });
    }
    throw error;
  }

  await new Promise((resolve, reject) => {
    req.session.regenerate((error) => (error ? reject(error) : resolve()));
  });
  req.session.user = { id: result.insertId, name: fields.name, email: fields.email, role: "tourist" };
  res.status(201).json({ user: req.session.user });
});

const dummyPasswordHash = bcrypt.hashSync("not-a-real-tourist-password", 12);

router.post("/auth/login", authLimiter, async (req, res) => {
  const fields = validateTouristFields(req.body, false);
  if (fields.error) return res.status(400).json({ error: fields.error });

  const [rows] = await pool.execute(
    "SELECT id, name, email, password_hash, role FROM tourists WHERE email = ? AND is_active = 1 LIMIT 1",
    [fields.email],
  );
  const user = rows[0];
  const passwordMatches = await bcrypt.compare(
    fields.password,
    user ? user.password_hash : dummyPasswordHash,
  );
  if (!user || !passwordMatches) {
    return res.status(401).json({ error: "That email and password don't match. Please try again." });
  }

  await new Promise((resolve, reject) => {
    req.session.regenerate((error) => (error ? reject(error) : resolve()));
  });
  req.session.user = publicUser(user);
  res.json({ user: req.session.user });
});

router.post("/auth/logout", requireUser, async (req, res) => {
  await new Promise((resolve, reject) => {
    req.session.destroy((error) => (error ? reject(error) : resolve()));
  });
  res.clearCookie("roam.sid", {
    httpOnly: true,
    sameSite: process.env.NODE_ENV === "production" && process.env.FRONTEND_ORIGIN ? "none" : "lax",
    secure: process.env.NODE_ENV === "production",
  });
  res.status(204).end();
});

router.get("/destinations", async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 100) : "";
  const category = typeof req.query.category === "string" ? req.query.category.trim().slice(0, 40) : "";
  const state = typeof req.query.state === "string" ? req.query.state.trim().slice(0, 100) : "";
  const maxFee = req.query.maxFee === undefined ? null : Number(req.query.maxFee);
  const sortOptions = {
    popularity: "featured DESC, rating DESC, name ASC",
    rating: "rating DESC, name ASC",
    fee: "entry_fee ASC, name ASC",
  };
  const conditions = [];
  const values = [];
  if (q) {
    conditions.push("(name LIKE ? OR location LIKE ? OR description LIKE ? OR category LIKE ? OR tags LIKE ?)");
    const search = `%${q}%`;
    values.push(search, search, search, search, search);
  }
  if (category) {
    conditions.push("category = ?");
    values.push(category);
  }
  if (state) {
    conditions.push("state = ?");
    values.push(state);
  }
  if (Number.isFinite(maxFee) && maxFee >= 0) {
    conditions.push("entry_fee <= ?");
    values.push(Math.min(maxFee, 1000000));
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const orderBy = sortOptions[req.query.sort] || sortOptions.popularity;
  const [rows] = await pool.execute(
    `SELECT id, name, location, state, description, category, tags, best_season AS bestSeason,
            climate, highlights, heritage_notes AS heritageNotes, entry_fee AS entryFee,
            image_url AS imageUrl, rating
       FROM destinations ${where}
      ORDER BY ${orderBy}
      LIMIT 60`,
    values,
  );
  res.json({ destinations: rows });
});

router.get("/destinations/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: "That destination isn't available." });

  const [destinations] = await pool.execute(
    `SELECT id, name, location, state, description, category, tags, best_season AS bestSeason,
            climate, highlights, heritage_notes AS heritageNotes, entry_fee AS entryFee,
            image_url AS imageUrl, rating
       FROM destinations WHERE id = ? LIMIT 1`,
    [id],
  );
  if (!destinations.length) return res.status(404).json({ error: "We couldn't find that destination." });

  const [[hotels], [places], [restaurants], [reviews]] = await Promise.all([
    pool.execute("SELECT id, name, address, rating, price_per_night AS pricePerNight, available_rooms AS availableRooms, amenities FROM hotels WHERE destination_id = ? ORDER BY name", [id]),
    pool.execute("SELECT id, name, type, timings, entry_fee AS entryFee, historical_notes AS historicalNotes, available_tickets AS availableTickets FROM places WHERE destination_id = ? ORDER BY name", [id]),
    pool.execute("SELECT id, name, address, rating, cuisine, average_cost AS averageCost, operating_hours AS operatingHours, available_tables AS availableTables FROM restaurants WHERE destination_id = ? ORDER BY name", [id]),
    pool.execute(
      `SELECT r.rating, r.comment, t.name AS touristName
         FROM reviews r JOIN tourists t ON t.id = r.tourist_id
        WHERE r.destination_id = ? ORDER BY r.created_at DESC LIMIT 30`,
      [id],
    ),
  ]);
  res.json({ destination: { ...destinations[0], hotels, places, restaurants, reviews } });
});

router.get("/destinations/:id/nearby-places", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: "Choose a valid destination." });
  const [places] = await pool.execute(
    `SELECT id, name, type, timings, entry_fee AS entryFee, historical_notes AS historicalNotes,
            available_tickets AS availableTickets
       FROM places WHERE destination_id = ? ORDER BY name LIMIT 100`,
    [id],
  );
  res.json({ places });
});

for (const [resource, query] of Object.entries({
  hotels: "SELECT id, destination_id AS destinationId, name, address, rating, price_per_night AS pricePerNight, available_rooms AS availableRooms, amenities FROM hotels WHERE destination_id = ? ORDER BY name LIMIT 200",
  places: "SELECT id, destination_id AS destinationId, name, type, timings, entry_fee AS entryFee, historical_notes AS historicalNotes, available_tickets AS availableTickets FROM places WHERE destination_id = ? ORDER BY name LIMIT 200",
  restaurants: "SELECT id, destination_id AS destinationId, name, address, rating, cuisine, average_cost AS averageCost, operating_hours AS operatingHours, available_tables AS availableTables FROM restaurants WHERE destination_id = ? ORDER BY name LIMIT 200",
})) {
  router.get(`/${resource}`, async (req, res) => {
    const destinationId = Number(req.query.destinationId);
    if (!Number.isSafeInteger(destinationId) || destinationId < 1) {
      return res.status(400).json({ error: "Choose a valid destination ID." });
    }
    const [items] = await pool.execute(query, [destinationId]);
    return res.json({ [resource]: items });
  });
}

router.get("/reviews", async (req, res) => {
  const destinationId = Number(req.query.destinationId);
  if (!Number.isSafeInteger(destinationId) || destinationId < 1) {
    return res.status(400).json({ error: "Choose a valid destination ID." });
  }
  const [reviews] = await pool.execute(
    `SELECT r.id, r.rating, r.comment, r.verified, r.created_at AS createdAt, t.name AS touristName
       FROM reviews r JOIN tourists t ON t.id = r.tourist_id
      WHERE r.destination_id = ? ORDER BY r.created_at DESC LIMIT 100`,
    [destinationId],
  );
  res.json({ reviews });
});

router.get("/auth/profile", requireUser, async (req, res) => {
  const user = await getTouristProfile(req.session.user.id);
  if (!user) return res.status(404).json({ error: "We couldn't find an active account." });
  res.json({ user });
});

router.patch("/auth/profile", requireUser, async (req, res) => {
  const result = await updateTouristProfile(req.session.user.id, req.body);
  if (result.error) return res.status(400).json({ error: result.error });
  req.session.user.name = result.user.name;
  req.session.user.email = result.user.email;
  res.json({ user: result.user });
});

router.get("/availability", async (req, res) => {
  const availability = await getAvailability({
    serviceType: req.query.serviceType,
    serviceId: req.query.serviceId,
    destinationId: req.query.destinationId,
    bookingDate: req.query.bookingDate,
    checkOut: req.query.checkOut,
  });
  if (!availability.valid) return res.status(400).json({ error: "Choose a valid listing and date range." });
  res.json({
    available: availability.available,
    unitPrice: availability.unitPrice,
    service: availability.service,
    dates: availability.dates,
  });
});

router.get("/bookings", requireUser, async (req, res) => {
  const [bookings] = await pool.execute(
    `SELECT b.id, b.booking_date AS bookingDate, b.check_out AS checkOut, b.quantity,
            b.guest_count AS guestCount, b.unit_price AS unitPrice,
            b.total_amount AS totalAmount, b.status, b.service_name AS serviceName,
            b.service_type AS serviceType, b.verification_token AS verificationToken,
            d.name AS destinationName,
            p.transaction_id AS transactionId, p.payment_mode AS paymentMode, p.status AS paymentStatus
       FROM bookings b JOIN destinations d ON d.id = b.destination_id
       LEFT JOIN payments p ON p.id = (SELECT MAX(p2.id) FROM payments p2 WHERE p2.booking_id = b.id)
      WHERE b.tourist_id = ? ORDER BY b.booking_date DESC, b.id DESC`,
    [req.session.user.id],
  );
  res.json({ bookings });
});

router.get("/bookings/:id", requireUser, async (req, res) => {
  const bookingId = Number(req.params.id);
  if (!Number.isSafeInteger(bookingId) || bookingId < 1) return res.status(404).json({ error: "Booking not found" });
  const [rows] = await pool.execute(
    `SELECT b.id, b.tourist_id AS touristId, b.booking_date AS bookingDate,
            b.check_out AS checkOut, b.quantity, b.guest_count AS guestCount,
            b.unit_price AS unitPrice, b.total_amount AS totalAmount,
            b.status, b.service_name AS serviceName, b.service_type AS serviceType,
            b.verification_token AS verificationToken, d.name AS destinationName,
            t.name AS touristName, t.email AS touristEmail,
            p.id AS paymentId, p.transaction_id AS transactionId,
            p.payment_mode AS paymentMode, p.status AS paymentStatus
       FROM bookings b JOIN destinations d ON d.id = b.destination_id
       JOIN tourists t ON t.id = b.tourist_id
       LEFT JOIN payments p ON p.id = (SELECT MAX(p2.id) FROM payments p2 WHERE p2.booking_id = b.id)
      WHERE b.id = ? AND (b.tourist_id = ? OR ? IN ('administrator', 'system_administrator')) LIMIT 1`,
    [bookingId, req.session.user.id, req.session.user.role || ""],
  );
  if (!rows.length) return res.status(404).json({ error: "Booking not found" });
  res.json({ booking: rows[0] });
});

router.get("/verify/:token", async (req, res) => {
  const token = typeof req.params.token === "string" && /^[a-f0-9]{48}$/.test(req.params.token)
    ? req.params.token : "";
  const [rows] = token ? await pool.execute(
    `SELECT b.id, b.booking_date AS bookingDate, b.check_out AS checkOut,
            b.quantity, b.guest_count AS guestCount, b.total_amount AS totalAmount,
            b.service_name AS serviceName, b.status AS bookingStatus,
            d.name AS destinationName, t.name AS touristName,
            p.transaction_id AS transactionId, p.status AS paymentStatus, p.payment_mode AS paymentMode
       FROM bookings b JOIN destinations d ON d.id = b.destination_id
       JOIN tourists t ON t.id = b.tourist_id
       LEFT JOIN payments p ON p.id = (SELECT MAX(p2.id) FROM payments p2 WHERE p2.booking_id = b.id)
      WHERE b.verification_token = ? LIMIT 1`,
    [token],
  ) : [[]];
  if (!rows.length) return res.status(404).json({ error: "Invalid or expired ticket" });
  res.json({ verified: true, booking: rows[0] });
});

router.post("/bookings", requireUser, async (req, res) => {
  const body = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
  const result = await createBooking({
    touristId: req.session.user.id, destinationId: body.destinationId,
    serviceId: body.serviceId, serviceType: body.serviceType,
    bookingDate: body.bookingDate, checkOut: body.checkOut,
    quantity: body.quantity === undefined ? 1 : body.quantity,
    guestCount: body.guestCount === undefined ? 1 : body.guestCount,
  });
  if (result.error) return res.status(result.status || 400).json({ error: result.error, available: result.available });
  const [destinationRows] = await pool.execute("SELECT name FROM destinations WHERE id = ?", [result.booking.destinationId]);
  result.booking.destinationName = destinationRows[0].name;
  res.status(201).json({ booking: result.booking });
});

router.post("/bookings/:id/payments", requireUser, async (req, res) => {
  const body = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
  const result = await processPayment({
    bookingId: req.params.id,
    touristId: req.session.user.id,
    mode: body.mode || "upi",
    bankName: body.bankName || "State Bank of India",
    simulateFailure: body.simulateFailure === true || body.simulateFailure === "true",
  });
  if (result.error) return res.status(result.status || 400).json({ error: result.error });
  res.status(result.payment.status === "failed" ? 402 : 201).json(result);
});

router.delete("/bookings/:id", requireUser, async (req, res) => {
  const bookingId = Number(req.params.id);
  if (!Number.isSafeInteger(bookingId) || bookingId < 1) return res.status(400).json({ error: "That trip isn't available." });

  const [result] = await pool.execute(
    "UPDATE bookings SET status = 'cancelled' WHERE id = ? AND tourist_id = ? AND status IN ('pending', 'confirmed')",
    [bookingId, req.session.user.id],
  );
  if (!result.affectedRows) return res.status(404).json({ error: "We couldn't find an active booking for that trip to cancel." });
  res.status(204).end();
});

router.post("/reviews", requireUser, async (req, res) => {
  const body = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
  const destinationId = Number(body.destinationId);
  const rating = Number(body.rating);
  const comment = typeof body.comment === "string" ? body.comment.trim() : "";
  if (!Number.isSafeInteger(destinationId) || destinationId < 1
      || !isValidRating(rating) || comment.length < 2 || comment.length > 1000) {
    return res.status(400).json({ error: "Please choose a rating and share a comment between 2 and 1,000 characters." });
  }

  const [eligible] = await pool.execute(
    "SELECT 1 FROM bookings WHERE tourist_id = ? AND destination_id = ? AND status IN ('confirmed', 'completed') LIMIT 1",
    [req.session.user.id, destinationId],
  );
  if (!eligible.length) {
    return res.status(403).json({ error: "Share a review after a confirmed trip to this destination." });
  }

  try {
    await pool.execute(
      "INSERT INTO reviews (tourist_id, destination_id, rating, comment, verified) VALUES (?, ?, ?, ?, 1)",
      [req.session.user.id, destinationId, rating, comment],
    );
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({ error: "You've already shared a story about this place. Thank you!" });
    }
    if (error.code === "ER_NO_REFERENCED_ROW_2") {
      return res.status(404).json({ error: "We couldn't find that destination." });
    }
    throw error;
  }
  await pool.execute(
    "UPDATE destinations SET rating = (SELECT COALESCE(AVG(rating), 0) FROM reviews WHERE destination_id = ?) WHERE id = ?",
    [destinationId, destinationId],
  );
  res.status(201).json({ message: "Your story has been shared." });
});

module.exports = router;
