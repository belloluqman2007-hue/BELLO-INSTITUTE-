"use strict";
/* ============================================================================
   MULTI-MADRASA PLATFORM — database-backed session store
   ----------------------------------------------------------------------------
   express-session store for the app_sessions table (sid, expires, data).
   Works with both the SQLite and MySQL drivers.
   ========================================================================== */
const session = require("express-session");
const db = require("./db");

class DBSessionStore extends session.Store {
  get(sid, cb) {
    db.get("SELECT * FROM app_sessions WHERE sid = ?", [sid])
      .then((row) => {
        if (!row) return cb(null, null);
        if (row.expires && row.expires < Date.now()) {
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
    const expires = sess.cookie && sess.cookie.expires
      ? new Date(sess.cookie.expires).getTime()
      : Date.now() + 86400000;
    db.transaction(async (tx) => {
      const exists = await tx.get("SELECT sid FROM app_sessions WHERE sid = ?", [sid]);
      if (exists) {
        await tx.run("UPDATE app_sessions SET data = ?, expires = ? WHERE sid = ?", [payload, expires, sid]);
      } else {
        await tx.run("INSERT INTO app_sessions (sid, expires, data) VALUES (?,?,?)", [sid, expires, payload]);
      }
    })
      .then(() => cb(null))
      .catch((err) => cb(err));
  }

  touch(sid, sess, cb) {
    const expires = sess.cookie && sess.cookie.expires
      ? new Date(sess.cookie.expires).getTime()
      : Date.now() + 86400000;
    db.run("UPDATE app_sessions SET expires = ? WHERE sid = ?", [expires, sid])
      .then(() => cb(null))
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
}

module.exports = DBSessionStore;
