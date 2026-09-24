"use strict";
/* ============================================================================
   EduSphere — Student Health & Medical module (admin workspace)
   ----------------------------------------------------------------------------
   Shared by BOTH institution categories (Islamic School and Western Academy):
   the same engine, routes and screens — health vocabulary is category-neutral
   so no labels are branched here.

   Two integration points with the existing dashboard (dashboard.js):
     • window.BelloHealth.profileTab(panel, studentId, ctx) renders the
       "Health" tab inside the existing student profile modal;
     • window.BelloHealth.handles()/render() render the "Health Reports"
       sidebar page (students/health) — allergy list + upcoming vaccinations.

   Everything renders with the existing dashboard design system (dash-card,
   dash-table, dash-form-grid, dash-pill…) and the shared window.API client,
   so it inherits the current theme, RTL container and mobile breakpoints.
   ========================================================================== */
(function () {
  const ROUTES = new Set(["students/health"]);
  const BLOOD_GROUPS = ["", "A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];
  const GENOTYPES = ["", "AA", "AS", "AC", "SS", "SC", "CC"];

  /* ------------------------------ helpers -------------------------------- */
  function esc(s) {
    return String(s === null || s === undefined ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  }
  function fmtDate(v) {
    if (!v) return "—";
    try { return new Date(String(v).slice(0, 10)).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }); }
    catch (e) { return String(v); }
  }
  function todayIso() { return new Date().toISOString().slice(0, 10); }
  function pill(text, kind) { return `<span class="dash-pill ${kind || "info"}">${esc(text)}</span>`; }
  function emptyRow(ctx, cols, copy) { return ctx.emptyRow ? ctx.emptyRow(cols, copy) : `<tr><td colspan="${cols}">${esc(copy)}</td></tr>`; }
  function isAdmin(ctx) { return !ctx.state || !ctx.state.me || ctx.state.me.role === "madrasa_admin"; }
  function currentUserName(ctx) { return (ctx.state && ctx.state.me && ctx.state.me.user && ctx.state.me.user.fullName) || ""; }

  function daysUntil(dateStr) {
    const d = new Date(`${String(dateStr).slice(0, 10)}T00:00:00Z`);
    const now = new Date(`${todayIso()}T00:00:00Z`);
    return Math.round((d - now) / 86400000);
  }
  function duePill(nextDue) {
    const days = daysUntil(nextDue);
    if (days < 0) return pill(`${Math.abs(days)} day(s) overdue`, "danger");
    if (days === 0) return pill("Due today", "warn");
    return pill(`Due in ${days} day(s)`, days <= 7 ? "warn" : "ok");
  }

  /* --------------------------- profile tab ------------------------------- */
  /** Renders the Health tab of the existing student profile modal. */
  async function profileTab(panel, studentId, ctx) {
    const I = ctx.I || {};
    panel.innerHTML = `<p class="hint">Loading health record…</p>`;
    let health = null, visits = [], vaccinations = [];
    try {
      const [h, v, vac] = await Promise.all([
        window.API.get(`/health/students/${studentId}`),
        window.API.get(`/health/students/${studentId}/visits`),
        window.API.get(`/health/students/${studentId}/vaccinations`),
      ]);
      health = h.health || null;
      visits = v.visits || [];
      vaccinations = vac.vaccinations || [];
    } catch (e) {
      panel.innerHTML = `<div class="dash-card"><div class="dash-card-pad"><p class="hint">${esc(e.message || "The health record could not be loaded.")}</p></div></div>`;
      return;
    }
    const admin = isAdmin(ctx);
    const facts = [
      ["Blood group", health && health.blood_group ? health.blood_group : "—"],
      ["Genotype", health && health.genotype ? health.genotype : "—"],
      ["Vision", health && health.vision_notes ? health.vision_notes : "—"],
      ["Hearing", health && health.hearing_notes ? health.hearing_notes : "—"],
      ["Dietary restrictions", health && health.dietary_restrictions ? health.dietary_restrictions : "—"],
      ["Emergency medication", health && health.emergency_medication ? health.emergency_medication : "—"],
    ];
    const textBlocks = [
      ["Allergies", health && health.allergies],
      ["Chronic conditions", health && health.chronic_conditions],
      ["Disabilities", health && health.disabilities],
    ];
    const chips = (value, kind) => String(value || "")
      .split(/[,;]/).map((s) => s.trim()).filter(Boolean)
      .map((s) => pill(s, kind)).join(" ") || `<span class="hint">None recorded</span>`;

    panel.innerHTML = `
      <div class="dash-card">
        <div class="dash-card-head">
          <h3>Medical profile</h3>
          <span class="hint">Updated ${health && health.last_updated ? fmtDate(health.last_updated) : "never"}</span>
          ${admin ? `<button type="button" class="dash-btn dash-btn-primary dash-btn-sm" id="healthEditBtn">${I.edit || ""} ${health ? "Edit health details" : "Add health details"}</button>` : ""}
        </div>
        <div class="dash-card-pad">
          <div class="student-profile-summary">
            ${facts.map(([l, v]) => `<div><small>${esc(l)}</small><strong>${esc(v)}</strong></div>`).join("")}
          </div>
          <div class="dash-info-grid student-profile-info" style="margin-top:12px">
            ${textBlocks.map(([l, v]) => `<div><b>${esc(l)}</b><br>${v ? esc(v) : '<span class="hint">—</span>'}</div>`).join("")}
          </div>
          ${health && health.allergies ? `<div class="student-profile-chip-list" style="margin-top:10px">${chips(health.allergies, "warn")}</div>` : ""}
          <p class="hint" style="margin-top:12px">Health data is sensitive: it is kept out of the standard student CSV export and only administrators of this institution can change it.</p>
        </div>
      </div>
      <div class="dash-card" style="margin-top:14px">
        <div class="dash-card-head">
          <h3>Sick-bay visits</h3>
          <span class="hint">${visits.length} record(s)</span>
          ${admin ? `<button type="button" class="dash-btn dash-btn-primary dash-btn-sm" id="healthLogVisitBtn">${I.plus || ""} Log visit</button>` : ""}
        </div>
        <div class="dash-table-wrap">
          <table class="dash-table">
            <thead><tr><th>Date</th><th>Complaint</th><th>Diagnosis</th><th>Treatment</th><th>Referred out</th><th>Attended by</th>${admin ? "<th></th>" : ""}</tr></thead>
            <tbody>
              ${visits.length ? visits.map((v) => `<tr>
                <td>${fmtDate(v.visit_date)}</td>
                <td><strong>${esc(v.complaint)}</strong></td>
                <td>${esc(v.diagnosis || "—")}</td>
                <td>${esc(v.treatment || "—")}</td>
                <td>${v.referred_out ? pill("Referred", "warn") : pill("Treated in school", "ok")}${v.referral_notes ? `<small>${esc(v.referral_notes)}</small>` : ""}</td>
                <td>${esc(v.attended_by || "—")}</td>
                ${admin ? `<td><button type="button" class="dash-btn dash-btn-danger dash-btn-sm" data-health-del-visit="${v.id}">${I.trash || ""} Remove</button></td>` : ""}
              </tr>`).join("") : emptyRow(ctx, admin ? 7 : 6, "No sick-bay visits have been logged.")}
            </tbody>
          </table>
        </div>
      </div>
      <div class="dash-card" style="margin-top:14px">
        <div class="dash-card-head">
          <h3>Vaccinations</h3>
          <span class="hint">${vaccinations.length} record(s)</span>
          ${admin ? `<button type="button" class="dash-btn dash-btn-primary dash-btn-sm" id="healthAddVaccineBtn">${I.plus || ""} Add vaccination</button>` : ""}
        </div>
        <div class="dash-table-wrap">
          <table class="dash-table">
            <thead><tr><th>Vaccine</th><th>Dose</th><th>Date given</th><th>Next due</th><th>Administered by</th><th>Notes</th></tr></thead>
            <tbody>
              ${vaccinations.length ? vaccinations.map((v) => `<tr>
                <td><strong>${esc(v.vaccine_name)}</strong></td>
                <td>${esc(v.dose || "—")}</td>
                <td>${fmtDate(v.date_given)}</td>
                <td>${v.next_due ? `${fmtDate(v.next_due)} ${duePill(v.next_due)}` : "—"}</td>
                <td>${esc(v.administered_by || "—")}</td>
                <td>${esc(v.notes || "—")}</td>
              </tr>`).join("") : emptyRow(ctx, 6, "No vaccination records yet.")}
            </tbody>
          </table>
        </div>
      </div>`;

    const editBtn = panel.querySelector("#healthEditBtn");
    if (editBtn) editBtn.addEventListener("click", () => openHealthForm(studentId, health, ctx));
    const logBtn = panel.querySelector("#healthLogVisitBtn");
    if (logBtn) logBtn.addEventListener("click", () => openVisitForm(studentId, ctx));
    const vaccineBtn = panel.querySelector("#healthAddVaccineBtn");
    if (vaccineBtn) vaccineBtn.addEventListener("click", () => openVaccinationForm(studentId, ctx));
    panel.querySelectorAll("[data-health-del-visit]").forEach((b) => b.addEventListener("click", async () => {
      if (!window.confirm("Remove this sick-bay visit? The record is kept for audit but hidden from the list.")) return;
      try {
        await window.API.del(`/health/visits/${b.dataset.healthDelVisit}`);
        ctx.toast("Visit removed.", "success");
        profileTab(panel, studentId, ctx);
      } catch (e) { ctx.toast(e.message || "Could not remove visit.", "error"); }
    }));
  }

  /* ------------------------------- forms --------------------------------- */
  function selectHtml(name, values, selected, emptyLabel) {
    return `<select name="${name}"><option value="">${esc(emptyLabel)}</option>${values.filter((v) => v).map((v) => `<option value="${esc(v)}" ${v === selected ? "selected" : ""}>${esc(v)}</option>`).join("")}</select>`;
  }

  function openHealthForm(studentId, health, ctx) {
    const I = ctx.I || {};
    const h = health || {};
    const modal = ctx.openModal(health ? "Edit health details" : "Add health details", `
      <form id="healthProfileForm">
        <div class="dash-form-grid">
          <div class="dash-field"><label>Blood group</label>${selectHtml("blood_group", BLOOD_GROUPS, h.blood_group, "Not recorded")}</div>
          <div class="dash-field"><label>Genotype</label>${selectHtml("genotype", GENOTYPES, h.genotype, "Not recorded")}</div>
          <div class="dash-field" style="grid-column:1/-1"><label>Allergies</label><textarea name="allergies" rows="2" placeholder="Separate with commas, e.g. Peanuts, Penicillin">${esc(h.allergies || "")}</textarea></div>
          <div class="dash-field" style="grid-column:1/-1"><label>Chronic conditions</label><textarea name="chronic_conditions" rows="2" placeholder="e.g. Asthma, Sickle cell disease">${esc(h.chronic_conditions || "")}</textarea></div>
          <div class="dash-field" style="grid-column:1/-1"><label>Disabilities</label><textarea name="disabilities" rows="2">${esc(h.disabilities || "")}</textarea></div>
          <div class="dash-field"><label>Vision notes</label><input name="vision_notes" value="${esc(h.vision_notes || "")}" placeholder="e.g. Wears glasses"></div>
          <div class="dash-field"><label>Hearing notes</label><input name="hearing_notes" value="${esc(h.hearing_notes || "")}"></div>
          <div class="dash-field"><label>Dietary restrictions</label><input name="dietary_restrictions" value="${esc(h.dietary_restrictions || "")}" placeholder="e.g. No beef"></div>
          <div class="dash-field" style="grid-column:1/-1"><label>Emergency medication</label><textarea name="emergency_medication" rows="2" placeholder="Medication kept in school + dosage">${esc(h.emergency_medication || "")}</textarea></div>
        </div>
        <button class="dash-btn dash-btn-primary" style="margin-top:14px">${I.check || ""} Save health details</button>
      </form>`);
    modal.querySelector("#healthProfileForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        await window.API.patch(`/health/students/${studentId}`, Object.fromEntries(new FormData(e.target)));
        ctx.closeModal();
        ctx.toast("Health details saved.", "success");
        if (ctx.reopen) ctx.reopen();
      } catch (err) { ctx.toast(err.message || "Could not save health details.", "error"); }
    });
  }

  function openVisitForm(studentId, ctx) {
    const I = ctx.I || {};
    const modal = ctx.openModal("Log sick-bay visit", `
      <form id="healthVisitForm">
        <div class="dash-form-grid">
          <div class="dash-field"><label>Visit date <span class="req">*</span></label><input name="visit_date" type="date" value="${todayIso()}" required></div>
          <div class="dash-field"><label>Attended by</label><input name="attended_by" value="${esc(currentUserName(ctx))}" placeholder="Nurse / first-aider"></div>
          <div class="dash-field" style="grid-column:1/-1"><label>Complaint <span class="req">*</span></label><input name="complaint" required placeholder="e.g. Headache after break"></div>
          <div class="dash-field" style="grid-column:1/-1"><label>Diagnosis</label><input name="diagnosis" placeholder="e.g. Mild dehydration"></div>
          <div class="dash-field" style="grid-column:1/-1"><label>Treatment given</label><textarea name="treatment" rows="2" placeholder="What was done / medication given"></div>
          <div class="dash-field"><label style="display:flex;align-items:center;gap:8px"><input type="checkbox" name="referred_out" value="true"> Referred out for further care</label></div>
          <div class="dash-field"><label>Referral notes</label><input name="referral_notes" placeholder="Where and why"></div>
        </div>
        <button class="dash-btn dash-btn-primary" style="margin-top:14px">${I.check || ""} Log visit</button>
      </form>`);
    modal.querySelector("#healthVisitForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(e.target));
      body.referred_out = !!body.referred_out;
      try {
        await window.API.post(`/health/students/${studentId}/visits`, body);
        ctx.closeModal();
        ctx.toast("Sick-bay visit logged.", "success");
        if (ctx.reopen) ctx.reopen();
      } catch (err) { ctx.toast(err.message || "Could not log visit.", "error"); }
    });
  }

  function openVaccinationForm(studentId, ctx) {
    const I = ctx.I || {};
    const modal = ctx.openModal("Add vaccination record", `
      <form id="healthVaccinationForm">
        <div class="dash-form-grid">
          <div class="dash-field"><label>Vaccine <span class="req">*</span></label><input name="vaccine_name" required placeholder="e.g. Yellow fever"></div>
          <div class="dash-field"><label>Dose</label><input name="dose" placeholder="e.g. Booster, 2nd dose"></div>
          <div class="dash-field"><label>Date given <span class="req">*</span></label><input name="date_given" type="date" value="${todayIso()}" required></div>
          <div class="dash-field"><label>Next dose due</label><input name="next_due" type="date"></div>
          <div class="dash-field"><label>Administered by</label><input name="administered_by" value="${esc(currentUserName(ctx))}"></div>
          <div class="dash-field" style="grid-column:1/-1"><label>Notes</label><textarea name="notes" rows="2"></textarea></div>
        </div>
        <button class="dash-btn dash-btn-primary" style="margin-top:14px">${I.check || ""} Save vaccination</button>
      </form>`);
    modal.querySelector("#healthVaccinationForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const body = Object.fromEntries(fd);
      if (!body.next_due) delete body.next_due;
      try {
        await window.API.post(`/health/students/${studentId}/vaccinations`, body);
        ctx.closeModal();
        ctx.toast("Vaccination record saved.", "success");
        if (ctx.reopen) ctx.reopen();
      } catch (err) { ctx.toast(err.message || "Could not save vaccination.", "error"); }
    });
  }

  /* --------------------------- Health Reports page ------------------------ */
  async function reportsPage(ctx, content) {
    const I = ctx.I || {};
    content.innerHTML = `<div class="dash-coming-soon"><div class="icon">${I.clock || ""}</div><h3>Loading…</h3></div>`;
    let allergies = [], upcoming = [];
    try {
      const [a, u] = await Promise.all([
        window.API.get("/health/reports/allergies"),
        window.API.get("/health/reports/upcoming-vaccines"),
      ]);
      allergies = a.students || [];
      upcoming = u.vaccinations || [];
    } catch (e) {
      content.innerHTML = `<div class="dash-page-head"><div><div class="dash-crumb">Students</div><h2>Health Reports</h2></div></div><div class="dash-card"><div class="dash-card-pad"><p class="hint">${esc(e.message || "Health reports could not be loaded.")}</p></div></div>`;
      return;
    }
    const admin = isAdmin(ctx);
    const statusPill = (s) => pill(s || "active", s === "active" ? "ok" : "muted");
    content.innerHTML = `
      <div class="dash-page-head">
        <div>
          <div class="dash-crumb">Students</div>
          <h2>Health Reports</h2>
          <p>Students with known allergies (for the canteen and trip planning) and vaccinations due within the next 30 days.</p>
        </div>
        <div class="dash-actions">
          ${admin ? `<a class="dash-btn dash-btn-ghost" href="${window.API.url("/health/export.csv")}">${I.download || ""} Export medical records (admin)</a>` : ""}
        </div>
      </div>
      <div class="dash-stats-grid">
        ${ctx.statCard ? ctx.statCard("health", allergies.length, "Students with allergies") : ""}
        ${ctx.statCard ? ctx.statCard("calendar", upcoming.length, "Vaccinations due (30 days)") : ""}
      </div>
      <div class="dash-card">
        <div class="dash-card-head">
          <h3>Known allergies</h3>
          <span class="hint">${allergies.length} student(s)</span>
        </div>
        <div class="dash-table-wrap">
          <table class="dash-table">
            <thead><tr><th>Student</th><th>Class</th><th>Allergies</th><th>Dietary restrictions</th><th>Emergency medication</th><th>Status</th></tr></thead>
            <tbody>
              ${allergies.length ? allergies.map((s) => `<tr>
                <td><strong>${esc(s.first_name)} ${esc(s.last_name)}</strong><small>${esc(s.admission_no)}</small></td>
                <td>${esc(s.class_en || "Unassigned")}</td>
                <td><div class="student-profile-chip-list">${String(s.allergies || "").split(/[,;]/).map((x) => x.trim()).filter(Boolean).map((x) => pill(x, "warn")).join(" ")}</div></td>
                <td>${esc(s.dietary_restrictions || "—")}</td>
                <td>${esc(s.emergency_medication || "—")}</td>
                <td>${statusPill(s.status)}</td>
              </tr>`).join("") : emptyRow(ctx, 6, "No students with recorded allergies.")}
            </tbody>
          </table>
        </div>
      </div>
      <div class="dash-card" style="margin-top:18px">
        <div class="dash-card-head">
          <h3>Vaccinations due in the next 30 days</h3>
          <span class="hint">${upcoming.length} record(s)</span>
        </div>
        <div class="dash-table-wrap">
          <table class="dash-table">
            <thead><tr><th>Student</th><th>Class</th><th>Vaccine</th><th>Dose</th><th>Date given</th><th>Next due</th><th>Guardian contact</th></tr></thead>
            <tbody>
              ${upcoming.length ? upcoming.map((v) => `<tr>
                <td><strong>${esc(v.first_name)} ${esc(v.last_name)}</strong><small>${esc(v.admission_no)}</small></td>
                <td>${esc(v.class_en || "Unassigned")}</td>
                <td>${esc(v.vaccine_name)}</td>
                <td>${esc(v.dose || "—")}</td>
                <td>${fmtDate(v.date_given)}</td>
                <td>${fmtDate(v.next_due)} ${duePill(v.next_due)}</td>
                <td>${esc(v.parent_name || "—")}<small>${esc(v.parent_phone || "")}</small></td>
              </tr>`).join("") : emptyRow(ctx, 7, "No vaccinations are due in the next 30 days.")}
            </tbody>
          </table>
        </div>
      </div>
      <p class="hint" style="margin-top:12px">Health data is sensitive: these reports are tenant-scoped and medical details are never part of the standard student CSV export.</p>`;
    if (ctx.bindRouteButtons) ctx.bindRouteButtons(content);
  }

  window.BelloHealth = {
    handles: (route) => ROUTES.has(route),
    render: async (ctx, content, route) => { if (route === "students/health") return await reportsPage(ctx, content); },
    profileTab,
  };
})();
