"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const MySQLSessionStore = require("../src/session-store");

function createPool() {
  const sessions = new Map();
  return {
    sessions,
    async execute(sql, values = []) {
      if (sql.startsWith("CREATE TABLE")) return [[]];
      if (sql.startsWith("SELECT data")) {
        const row = sessions.get(values[0]);
        return [[row && row.expires > values[1] ? { data: row.data } : undefined].filter(Boolean)];
      }
      if (sql.startsWith("INSERT INTO sessions")) {
        sessions.set(values[0], { expires: values[1], data: values[2] });
        return [{ affectedRows: 1 }];
      }
      if (sql.startsWith("UPDATE sessions")) {
        const row = sessions.get(values[1]);
        if (row) row.expires = values[0];
        return [{ affectedRows: row ? 1 : 0 }];
      }
      if (sql.startsWith("DELETE FROM sessions WHERE sid")) {
        sessions.delete(values[0]);
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
}

function storeCall(store, method, ...args) {
  return new Promise((resolve, reject) => {
    store[method](...args, (error, value) => (error ? reject(error) : resolve(value)));
  });
}

test("MySQL session store persists, loads, touches, and destroys sessions", async () => {
  const pool = createPool();
  const store = new MySQLSessionStore(pool, 60_000);
  await store.initialize();
  try {
    const sessionData = {
      cookie: { expires: new Date(Date.now() + 30_000) },
      user: { id: 7, name: "Traveler" },
    };
    await storeCall(store, "set", "session-1", sessionData);
    const loaded = await storeCall(store, "get", "session-1");
    assert.equal(loaded.user.name, "Traveler");
    assert.equal(loaded.cookie.expires, sessionData.cookie.expires.toISOString());

    await storeCall(store, "touch", "session-1", {
      cookie: { expires: new Date(Date.now() + 50_000) },
    });
    assert.ok(pool.sessions.get("session-1").expires > Date.now() + 40_000);

    await storeCall(store, "destroy", "session-1");
    assert.equal(pool.sessions.has("session-1"), false);
  } finally {
    store.close();
  }
});

test("MySQL session store removes sessions that are already expired", async () => {
  const pool = createPool();
  const store = new MySQLSessionStore(pool, 60_000);
  try {
    await storeCall(store, "set", "expired-session", {
      cookie: { expires: new Date(Date.now() - 1000) },
    });
    assert.equal(pool.sessions.has("expired-session"), false);
  } finally {
    store.close();
  }
});
