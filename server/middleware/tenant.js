"use strict";
/* ============================================================================
   MULTI-MADRASA PLATFORM — tenant isolation (the security core)
   ----------------------------------------------------------------------------
   Every tenant-owned resource row carries madrasa_id. These helpers enforce,
   on the BACKEND, that:

     • a user may only read/modify rows where row.madrasa_id = user.madrasa_id
     • super_admin (madrasa_id NULL) may reach every tenant explicitly
     • any other access attempt gets 404 (existence not leaked)

   Routes must NEVER trust a client-supplied madrasa_id. The tenant always
   comes from the authenticated user's session record (see middleware/auth.js).
   ========================================================================== */
const db = require("../db");

/**
 * Returns the effective tenant id for this request:
 *   - super_admin acting with an explicit ?madrasaId (or body.madrasa_id)
 *   - any other role: their own madrasa_id, always.
 */
function effectiveTenantId(req) {
  const u = req.user;
  if (u.role === "super_admin") {
    const q = Number((req.query && req.query.madrasaId) || (req.body && req.body.madrasa_id) || 0);
    return q > 0 ? q : null; // null => platform-wide query (stats)
  }
  return u.madrasaId;
}

/**
 * Asserts that `resourceMadrasaId` belongs to the requesting tenant.
 * Returns true if allowed; otherwise sends 404 and returns false.
 */
function assertSameTenant(req, res, resourceMadrasaId) {
  const u = req.user;
  if (!u) return fail(res);
  if (u.role === "super_admin") return true;
  if (Number(resourceMadrasaId) !== Number(u.madrasaId)) return fail(res);
  return true;
}

function fail(res) {
  res.status(404).json({ error: "Not found." });
  return false;
}

/**
 * Loads a tenant-owned row by id and enforces isolation.
 * table must contain (id, madrasa_id). Returns the row or null (after 404).
 */
async function loadTenantRow(req, res, table, id, extraWhere = "") {
  const tid = Number(id);
  if (!Number.isInteger(tid) || tid <= 0) {
    res.status(400).json({ error: "Invalid id." });
    return null;
  }
  const row = await db.get(`SELECT * FROM ${table} WHERE id = ? ${extraWhere}`, [tid]);
  if (!row) { res.status(404).json({ error: "Not found." }); return null; }
  if (!assertSameTenant(req, res, row.madrasa_id)) return null;
  return row;
}

/**
 * Teacher scope: returns the set of (classId, subjectId) pairs the teacher is
 * assigned to. A NULL class_id means "any class in this subject", a NULL
 * subject_id means "any subject in this class" (full-class teacher).
 */
async function getTeacherAssignments(madrasaId, userId) {
  const rows = await db.all(
    "SELECT class_id, subject_id FROM teacher_assignments WHERE madrasa_id = ? AND user_id = ?",
    [madrasaId, userId]
  );
  const wholeClassIds = new Set();    // class assigned without a subject -> any subject in class
  const classSubjects = new Set();    // "classId:subjectId" specific pairs
  const assignedClassIds = new Set(); // any assignment touching this class
  let anyClassAnySubject = false;
  for (const r of rows) {
    if (r.class_id == null && r.subject_id == null) anyClassAnySubject = true;
    if (r.class_id != null) {
      const cid = Number(r.class_id);
      assignedClassIds.add(cid);
      if (r.subject_id == null) wholeClassIds.add(cid);
      else classSubjects.add(cid + ":" + Number(r.subject_id));
    }
  }
  return { wholeClassIds, classSubjects, assignedClassIds, anyClassAnySubject };
}

/**
 * Checks whether a teacher may write results for (classId, subjectId).
 */
function teacherCanAccess(scope, classId, subjectId) {
  const cid = Number(classId);
  const sid = Number(subjectId);
  if (scope.anyClassAnySubject) return true;
  if (scope.wholeClassIds.has(cid)) return true;
  return scope.classSubjects.has(cid + ":" + sid);
}

/**
 * Checks whether a teacher may mark attendance for a class.
 */
function teacherCanMarkAttendance(scope, classId) {
  const cid = Number(classId);
  if (scope.anyClassAnySubject) return true;
  return scope.assignedClassIds.has(cid);
}

/**
 * Validates that a madrasa exists and is active. Returns the madrasa row or null.
 */
async function getActiveMadrasa(madrasaId) {
  if (!madrasaId) return null;
  return db.get("SELECT * FROM madaris WHERE id = ? AND status = 'active'", [madrasaId]);
}

module.exports = {
  effectiveTenantId,
  assertSameTenant,
  loadTenantRow,
  getTeacherAssignments,
  teacherCanAccess,
  teacherCanMarkAttendance,
  getActiveMadrasa,
};
