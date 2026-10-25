"use strict";

const { Router } = require("express");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const pool = require("../db");
const { resourceDefinitions } = require("./management-api");

const router = Router();
const templatePath = path.resolve(__dirname, "../../../frontend/admin.html");
const admins = ["administrator", "system_administrator"];
const providers = ["service_provider", "hotel_manager"];
const roleLabels = {
  tourist: "Tourist",
  administrator: "Administrator",
  service_provider: "Service provider",
  system_administrator: "System administrator",
  hotel_manager: "Hotel manager",
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

async function requireManagement(req, res, next) {
  if (!req.session.user) {
    req.session.notice = "Sign in with an administrator or service-provider account.";
    return res.redirect(303, `/account?mode=login&next=${encodeURIComponent("/dashboard")}`);
  }
  const [users] = await pool.execute("SELECT role, is_active FROM tourists WHERE id = ? LIMIT 1", [req.session.user.id]);
  if (!users.length || !users[0].is_active) return res.status(401).send("This account is unavailable.");
  const role = users[0].role;
  req.session.user.role = role;
  if (![...admins, ...providers].includes(role)) {
    return res.status(403).send("Your account does not have management access.");
  }
  next();
}

function dashboardHeader(user) {
  return `<a class="text-button" href="/trips">My trips</a>
    <form class="inline-form" action="/account/logout" method="post">
      <button class="button button-dark" type="submit">Sign out</button>
    </form>`;
}

async function sendDashboard(res, values) {
  let markup = await readFile(templatePath, "utf8");
  for (const [key, value] of Object.entries(values)) markup = markup.replaceAll(`{{${key}}}`, String(value));
  return res.type("html").send(markup);
}

function notice(req) {
  const value = req.session.notice;
  delete req.session.notice;
  return value ? `<p class="page-notice" role="status">${escapeHtml(value)}</p>` : "";
}

function inputFor(field, label, value, required) {
  const id = `${field}-${Math.random().toString(36).slice(2, 9)}`;
  const requiredAttribute = required ? " required" : "";
  if (["description", "highlights", "heritageNotes", "amenities", "historicalNotes"].includes(field)) {
    return `<label class="form-label" for="${id}">${escapeHtml(label)}</label><textarea class="form-input" id="${id}" name="${field}" maxlength="5000"${requiredAttribute}>${escapeHtml(value)}</textarea>`;
  }
  if (field === "category") {
    const categories = ["mountains", "heritage", "beach", "nature", "spiritual"];
    return `<label class="form-label" for="${id}">Category</label><select class="form-input" id="${id}" name="${field}"${requiredAttribute}>${categories.map((category) => `<option value="${category}"${category === value ? " selected" : ""}>${escapeHtml(category)}</option>`).join("")}</select>`;
  }
  const numeric = ["destinationId", "providerId", "entryFee", "rating", "featured", "pricePerNight", "availableRooms", "availableTickets", "averageCost", "availableTables"];
  const type = numeric.includes(field) ? "number" : field === "imageUrl" ? "url" : "text";
  const step = ["entryFee", "pricePerNight", "rating", "averageCost"].includes(field) ? ' step="0.01"' : "";
  const min = numeric.includes(field) ? ' min="0"' : "";
  return `<label class="form-label" for="${id}">${escapeHtml(label)}</label><input class="form-input" id="${id}" name="${field}" type="${type}" value="${escapeHtml(value)}" maxlength="5000"${step}${min}${requiredAttribute}>`;
}

const fieldLabels = {
  name: "Name", location: "Location", state: "State", description: "Description", category: "Category",
  tags: "Search tags", bestSeason: "Best season", climate: "Climate", highlights: "Highlights",
  heritageNotes: "Heritage notes", entryFee: "Entry fee (₹)", imageUrl: "Image URL",
  destinationId: "Destination ID", address: "Address", rating: "Rating (0–5)",
  pricePerNight: "Price per room / night (₹)", availableRooms: "Rooms available",
  amenities: "Room amenities", providerId: "Assigned provider account ID (optional)",
  type: "Place type", timings: "Opening hours", historicalNotes: "Historical notes",
  availableTickets: "Tickets available", cuisine: "Cuisine", averageCost: "Average cost for two (₹)",
  operatingHours: "Operating hours", availableTables: "Tables available",
};

function renderCreateForm(resource, definition) {
  const formFields = Object.keys(definition.columns)
    .map((field) => inputFor(field, fieldLabels[field] || field, "", definition.required.includes(field)))
    .join("");
  return `<form class="management-form" action="/api/management/entities/${resource}" method="post">
    <input type="hidden" name="_form" value="1"><h3>Add ${escapeHtml(resource.slice(0, -1))}</h3>
    ${formFields}<button class="button button-dark" type="submit">Add listing</button>
  </form>`;
}

function renderEditForm(resource, definition, row) {
  const fields = Object.entries(definition.columns)
    .map(([field, column]) => inputFor(field, fieldLabels[field] || field, row[column] ?? "", false))
    .join("");
  return `<details class="management-entry"><summary>#${row.id} · ${escapeHtml(row.name || row.service_name || row.transaction_id || "Record")}</summary>
    <form class="management-form" action="/api/management/entities/${resource}/${row.id}/update" method="post">
      <input type="hidden" name="_form" value="1">${fields}
      <div class="management-actions"><button class="button button-dark" type="submit">Save changes</button></div>
    </form>
    <form action="/api/management/entities/${resource}/${row.id}/delete" method="post">
      <input type="hidden" name="_form" value="1"><button class="button danger-button" type="submit">Delete listing</button>
    </form>
  </details>`;
}

function metric(label, value) {
  return `<article class="metric-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></article>`;
}

function table(headers, rows) {
  if (!rows.length) return '<p class="modal-note">Nothing here just yet.</p>';
  return `<div class="data-table-wrap"><table class="data-table"><thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`;
}

router.get("/dashboard", requireManagement, async (req, res) => {
  const role = req.session.user.role;
  let metrics = "";
  let content = "";

  if (admins.includes(role)) {
    const [[tourists]] = await pool.query("SELECT COUNT(*) AS total FROM tourists WHERE role = 'tourist'");
    const [[destinations]] = await pool.query("SELECT COUNT(*) AS total FROM destinations");
    const [[hotels]] = await pool.query("SELECT COUNT(*) AS total FROM hotels");
    const [[places]] = await pool.query("SELECT COUNT(*) AS total FROM places");
    const [[restaurants]] = await pool.query("SELECT COUNT(*) AS total FROM restaurants");
    const [[bookings]] = await pool.query("SELECT COUNT(*) AS total, SUM(status = 'confirmed') AS confirmed FROM bookings");
    const [[revenue]] = await pool.query("SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE status = 'success'");
    metrics = [
      ["Tourists", tourists.total], ["Destinations", destinations.total], ["Hotels", hotels.total],
      ["Places", places.total], ["Restaurants", restaurants.total], ["Bookings", bookings.total],
      ["Confirmed bookings", bookings.confirmed || 0], ["Recorded demo payments", "₹" + Number(revenue.total).toLocaleString("en-IN")],
    ].map(([label, value]) => metric(label, value)).join("");

    const nav = `<nav class="dashboard-nav">${Object.keys(resourceDefinitions).map((resource) => `<a href="#${resource}">${escapeHtml(resource)}</a>`).join("")}<a href="#bookings">Bookings</a><a href="#payments">Payments</a><a href="#reviews">Reviews</a>${role === "system_administrator" ? '<a href="#users">Accounts & roles</a><a href="#messages">Contact messages</a><a href="#database">Database</a>' : ""}</nav>`;
    const sections = [];
    for (const [resource, definition] of Object.entries(resourceDefinitions)) {
      const [rows] = await pool.query(`SELECT * FROM ${definition.table} ORDER BY id DESC LIMIT 35`);
      sections.push(`<section class="dashboard-section" id="${resource}"><h2>Manage ${escapeHtml(resource)}</h2>${renderCreateForm(resource, definition)}<div class="management-list">${rows.map((row) => renderEditForm(resource, definition, row)).join("") || '<p class="modal-note">No listings yet.</p>'}</div></section>`);
    }

    const [bookingRows] = await pool.query(
      `SELECT b.id, b.booking_date, b.check_out, b.status, b.total_amount, b.service_name,
              d.name AS destination_name, t.name AS tourist_name
         FROM bookings b JOIN destinations d ON d.id = b.destination_id
         JOIN tourists t ON t.id = b.tourist_id ORDER BY b.created_at DESC LIMIT 80`,
    );
    const bookingTable = table(["Booking", "Tourist", "Destination · service", "Date", "Total", "Status"], bookingRows.map((booking) => `<tr>
      <td>BID-#${booking.id}</td><td>${escapeHtml(booking.tourist_name)}</td>
      <td>${escapeHtml(booking.destination_name)} · ${escapeHtml(booking.service_name)}</td>
      <td>${escapeHtml(booking.booking_date)}${booking.check_out ? ` – ${escapeHtml(booking.check_out)}` : ""}</td>
      <td>₹${Number(booking.total_amount).toLocaleString("en-IN")}</td>
      <td><form class="inline-form" action="/api/management/bookings/${booking.id}/status" method="post"><input type="hidden" name="_form" value="1"><label class="visually-hidden" for="status-${booking.id}">Booking status</label><select id="status-${booking.id}" class="form-input" name="status">${["pending", "confirmed", "cancelled", "completed"].map((status) => `<option${booking.status === status ? " selected" : ""}>${status}</option>`).join("")}</select><button class="text-button" type="submit">Save</button></form></td>
    </tr>`));
    sections.push(`<section class="dashboard-section" id="bookings"><h2>Bookings</h2>${bookingTable}</section>`);

    const [paymentRows] = await pool.query(
      `SELECT p.id, p.amount, p.payment_mode, p.transaction_id, p.status, p.created_at,
              t.name AS tourist_name, d.name AS destination_name
         FROM payments p JOIN tourists t ON t.id = p.tourist_id
         JOIN bookings b ON b.id = p.booking_id JOIN destinations d ON d.id = b.destination_id
        ORDER BY p.created_at DESC LIMIT 80`,
    );
    const paymentTable = table(["Payment", "Tourist", "Destination", "Amount", "Method", "Transaction", "Status"], paymentRows.map((payment) => `<tr>
      <td>#${payment.id}</td><td>${escapeHtml(payment.tourist_name)}</td><td>${escapeHtml(payment.destination_name)}</td>
      <td>₹${Number(payment.amount).toLocaleString("en-IN")}</td><td>${escapeHtml(payment.payment_mode)}</td>
      <td>${escapeHtml(payment.transaction_id)}</td><td>${escapeHtml(payment.status)}
      ${payment.status === "success" ? `<form action="/api/management/payments/${payment.id}/refund" method="post"><input type="hidden" name="_form" value="1"><button class="text-button cancel-booking" type="submit">Record demo refund</button></form>` : ""}</td></tr>`));
    sections.push(`<section class="dashboard-section" id="payments"><h2>Payments & refunds</h2><p class="demo-warning">Payments and refunds are simulations. This dashboard cannot move or return real money.</p>${paymentTable}</section>`);

    const [reviewRows] = await pool.query(
      `SELECT r.id, r.rating, r.comment, r.created_at, r.verified,
              t.name AS tourist_name, d.name AS destination_name
         FROM reviews r JOIN tourists t ON t.id = r.tourist_id
         JOIN destinations d ON d.id = r.destination_id
        ORDER BY r.created_at DESC LIMIT 100`,
    );
    const reviewTable = table(["Rating", "Destination", "Traveler", "Verified", "Comment", "Moderation"], reviewRows.map((review) => `<tr>
      <td>★ ${review.rating}</td><td>${escapeHtml(review.destination_name)}</td><td>${escapeHtml(review.tourist_name)}</td>
      <td>${review.verified ? "Verified" : "Unverified"}</td><td>${escapeHtml(review.comment)}</td>
      <td><form action="/api/management/reviews/${review.id}/delete" method="post"><input type="hidden" name="_form" value="1"><button class="text-button cancel-booking" type="submit">Remove review</button></form></td></tr>`));
    sections.push(`<section class="dashboard-section" id="reviews"><h2>Review moderation</h2>${reviewTable}</section>`);

    if (role === "system_administrator") {
      const [users] = await pool.query("SELECT id, name, email, role, is_active FROM tourists ORDER BY id DESC LIMIT 100");
      const userTable = table(["ID", "Name", "Email", "Role", "Status"], users.map((user) => `<tr><td>${user.id}</td><td>${escapeHtml(user.name)}</td><td>${escapeHtml(user.email)}</td><td>
        <form class="inline-form" action="/api/management/users/${user.id}/role" method="post">
          <input type="hidden" name="_form" value="1"><label class="visually-hidden" for="role-${user.id}">Account role</label>
          <select id="role-${user.id}" class="form-input" name="role">${Object.entries(roleLabels).map(([value, label]) => `<option value="${value}"${value === user.role ? " selected" : ""}>${label}</option>`).join("")}</select>
          <button class="text-button" type="submit">Save role</button>
        </form><form class="inline-form" action="/api/management/users/${user.id}/status" method="post"><input type="hidden" name="_form" value="1"><input type="hidden" name="isActive" value="${user.is_active ? "0" : "1"}"><button class="text-button${user.is_active ? " cancel-booking" : ""}" type="submit">${user.is_active ? "Suspend account" : "Restore account"}</button></form></td><td>${user.is_active ? "Active" : "Suspended"}</td></tr>`));
      sections.push(`<section class="dashboard-section" id="users"><h2>Accounts & access</h2><p>Assign trusted staff roles or suspend access for accounts. Historical bookings and payment records are retained.</p>${userTable}</section>`);
      sections.push(`<section class="dashboard-section" id="database"><h2>Database tools</h2><p class="demo-warning">For safety, this app does not expose arbitrary SQL execution or a one-click database reset.</p><div class="database-actions"><a class="button button-dark" href="/admin/database/schema">Download schema-only SQL</a><a class="button button-outline" href="/api/sql/health">Read-only database health</a></div></section>`);
      const [messages] = await pool.query(
        "SELECT id, name, email, subject, message, status, created_at FROM contact_messages ORDER BY created_at DESC LIMIT 100",
      );
      const contactTable = table(["Received", "From", "Subject", "Message", "Status"], messages.map((message) => `<tr>
        <td>${escapeHtml(message.created_at)}</td><td>${escapeHtml(message.name)}<br>${escapeHtml(message.email)}</td>
        <td>${escapeHtml(message.subject)}</td><td>${escapeHtml(message.message)}</td><td><form action="/api/management/contact-messages/${message.id}/status" method="post"><input type="hidden" name="_form" value="1"><input type="hidden" name="status" value="${message.status === "new" ? "reviewed" : "new"}"><button class="text-button" type="submit">Mark ${message.status === "new" ? "reviewed" : "new"}</button></form></td></tr>`));
      sections.push(`<section class="dashboard-section" id="messages"><h2>Contact messages</h2>${contactTable}</section>`);
    }
    content = `${nav}${sections.join("")}`;
  } else {
    const [hotels] = await pool.execute(
      `SELECT h.id, h.name, h.address, h.available_rooms, d.name AS destination_name
         FROM hotels h JOIN destinations d ON d.id = h.destination_id
        WHERE h.provider_id = ? ORDER BY h.name`,
      [req.session.user.id],
    );
    const [reservations] = await pool.execute(
      `SELECT b.id, b.booking_date, b.check_out, b.quantity, b.guest_count, b.status,
              b.service_name, d.name AS destination_name, t.name AS tourist_name
         FROM bookings b JOIN hotels h ON b.service_type = 'hotel' AND b.service_id = h.id
         JOIN destinations d ON d.id = b.destination_id JOIN tourists t ON t.id = b.tourist_id
        WHERE h.provider_id = ? ORDER BY b.booking_date DESC LIMIT 150`,
      [req.session.user.id],
    );
    metrics = [
      ["Assigned hotels", hotels.length],
      ["Active room reservations", reservations.filter((booking) => ["pending", "confirmed"].includes(booking.status)).length],
      ["Reserved rooms", reservations.filter((booking) => ["pending", "confirmed"].includes(booking.status)).reduce((total, booking) => total + Number(booking.quantity), 0)],
    ].map(([label, value]) => metric(label, value)).join("");
    const hotelCards = hotels.map((hotel) => `<article class="management-entry"><strong>${escapeHtml(hotel.name)} · ${escapeHtml(hotel.destination_name)}</strong><span>${escapeHtml(hotel.address)}</span>
      <form class="management-form" action="/api/provider/hotels/${hotel.id}/inventory" method="post"><input type="hidden" name="_form" value="1">
        <label class="form-label" for="rooms-${hotel.id}">Update total room inventory</label><input class="form-input" id="rooms-${hotel.id}" name="availableRooms" type="number" min="0" max="100000" value="${hotel.available_rooms}" required><button class="button button-dark" type="submit">Save availability</button>
      </form></article>`).join("") || '<p class="modal-note">No hotels are assigned to this account yet. Ask an administrator to assign your provider account to a hotel.</p>';
    const reservationTable = table(["Booking", "Traveler", "Destination / hotel", "Stay", "Rooms · guests", "Status"], reservations.map((booking) => `<tr>
      <td>BID-#${booking.id}</td><td>${escapeHtml(booking.tourist_name)}</td>
      <td>${escapeHtml(booking.destination_name)} · ${escapeHtml(booking.service_name)}</td>
      <td>${escapeHtml(booking.booking_date)}${booking.check_out ? ` – ${escapeHtml(booking.check_out)}` : ""}</td>
      <td>${booking.quantity} · ${booking.guest_count}</td><td>${escapeHtml(booking.status)}</td></tr>`));
    content = `<section class="dashboard-section"><h2>Assigned hotels & room inventory</h2>${hotelCards}</section><section class="dashboard-section"><h2>Room reservations & occupancy</h2>${reservationTable}</section>`;
  }

  return sendDashboard(res, {
    DASHBOARD_TITLE: admins.includes(role) ? "Smart Tourist Guide System dashboard" : "Your guestbook.",
    DASHBOARD_ROLE: escapeHtml(roleLabels[role] || role),
    DASHBOARD_DESCRIPTION: admins.includes(role)
      ? "Tools for managing destinations, travelers, bookings, and listings in Smart Tourist Guide System."
      : "Check your room reservations, dates, guest counts, and current room inventory.",
    HEADER_ACTIONS: dashboardHeader(req.session.user),
    NOTICE: notice(req),
    DASHBOARD_METRICS: metrics,
    DASHBOARD_CONTENT: content,
  });
});

router.get("/admin/database/schema", requireManagement, async (req, res) => {
  if (req.session.user.role !== "system_administrator") return res.status(403).send("System administrator access is required.");
  return res.download(path.resolve(__dirname, "../../sql/schema.sql"), "roam-schema.sql");
});

router.get("/demo-payment", (req, res) => {
  res.type("html").send("<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width\"><title>Payment demo · Smart Tourist Guide System</title><link rel=\"stylesheet\" href=\"/styles.css\"><main class=\"account-page\"><a class=\"brand\" href=\"/\" aria-label=\"Smart Tourist Guide System home\"><span class=\"brand-mark\">ST</span><span class=\"brand-name\">Smart Tourist Guide <span>System</span></span></a><span class=\"eyebrow section-eyebrow\">PAYMENT DEMO ONLY</span><h1>No payment was made.</h1><p>This QR code points to the local Smart Tourist Guide System demonstration, not to UPI, a bank, or a payment gateway.</p><a class=\"underlined-link\" href=\"/\">Back to exploring</a></main></html>");
});

module.exports = router;
