"use strict";

const session = require("express-session");

class MySQLSessionStore extends session.Store {
  constructor(pool, expiration) {
    super();
    this.pool = pool;
    this.expiration = expiration;
    this.cleanupTimer = null;
  }

  async initialize() {
    await this.pool.execute(
      `CREATE TABLE IF NOT EXISTS sessions (
        sid VARCHAR(128) NOT NULL,
        expires BIGINT UNSIGNED NOT NULL,
        data MEDIUMTEXT NOT NULL,
        PRIMARY KEY (sid),
        KEY idx_sessions_expires (expires)
      ) ENGINE=InnoDB`,
    );
    this.cleanupTimer = setInterval(() => {
      this.pool.execute("DELETE FROM sessions WHERE expires <= ?", [Date.now()])
        .catch((error) => console.error("Expired session cleanup failed:", error));
    }, 15 * 60 * 1000);
    this.cleanupTimer.unref();
  }

  get(sid, callback) {
    this.pool.execute(
      "SELECT data FROM sessions WHERE sid = ? AND expires > ? LIMIT 1",
      [sid, Date.now()],
    ).then(([rows]) => {
      if (!rows.length) return callback(null, null);
      return callback(null, JSON.parse(rows[0].data));
    }).catch(callback);
  }

  set(sid, sessionData, callback = () => {}) {
    const cookieExpiry = sessionData.cookie && sessionData.cookie.expires
      ? new Date(sessionData.cookie.expires).getTime()
      : Date.now() + this.expiration;
    if (cookieExpiry <= Date.now()) return this.destroy(sid, callback);

    this.pool.execute(
      `INSERT INTO sessions (sid, expires, data) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE expires = VALUES(expires), data = VALUES(data)`,
      [sid, cookieExpiry, JSON.stringify(sessionData)],
    ).then(() => callback(null)).catch(callback);
  }

  touch(sid, sessionData, callback = () => {}) {
    const cookieExpiry = sessionData.cookie && sessionData.cookie.expires
      ? new Date(sessionData.cookie.expires).getTime()
      : Date.now() + this.expiration;
    this.pool.execute(
      "UPDATE sessions SET expires = ? WHERE sid = ?",
      [cookieExpiry, sid],
    ).then(() => callback(null)).catch(callback);
  }

  destroy(sid, callback = () => {}) {
    this.pool.execute("DELETE FROM sessions WHERE sid = ?", [sid])
      .then(() => callback(null))
      .catch(callback);
  }

  close() {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    this.cleanupTimer = null;
  }
}

module.exports = MySQLSessionStore;
