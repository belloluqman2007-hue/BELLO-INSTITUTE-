"use strict";
/* ============================================================================
   MULTI-MADRASA PLATFORM — database-backed session store
   ----------------------------------------------------------------------------
   express-session store for the app_sessions table (sid, expires, data).
   Works with both the SQLite and MySQL drivers.

   Writes are a single ATOMIC upsert, not a read-then-write inside a
   transaction. The old read-then-write opened a `BEGIN IMMEDIATE` for every
   session save; two overlapping requests (the browser fires several /api calls
   right after sign-in) could collide on SQLite with "cannot start a
   transaction within a transaction", and on MySQL two parallel logins could
   race between the SELECT and the INSERT and hit a duplicate-key error. Either
   one reached express-session's save() callback and surfaced to the user as
   "Session save error." even though the credentials were correct.
   ========================================================================== */
const session = require("express-session");
const db = require("./db");

const DEFAULT_TTL_MS = 86400000; // 24h fallback when the cookie has no expiry

function expiryOf(sess) {
  const raw = sess && sess.cookie && sess.cookie.expires;
  const ts = raw ? new Date(raw).getTime() : NaN;
  return Number.isFinite(ts) && ts > 0 ? ts : Date.now() + DEFAULT_TTL_MS;
}

class DBSessionStore extends session.Store {
  get(sid, cb) {
    db.get("SELECT * FROM app_sessions WHERE sid = ?", [sid])
      .then((row) => {
        if (!row) return cb(null, null);
        if (row.expires && Number(row.expires) < Date.now()) {
          return this.destroy(sid, () => cb(null, null));
        }
        let data = null;
        try { data = JSON.parse(row.data || "{}"); } catch (e) { data = {}; }
        cb(null, data);
      })
      .catch((err) => cb(err));
  }

  set(sid, sess, cb) {
    const payload = JSON.stringify(sess);
    const expires = expiryOf(sess);
    db.dialect()
      .then((dialect) => {
        const sql = dialect === "mysql"
          ? "INSERT INTO app_sessions (sid, expires, data) VALUES (?,?,?) " +
            "ON DUPLICATE KEY UPDATE expires = VALUES(expires), data = VALUES(data)"
          : "INSERT INTO app_sessions (sid, expires, data) VALUES (?,?,?) " +
            "ON CONFLICT(sid) DO UPDATE SET expires = excluded.expires, data = excluded.data";
        return db.run(sql, [sid, expires, payload]);
      })
      .then(() => cb(null))
      .catch((err) => cb(err));
  }

  touch(sid, sess, cb) {
    const expires = expiryOf(sess);
    // Rolling sessions call touch() on EVERY authenticated request. Rewriting
    // the row each time means one database write per request — hundreds of
    // writes/second under load, each an fsync on the dev SQLite driver. The
    // extension only needs 60-second granularity: skip the write while the
    // stored expiry is already within a minute of the new one. (A read is
    // orders of magnitude cheaper than a write here.)
    const TOUCH_GRACE_MS = 60000;
    db.get("SELECT expires FROM app_sessions WHERE sid = ?", [sid])
      .then((row) => {
        // Row removed by a cleanup/restore: re-create it instead of silently
        // letting the session evaporate.
        if (!row) return this.set(sid, sess, cb);
        if (Number(row.expires) >= expires - TOUCH_GRACE_MS) return cb(null);
        return db.run("UPDATE app_sessions SET expires = ? WHERE sid = ?", [expires, sid]).then(() => cb(null));
      })
      .catch((err) => cb(err));
  }

  destroy(sid, cb) {
    db.run("DELETE FROM app_sessions WHERE sid = ?", [sid])
      .then(() => cb(null))
      .catch((err) => cb(err));
  }

  clear(cb) {
    db.run("DELETE FROM app_sessions").then(() => cb(null)).catch((err) => cb(err));
  }

  /** Removes expired rows. Safe to call on a timer or at boot. */
  prune() {
    return db.run("DELETE FROM app_sessions WHERE expires IS NOT NULL AND expires < ?", [Date.now()]);
  }
}

module.exports = DBSessionStore;
