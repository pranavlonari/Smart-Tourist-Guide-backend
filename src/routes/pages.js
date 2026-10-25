"use strict";

const { randomUUID } = require("node:crypto");
const { Router } = require("express");
const { readFile } = require("node:fs/promises");
const path = require("node:path");
const bcrypt = require("bcryptjs");
const QRCode = require("qrcode");
const { rateLimit } = require("express-rate-limit");
const pool = require("../db");
const { createBooking, getAvailability, processPayment } = require("../services/travel");
const { getTouristProfile, updateTouristProfile } = require("../services/profile");
const { isValidEmail, isValidPassword, isValidRating } = require("../validation");

const router = Router();
const frontendPath = path.resolve(__dirname, "../../../frontend");
const categories = ["mountains", "beach", "heritage", "nature", "spiritual"];
const categoryLabels = {
  mountains: "Hill Station",
  heritage: "Heritage & Culture",
  beach: "Beaches & Coastal",
  nature: "Nature & Wildlife",
  spiritual: "Spiritual",
};
const states = ["Maharashtra", "Rajasthan", "Goa", "Himachal Pradesh", "Kerala", "Karnataka", "Punjab"];
const sortLabels = { popularity: "Popularity", rating: "Tourist rating", fee: "Entry fee" };
const fallbackImage = "https://images.unsplash.com/photo-1470770841072-f978cf4d019e?auto=format&fit=crop&w=1000&q=80";
const dummyPasswordHash = bcrypt.hashSync("not-a-real-tourist-password", 12);
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: "Too many sign-in attempts. Please try again in a little while.",
});

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function safeImageUrl(value) {
  try {
    const image = new URL(value);
    return image.protocol === "https:" && image.hostname === "images.unsplash.com"
      ? image.href
      : fallbackImage;
  } catch {
    return fallbackImage;
  }
}

async function sendPage(res, fileName, values, status = 200) {
  let markup = await readFile(path.join(frontendPath, fileName), "utf8");
  for (const [key, value] of Object.entries(values)) {
    markup = markup.replaceAll(`{{${key}}}`, String(value));
  }
  return res.status(status).type("html").send(markup);
}

function takeNotice(req) {
  const message = req.session.notice;
  delete req.session.notice;
  return message ? `<p class="page-notice" role="status">${escapeHtml(message)}</p>` : "";
}

function setNotice(req, message) {
  req.session.notice = message;
}

function headerActions(user) {
  if (!user) return '<a class="button button-dark" href="/account">Sign in</a>';
  const management = ["administrator", "system_administrator", "service_provider", "hotel_manager"].includes(user.role)
    ? '<a class="text-button" href="/dashboard">Dashboard</a>'
    : "";
  const firstName = escapeHtml(String(user.name || "Profile").trim().split(/\s+/)[0]);
  return `<a class="header-link" href="/cart">Cart</a>${management}<a class="text-button" href="/profile">Hi, ${firstName}</a><a class="text-button header-secondary" href="/trips">My trips</a>
    <form class="inline-form" action="/account/logout" method="post">
      <button class="button button-dark" type="submit">Sign out</button>
    </form>`;
}

function accountPath(nextPath, fallback = "/") {
  if (typeof nextPath !== "string" || !nextPath.startsWith("/") || nextPath.startsWith("//")
      || nextPath.startsWith("/api/")) return fallback;
  return nextPath;
}

async function requireTourist(req, res, next) {
  if (req.session.user) {
    const [users] = await pool.execute("SELECT is_active FROM tourists WHERE id = ? LIMIT 1", [req.session.user.id]);
    if (users.length && users[0].is_active) return next();
    return res.status(403).type("html").send("<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><title>Account unavailable · Smart Tourist Guide System</title><link rel=\"stylesheet\" href=\"/styles.css\"><main class=\"account-page\"><h1>This account is unavailable.</h1><a class=\"underlined-link\" href=\"/account\">Sign in with another account</a></main></html>");
  }
  let returnPath = req.originalUrl;
  if (req.method === "POST" && req.path === "/bookings") {
    const destinationId = Number(req.body.destinationId);
    returnPath = Number.isSafeInteger(destinationId) && destinationId > 0
      ? `/destinations/${destinationId}`
      : "/";
  } else if (req.method === "POST" && /^\/destinations\/\d+\/reviews$/.test(req.path)) {
    returnPath = `/destinations/${req.params.id}`;
  } else if (req.method === "POST" && /^\/trips\/\d+\/cancel$/.test(req.path)) {
    returnPath = "/trips";
  } else if (req.path.startsWith("/cart")) {
    returnPath = "/cart";
  }
  const destination = accountPath(returnPath);
  setNotice(req, "Sign in to keep planning your trip.");
  return res.redirect(303, `/account?mode=login&next=${encodeURIComponent(destination)}`);
}

function safeCart(cart) {
  return Array.isArray(cart) ? cart.slice(0, 20) : [];
}

function cartItemTotal(item) {
  const nights = item.serviceType === "hotel"
    ? Math.max(1, Math.round((Date.parse(`${item.checkOut}T00:00:00Z`) - Date.parse(`${item.bookingDate}T00:00:00Z`)) / 86400000))
    : 1;
  return Math.round(Number(item.unitPrice) * Number(item.quantity) * nights * 100) / 100;
}

function requireRoles(allowedRoles) {
  return (req, res, next) => {
    if (!req.session.user) {
      setNotice(req, "Please sign in with an authorized account to continue.");
      return res.redirect(303, `/account?mode=login&next=${encodeURIComponent(accountPath(req.originalUrl))}`);
    }
    if (!allowedRoles.includes(req.session.user.role)) {
      res.status(403).type("html").send("<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><title>Not authorized · Smart Tourist Guide System</title><link rel=\"stylesheet\" href=\"/styles.css\"><main class=\"account-page\"><h1>This dashboard isn't available to your account.</h1><a class=\"underlined-link\" href=\"/\">Back to Smart Tourist Guide System</a></main></html>");
      return;
    }
    return next();
  };
}

function pageNotice(message) {
  return message ? `<p class="page-notice" role="alert">${escapeHtml(message)}</p>` : "";
}

async function queryDestinations(search, category) {
  const conditions = [];
  const values = [];
  const state = search.state;
  const maxFee = search.maxFee;
  const orderBy = sortLabels[search.sort] ? {
    popularity: "featured DESC, rating DESC, name ASC",
    rating: "rating DESC, name ASC",
    fee: "entry_fee ASC, name ASC",
  }[search.sort] : "featured DESC, rating DESC, name ASC";
  if (search.q) {
    conditions.push("(name LIKE ? OR location LIKE ? OR state LIKE ? OR description LIKE ? OR category LIKE ? OR tags LIKE ?)");
    const term = `%${search.q}%`;
    values.push(term, term, term, term);
    values.push(term, term);
  }
  if (categories.includes(search.category)) {
    conditions.push("category = ?");
    values.push(search.category);
  }
  if (states.includes(state)) {
    conditions.push("state = ?");
    values.push(state);
  }
  if (Number.isFinite(maxFee)) {
    conditions.push("entry_fee <= ?");
    values.push(maxFee);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const [rows] = await pool.execute(
    `SELECT id, name, location, state, description, category, tags,
            best_season AS bestSeason, climate, highlights, heritage_notes AS heritageNotes,
            entry_fee AS entryFee, image_url AS imageUrl, rating,
            (SELECT COUNT(*) FROM reviews r WHERE r.destination_id = destinations.id) AS reviewCount
       FROM destinations ${where}
      ORDER BY ${orderBy}
      LIMIT 60`,
    values,
  );
  return rows;
}

function renderDestinationCard(destination) {
  return `<article class="destination-card">
    <a class="card-link" href="/destinations/${destination.id}" aria-label="Discover ${escapeHtml(destination.name)}">
      <div class="card-image-wrap">
        <img class="card-image" src="${escapeHtml(safeImageUrl(destination.imageUrl))}" alt="Scenery in ${escapeHtml(destination.name)}" loading="lazy">
        <span class="card-category">${escapeHtml(destination.category)}</span>
        <span class="card-arrow" aria-hidden="true">↗</span>
      </div>
      <div class="card-content">
        <p class="card-location">${escapeHtml(destination.state || destination.location)}</p>
        <h3>${escapeHtml(destination.name)}</h3>
        <p class="card-description">${escapeHtml(destination.description)}</p>
        <div class="card-foot">
          <span class="card-rating"><span>★ </span>${Number(destination.rating).toFixed(1)} · ${Number(destination.reviewCount)} reviews</span>
          <span>${Number(destination.entryFee) ? `Entry from ₹${Number(destination.entryFee).toLocaleString("en-IN")}` : "A little adventure, free"}</span>
        </div>
      </div>
    </a>
  </article>`;
}

function renderCategoryOptions(selected) {
  const options = [['', "Every category"], ...Object.entries(categoryLabels)];
  return options.map(([value, label]) => `<option value="${escapeHtml(value)}"${value === selected ? " selected" : ""}>${escapeHtml(label)}</option>`).join("");
}

function renderOptions(options, selected, emptyLabel, labels = {}) {
  const rows = emptyLabel ? [["", emptyLabel], ...options.map((value) => [value, labels[value] || value])] : options.map((value) => [value, labels[value] || value]);
  return rows.map(([value, label]) => `<option value="${escapeHtml(value)}"${value === selected ? " selected" : ""}>${escapeHtml(label)}</option>`).join("");
}

function renderCategoryPills(selected) {
  const pills = Object.entries(categoryLabels).map(([category, label]) => {
    const href = `/?${new URLSearchParams({ category }).toString()}#destinations`;
    return `<a class="category-pill${selected === category ? " is-active" : ""}" href="${href}">${escapeHtml(label)}</a>`;
  });
  return `<a class="category-pill${selected ? "" : " is-active"}" href="/#destinations">Everything</a>${pills.join("")}`;
}

router.get("/about", async (req, res) => sendPage(res, "about.html", {
  HEADER_ACTIONS: headerActions(req.session.user),
}));

router.get("/contact", async (req, res) => sendPage(res, "contact.html", {
  HEADER_ACTIONS: headerActions(req.session.user),
  NOTICE: takeNotice(req),
}));

router.post("/contact", async (req, res) => {
  const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
  const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const subject = typeof req.body.subject === "string" ? req.body.subject.trim() : "";
  const message = typeof req.body.message === "string" ? req.body.message.trim() : "";
  if (name.length < 2 || name.length > 100 || !isValidEmail(email)
      || subject.length < 3 || subject.length > 150 || message.length < 10 || message.length > 3000) {
    setNotice(req, "Please check your name, email, subject, and message before sending.");
    return res.redirect(303, "/contact");
  }
  await pool.execute(
    "INSERT INTO contact_messages (name, email, subject, message) VALUES (?, ?, ?, ?)",
    [name, email, subject, message],
  );
  setNotice(req, "Thanks for getting in touch. Your message has been saved for the site administrator.");
  return res.redirect(303, "/contact");
});

router.get("/admin/login", (req, res) => {
  if (req.session.user && ["administrator", "system_administrator"].includes(req.session.user.role)) {
    return res.redirect(303, "/dashboard");
  }
  return sendPage(res, "admin-login.html", {
    NOTICE: takeNotice(req),
  });
});

router.post("/admin/login", authLimiter, async (req, res) => {
  const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const password = req.body.password;
  if (!isValidEmail(email) || !isValidPassword(password)) {
    setNotice(req, "Enter a valid administrator email and password.");
    return res.redirect(303, "/admin/login");
  }
  const [rows] = await pool.execute(
    `SELECT id, name, email, password_hash, role
       FROM tourists
      WHERE email = ? AND is_active = 1
      LIMIT 1`,
    [email],
  );
  const user = rows[0];
  const passwordMatches = await bcrypt.compare(password, user ? user.password_hash : dummyPasswordHash);
  if (!user || !passwordMatches || !["administrator", "system_administrator"].includes(user.role)) {
    setNotice(req, "Those credentials don't match an active administrator account.");
    return res.redirect(303, "/admin/login");
  }
  await new Promise((resolve, reject) => {
    req.session.regenerate((error) => (error ? reject(error) : resolve()));
  });
  req.session.user = { id: user.id, name: user.name, email: user.email, role: user.role };
  setNotice(req, `Welcome back, ${user.name.split(" ")[0]}.`);
  return res.redirect(303, "/dashboard");
});

router.get("/cart", requireTourist, async (req, res) => {
  const cart = safeCart(req.session.cart);
  const cartItems = await Promise.all(cart.map(async (item) => {
    const availability = await getAvailability({
      destinationId: item.destinationId,
      serviceType: item.serviceType,
      serviceId: item.serviceId,
      bookingDate: item.bookingDate,
      checkOut: item.checkOut,
    });
    const currentPrice = availability.valid ? availability.unitPrice : item.unitPrice;
    const total = cartItemTotal({ ...item, unitPrice: currentPrice });
    const canCheckout = availability.valid && availability.available >= item.quantity;
    return {
      total,
      markup: `<article class="cart-item">
      <div class="cart-item-details"><span class="eyebrow section-eyebrow">${escapeHtml(item.destinationName)}</span>
        <h2>${escapeHtml(item.serviceName)}</h2>
        <p>${item.serviceType === "hotel" ? "Stay" : item.serviceType === "place" ? "Attraction" : "Dining"} · ${escapeHtml(item.bookingDate)}${item.checkOut ? ` – ${escapeHtml(item.checkOut)}` : ""}</p>
        <p>${item.quantity} item(s) · ${item.guestCount} guest(s)${item.serviceType === "hotel" && item.checkOut ? ` · ${Math.max(1, Math.round((Date.parse(`${item.checkOut}T00:00:00Z`) - Date.parse(`${item.bookingDate}T00:00:00Z`)) / 86400000))} night(s)` : ""}</p>
        <span class="${canCheckout ? "cart-availability" : "cart-unavailable"}">${canCheckout ? `${availability.available} available in demo inventory` : "No longer available for these dates. Remove and choose another date."}</span>
      </div>
      <div class="cart-item-actions"><strong>₹${total.toLocaleString("en-IN")}</strong>
        ${canCheckout ? `<form action="/cart/${encodeURIComponent(item.id)}/checkout" method="post"><button class="button button-dark" type="submit">Continue to checkout <span aria-hidden="true">↗</span></button></form>` : ""}
        <form action="/cart/${encodeURIComponent(item.id)}/remove" method="post"><button class="text-button cancel-booking" type="submit">Remove</button></form>
      </div>
    </article>`,
    };
  }));
  const total = cartItems.reduce((sum, item) => sum + item.total, 0);
  return sendPage(res, "cart.html", {
    HEADER_ACTIONS: headerActions(req.session.user),
    NOTICE: takeNotice(req),
    CHECKOUT_STEPS: '<ol class="checkout-steps" aria-label="Checkout progress"><li class="is-current">Cart</li><li>Payment</li><li>Confirmation</li></ol>',
    CART_ITEMS: cartItems.map((item) => item.markup).join("") || '<section class="empty-state"><span aria-hidden="true">✳</span><h2>Your cart is ready for an idea.</h2><p>Explore destinations and add a stay, attraction, or restaurant experience.</p><a class="button button-dark" href="/">Explore destinations</a></section>',
    CART_SUMMARY: cartItems.length
      ? `<section class="cart-total"><span>${cartItems.length} selected experience(s) · estimated total</span><strong>₹${total.toLocaleString("en-IN")}</strong><p>Each experience is checked out as its own booking. Availability and price are verified before payment.</p></section>`
      : "",
  });
});

router.get("/profile", requireTourist, async (req, res) => {
  const user = await getTouristProfile(req.session.user.id);
  if (!user) return res.status(404).send("We couldn't find an active account.");
  req.session.user.name = user.name;
  req.session.user.email = user.email;
  req.session.user.role = user.role;
  const [[tripCount]] = await pool.execute(
    "SELECT COUNT(*) AS total FROM bookings WHERE tourist_id = ?",
    [user.id],
  );
  const roleLabels = {
    tourist: "TOURIST",
    administrator: "ADMINISTRATOR",
    system_administrator: "SYSTEM ADMINISTRATOR",
    service_provider: "SERVICE PROVIDER",
    hotel_manager: "HOTEL MANAGER",
  };
  const initials = user.name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  return sendPage(res, "profile.html", {
    HEADER_ACTIONS: headerActions(req.session.user),
    MANAGEMENT_LINK: ["administrator", "system_administrator", "service_provider", "hotel_manager"].includes(user.role)
      ? '<a href="/dashboard">Dashboard</a>'
      : "",
    NOTICE: takeNotice(req),
    PROFILE_INITIALS: escapeHtml(initials),
    PROFILE_ROLE: escapeHtml(roleLabels[user.role] || "ACCOUNT"),
    PROFILE_NAME: escapeHtml(user.name),
    PROFILE_NAME_VALUE: escapeHtml(user.name),
    PROFILE_EMAIL: escapeHtml(user.email),
    PROFILE_PHONE: escapeHtml(user.phone),
    PROFILE_CREATED: escapeHtml(new Date(user.createdAt).toLocaleDateString(undefined, { year: "numeric", month: "long" })),
    PROFILE_TRIP_COUNT: Number(tripCount.total).toLocaleString("en-IN"),
    PROFILE_STATUS: "Active",
  });
});

router.post("/profile", requireTourist, async (req, res) => {
  const result = await updateTouristProfile(req.session.user.id, req.body);
  if (result.error) {
    setNotice(req, result.error);
    return res.redirect(303, "/profile");
  }
  req.session.user.name = result.user.name;
  req.session.user.email = result.user.email;
  setNotice(req, "Your profile details have been saved.");
  return res.redirect(303, "/profile");
});

router.post("/cart/add", requireTourist, async (req, res) => {
  const destinationId = Number(req.body.destinationId);
  const serviceId = Number(req.body.serviceId);
  const quantity = Number(req.body.quantity);
  const guestCount = Number(req.body.guestCount);
  const serviceType = typeof req.body.serviceType === "string" ? req.body.serviceType : "";
  const bookingDate = typeof req.body.bookingDate === "string" ? req.body.bookingDate : "";
  const checkOut = typeof req.body.checkOut === "string" ? req.body.checkOut : null;
  const availability = await getAvailability({ destinationId, serviceType, serviceId, bookingDate, checkOut });
  if (!availability.valid || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 20
      || !Number.isSafeInteger(guestCount) || guestCount < 1 || guestCount > 20
      || quantity > availability.available) {
    setNotice(req, "We couldn't add that experience. Check the dates, quantity, and current sample availability.");
    return res.redirect(303, destinationId > 0 ? `/destinations/${destinationId}` : "/");
  }
  const [destinations] = await pool.execute("SELECT name FROM destinations WHERE id = ? LIMIT 1", [destinationId]);
  if (!destinations.length) return res.status(404).send("Destination not found.");
  const cart = safeCart(req.session.cart);
  if (cart.length >= 20) {
    setNotice(req, "Your cart has reached its 20-experience limit. Remove an item before adding another.");
    return res.redirect(303, "/cart");
  }
  cart.push({
    id: randomUUID(),
    destinationId,
    destinationName: destinations[0].name,
    serviceType,
    serviceId,
    serviceName: availability.service.name,
    bookingDate,
    checkOut: serviceType === "hotel" ? checkOut : null,
    quantity,
    guestCount,
    unitPrice: availability.unitPrice,
  });
  req.session.cart = cart;
  setNotice(req, "Added to your trip cart. Availability will be checked again at checkout.");
  return res.redirect(303, "/cart");
});

router.post("/cart/:id/remove", requireTourist, (req, res) => {
  const cart = safeCart(req.session.cart);
  const nextCart = cart.filter((item) => item.id !== req.params.id);
  if (nextCart.length === cart.length) setNotice(req, "That cart item was already removed.");
  else {
    req.session.cart = nextCart;
    setNotice(req, "Removed from your cart.");
  }
  return res.redirect(303, "/cart");
});

router.post("/cart/:id/checkout", requireTourist, async (req, res) => {
  const cart = safeCart(req.session.cart);
  const item = cart.find((entry) => entry.id === req.params.id);
  if (!item) {
    setNotice(req, "That cart item is no longer available.");
    return res.redirect(303, "/cart");
  }
  const result = await createBooking({
    touristId: req.session.user.id,
    destinationId: item.destinationId,
    serviceType: item.serviceType,
    serviceId: item.serviceId,
    bookingDate: item.bookingDate,
    checkOut: item.checkOut,
    quantity: item.quantity,
    guestCount: item.guestCount,
  });
  if (result.error) {
    setNotice(req, result.error);
    return res.redirect(303, "/cart");
  }
  req.session.cart = cart.filter((entry) => entry.id !== item.id);
  return res.redirect(303, `/payment/${result.booking.id}`);
});

router.get("/", async (req, res) => {
  const search = {
    q: typeof req.query.q === "string" ? req.query.q.trim().slice(0, 100) : "",
    category: typeof req.query.category === "string" ? req.query.category : "",
    state: typeof req.query.state === "string" ? req.query.state : "",
    sort: typeof req.query.sort === "string" ? req.query.sort : "popularity",
    maxFee: req.query.maxFee === undefined ? null : Number(req.query.maxFee),
  };
  if (!Number.isFinite(search.maxFee) || search.maxFee < 0) search.maxFee = null;
  const destinations = await queryDestinations(search, search.category);
  return sendPage(res, "index.html", {
    HEADER_ACTIONS: headerActions(req.session.user),
    SEARCH_QUERY: escapeHtml(search.q),
    STATE_OPTIONS: renderOptions(states, search.state, "Everywhere"),
    CATEGORY_OPTIONS: renderCategoryOptions(search.category),
    MAX_FEE: search.maxFee ?? 2000,
    MAX_FEE_LABEL: search.maxFee === null || search.maxFee >= 2000 ? "1,000+" : search.maxFee,
    SORT_OPTIONS: renderOptions(Object.keys(sortLabels), search.sort, null, sortLabels),
    CATEGORY_PILLS: renderCategoryPills(search.category),
    NOTICE: takeNotice(req),
    RESULTS_COUNT: `${destinations.length} ${destinations.length === 1 ? "lovely place" : "lovely places"} to explore`,
    DESTINATION_CARDS: destinations.map(renderDestinationCard).join(""),
    EMPTY_STATE: destinations.length
      ? ""
      : '<div class="empty-state"><span aria-hidden="true">✳</span><h3>No places found just yet.</h3><p>Try another search. Your somewhere is out there.</p></div>',
  });
});

router.get("/destinations/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id < 1) return res.status(404).send("Destination not found.");
  const [destinations] = await pool.execute(
    `SELECT id, name, location, state, description, category, tags, best_season AS bestSeason,
            climate, highlights, heritage_notes AS heritageNotes, entry_fee AS entryFee,
            image_url AS imageUrl, rating,
            (SELECT COUNT(*) FROM reviews r WHERE r.destination_id = destinations.id) AS reviewCount
       FROM destinations WHERE id = ? LIMIT 1`,
    [id],
  );
  if (!destinations.length) return res.status(404).send("Destination not found.");
  const destination = destinations[0];
  const [[hotels], [places], [restaurants], [reviews]] = await Promise.all([
    pool.execute("SELECT id, name, address, rating, price_per_night AS pricePerNight, available_rooms AS capacity, amenities FROM hotels WHERE destination_id = ? ORDER BY name", [id]),
    pool.execute("SELECT id, name, type, timings, entry_fee AS entryFee, historical_notes AS historicalNotes, available_tickets AS capacity FROM places WHERE destination_id = ? ORDER BY name", [id]),
    pool.execute("SELECT id, name, address, rating, cuisine, average_cost AS averageCost, operating_hours AS operatingHours, available_tables AS capacity FROM restaurants WHERE destination_id = ? ORDER BY name", [id]),
    pool.execute(
      `SELECT r.rating, r.comment, r.verified, r.created_at AS createdAt, t.name AS touristName
         FROM reviews r JOIN tourists t ON t.id = r.tourist_id
        WHERE r.destination_id = ? ORDER BY r.created_at DESC LIMIT 30`,
      [id],
    ),
  ]);

  const listings = [
    ["hotels", "Hotels & stays", "hotel", hotels],
    ["places", "Places & attractions", "place", places],
    ["restaurants", "Dining & restaurants", "restaurant", restaurants],
  ];
  const listingGroups = listings.map(([idName, title, serviceType, records]) => {
    const items = records.length ? records.map((listing) => {
      const secondary = listing.address || listing.type || "A local favorite";
      const rating = listing.rating ? ` · ★ ${Number(listing.rating).toFixed(1)}` : "";
      const timings = listing.timings || listing.operatingHours ? ` · ${escapeHtml(listing.timings || listing.operatingHours)}` : "";
      const price = serviceType === "hotel" ? listing.pricePerNight
        : serviceType === "place" ? listing.entryFee : listing.averageCost;
      const priceLabel = serviceType === "hotel" ? "per room / night"
        : serviceType === "place" ? "per ticket" : "average for two";
      const extras = serviceType === "hotel" ? listing.amenities
        : serviceType === "place" ? listing.historicalNotes : listing.cuisine;
      const stockName = serviceType === "hotel" ? "rooms"
        : serviceType === "place" ? "tickets" : "tables";
      return `<article class="listing">
        <strong>${escapeHtml(listing.name)}</strong>
        <span>${escapeHtml(secondary)}${rating}${timings}</span>
        <span>${escapeHtml(extras || "")}</span>
        <span class="listing-price">₹${Number(price).toLocaleString("en-IN")} <small>${priceLabel}</small> · ${Number(listing.capacity)} ${stockName} total</span>
        <form class="listing-form" action="/availability" method="get">
          <input type="hidden" name="destinationId" value="${destination.id}">
          <input type="hidden" name="serviceType" value="${serviceType}">
          <input type="hidden" name="serviceId" value="${listing.id}">
          <label class="form-label" for="booking-date-${serviceType}-${listing.id}">${serviceType === "hotel" ? "Check-in" : "Visit date"}</label>
          <input class="form-input" id="booking-date-${serviceType}-${listing.id}" name="bookingDate" type="date" min="${new Date().toISOString().slice(0, 10)}" required>
          ${serviceType === "hotel" ? `<label class="form-label" for="checkout-date-${listing.id}">Check-out</label><input class="form-input" id="checkout-date-${listing.id}" name="checkOut" type="date" min="${new Date().toISOString().slice(0, 10)}" required>` : ""}
          <label class="form-label" for="quantity-${serviceType}-${listing.id}">${serviceType === "hotel" ? "Rooms" : serviceType === "place" ? "Tickets" : "Tables"}</label>
          <input class="form-input" id="quantity-${serviceType}-${listing.id}" name="quantity" type="number" min="1" max="20" value="1" required>
          <label class="form-label" for="guests-${serviceType}-${listing.id}">Guests</label>
          <input class="form-input" id="guests-${serviceType}-${listing.id}" name="guestCount" type="number" min="1" max="20" value="1" required>
          <button class="button button-dark" type="submit">Check availability <span aria-hidden="true">↗</span></button>
        </form>
      </article>`;
    }).join("") : '<p class="modal-note">More local favorites are on their way.</p>';
    return `<section class="detail-group" id="${idName}"><h2>${title}</h2>${items}</section>`;
  }).join("");
  const reviewItems = reviews.length ? reviews.map((review) => {
    const stars = "★".repeat(review.rating) + "☆".repeat(5 - review.rating);
    return `<article class="review-item"><span>${stars}</span>${review.verified ? '<span class="verified-review"> · Verified traveler</span>' : ""}<br>${escapeHtml(review.comment)}<br><strong>${escapeHtml(review.touristName)}</strong><small>${escapeHtml(new Date(review.createdAt).toLocaleDateString())}</small></article>`;
  }).join("") : '<p class="modal-note">No stories shared here yet. Yours could be the first.</p>';

  return sendPage(res, "destination.html", {
    PAGE_TITLE: `${escapeHtml(destination.name)} · Smart Tourist Guide System`,
    HEADER_ACTIONS: headerActions(req.session.user),
    NOTICE: takeNotice(req),
    DESTINATION_IMAGE: escapeHtml(safeImageUrl(destination.imageUrl)),
    DESTINATION_NAME: escapeHtml(destination.name),
    DESTINATION_LOCATION: escapeHtml(destination.location),
    DESTINATION_CATEGORY: escapeHtml(destination.category),
    DESTINATION_DESCRIPTION: escapeHtml(destination.description),
    DESTINATION_FACTS: `<span class="detail-fact">★ ${Number(destination.rating).toFixed(1)} traveler rating</span><span class="detail-fact">${Number(destination.entryFee) ? `Entry fee ₹${Number(destination.entryFee).toLocaleString("en-IN")}` : "No entry fee"}</span>`,
    SEASON_CLIMATE: `<span class="detail-fact">Best season: ${escapeHtml(destination.bestSeason || "Year-round")}</span><span class="detail-fact">${escapeHtml(destination.climate || "A lovely place to explore")}</span>`,
    DESTINATION_HIGHLIGHTS: escapeHtml(destination.highlights || ""),
    DESTINATION_HERITAGE: escapeHtml(destination.heritageNotes || ""),
    LISTING_GROUPS: listingGroups,
    REVIEWS: reviewItems,
    DESTINATION_ID: destination.id,
  });
});

  router.get("/availability", async (req, res) => {
    const destinationId = Number(req.query.destinationId);
    const serviceType = typeof req.query.serviceType === "string" ? req.query.serviceType : "";
    const serviceId = Number(req.query.serviceId);
    const bookingDate = typeof req.query.bookingDate === "string" ? req.query.bookingDate : "";
    const checkOut = typeof req.query.checkOut === "string" ? req.query.checkOut : "";
    const quantity = Math.min(20, Math.max(1, Number(req.query.quantity) || 1));
    const guestCount = Math.min(20, Math.max(1, Number(req.query.guestCount) || 1));
    const availability = await getAvailability({ destinationId, serviceType, serviceId, bookingDate, checkOut });
    if (!availability.valid) {
      setNotice(req, "Choose a valid listing and future date range to check availability.");
      return res.redirect(303, destinationId > 0 ? `/destinations/${destinationId}` : "/");
    }

    const [destinations] = await pool.execute("SELECT id, name FROM destinations WHERE id = ? LIMIT 1", [destinationId]);
    if (!destinations.length) return res.status(404).send("Destination not found.");
    const destination = destinations[0];
    const isAvailable = quantity <= availability.available;
    const duration = serviceType === "hotel"
      ? Math.max(1, Math.round((Date.parse(`${checkOut}T00:00:00Z`) - Date.parse(`${bookingDate}T00:00:00Z`)) / 86400000))
      : 1;
    const total = Number((availability.unitPrice * quantity * duration).toFixed(2));
    const label = serviceType === "hotel" ? `${quantity} room(s) · ${guestCount} guest(s)`
      : serviceType === "place" ? `${quantity} ticket(s) · ${guestCount} guest(s)`
        : `${quantity} table(s) · ${guestCount} guest(s)`;
    const dateSummary = serviceType === "hotel"
      ? `${bookingDate} to ${checkOut} · ${duration} night(s)` : bookingDate;
    const notice = isAvailable
      ? `<p class="page-notice" role="status">Good news — your dates are available in our demo inventory. ${availability.available} ${serviceType === "hotel" ? "room(s)" : serviceType === "place" ? "ticket(s)" : "table(s)"} remain.</p>`
      : `<p class="page-notice" role="alert">Those dates don't have enough availability (${availability.available} ${serviceType === "hotel" ? "room(s)" : serviceType === "place" ? "ticket(s)" : "table(s)"} remain). Try a smaller group or another date.</p>`;
    const bookingForm = isAvailable ? `<form class="checkout-form" action="/bookings" method="post">
      <input type="hidden" name="destinationId" value="${destinationId}">
      <input type="hidden" name="serviceType" value="${escapeHtml(serviceType)}">
      <input type="hidden" name="serviceId" value="${serviceId}">
      <input type="hidden" name="bookingDate" value="${escapeHtml(bookingDate)}">
      <input type="hidden" name="checkOut" value="${escapeHtml(checkOut)}">
      <input type="hidden" name="quantity" value="${quantity}">
      <input type="hidden" name="guestCount" value="${guestCount}">
      <p class="demo-warning">Inventory and prices are examples for this project demo and are not live provider availability.</p>
      <button class="button button-dark form-submit" type="submit">Continue to booking · ₹${total.toLocaleString("en-IN")} <span aria-hidden="true">↗</span></button>
    </form>` : `<a class="button button-dark" href="/destinations/${destinationId}#${serviceType === "hotel" ? "hotels" : serviceType === "place" ? "places" : "restaurants"}">Try other dates <span aria-hidden="true">↗</span></a>`;
    const cartForm = isAvailable && req.session.user ? `<form class="cart-add-form" action="/cart/add" method="post">
      <input type="hidden" name="destinationId" value="${destinationId}">
      <input type="hidden" name="serviceType" value="${escapeHtml(serviceType)}">
      <input type="hidden" name="serviceId" value="${serviceId}">
      <input type="hidden" name="bookingDate" value="${escapeHtml(bookingDate)}">
      <input type="hidden" name="checkOut" value="${escapeHtml(checkOut)}">
      <input type="hidden" name="quantity" value="${quantity}">
      <input type="hidden" name="guestCount" value="${guestCount}">
      <button class="button button-outline" type="submit">Add to trip cart</button>
    </form>` : isAvailable ? '<p class="modal-note">Sign in to add this experience to your cart.</p>' : "";
    const sortColumn = serviceType === "place" ? "name" : "rating DESC, name";
    const [alternatives] = await pool.execute(
      `SELECT id, name, ${serviceType === "hotel" ? "address" : serviceType === "place" ? "type" : "cuisine"} AS description
         FROM ${serviceType === "hotel" ? "hotels" : serviceType === "place" ? "places" : "restaurants"}
        WHERE destination_id = ? AND id <> ? ORDER BY ${sortColumn} LIMIT 4`,
      [destinationId, serviceId],
    );
    const alternativeCards = alternatives.map((item) => `<a class="alternative-card" href="/destinations/${destinationId}#${serviceType === "hotel" ? "hotels" : serviceType === "place" ? "places" : "restaurants"}"><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.description || "A local favorite")}</span></a>`).join("")
      || '<p class="modal-note">More local favorites are on their way.</p>';
    return sendPage(res, "availability.html", {
      HEADER_ACTIONS: headerActions(req.session.user),
      NOTICE: notice,
      DESTINATION_ID: destinationId,
      DESTINATION_NAME: escapeHtml(destination.name),
      AVAILABILITY_HEADING: isAvailable ? "It's looking good." : "Let's try another plan.",
      SERVICE_NAME: escapeHtml(availability.service.name),
      DATE_SUMMARY: escapeHtml(dateSummary),
      CAPACITY_SUMMARY: escapeHtml(label),
      PRICE_SUMMARY: `₹${total.toLocaleString("en-IN")} estimated · demo pricing`,
      BOOKING_FORM: bookingForm,
      CART_FORM: cartForm,
      ALTERNATIVES: alternativeCards,
    });
  });

  router.get("/bookings/:id/payment", requireTourist, (req, res) => res.redirect(303, `/payment/${req.params.id}`));

  router.get("/payment/:id", requireTourist, async (req, res) => {
    const bookingId = Number(req.params.id);
    if (!Number.isSafeInteger(bookingId) || bookingId < 1) return res.status(404).send("Booking not found.");
    const [bookings] = await pool.execute(
      `SELECT b.id, b.tourist_id AS touristId, b.booking_date AS bookingDate,
              b.check_out AS checkOut, b.quantity, b.guest_count AS guestCount,
              b.total_amount AS totalAmount, b.service_name AS serviceName, b.status,
              d.name AS destinationName
         FROM bookings b JOIN destinations d ON d.id = b.destination_id
        WHERE b.id = ? LIMIT 1`,
      [bookingId],
    );
    const booking = bookings[0];
    if (!booking || Number(booking.touristId) !== Number(req.session.user.id)) return res.status(404).send("Booking not found.");
    if (booking.status !== "pending") {
      const [payments] = await pool.execute(
        "SELECT transaction_id AS transactionId FROM payments WHERE booking_id = ? ORDER BY id DESC LIMIT 1",
        [bookingId],
      );
      if (payments.length) return res.redirect(303, `/receipts/${bookingId}`);
      return res.redirect(303, "/trips");
    }
    const traveler = await getTouristProfile(req.session.user.id);
    if (!traveler) return res.status(404).send("We couldn't find an active account.");
    const dateSummary = booking.checkOut
      ? `${booking.bookingDate} to ${booking.checkOut}` : booking.bookingDate;
    return sendPage(res, "payment.html", {
      HEADER_ACTIONS: headerActions(req.session.user),
      NOTICE: takeNotice(req),
      CHECKOUT_STEPS: '<ol class="checkout-steps" aria-label="Checkout progress"><li>Cart</li><li class="is-current">Payment</li><li>Confirmation</li></ol>',
      TRAVELER_NAME: escapeHtml(traveler.name),
      TRAVELER_EMAIL: escapeHtml(traveler.email),
      TRAVELER_PHONE: escapeHtml(traveler.phone),
      BOOKING_ID: booking.id,
      BOOKING_DESTINATION: escapeHtml(booking.destinationName),
      BOOKING_SERVICE: escapeHtml(booking.serviceName),
      BOOKING_DATE: escapeHtml(dateSummary),
      BOOKING_QUANTITY_LABEL: `${booking.quantity} item(s) · ${booking.guestCount} guest(s)`,
      BOOKING_TOTAL: Number(booking.totalAmount).toLocaleString("en-IN"),
      PAYMENT_QR: await QRCode.toDataURL(`${process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`}/demo-payment`, { errorCorrectionLevel: "M", margin: 2, width: 150 }),
      FAILURE_OPTION_DISABLED: process.env.NODE_ENV === "production" ? "disabled" : "",
      PAYMENT_BUTTON: "Simulate payment",
    });
  });

  router.post("/bookings/:id/pay", requireTourist, async (req, res) => {
    const result = await processPayment({
      bookingId: req.params.id,
      touristId: req.session.user.id,
      mode: req.body.mode,
      bankName: req.body.bankName,
      simulateFailure: req.body.simulateFailure === "true",
    });
    if (result.error) {
      setNotice(req, result.error);
      return res.redirect(303, `/payment/${encodeURIComponent(req.params.id)}`);
    }
    if (result.payment.status === "failed") {
      setNotice(req, `The demo transaction ${result.payment.transactionId} failed. No charge was made. Choose another test result or retry.`);
      return res.redirect(303, `/payment/${result.payment.bookingId}`);
    }
    setNotice(req, result.payment.status === "cash_due"
      ? "Your demo reservation is confirmed; payment is due directly to the provider."
      : "Your demo payment succeeded. No real payment was processed.");
    return res.redirect(303, `/receipts/${result.payment.bookingId}`);
  });

  router.get("/receipts/:id", requireTourist, async (req, res) => {
    const bookingId = Number(req.params.id);
    if (!Number.isSafeInteger(bookingId) || bookingId < 1) return res.status(404).send("Ticket not found.");
    const [rows] = await pool.execute(
      `SELECT b.id, b.tourist_id AS touristId, b.booking_date AS bookingDate,
              b.check_out AS checkOut, b.quantity, b.guest_count AS guestCount,
              b.total_amount AS totalAmount, b.service_name AS serviceName, b.status AS bookingStatus,
              b.verification_token AS verificationToken, d.name AS destinationName,
              t.name AS touristName, t.email AS touristEmail,
              p.transaction_id AS transactionId, p.payment_mode AS paymentMode, p.status AS paymentStatus
         FROM bookings b JOIN destinations d ON d.id = b.destination_id
         JOIN tourists t ON t.id = b.tourist_id
         LEFT JOIN payments p ON p.id = (SELECT MAX(p2.id) FROM payments p2 WHERE p2.booking_id = b.id)
        WHERE b.id = ? LIMIT 1`,
      [bookingId],
    );
    const booking = rows[0];
    if (!booking || Number(booking.touristId) !== Number(req.session.user.id) || !booking.transactionId) {
      return res.status(404).send("Ticket not found.");
    }
    const origin = `${req.protocol}://${req.get("host")}`;
    const verificationUrl = `${origin}/verify/${encodeURIComponent(booking.verificationToken)}`;
    const qr = await QRCode.toDataURL(verificationUrl, { errorCorrectionLevel: "M", margin: 2, width: 180 });
    const paidAtDesk = booking.paymentStatus === "cash_due";
    return sendPage(res, "receipt.html", {
      HEADER_ACTIONS: headerActions(req.session.user),
      RECEIPT_NOTICE: escapeHtml(takeNotice(req) || "A little ticket to keep. Your real trip plans are still up to you."),
      CHECKOUT_STEPS: '<ol class="checkout-steps" aria-label="Checkout progress"><li class="is-complete">Cart</li><li class="is-complete">Payment</li><li class="is-current">Confirmation</li></ol>',
      RECEIPT_DESTINATION: escapeHtml(booking.destinationName),
      RECEIPT_STATUS: escapeHtml(booking.bookingStatus),
      BOOKING_ID: booking.id,
      TRANSACTION_ID: escapeHtml(booking.transactionId),
      TOURIST_NAME: escapeHtml(booking.touristName),
      TOURIST_EMAIL: escapeHtml(booking.touristEmail),
      BOOKING_SERVICE: escapeHtml(booking.serviceName),
      BOOKING_DATE: escapeHtml(booking.checkOut ? `${booking.bookingDate} — ${booking.checkOut}` : booking.bookingDate),
      BOOKING_QUANTITY: `${booking.quantity} · ${booking.guestCount}`,
      PAYMENT_MODE: escapeHtml(booking.paymentMode.replaceAll("_", " ")),
      PAYMENT_DISCLAIMER: paidAtDesk ? "(to be paid at provider)" : "(simulated)",
      BOOKING_TOTAL: Number(booking.totalAmount).toLocaleString("en-IN"),
      VERIFICATION_QR: qr,
      PAYMENT_NOTICE: paidAtDesk
        ? "Pay the provider directly on arrival. No payment was collected by this demo."
        : "Demo transaction only. No payment gateway was contacted and no money was collected.",
    });
  });

  router.get("/verify/:token", async (req, res) => {
    const token = typeof req.params.token === "string" && /^[a-f0-9]{48}$/.test(req.params.token)
      ? req.params.token : "";
    const [rows] = token ? await pool.execute(
      `SELECT b.id, b.booking_date AS bookingDate, b.check_out AS checkOut,
              b.service_name AS serviceName, b.status AS bookingStatus,
              d.name AS destinationName, p.transaction_id AS transactionId, p.status AS paymentStatus
         FROM bookings b JOIN destinations d ON d.id = b.destination_id
         LEFT JOIN payments p ON p.id = (SELECT MAX(p2.id) FROM payments p2 WHERE p2.booking_id = b.id)
        WHERE b.verification_token = ? LIMIT 1`,
      [token],
    ) : [[]];
    const valid = rows.length > 0 && rows[0].bookingStatus === "confirmed";
    const details = valid
      ? `<p>Booking BID-#${rows[0].id}</p><p>${escapeHtml(rows[0].destinationName)} · ${escapeHtml(rows[0].serviceName)}</p><p>${escapeHtml(rows[0].bookingDate)}${rows[0].checkOut ? ` — ${escapeHtml(rows[0].checkOut)}` : ""}</p><p>${escapeHtml(rows[0].transactionId || "PAY AT DESK")} · ${escapeHtml(rows[0].paymentStatus || "not paid")}</p>`
      : "";
    return sendPage(res, "verify.html", {
      VERIFY_HEADING: valid ? "Demo reservation found." : "We couldn't verify that ticket.",
      VERIFY_MESSAGE: valid ? "This reservation exists in the Smart Tourist Guide System demonstration database." : "The ticket may have been cancelled or the verification link may be invalid.",
      VERIFY_DETAILS: details,
    }, valid ? 200 : 404);
  });

async function renderAccount(res, req, mode, nextPath, error = "", status = 200) {
  const registering = mode === "register";
  const fields = registering ? `
    <label class="form-label" for="account-name">Your name</label>
    <input class="form-input" id="account-name" name="name" autocomplete="name" minlength="2" maxlength="100" required>
    <label class="form-label" for="account-phone">Phone number</label>
    <input class="form-input" id="account-phone" name="phone" type="tel" autocomplete="tel" minlength="7" maxlength="30" required>` : "";
  const action = registering ? "/account/register" : "/account/login";
  const submitText = registering ? "Create account" : "Sign in";
  const form = `<form action="${action}" method="post">
    <input type="hidden" name="next" value="${escapeHtml(accountPath(nextPath))}">
    ${fields}
    <label class="form-label" for="account-email">Email address</label>
    <input class="form-input" id="account-email" name="email" type="email" autocomplete="email" maxlength="254" required>
    <label class="form-label" for="account-password">Password</label>
    <input class="form-input" id="account-password" name="password" type="password" autocomplete="${registering ? "new-password" : "current-password"}" minlength="8" maxlength="72" required>
    ${registering ? '<p class="modal-note">Use 8 to 72 characters. Your password is securely hashed.</p>' : ""}
    ${pageNotice(error)}
    <button class="button button-dark form-submit" type="submit">${submitText} <span aria-hidden="true">↗</span></button>
  </form>`;
  return sendPage(res, "account.html", {
    PAGE_TITLE: registering ? "Create an account" : "Sign in",
    HEADER_ACTIONS: headerActions(req.session.user),
    PAGE_HEADING: registering ? "Let's get you out there." : "Welcome back.",
    PAGE_INTRO: registering ? "A little about you. Then, the world." : "Sign in to pick up where your daydreams left off.",
    NOTICE: takeNotice(req),
    LOGIN_ACTIVE: registering ? "" : "is-active",
    REGISTER_ACTIVE: registering ? "is-active" : "",
    ACCOUNT_FORM: form,
  }, status);
}

router.get("/account", async (req, res) => {
  if (req.session.user) return res.redirect(303, "/profile");
  const mode = req.query.mode === "register" ? "register" : "login";
  return renderAccount(res, req, mode, accountPath(req.query.next, "/profile"));
});

router.post("/account/register", authLimiter, async (req, res) => {
  const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
  const phone = typeof req.body.phone === "string" ? req.body.phone.trim() : "";
  const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const password = req.body.password;
  const nextPath = accountPath(req.body.next, "/profile");
  if (name.length < 2 || name.length > 100 || phone.length < 7 || phone.length > 30
      || !isValidEmail(email) || !isValidPassword(password)) {
    return renderAccount(res, req, "register", nextPath, "Please check your details. Passwords must be between 8 and 72 bytes.", 400);
  }

  const passwordHash = await bcrypt.hash(password, 12);
  let result;
  try {
    [result] = await pool.execute(
      "INSERT INTO tourists (name, email, phone, password_hash, role) VALUES (?, ?, ?, ?, 'tourist')",
      [name, email, phone, passwordHash],
    );
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      return renderAccount(res, req, "register", nextPath, "An account with that email already exists. Try signing in.", 409);
    }
    throw error;
  }

  await new Promise((resolve, reject) => {
    req.session.regenerate((error) => (error ? reject(error) : resolve()));
  });
  req.session.user = { id: result.insertId, name, email, role: "tourist" };
  setNotice(req, `You're all set, ${name.split(" ")[0]}. Let the daydreaming begin.`);
  return res.redirect(303, nextPath);
});

router.post("/account/login", authLimiter, async (req, res) => {
  const email = typeof req.body.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const password = req.body.password;
  const nextPath = accountPath(req.body.next, "/profile");
  if (!isValidEmail(email) || !isValidPassword(password)) {
    return renderAccount(res, req, "login", nextPath, "Please enter a valid email and password.", 400);
  }

  const [rows] = await pool.execute(
    "SELECT id, name, email, password_hash, role FROM tourists WHERE email = ? AND is_active = 1 LIMIT 1",
    [email],
  );
  const user = rows[0];
  const passwordMatches = await bcrypt.compare(password, user ? user.password_hash : dummyPasswordHash);
  if (!user || !passwordMatches) {
    return renderAccount(res, req, "login", nextPath, "That email and password don't match. Please try again.", 401);
  }

  await new Promise((resolve, reject) => {
    req.session.regenerate((error) => (error ? reject(error) : resolve()));
  });
  req.session.user = { id: user.id, name: user.name, email: user.email, role: user.role };
  setNotice(req, `Welcome back, ${user.name.split(" ")[0]}.`);
  return res.redirect(303, nextPath);
});

router.post("/account/logout", requireTourist, async (req, res) => {
  await new Promise((resolve, reject) => {
    req.session.destroy((error) => (error ? reject(error) : resolve()));
  });
  res.clearCookie("roam.sid", {
    httpOnly: true,
    sameSite: process.env.NODE_ENV === "production" && process.env.FRONTEND_ORIGIN ? "none" : "lax",
    secure: process.env.NODE_ENV === "production",
  });
  return res.redirect(303, "/");
});

router.get("/trips", requireTourist, async (req, res) => {
  const [bookings] = await pool.execute(
    `SELECT b.id, b.booking_date AS bookingDate, b.check_out AS checkOut,
            b.quantity, b.guest_count AS guestCount, b.total_amount AS totalAmount,
            b.status, b.service_name AS serviceName, b.verification_token AS verificationToken,
            d.name AS destinationName, p.id AS paymentId, p.status AS paymentStatus,
            p.transaction_id AS transactionId
       FROM bookings b JOIN destinations d ON d.id = b.destination_id
       LEFT JOIN payments p ON p.id = (SELECT MAX(p2.id) FROM payments p2 WHERE p2.booking_id = b.id)
      WHERE b.tourist_id = ? ORDER BY b.booking_date DESC, b.id DESC`,
    [req.session.user.id],
  );
  const bookingList = bookings.length ? bookings.map((booking) => `<article class="booking-item">
    <strong>${escapeHtml(booking.destinationName)} · ${escapeHtml(booking.serviceName)}</strong>
    <span>${escapeHtml(new Date(`${booking.bookingDate}T12:00:00`).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }))}${booking.checkOut ? ` — ${escapeHtml(booking.checkOut)}` : ""} · ${escapeHtml(booking.status)} · ₹${Number(booking.totalAmount).toLocaleString("en-IN")}</span>
    <span>${booking.quantity} item(s) · ${booking.guestCount} guest(s)${booking.paymentStatus ? ` · payment ${escapeHtml(booking.paymentStatus)}` : ""}</span>
    <div class="management-actions">
      ${booking.status === "pending" ? `<a class="button button-dark" href="/payment/${booking.id}">Continue to payment</a><form class="cancel-form" action="/trips/${booking.id}/cancel" method="post"><button class="text-button cancel-booking" type="submit">Cancel trip</button></form>` : ""}
      ${booking.transactionId ? `<a class="underlined-link" href="/receipts/${booking.id}">View e-ticket</a>` : ""}
    </div>
  </article>`).join("") : '<p class="modal-note">No trips on the calendar yet. Your somewhere is waiting.</p>';
  return sendPage(res, "bookings.html", {
    HEADER_ACTIONS: headerActions(req.session.user),
    NOTICE: takeNotice(req),
    BOOKING_LIST: bookingList,
  });
});

router.post("/bookings", requireTourist, async (req, res) => {
  const destinationId = Number(req.body.destinationId);
  const destinationPath = Number.isSafeInteger(destinationId) && destinationId > 0
    ? `/destinations/${destinationId}`
    : "/";
  const result = await createBooking({
    touristId: req.session.user.id,
    destinationId,
    serviceId: req.body.serviceId,
    serviceType: req.body.serviceType,
    bookingDate: req.body.bookingDate,
    checkOut: req.body.checkOut || null,
    quantity: req.body.quantity || 1,
    guestCount: req.body.guestCount || 1,
  });
  if (result.error) {
    setNotice(req, result.error);
    return res.redirect(303, destinationPath);
  }
  return res.redirect(303, `/payment/${result.booking.id}`);
});

router.post("/trips/:id/cancel", requireTourist, async (req, res) => {
  const bookingId = Number(req.params.id);
  if (!Number.isSafeInteger(bookingId) || bookingId < 1) {
    setNotice(req, "We couldn't find that active trip.");
    return res.redirect(303, "/trips");
  }
  const [result] = await pool.execute(
    "UPDATE bookings SET status = 'cancelled' WHERE id = ? AND tourist_id = ? AND status = 'pending'",
    [bookingId, req.session.user.id],
  );
  setNotice(req, result.affectedRows ? "Trip cancelled. You can plan another whenever you like." : "We couldn't find an active planning request for that trip.");
  return res.redirect(303, "/trips");
});

router.post("/destinations/:id/reviews", requireTourist, async (req, res) => {
  const destinationId = Number(req.params.id);
  const rating = Number(req.body.rating);
  const comment = typeof req.body.comment === "string" ? req.body.comment.trim() : "";
  const destinationPath = Number.isSafeInteger(destinationId) && destinationId > 0
    ? `/destinations/${destinationId}`
    : "/";
  if (!Number.isSafeInteger(destinationId) || destinationId < 1 || !isValidRating(rating)
      || comment.length < 2 || comment.length > 1000) {
    setNotice(req, "Choose a rating and share a comment between 2 and 1,000 characters.");
    return res.redirect(303, destinationPath);
  }
  const [eligible] = await pool.execute(
    "SELECT 1 FROM bookings WHERE tourist_id = ? AND destination_id = ? AND status IN ('confirmed', 'completed') LIMIT 1",
    [req.session.user.id, destinationId],
  );
  if (!eligible.length) {
    setNotice(req, "You can leave a verified review after a confirmed trip to this destination.");
    return res.redirect(303, `${destinationPath}#reviews`);
  }
  try {
    await pool.execute(
      "INSERT INTO reviews (tourist_id, destination_id, rating, comment, verified) VALUES (?, ?, ?, ?, 1)",
      [req.session.user.id, destinationId, rating, comment],
    );
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      setNotice(req, "You've already shared a story about this place. Thank you!");
      return res.redirect(303, destinationPath);
    }
    if (error.code === "ER_NO_REFERENCED_ROW_2") {
      return res.status(404).send("Destination not found.");
    }
    throw error;
  }
  await pool.execute(
    "UPDATE destinations SET rating = (SELECT COALESCE(AVG(rating), 0) FROM reviews WHERE destination_id = ?) WHERE id = ?",
    [destinationId, destinationId],
  );
  setNotice(req, "Your story is part of this place now. Thank you.");
  return res.redirect(303, destinationPath);
});

router.use((req, res) => {
  return res.status(404).type("html").send("<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><title>Not found · Smart Tourist Guide System</title><link rel=\"stylesheet\" href=\"/styles.css\"><main class=\"account-page\"><h1>That place isn't on our map.</h1><a class=\"underlined-link\" href=\"/\">Back to Smart Tourist Guide System</a></main></html>");
});

module.exports = router;
module.exports.headerActions = headerActions;
