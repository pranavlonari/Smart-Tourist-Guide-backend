"use strict";

require("dotenv").config();

const path = require("node:path");
const express = require("express");
const session = require("express-session");
const helmet = require("helmet");
const { rateLimit } = require("express-rate-limit");
const pool = require("./db");
const MySQLSessionStore = require("./session-store");
const apiRouter = require("./routes/api");
const managementApiRouter = require("./routes/management-api");
const managementPagesRouter = require("./routes/management-pages");
const pagesRouter = require("./routes/pages");
const frontendPath = path.resolve(__dirname, "../../frontend");
const frontendOrigin = process.env.FRONTEND_ORIGIN;

const app = express();
const port = Number(process.env.PORT || 3000);
const sessionSecret = process.env.SESSION_SECRET;
const isProduction = process.env.NODE_ENV === "production";

if (!sessionSecret || Buffer.byteLength(sessionSecret) < 32) {
  throw new Error("SESSION_SECRET must be set to a random value of at least 32 characters.");
}
if (!process.env.DB_USER) {
  throw new Error("DB_USER must be set in backend/.env before starting the server.");
}
if (isProduction) app.set("trust proxy", 1);

const sessionStore = new MySQLSessionStore(pool, 8 * 60 * 60 * 1000);

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use((req, res, next) => {
  const origin = req.headers.origin;
  const allowedOrigins = [
    frontendOrigin,
    "https://touristguidefrontend.vercel.app",
    "http://localhost:3000",
    "http://localhost:5000",
    "http://localhost:5500",
    "http://localhost:8080",
    "http://127.0.0.1:5500",
    "http://127.0.0.1:8080",
  ].filter(Boolean);
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS");
    res.setHeader("Vary", "Origin");
  }
  if (req.method === "OPTIONS") return res.sendStatus(204);
  return next();
});
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      "img-src": ["'self'", "data:", "https://images.unsplash.com"],
      "font-src": ["'self'", "https://fonts.gstatic.com"],
      "style-src": ["'self'", "https://fonts.googleapis.com"],
    },
  },
  crossOriginResourcePolicy: { policy: "cross-origin" },
}));
app.use(express.json({ limit: "12kb" }));
app.use(express.urlencoded({ extended: false, limit: "12kb" }));
app.use((req, res, next) => {
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) req.body = {};
  next();
});
app.use(session({
  name: "roam.sid",
  secret: sessionSecret,
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: isProduction && frontendOrigin ? "none" : "lax",
    secure: isProduction,
    maxAge: 8 * 60 * 60 * 1000,
  },
}));

app.use("/api", rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 180,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again in a little while." },
}));
app.use(managementPagesRouter);
app.use("/api", apiRouter);
app.use("/api", managementApiRouter);
app.use("/api", (req, res) => res.status(404).json({ error: "That API route doesn't exist." }));
app.get("/styles.css", (req, res, next) => {
  res.sendFile(path.join(frontendPath, "styles.css"), { maxAge: isProduction ? "1h" : 0 }, (error) => {
    if (error) res.status(404).end();
  });
});
app.use(pagesRouter);

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  if (Number.isInteger(error.status) && error.status >= 400 && error.status < 500) {
    const message = error.status === 413
      ? "That request is too large."
      : "That request couldn't be understood.";
    return res.status(error.status).json({ error: message });
  }
  console.error("Request failed:", error);
  return res.status(500).json({ error: "We couldn't complete that request. Please try again." });
});

let server;

async function shutdown() {
  if (!server) {
    sessionStore.close();
    await pool.end();
    process.exit(0);
    return;
  }
  server.close(async () => {
    sessionStore.close();
    await pool.end();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

async function initialize() {
  await sessionStore.initialize();
  await pool.query("SELECT 1");
}

const ready = initialize();

if (require.main === module) {
  ready.then(() => {
    server = app.listen(port, () => {
      console.log(`Smart Tourist Guide System is ready at http://localhost:${port}`);
    });
  }).catch(async (error) => {
    console.error("Server startup failed:", error);
    sessionStore.close();
    await pool.end();
    process.exit(1);
  });
}

module.exports = app;
module.exports.app = app;
module.exports.ready = ready;
