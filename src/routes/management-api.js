"use strict";

const path = require("node:path");
const { Router } = require("express");
const pool = require("../db");
const { isValidEmail } = require("../validation");

const router = Router();
const roles = ["tourist", "administrator", "service_provider", "system_administrator", "hotel_manager"];
const administrators = ["administrator", "system_administrator"];
const resourceDefinitions = Object.freeze({
  destinations: {
    table: "destinations",
    columns: {
      name: "name", location: "location", state: "state", description: "description",
      category: "category", tags: "tags", bestSeason: "best_season", climate: "climate",
      highlights: "highlights", heritageNotes: "heritage_notes", entryFee: "entry_fee",
      imageUrl: "image_url", featured: "featured",
    },
    required: ["name", "location", "state", "description", "category", "highlights", "heritageNotes", "imageUrl"],
  },
  hotels: {
    table: "hotels",
    columns: {
      destinationId: "destination_id", name: "name", address: "address", rating: "rating",
      pricePerNight: "price_per_night", availableRooms: "available_rooms", amenities: "amenities",
      providerId: "provider_id",
    },
    required: ["destinationId", "name", "address", "amenities"],
  },
  places: {
    table: "places",
    columns: {
      destinationId: "destination_id", name: "name", type: "type", timings: "timings",
      entryFee: "entry_fee", historicalNotes: "historical_notes", availableTickets: "available_tickets",
    },
    required: ["destinationId", "name", "type", "timings", "historicalNotes"],
  },
  restaurants: {
    table: "restaurants",
    columns: {
      destinationId: "destination_id", name: "name", address: "address", rating: "rating",
      cuisine: "cuisine", averageCost: "average_cost", operatingHours: "operating_hours",
      availableTables: "available_tables",
    },
    required: ["destinationId", "name", "address"],
  },
});

function isId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function requireUser(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: "Please sign in to continue." });
  return requireActiveUser(req, res, next);
}

async function requireActiveUser(req, res, next) {
  const [users] = await pool.execute("SELECT is_active FROM tourists WHERE id = ? LIMIT 1", [req.session.user.id]);
  if (!users.length || !users[0].is_active) {
    return res.status(403).json({ error: "This account is unavailable. Contact the site administrator." });
  }
  next();
}

function requireRoles(allowedRoles) {
  return async (req, res, next) => {
    if (!req.session.user) return res.status(401).json({ error: "Please sign in to continue." });
    const [users] = await pool.execute("SELECT role, is_active FROM tourists WHERE id = ? LIMIT 1", [req.session.user.id]);
    if (!users.length || !users[0].is_active) return res.status(401).json({ error: "Please sign in to continue." });
    req.session.user.role = users[0].role;
    if (!allowedRoles.includes(users[0].role)) {
      return res.status(403).json({ error: "Your account doesn't have permission to do that." });
    }
    next();
  };
}

async function audit(req, action, entityType, entityId, details) {
  await pool.execute(
    "INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?)",
    [req.session.user.id, action, entityType, entityId, JSON.stringify(details || {})],
  );
}

function fieldsFor(definition, input, partial = false) {
  const body = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const fields = [];
  for (const [key, column] of Object.entries(definition.columns)) {
    if (!Object.hasOwn(body, key)) continue;
    let value = body[key];
    if (["entryFee", "pricePerNight", "rating", "averageCost"].includes(key)) {
      value = Number(value);
      if (!Number.isFinite(value) || value < 0 || value > 10000000) return { error: `${key} must be a non-negative amount.` };
      if (key === "rating" && value > 5) return { error: "Ratings must be between zero and five." };
    } else if (["availableRooms", "availableTickets", "availableTables", "destinationId", "providerId", "featured"].includes(key)) {
      if (value === "" && key === "providerId") value = null;
      else if (value !== null) {
        value = Number(value);
        if (!Number.isSafeInteger(value) || value < 0 || (key === "destinationId" && value < 1)) {
          return { error: `${key} must be a valid whole number.` };
        }
      }
    } else if (typeof value !== "string" || value.trim().length > 5000) {
      return { error: `${key} must be a text value no longer than 5,000 characters.` };
    } else {
      value = value.trim();
    }
    fields.push({ key, column, value });
  }
  if (definition.required.some((field) => !fields.some((entry) => entry.key === field) && !partial)) {
    return { error: "Please fill in all required fields." };
  }
  if (!fields.length) return { error: "Include at least one field to save." };
  return { fields };
}

router.get("/management/overview", requireRoles([...administrators, "service_provider", "hotel_manager"]), async (req, res) => {
  if (administrators.includes(req.session.user.role)) {
    const [[tourists]] = await pool.query("SELECT COUNT(*) AS total FROM tourists WHERE role = 'tourist'");
    const [[destinations]] = await pool.query("SELECT COUNT(*) AS total FROM destinations");
    const [[hotels]] = await pool.query("SELECT COUNT(*) AS total FROM hotels");
    const [[places]] = await pool.query("SELECT COUNT(*) AS total FROM places");
    const [[restaurants]] = await pool.query("SELECT COUNT(*) AS total FROM restaurants");
    const [[bookingStats]] = await pool.query(
      `SELECT COUNT(*) AS bookings,
              SUM(status = 'confirmed') AS confirmedBookings
         FROM bookings`,
    );
    const [[revenue]] = await pool.query(
      "SELECT COALESCE(SUM(amount), 0) AS totalRevenue FROM payments WHERE status = 'success'",
    );
    return res.json({
      role: req.session.user.role,
      metrics: {
        tourists: tourists.total, destinations: destinations.total,
        hotels: hotels.total, places: places.total, restaurants: restaurants.total,
        bookings: bookingStats.bookings, confirmedBookings: bookingStats.confirmedBookings || 0,
        totalRevenue: Number(revenue.totalRevenue),
      },
    });
  }
  const [hotelRows] = await pool.execute(
    `SELECT h.id, h.name, h.address, h.available_rooms AS availableRooms,
            h.destination_id AS destinationId, d.name AS destinationName
       FROM hotels h JOIN destinations d ON d.id = h.destination_id
      WHERE h.provider_id = ? ORDER BY h.name`,
    [req.session.user.id],
  );
  const [reservationRows] = await pool.execute(
    `SELECT b.id, b.booking_date AS bookingDate, b.check_out AS checkOut,
            b.quantity, b.guest_count AS guestCount, b.status, b.service_name AS serviceName,
            t.name AS touristName, d.name AS destinationName
       FROM bookings b
       JOIN hotels h ON b.service_type = 'hotel' AND b.service_id = h.id
       JOIN tourists t ON t.id = b.tourist_id
       JOIN destinations d ON d.id = b.destination_id
      WHERE h.provider_id = ? ORDER BY b.booking_date DESC LIMIT 200`,
    [req.session.user.id],
  );
  return res.json({ role: req.session.user.role, hotels: hotelRows, reservations: reservationRows });
});

router.get("/management/entities/:resource", requireRoles(administrators), async (req, res) => {
  const definition = resourceDefinitions[req.params.resource];
  if (!definition) return res.status(404).json({ error: "That listing type isn't available." });
  const [rows] = await pool.query(`SELECT * FROM ${definition.table} ORDER BY id DESC LIMIT 500`);
  res.json({ items: rows });
});

router.post("/management/entities/:resource", requireRoles(administrators), async (req, res) => {
  const definition = resourceDefinitions[req.params.resource];
  if (!definition) return res.status(404).json({ error: "That listing type isn't available." });
  const result = fieldsFor(definition, req.body);
  if (result.error) return res.status(400).json({ error: result.error });
  const columns = result.fields.map((field) => field.column);
  const values = result.fields.map((field) => field.value);
  const [insert] = await pool.execute(
    `INSERT INTO ${definition.table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
    values,
  );
  await audit(req, "create", req.params.resource, insert.insertId, result.fields);
  if (req.body._form === "1") {
    req.session.notice = "Listing added successfully.";
    return res.redirect(303, `/dashboard#${req.params.resource}`);
  }
  res.status(201).json({ id: insert.insertId });
});

async function updateEntity(req, res) {
  const definition = resourceDefinitions[req.params.resource];
  const id = isId(req.params.id);
  if (!definition) return res.status(404).json({ error: "That listing type isn't available." });
  if (!id) return res.status(400).json({ error: "Choose a valid listing." });
  const result = fieldsFor(definition, req.body, true);
  if (result.error) return res.status(400).json({ error: result.error });
  const [updated] = await pool.execute(
    `UPDATE ${definition.table} SET ${result.fields.map((field) => `${field.column} = ?`).join(", ")} WHERE id = ?`,
    [...result.fields.map((field) => field.value), id],
  );
  if (!updated.affectedRows) return res.status(404).json({ error: "We couldn't find that listing." });
  await audit(req, "update", req.params.resource, id, result.fields);
  if (req.body._form === "1") {
    req.session.notice = "Listing updated successfully.";
    return res.redirect(303, `/dashboard#${req.params.resource}`);
  }
  res.json({ updated: true });
}

router.put("/management/entities/:resource/:id", requireRoles(administrators), updateEntity);
router.post("/management/entities/:resource/:id/update", requireRoles(administrators), updateEntity);

async function deleteEntity(req, res) {
  const definition = resourceDefinitions[req.params.resource];
  const id = isId(req.params.id);
  if (!definition) return res.status(404).json({ error: "That listing type isn't available." });
  if (!id) return res.status(400).json({ error: "Choose a valid listing." });
  const [deleted] = await pool.execute(`DELETE FROM ${definition.table} WHERE id = ?`, [id]);
  if (!deleted.affectedRows) return res.status(404).json({ error: "We couldn't find that listing." });
  await audit(req, "delete", req.params.resource, id, {});
  if (req.body._form === "1") {
    req.session.notice = "Listing removed.";
    return res.redirect(303, `/dashboard#${req.params.resource}`);
  }
  res.status(204).end();
}

router.delete("/management/entities/:resource/:id", requireRoles(administrators), deleteEntity);
router.post("/management/entities/:resource/:id/delete", requireRoles(administrators), deleteEntity);

router.get("/management/bookings", requireRoles(administrators), async (req, res) => {
  const [bookings] = await pool.query(
    `SELECT b.id, b.booking_date AS bookingDate, b.check_out AS checkOut,
            b.quantity, b.guest_count AS guestCount, b.total_amount AS totalAmount,
            b.status, b.service_name AS serviceName, b.service_type AS serviceType,
            t.name AS touristName, t.email AS touristEmail, d.name AS destinationName,
            p.transaction_id AS transactionId, p.status AS paymentStatus
       FROM bookings b JOIN tourists t ON t.id = b.tourist_id
       JOIN destinations d ON d.id = b.destination_id
       LEFT JOIN payments p ON p.id = (SELECT MAX(p2.id) FROM payments p2 WHERE p2.booking_id = b.id)
      ORDER BY b.created_at DESC LIMIT 500`,
  );
  res.json({ bookings });
});

router.patch("/management/bookings/:id", requireRoles(administrators), async (req, res) => {
  const id = isId(req.params.id);
  const statuses = ["pending", "confirmed", "cancelled", "completed"];
  if (!id || !statuses.includes(req.body.status)) return res.status(400).json({ error: "Choose a valid booking and status." });
  const [result] = await pool.execute("UPDATE bookings SET status = ? WHERE id = ?", [req.body.status, id]);
  if (!result.affectedRows) return res.status(404).json({ error: "We couldn't find that booking." });
  await audit(req, "update_status", "booking", id, { status: req.body.status });
  res.json({ updated: true });
});

router.post("/management/bookings/:id/status", requireRoles(administrators), async (req, res) => {
  const id = isId(req.params.id);
  const statuses = ["pending", "confirmed", "cancelled", "completed"];
  if (!id || !statuses.includes(req.body.status)) {
    req.session.notice = "Choose a valid booking status.";
    return res.redirect(303, "/dashboard#bookings");
  }
  await pool.execute("UPDATE bookings SET status = ? WHERE id = ?", [req.body.status, id]);
  await audit(req, "update_status", "booking", id, { status: req.body.status });
  req.session.notice = "Booking status updated.";
  return res.redirect(303, "/dashboard#bookings");
});

router.get("/management/payments", requireRoles(administrators), async (req, res) => {
  const [payments] = await pool.query(
    `SELECT p.id, p.booking_id AS bookingId, p.amount, p.payment_mode AS paymentMode,
            p.transaction_id AS transactionId, p.status, p.created_at AS createdAt,
            t.name AS touristName, d.name AS destinationName, b.service_name AS serviceName
       FROM payments p JOIN tourists t ON t.id = p.tourist_id
       JOIN bookings b ON b.id = p.booking_id
       JOIN destinations d ON d.id = b.destination_id
      ORDER BY p.created_at DESC LIMIT 500`,
  );
  res.json({ payments });
});

router.get("/payments", requireRoles(administrators), async (req, res) => {
  const [payments] = await pool.query(
    `SELECT p.id, p.booking_id AS bookingId, p.amount, p.payment_mode AS paymentMode,
            p.transaction_id AS transactionId, p.status, p.created_at AS createdAt,
            t.name AS touristName, d.name AS destinationName, b.service_name AS serviceName
       FROM payments p JOIN tourists t ON t.id = p.tourist_id
       JOIN bookings b ON b.id = p.booking_id JOIN destinations d ON d.id = b.destination_id
      ORDER BY p.created_at DESC LIMIT 500`,
  );
  res.json({ payments });
});

async function refundPayment(req, res) {
  const id = isId(req.params.id);
  if (!id) return res.status(400).json({ error: "Choose a valid payment." });
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      "SELECT id, booking_id AS bookingId, status FROM payments WHERE id = ? FOR UPDATE",
      [id],
    );
    const payment = rows[0];
    if (!payment || payment.status !== "success") {
      await connection.rollback();
      if (req.body._form === "1") {
        req.session.notice = "Only a successful demo payment can be marked as refunded.";
        return res.redirect(303, "/dashboard#payments");
      }
      return res.status(409).json({ error: "Only a successful demo payment can be marked as refunded." });
    }
    await connection.execute("UPDATE payments SET status = 'refunded', refunded_at = CURRENT_TIMESTAMP WHERE id = ?", [id]);
    await connection.execute("UPDATE bookings SET status = 'cancelled' WHERE id = ?", [payment.bookingId]);
    await connection.execute(
      "INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, details) VALUES (?, 'simulated_refund', 'payment', ?, ?)",
      [req.session.user.id, id, JSON.stringify({ bookingId: payment.bookingId, note: "No real payment processor is connected." })],
    );
    await connection.commit();
    if (req.body._form === "1") {
      req.session.notice = "Demo refund recorded. No real payment processor was contacted.";
      return res.redirect(303, "/dashboard#payments");
    }
    return res.json({ refunded: true, simulated: true });
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

router.post("/management/payments/:id/refund", requireRoles(administrators), refundPayment);
router.post("/payments/:id/refund", requireRoles(administrators), refundPayment);

router.get("/management/reviews", requireRoles(administrators), async (req, res) => {
  const [reviews] = await pool.query(
    `SELECT r.id, r.rating, r.comment, r.created_at AS createdAt,
            t.name AS touristName, d.name AS destinationName
       FROM reviews r JOIN tourists t ON t.id = r.tourist_id
       JOIN destinations d ON d.id = r.destination_id
      ORDER BY r.created_at DESC LIMIT 500`,
  );
  res.json({ reviews });
});

async function deleteReview(req, res) {
  const id = isId(req.params.id);
  if (!id) {
    if (req.body._form === "1") {
      req.session.notice = "Choose a valid review.";
      return res.redirect(303, "/dashboard#reviews");
    }
    return res.status(400).json({ error: "Choose a valid review." });
  }
  const connection = await pool.getConnection();
  let result;
  let destinationId;
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute("SELECT destination_id FROM reviews WHERE id = ? FOR UPDATE", [id]);
    if (!rows.length) {
      await connection.rollback();
      if (req.body._form === "1") {
        req.session.notice = "That review was already removed.";
        return res.redirect(303, "/dashboard#reviews");
      }
      return res.status(404).json({ error: "We couldn't find that review." });
    }
    destinationId = rows[0].destination_id;
    [result] = await connection.execute("DELETE FROM reviews WHERE id = ?", [id]);
    await connection.execute(
      "UPDATE destinations SET rating = (SELECT COALESCE(AVG(rating), 0) FROM reviews WHERE destination_id = ?) WHERE id = ?",
      [destinationId, destinationId],
    );
    await connection.execute(
      "INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, details) VALUES (?, 'moderate_delete', 'review', ?, JSON_OBJECT('destinationId', ?))",
      [req.session.user.id, id, destinationId],
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
  if (req.body._form === "1") {
    req.session.notice = result.affectedRows ? "Review removed." : "That review was already removed.";
    return res.redirect(303, "/dashboard#reviews");
  }
  res.status(204).end();
}

router.delete("/management/reviews/:id", requireRoles(administrators), deleteReview);
router.post("/management/reviews/:id/delete", requireRoles(administrators), deleteReview);
router.delete("/reviews/:id", requireRoles(administrators), deleteReview);

router.get("/management/users", requireRoles(["system_administrator"]), async (req, res) => {
  const [users] = await pool.query(
    "SELECT id, name, email, phone, role, is_active AS isActive, created_at AS createdAt FROM tourists ORDER BY created_at DESC LIMIT 500",
  );
  res.json({ users, roles });
});

router.get("/management/contact-messages", requireRoles(["system_administrator"]), async (req, res) => {
  const [messages] = await pool.query(
    "SELECT id, name, email, subject, message, status, created_at AS createdAt FROM contact_messages ORDER BY created_at DESC LIMIT 500",
  );
  res.json({ messages });
});

router.post("/management/contact-messages/:id/status", requireRoles(["system_administrator"]), async (req, res) => {
  const id = isId(req.params.id);
  const status = req.body.status === "reviewed" ? "reviewed" : req.body.status === "new" ? "new" : null;
  if (!id || !status) {
    req.session.notice = "Choose a valid message status.";
    return res.redirect(303, "/dashboard#messages");
  }
  const [result] = await pool.execute("UPDATE contact_messages SET status = ? WHERE id = ?", [status, id]);
  if (result.affectedRows) await audit(req, "update_contact_message", "contact_message", id, { status });
  req.session.notice = result.affectedRows ? "Contact message updated." : "We couldn't find that message.";
  return res.redirect(303, "/dashboard#messages");
});

router.patch("/auth/profile", requireUser, async (req, res) => {
  const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
  const phone = typeof req.body.phone === "string" ? req.body.phone.trim() : "";
  const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
  if (name.length < 2 || name.length > 100 || phone.length < 7 || phone.length > 30 || !isValidEmail(email)) {
    return res.status(400).json({ error: "Enter a valid name, email, and phone number." });
  }
  try {
    const [updated] = await pool.execute(
      "UPDATE tourists SET name = ?, email = ?, phone = ? WHERE id = ?",
      [name, email, phone, req.session.user.id],
    );
    if (!updated.affectedRows) return res.status(404).json({ error: "We couldn't find that account." });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") return res.status(409).json({ error: "That email address is already in use." });
    throw error;
  }
  req.session.user = { ...req.session.user, name, email };
  res.json({ user: req.session.user });
});

router.patch("/management/users/:id/role", requireRoles(["system_administrator"]), async (req, res) => {
  const id = isId(req.params.id);
  if (!id || !roles.includes(req.body.role)) return res.status(400).json({ error: "Choose a valid account and role." });
  if (id === Number(req.session.user.id) && req.body.role !== "system_administrator") {
    return res.status(409).json({ error: "You can't remove your own system administrator access." });
  }
  const [result] = await pool.execute("UPDATE tourists SET role = ? WHERE id = ?", [req.body.role, id]);
  if (!result.affectedRows) return res.status(404).json({ error: "We couldn't find that account." });
  await audit(req, "change_role", "tourist", id, { role: req.body.role });
  res.json({ updated: true });
});

router.post("/management/users/:id/role", requireRoles(["system_administrator"]), async (req, res) => {
  const id = isId(req.params.id);
  if (!id || !roles.includes(req.body.role)) {
    req.session.notice = "Choose a valid account and role.";
    return res.redirect(303, "/dashboard#users");
  }
  if (id === Number(req.session.user.id) && req.body.role !== "system_administrator") {
    req.session.notice = "You can't remove your own system administrator access.";
    return res.redirect(303, "/dashboard#users");
  }
  const [result] = await pool.execute("UPDATE tourists SET role = ? WHERE id = ?", [req.body.role, id]);
  if (result.affectedRows) await audit(req, "change_role", "tourist", id, { role: req.body.role });
  req.session.notice = result.affectedRows ? "Account role updated." : "We couldn't find that account.";
  return res.redirect(303, "/dashboard#users");
});

router.patch("/management/users/:id/status", requireRoles(["system_administrator"]), async (req, res) => {
  const id = isId(req.params.id);
  const activeValue = req.body.isActive;
  const isActive = activeValue === true || activeValue === 1 || activeValue === "1";
  if (!id || ![true, false, 1, 0, "1", "0"].includes(activeValue)) {
    return res.status(400).json({ error: "Choose a valid account status." });
  }
  if (id === Number(req.session.user.id) && !isActive) {
    return res.status(409).json({ error: "You can't suspend your own administrator account." });
  }
  const [targets] = await pool.execute("SELECT role, is_active FROM tourists WHERE id = ? LIMIT 1", [id]);
  if (!targets.length) return res.status(404).json({ error: "We couldn't find that account." });
  if (!isActive && targets[0].role === "system_administrator" && targets[0].is_active) {
    const [[activeAdmins]] = await pool.query(
      "SELECT COUNT(*) AS total FROM tourists WHERE role = 'system_administrator' AND is_active = 1",
    );
    if (activeAdmins.total <= 1) {
      return res.status(409).json({ error: "At least one active system administrator must remain." });
    }
  }
  await pool.execute("UPDATE tourists SET is_active = ? WHERE id = ?", [isActive ? 1 : 0, id]);
  await audit(req, isActive ? "restore_account" : "suspend_account", "tourist", id, { isActive });
  res.json({ updated: true, isActive });
});

router.post("/management/users/:id/status", requireRoles(["system_administrator"]), async (req, res) => {
  const id = isId(req.params.id);
  const isActive = req.body.isActive === "1";
  if (!id) {
    req.session.notice = "Choose a valid account.";
    return res.redirect(303, "/dashboard#users");
  }
  if (id === Number(req.session.user.id) && !isActive) {
    req.session.notice = "You can't suspend your own administrator account.";
    return res.redirect(303, "/dashboard#users");
  }
  const [targets] = await pool.execute("SELECT role, is_active FROM tourists WHERE id = ? LIMIT 1", [id]);
  if (!targets.length) {
    req.session.notice = "We couldn't find that account.";
    return res.redirect(303, "/dashboard#users");
  }
  if (!isActive && targets[0].role === "system_administrator" && targets[0].is_active) {
    const [[activeAdmins]] = await pool.query(
      "SELECT COUNT(*) AS total FROM tourists WHERE role = 'system_administrator' AND is_active = 1",
    );
    if (activeAdmins.total <= 1) {
      req.session.notice = "At least one active system administrator must remain.";
      return res.redirect(303, "/dashboard#users");
    }
  }
  await pool.execute("UPDATE tourists SET is_active = ? WHERE id = ?", [isActive ? 1 : 0, id]);
  await audit(req, isActive ? "restore_account" : "suspend_account", "tourist", id, { isActive });
  req.session.notice = isActive ? "Account restored." : "Account suspended.";
  return res.redirect(303, "/dashboard#users");
});

router.get("/sql/health", requireRoles(["system_administrator"]), async (req, res) => {
  const [tables] = await pool.execute(
    `SELECT TABLE_NAME AS tableName, TABLE_ROWS AS approximateRows
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME`,
  );
  res.json({ database: "connected", tables });
});

router.get("/sql/schema", requireRoles(["system_administrator"]), (req, res) => {
  res.download(path.resolve(__dirname, "../../sql/schema.sql"), "roam-schema.sql");
});

router.get("/provider/reservations", requireRoles(["service_provider", "hotel_manager"]), async (req, res) => {
  const [reservations] = await pool.execute(
    `SELECT b.id, b.booking_date AS bookingDate, b.check_out AS checkOut, b.quantity,
            b.guest_count AS guestCount, b.status, b.service_name AS serviceName,
            t.name AS touristName, d.name AS destinationName
       FROM bookings b JOIN hotels h ON b.service_type = 'hotel' AND b.service_id = h.id
       JOIN tourists t ON t.id = b.tourist_id
       JOIN destinations d ON d.id = b.destination_id
      WHERE h.provider_id = ? ORDER BY b.booking_date DESC LIMIT 200`,
    [req.session.user.id],
  );
  res.json({ reservations });
});

router.patch("/provider/hotels/:id/inventory", requireRoles(["service_provider", "hotel_manager"]), async (req, res) => {
  const id = isId(req.params.id);
  const availableRooms = Number(req.body.availableRooms);
  if (!id || !Number.isSafeInteger(availableRooms) || availableRooms < 0 || availableRooms > 100000) {
    return res.status(400).json({ error: "Enter a valid room availability count." });
  }
  const [result] = await pool.execute(
    "UPDATE hotels SET available_rooms = ? WHERE id = ? AND provider_id = ?",
    [availableRooms, id, req.session.user.id],
  );
  if (!result.affectedRows) return res.status(404).json({ error: "That hotel isn't assigned to your provider account." });
  await audit(req, "update_inventory", "hotel", id, { availableRooms });
  if (req.body._form === "1") {
    req.session.notice = "Room inventory updated.";
    return res.redirect(303, "/dashboard");
  }
  res.json({ updated: true });
});

router.post("/provider/hotels/:id/inventory", requireRoles(["service_provider", "hotel_manager"]), async (req, res) => {
  const id = isId(req.params.id);
  const availableRooms = Number(req.body.availableRooms);
  if (!id || !Number.isSafeInteger(availableRooms) || availableRooms < 0 || availableRooms > 100000) {
    req.session.notice = "Enter a valid room availability count.";
    return res.redirect(303, "/dashboard");
  }
  const [result] = await pool.execute(
    "UPDATE hotels SET available_rooms = ? WHERE id = ? AND provider_id = ?",
    [availableRooms, id, req.session.user.id],
  );
  req.session.notice = result.affectedRows ? "Room inventory updated." : "That hotel isn't assigned to your provider account.";
  return res.redirect(303, "/dashboard");
});

module.exports = router;
module.exports.resourceDefinitions = resourceDefinitions;
