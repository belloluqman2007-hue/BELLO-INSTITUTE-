"use strict";
/* ============================================================================
   MULTI-MADRASA PLATFORM — Madrasa Admin routes (tenant-scoped)
   ----------------------------------------------------------------------------
   Protected: madrasa_admin of THIS madrasa (or super_admin inspecting).
   The tenant id ALWAYS comes from the authenticated user (see tenant.js) —
   never from the request.
   ========================================================================== */
const express = require("express");
const db = require("../db");
const { asyncHandler, err, ok, cleanStr, toNum, clampNum, logActivity } = require("../util");
const { requireAuth, requireRole, requireTenant } = require("../middleware/auth");
const { getActiveMadrasa } = require("../middleware/tenant");
const { imageUploader } = require("../middleware/upload");
const grading = require("../services/grading");
const analytics = require("../services/analytics");
const institution = require("../services/institution");

// Two routers share the same tenant scope:
//  router      -> mounted at /api/madrasa (profile, settings)
//  rootRouter  -> mounted at the API root (classes, subjects, sessions, grading)
const router = express.Router();
const rootRouter = express.Router();
router.use(requireAuth, requireTenant);

/**
 * Resolves the caller's madrasa (and verifies it is active) for this request.
 * super_admin may inspect a specific madrasa via ?madrasaId (for support).
 */
async function resolveMadrasa(req, res) {
  let mid;
  if (req.user.role === "super_admin") {
    mid = toNum((req.query && req.query.madrasaId) || 0);
    if (!mid) { res.status(400).json({ error: "madrasaId required for super admin." }); return null; }
  } else {
    mid = req.user.madrasaId;
  }
  const m = await getActiveMadrasa(mid);
  if (!m) { res.status(m ? 403 : 404).json({ error: "Madrasa not found or not active." }); return null; }
  req.madrasa = m;
  return m;
}

const adminOrSupport = (req, res, next) => {
  if (req.user.role === "madrasa_admin" || req.user.role === "super_admin") return next();
  return res.status(403).json({ error: "Madrasa administrators only." });
};

/* ------------------------------ profile -------------------------------- */

router.get("/profile", asyncHandler(async (req, res) => {
  const m = await resolveMadrasa(req, res);
  if (!m) return;
  const settings = {};
  const rows = await db.all("SELECT key_name, value FROM settings WHERE madrasa_id = ?", [m.id]);
  rows.forEach((r) => { settings[r.key_name] = r.value; });
  const plan = await db.get("SELECT * FROM plans WHERE id = ?", [m.plan_id]);
  const category = m.category || "islamic";
  ok(res, { madrasa: m, settings, plan, category, terminology: institution.terminology(category) });
}));

router.put("/profile", adminOrSupport, asyncHandler(async (req, res) => {
  const m = await resolveMadrasa(req, res);
  if (!m) return;
  const b = req.body || {};
  const fields = {
    name_en: [b.name_en, 160], name_ar: [b.name_ar, 160],
    motto_en: [b.motto_en, 160], motto_ar: [b.motto_ar, 160],
    address: [b.address, 255], city: [b.city, 80], state_name: [b.state_name, 80],
    phone: [b.phone, 60], email: [b.email, 120],
    // Website/brand fields — kept inside a small, safe field set so every
    // tenant site still fits the shared BELLO template.
    tagline: [b.tagline, 200], whatsapp: [b.whatsapp, 60],
    facebook: [b.facebook, 200], instagram: [b.instagram, 200], maps_link: [b.maps_link, 255],
    admin_full_name: [b.admin_full_name, 160], admin_position: [b.admin_position, 80],
    admission_info: [b.admission_info, 4000],
  };
  const sets = [];
  const vals = [];
  for (const [f, [v, max]] of Object.entries(fields)) {
    if (v !== undefined) { sets.push(`${f} = ?`); vals.push(cleanStr(v, max)); }
  }
  if (b.brand_color !== undefined) {
    const c = cleanStr(b.brand_color, 20);
    if (c && !/^#[0-9a-fA-F]{3,8}$/.test(c)) return err(res, 400, "brand_color must be a hex color like #220b40.");
    sets.push("brand_color = ?"); vals.push(c);
  }
  if (!sets.length) return err(res, 400, "Nothing to update.");
  sets.push("updated_at = CURRENT_TIMESTAMP");
  vals.push(m.id);
  await db.run(`UPDATE madaris SET ${sets.join(", ")} WHERE id = ?`, vals);
  logActivity(db, { madrasaId: m.id, userId: req.user.id, action: "profile.update", entity: "madrasa", entityId: String(m.id), ip: req.ip });
  ok(res, { ok: true });
}));

router.post("/profile/logo", adminOrSupport, imageUploader("logos", "logo"), asyncHandler(async (req, res) => {
  const m = await resolveMadrasa(req, res);
  if (!m) return;
  if (!req.file) return err(res, 400, "No image uploaded.");
  await db.run("UPDATE madaris SET logo_path = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [`/uploads/logos/${req.file.filename}`, m.id]);
  ok(res, { ok: true, logoPath: `/uploads/logos/${req.file.filename}` });
}));

router.post("/profile/hero", adminOrSupport, imageUploader("hero", "hero"), asyncHandler(async (req, res) => {
  const m = await resolveMadrasa(req, res);
  if (!m) return;
  if (!req.file) return err(res, 400, "No image uploaded.");
  await db.run("UPDATE madaris SET hero_image_path = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [`/uploads/hero/${req.file.filename}`, m.id]);
  ok(res, { ok: true, heroImagePath: `/uploads/hero/${req.file.filename}` });
}));

/* ------------------------------ gallery -------------------------------- */

router.get("/gallery", adminOrSupport, asyncHandler(async (req, res) => {
  const m = await resolveMadrasa(req, res);
  if (!m) return;
  const rows = await db.all("SELECT * FROM gallery_images WHERE madrasa_id = ? ORDER BY sort_order, id", [m.id]);
  ok(res, { images: rows });
}));

router.post("/gallery", adminOrSupport, imageUploader("gallery", "image"), asyncHandler(async (req, res) => {
  const m = await resolveMadrasa(req, res);
  if (!m) return;
  if (!req.file) return err(res, 400, "No image uploaded.");
  const caption = cleanStr((req.body || {}).caption, 200);
  const count = await db.get("SELECT COUNT(*) AS n FROM gallery_images WHERE madrasa_id = ?", [m.id]);
  if (Number(count.n) >= 40) return err(res, 400, "Gallery limit reached (40 images).");
  const r = await db.run(
    "INSERT INTO gallery_images (madrasa_id, image_path, caption, sort_order) VALUES (?,?,?,?)",
    [m.id, `/uploads/gallery/${req.file.filename}`, caption, Number(count.n)]
  );
  logActivity(db, { madrasaId: m.id, userId: req.user.id, action: "gallery.add", entity: "gallery_image", entityId: String(r.lastInsertRowid), ip: req.ip });
  ok(res, { ok: true, id: r.lastInsertRowid, imagePath: `/uploads/gallery/${req.file.filename}` });
}));

router.delete("/gallery/:id", adminOrSupport, asyncHandler(async (req, res) => {
  const m = await resolveMadrasa(req, res);
  if (!m) return;
  const row = await db.get("SELECT id FROM gallery_images WHERE id = ? AND madrasa_id = ?", [toNum(req.params.id, 0), m.id]);
  if (!row) return err(res, 404, "Image not found.");
  await db.run("DELETE FROM gallery_images WHERE id = ?", [row.id]);
  ok(res, { ok: true });
}));

/* ------------------------------ public site ---------------------------- */

/**
 * What the LOGGED-OUT public site may show for this madrasa, plus the
 * statistics the settings screen previews. Saved straight onto the madrasa
 * row so a directory query never needs a join.
 */
router.get("/public-site", adminOrSupport, asyncHandler(async (req, res) => {
  const m = await resolveMadrasa(req, res);
  if (!m) return;
  const [pending, published, notices] = await Promise.all([
    db.get("SELECT COUNT(*) AS n FROM admission_requests WHERE madrasa_id = ? AND status = 'pending'", [m.id]),
    db.get("SELECT COUNT(*) AS n FROM term_summaries WHERE madrasa_id = ? AND published_at IS NOT NULL", [m.id]),
    db.get("SELECT COUNT(*) AS n FROM announcements WHERE madrasa_id = ? AND is_active = 1 AND publish_public = 1", [m.id]),
  ]);
  ok(res, {
    settings: {
      public_listing: Number(m.public_listing) === 1,
      public_results: Number(m.public_results) === 1,
      public_admissions: Number(m.public_admissions) === 1,
      description_en: m.description_en || "",
      description_ar: m.description_ar || "",
      founded_year: m.founded_year || "",
      website: m.website || "",
    },
    counts: {
      pendingApplications: Number(pending.n),
      publishedResults: Number(published.n),
      publicNotices: Number(notices.n),
    },
    urls: {
      directory: `/madrasa/${m.slug}`,
      results: `/results-check?madrasa=${m.slug}`,
      apply: `/apply/${m.slug}`,
    },
  });
}));

router.put("/public-site", adminOrSupport, asyncHandler(async (req, res) => {
  const m = await resolveMadrasa(req, res);
  if (!m) return;
  const b = req.body || {};
  const sets = [];
  const vals = [];
  for (const flag of ["public_listing", "public_results", "public_admissions"]) {
    if (b[flag] !== undefined) { sets.push(`${flag} = ?`); vals.push(b[flag] ? 1 : 0); }
  }
  for (const [key, max] of [["description_en", 4000], ["description_ar", 4000], ["website", 160]]) {
    if (b[key] !== undefined) { sets.push(`${key} = ?`); vals.push(cleanStr(b[key], max)); }
  }
  if (b.founded_year !== undefined) {
    const y = cleanStr(b.founded_year, 8);
    if (y && !/^\d{4}$/.test(y)) return err(res, 400, "Founded year must be a 4-digit year.");
    sets.push("founded_year = ?"); vals.push(y);
  }
  if (!sets.length) return err(res, 400, "Nothing to update.");
  sets.push("updated_at = CURRENT_TIMESTAMP");
  vals.push(m.id);
  await db.run(`UPDATE madaris SET ${sets.join(", ")} WHERE id = ?`, vals);
  logActivity(db, { madrasaId: m.id, userId: req.user.id, action: "madrasa.public_site", entity: "madrasa", entityId: String(m.id), ip: req.ip });
  ok(res, { ok: true });
}));

/* ------------------------------ analytics ------------------------------ */

/**
 * GET /api/madrasa/analytics?months=12&attendanceDays=30&termId=N
 * Dashboard aggregates for THIS madrasa. madrasa_admin only (a super admin may
 * inspect a specific madrasa with ?madrasaId for support). The tenant id is
 * always resolved from the session user — never from the request.
 */
router.get("/analytics", adminOrSupport, asyncHandler(async (req, res) => {
  const m = await resolveMadrasa(req, res);
  if (!m) return;
  const data = await analytics.tenantAnalytics(m.id, {
    months: req.query.months,
    attendanceDays: req.query.attendanceDays,
    termId: req.query.termId,
  });
  ok(res, { madrasaId: m.id, analytics: data });
}));

/**
 * GET /api/madrasa/dashboard
 * Everything the admin dashboard landing page needs in one call: the six
 * headline stat cards, today's attendance breakdown, today's classes, recent
 * applications and recent announcements — scoped strictly to this tenant.
 */
router.get("/dashboard", adminOrSupport, asyncHandler(async (req, res) => {
  const m = await resolveMadrasa(req, res);
  if (!m) return;
  const today = new Date();
  const isoToday = today.getFullYear() + "-" + String(today.getMonth() + 1).padStart(2, "0") + "-" + String(today.getDate()).padStart(2, "0");
  const dayName = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][today.getDay()];

  const [totals, attToday, pendingApps, todaysClasses, recentApps, recentAnnouncements] = await Promise.all([
    db.get(
      `SELECT
         (SELECT COUNT(*) FROM students WHERE madrasa_id = ? AND status IN ('active','promoted','suspended')) AS students,
         (SELECT COUNT(*) FROM users WHERE madrasa_id = ? AND role = 'teacher' AND is_active = 1) AS teachers,
         (SELECT COUNT(*) FROM classes WHERE madrasa_id = ? AND is_active = 1) AS classes,
         (SELECT COUNT(*) FROM subjects WHERE madrasa_id = ? AND is_active = 1) AS subjects`,
      [m.id, m.id, m.id, m.id]
    ),
    db.all("SELECT status, COUNT(*) AS n FROM attendance WHERE madrasa_id = ? AND day = ? GROUP BY status", [m.id, isoToday]),
    db.get("SELECT COUNT(*) AS n FROM admission_requests WHERE madrasa_id = ? AND status = 'pending'", [m.id]),
    db.all(
      `SELECT ts.day, ts.period, ts.start_time, ts.end_time, c.name_en AS class_name,
              su.name_en AS subject_name, u.full_name AS teacher_name
         FROM timetable_slots ts
         JOIN classes c ON c.id = ts.class_id
         LEFT JOIN subjects su ON su.id = ts.subject_id
         LEFT JOIN users u ON u.id = ts.teacher_id
        WHERE ts.madrasa_id = ? AND ts.day = ?
        ORDER BY ts.period`,
      [m.id, dayName]
    ),
    db.all(
      `SELECT id, reference, status, first_name, last_name, created_at
         FROM admission_requests WHERE madrasa_id = ? ORDER BY id DESC LIMIT 6`,
      [m.id]
    ),
    db.all(
      `SELECT id, title, body, created_at FROM announcements
        WHERE madrasa_id = ? AND is_active = 1 ORDER BY id DESC LIMIT 6`,
      [m.id]
    ),
  ]);

  const attMap = {};
  attToday.forEach((r) => { attMap[r.status] = Number(r.n); });
  const attMarked = Object.values(attMap).reduce((a, b) => a + b, 0);
  const totalStudents = totals ? Number(totals.students) : 0;

  ok(res, {
    madrasaId: m.id,
    category: m.category || "islamic",
    stats: {
      totalStudents,
      totalTeachers: totals ? Number(totals.teachers) : 0,
      totalClasses: totals ? Number(totals.classes) : 0,
      totalSubjects: totals ? Number(totals.subjects) : 0,
      pendingApplications: pendingApps ? Number(pendingApps.n) : 0,
      attendanceToday: {
        present: attMap.present || 0,
        absent: attMap.absent || 0,
        late: attMap.late || 0,
        excused: attMap.excused || 0,
        marked: attMarked,
        unmarked: Math.max(0, totalStudents - attMarked),
      },
    },
    todaysClasses: todaysClasses.map((r) => ({
      day: r.day, period: r.period, startTime: r.start_time, endTime: r.end_time,
      className: r.class_name, subjectName: r.subject_name || "—", teacherName: r.teacher_name || "—",
    })),
    recentApplications: recentApps.map((r) => ({
      id: r.id, reference: r.reference, status: r.status,
      name: `${r.first_name} ${r.last_name}`.trim(), createdAt: r.created_at,
    })),
    recentAnnouncements: recentAnnouncements.map((r) => ({
      id: r.id, title: r.title, body: r.body, createdAt: r.created_at,
    })),
  });
}));

/** Per-madrasa key/value settings (admission prefix, etc.) */
router.put("/settings", adminOrSupport, asyncHandler(async (req, res) => {
  const m = await resolveMadrasa(req, res);
  if (!m) return;
  const dialect = await db.dialect();
  for (const [k, v] of Object.entries(req.body || {})) {
    const key = cleanStr(k, 80);
    if (!key) continue;
    const val = String(v === null || v === undefined ? "" : v);
    if (dialect === "sqlite") {
      await db.run("INSERT INTO settings (madrasa_id, key_name, value) VALUES (?,?,?) ON CONFLICT(madrasa_id, key_name) DO UPDATE SET value = excluded.value", [m.id, key, val]);
    } else {
      await db.run("INSERT INTO settings (madrasa_id, key_name, value) VALUES (?,?,?) ON DUPLICATE KEY UPDATE value = VALUES(value)", [m.id, key, val]);
    }
  }
  ok(res, { ok: true });
}));

/* ------------------------------ classes -------------------------------- */

rootRouter.get("/classes", requireAuth, requireTenant, asyncHandler(async (req, res) => {
  const m = await resolveMadrasa(req, res);
  if (!m) return;
  const rows = await db.all(
    `SELECT c.*, (SELECT COUNT(*) FROM class_subjects cs WHERE cs.class_id = c.id) AS subject_count,
            (SELECT COUNT(*) FROM students s WHERE s.class_id = c.id AND s.status IN ('active','promoted','suspended')) AS student_count
     FROM classes c WHERE c.madrasa_id = ? AND c.is_active = 1 ORDER BY c.sort_order, c.id`,
    [m.id]
  );
  // Attach subjects per class
  const cs = await db.all("SELECT * FROM class_subjects WHERE madrasa_id = ? ORDER BY id", [m.id]);
  const subs = await db.all("SELECT * FROM subjects WHERE madrasa_id = ?", [m.id]);
  const subMap = new Map(subs.map((s) => [s.id, s]));
  rows.forEach((r) => {
    r.subjects = cs.filter((x) => x.class_id === r.id).map((x) => subMap.get(x.subject_id)).filter(Boolean);
  });
  ok(res, { classes: rows });
}));

rootRouter.post("/classes", requireAuth, requireTenant, adminOrSupport, asyncHandler(async (req, res) => {
  const m = await resolveMadrasa(req, res);
  if (!m) return;
  const b = req.body || {};
  const nameEn = cleanStr(b.name_en, 120);
  if (!nameEn) return err(res, 400, "Class name is required.");
  const dup = await db.get("SELECT id FROM classes WHERE madrasa_id = ? AND name_en = ?", [m.id, nameEn]);
  if (dup) return err(res, 400, "A class with this name already exists.");
  const r = await db.run("INSERT INTO classes (madrasa_id, name_en, name_ar, sort_order) VALUES (?,?,?,?)", [m.id, nameEn, cleanStr(b.name_ar, 120), toNum(b.sort_order, 0)]);
  logActivity(db, { madrasaId: m.id, userId: req.user.id, action: "class.create", entity: "class", entityId: String(r.lastInsertRowid), ip: req.ip });
  ok(res, { ok: true, id: r.lastInsertRowid });
}));

async function loadClass(req, res, id) {
  const m = req.madrasa || await resolveMadrasa(req, res);
  if (!m) return null;
  const row = await db.get("SELECT * FROM classes WHERE id = ? AND madrasa_id = ?", [toNum(id, 0), m.id]);
  if (!row) { res.status(404).json({ error: "Class not found." }); return null; }
  return row;
}

rootRouter.patch("/classes/:id", requireAuth, requireTenant, adminOrSupport, asyncHandler(async (req, res) => {
  const c = await loadClass(req, res, req.params.id);
  if (!c) return;
  const b = req.body || {};
  const sets = [];
  const vals = [];
  if (b.name_en !== undefined) { sets.push("name_en = ?"); vals.push(cleanStr(b.name_en, 120)); }
  if (b.name_ar !== undefined) { sets.push("name_ar = ?"); vals.push(cleanStr(b.name_ar, 120)); }
  if (b.sort_order !== undefined) { sets.push("sort_order = ?"); vals.push(toNum(b.sort_order, 0)); }
  if (b.is_active !== undefined) { sets.push("is_active = ?"); vals.push(b.is_active ? 1 : 0); }
  if (!sets.length) return err(res, 400, "Nothing to update.");
  vals.push(c.id);
  await db.run(`UPDATE classes SET ${sets.join(", ")} WHERE id = ?`, vals);
  ok(res, { ok: true });
}));

rootRouter.delete("/classes/:id", requireAuth, requireTenant, adminOrSupport, asyncHandler(async (req, res) => {
  const c = await loadClass(req, res, req.params.id);
  if (!c) return;
  const usage = await db.get("SELECT COUNT(*) AS n FROM students WHERE class_id = ? AND status IN ('active','promoted','suspended')", [c.id]);
  if (Number(usage.n) > 0) return err(res, 400, "This class still has students. Move them first.");
  await db.run("DELETE FROM class_subjects WHERE class_id = ?", [c.id]);
  await db.run("DELETE FROM classes WHERE id = ?", [c.id]);
  logActivity(db, { madrasaId: req.madrasa.id, userId: req.user.id, action: "class.delete", entity: "class", entityId: String(c.id), ip: req.ip });
  ok(res, { ok: true });
}));

/** Set the subjects for a class (replace all). */
rootRouter.put("/classes/:id/subjects", requireAuth, requireTenant, adminOrSupport, asyncHandler(async (req, res) => {
  const c = await loadClass(req, res, req.params.id);
  if (!c) return;
  const subjectIds = Array.isArray(req.body && req.body.subject_ids) ? req.body.subject_ids.map((x) => toNum(x, 0)).filter(Boolean) : [];
  await db.run("DELETE FROM class_subjects WHERE class_id = ? AND madrasa_id = ?", [c.id, req.madrasa.id]);
  for (const sid of subjectIds) {
    const s = await db.get("SELECT id FROM subjects WHERE id = ? AND madrasa_id = ?", [sid, req.madrasa.id]);
    if (s) await db.insertIgnore("class_subjects", "madrasa_id, class_id, subject_id", [req.madrasa.id, c.id, sid]);
  }
  ok(res, { ok: true });
}));

/* ------------------------------ subjects ------------------------------- */

rootRouter.get("/subjects", requireAuth, requireTenant, asyncHandler(async (req, res) => {
  const m = await resolveMadrasa(req, res);
  if (!m) return;
  const rows = await db.all("SELECT * FROM subjects WHERE madrasa_id = ? AND is_active = 1 ORDER BY name_en", [m.id]);
  ok(res, { subjects: rows });
}));

rootRouter.post("/subjects", requireAuth, requireTenant, adminOrSupport, asyncHandler(async (req, res) => {
  const m = await resolveMadrasa(req, res);
  if (!m) return;
  const b = req.body || {};
  const nameEn = cleanStr(b.name_en, 120);
  if (!nameEn && !cleanStr(b.name_ar, 120)) return err(res, 400, "Subject name (English or Arabic) is required.");
  const nameKey = nameEn || cleanStr(b.name_ar, 120);
  const dup = await db.get(
    `SELECT id FROM subjects WHERE madrasa_id = ? AND (? = '' OR name_en = ? OR name_ar = ?)`,
    [m.id, nameKey, nameKey, nameKey]
  );
  if (dup) return err(res, 400, "A subject with this name already exists.");
  const r = await db.run("INSERT INTO subjects (madrasa_id, name_en, name_ar) VALUES (?,?,?)", [m.id, nameEn || nameKey, cleanStr(b.name_ar, 120)]);
  logActivity(db, { madrasaId: m.id, userId: req.user.id, action: "subject.create", entity: "subject", entityId: String(r.lastInsertRowid), ip: req.ip });
  ok(res, { ok: true, id: r.lastInsertRowid });
}));

rootRouter.patch("/subjects/:id", requireAuth, requireTenant, adminOrSupport, asyncHandler(async (req, res) => {
  const m = req.madrasa;
  const s = await db.get("SELECT * FROM subjects WHERE id = ? AND madrasa_id = ?", [toNum(req.params.id, 0), m.id]);
  if (!s) return res.status(404).json({ error: "Subject not found." });
  const b = req.body || {};
  const sets = [];
  const vals = [];
  if (b.name_en !== undefined) { sets.push("name_en = ?"); vals.push(cleanStr(b.name_en, 120)); }
  if (b.name_ar !== undefined) { sets.push("name_ar = ?"); vals.push(cleanStr(b.name_ar, 120)); }
  if (b.is_active !== undefined) { sets.push("is_active = ?"); vals.push(b.is_active ? 1 : 0); }
  if (!sets.length) return err(res, 400, "Nothing to update.");
  vals.push(s.id);
  await db.run(`UPDATE subjects SET ${sets.join(", ")} WHERE id = ?`, vals);
  ok(res, { ok: true });
}));

rootRouter.delete("/subjects/:id", requireAuth, requireTenant, adminOrSupport, asyncHandler(async (req, res) => {
  const m = req.madrasa;
  const s = await db.get("SELECT * FROM subjects WHERE id = ? AND madrasa_id = ?", [toNum(req.params.id, 0), m.id]);
  if (!s) return res.status(404).json({ error: "Subject not found." });
  const used = await db.get("SELECT COUNT(*) AS n FROM results WHERE subject_id = ? AND madrasa_id = ?", [s.id, m.id]);
  if (Number(used.n) > 0) return err(res, 400, "This subject has result records. Deactivate it instead of deleting.");
  await db.run("DELETE FROM class_subjects WHERE subject_id = ? AND madrasa_id = ?", [s.id, m.id]);
  await db.run("DELETE FROM subjects WHERE id = ?", [s.id]);
  ok(res, { ok: true });
}));

/* ------------------------------ sessions & terms ----------------------- */

rootRouter.get("/sessions", requireAuth, requireTenant, asyncHandler(async (req, res) => {
  const m = await resolveMadrasa(req, res);
  if (!m) return;
  const rows = await db.all("SELECT * FROM academic_sessions WHERE madrasa_id = ? ORDER BY id DESC", [m.id]);
  for (const r of rows) {
    r.terms = await db.all("SELECT * FROM terms WHERE madrasa_id = ? AND session_id = ? ORDER BY position", [m.id, r.id]);
  }
  ok(res, { sessions: rows });
}));

rootRouter.post("/sessions", requireAuth, requireTenant, adminOrSupport, asyncHandler(async (req, res) => {
  const m = await resolveMadrasa(req, res);
  if (!m) return;
  const b = req.body || {};
  const label = cleanStr(b.label, 40); // e.g. "2026/2027"
  if (!/^\d{4}([/ -]?\d{0,2})?$/.test(label)) return err(res, 400, "Label should look like 2026/2027.");
  const dup = await db.get("SELECT id FROM academic_sessions WHERE madrasa_id = ? AND label = ?", [m.id, label]);
  if (dup) return err(res, 400, "That session already exists.");
  const r = await db.run(
    "INSERT INTO academic_sessions (madrasa_id, label, start_date, end_date) VALUES (?,?,?,?)",
    [m.id, label, b.start_date || null, b.end_date || null]
  );
  // Auto-create the three standard terms
  const defaults = [["First Term", "الفترة الأولى"], ["Second Term", "الفترة الثانية"], ["Third Term", "الفترة الثالثة"]];
  for (let i = 0; i < defaults.length; i++) {
    await db.insertIgnore("terms", "madrasa_id, session_id, position, name_en, name_ar", [m.id, r.lastInsertRowid, i + 1, defaults[i][0], defaults[i][1]]);
  }
  logActivity(db, { madrasaId: m.id, userId: req.user.id, action: "session.create", entity: "session", entityId: String(r.lastInsertRowid), ip: req.ip });
  ok(res, { ok: true, id: r.lastInsertRowid });
}));

rootRouter.patch("/sessions/:id", requireAuth, requireTenant, adminOrSupport, asyncHandler(async (req, res) => {
  const m = req.madrasa;
  const s = await db.get("SELECT * FROM academic_sessions WHERE id = ? AND madrasa_id = ?", [toNum(req.params.id, 0), m.id]);
  if (!s) return res.status(404).json({ error: "Session not found." });
  if (req.body && req.body.is_current !== undefined) {
    await db.run("UPDATE academic_sessions SET is_current = 0 WHERE madrasa_id = ?", [m.id]);
    if (req.body.is_current) await db.run("UPDATE academic_sessions SET is_current = 1 WHERE id = ?", [s.id]);
  }
  ok(res, { ok: true });
}));

rootRouter.post("/sessions/:id/terms", requireAuth, requireTenant, adminOrSupport, asyncHandler(async (req, res) => {
  const m = req.madrasa;
  const s = await db.get("SELECT * FROM academic_sessions WHERE id = ? AND madrasa_id = ?", [toNum(req.params.id, 0), m.id]);
  if (!s) return res.status(404).json({ error: "Session not found." });
  const b = req.body || {};
  const pos = toNum(b.position, 0);
  const nameEn = cleanStr(b.name_en, 60);
  if (!pos || !nameEn) return err(res, 400, "position and name_en are required.");
  const dup = await db.get("SELECT id FROM terms WHERE madrasa_id = ? AND session_id = ? AND position = ?", [m.id, s.id, pos]);
  if (dup) return err(res, 400, "A term with this position already exists.");
  const r = await db.run(
    "INSERT INTO terms (madrasa_id, session_id, position, name_en, name_ar, start_date, end_date) VALUES (?,?,?,?,?,?,?)",
    [m.id, s.id, pos, nameEn, cleanStr(b.name_ar, 60), b.start_date || null, b.end_date || null]
  );
  ok(res, { ok: true, id: r.lastInsertRowid });
}));

/* ------------------------------ grading config ------------------------- */

rootRouter.get("/grading", requireAuth, requireTenant, asyncHandler(async (req, res) => {
  const m = await resolveMadrasa(req, res);
  if (!m) return;
  const cfg = await grading.getGradingConfig(m.id);
  ok(res, {
    caMax: cfg.caMax,
    examMax: cfg.examMax,
    passMark: cfg.passMark,
    promotionMinAverage: cfg.promotionMinAverage,
    promotionRequirePass: cfg.promotionRequirePass,
    bands: cfg.bands,
  });
}));

rootRouter.put("/grading", requireAuth, requireTenant, adminOrSupport, asyncHandler(async (req, res) => {
  const m = await resolveMadrasa(req, res);
  if (!m) return;
  const b = req.body || {};
  const existing = await db.get("SELECT id FROM grading_config WHERE madrasa_id = ?", [m.id]);
  const caMax = clampNum(b.ca_max, 1, 100, 40);
  const examMax = clampNum(b.exam_max, 1, 100, 60);
  const passMark = clampNum(b.pass_mark, 0, 100, 50);
  const promoAvg = b.promotion_min_average === null || b.promotion_min_average === "" ? null : clampNum(b.promotion_min_average, 0, 100, 50);
  const requirePass = b.promotion_require_pass === undefined ? 1 : (b.promotion_require_pass ? 1 : 0);
  let bands = grading.DEFAULT_BANDS;
  if (Array.isArray(b.bands) && b.bands.length) {
    bands = b.bands
      .filter((x) => x && x.grade)
      .map((x) => ({
        min: clampNum(x.min, 0, 100, 0),
        grade: cleanStr(x.grade, 5),
        remark: cleanStr(x.remark, 60),
        remark_ar: cleanStr(x.remark_ar, 60),
      }))
      .sort((a, z) => z.min - a.min);
  }
  const vals = [m.id, caMax, examMax, passMark, promoAvg, requirePass, JSON.stringify(bands)];
  if (existing) {
    await db.run(
      "UPDATE grading_config SET ca_max=?, exam_max=?, pass_mark=?, promotion_min_average=?, promotion_require_pass=?, grade_bands=? WHERE madrasa_id=?",
      vals
    );
  } else {
    await db.run(
      "INSERT INTO grading_config (madrasa_id, ca_max, exam_max, pass_mark, promotion_min_average, promotion_require_pass, grade_bands) VALUES (?,?,?,?,?,?,?)",
      vals
    );
  }
  logActivity(db, { madrasaId: m.id, userId: req.user.id, action: "grading.update", entity: "grading", entityId: String(m.id), ip: req.ip });
  ok(res, { ok: true });
}));

module.exports = { router, rootRouter };
