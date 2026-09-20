"use strict";
/* ============================================================================
   BELLO — Parent portal: "Book a meeting"
   ----------------------------------------------------------------------------
   The parent-facing half of the Parent-Teacher Meeting module. It is mounted
   by the public SPA router (public/js/app.js) at /parent and /parent/meetings,
   exactly the way the registration and admin modules are mounted, so app.js
   keeps one small routing hook instead of a second application.

   Flow: sign in (parent account) → choose meeting session → choose child →
   choose one of that child's teachers → choose a free time slot → booking is
   confirmed on screen with the date, time and location.

   It talks ONLY to the existing tenant-scoped API (/api/ptm/*) with the shared
   window.API client, so the session, CSRF and madrasa_id isolation rules are
   the ones already enforced by the server. Both institution categories are
   served by the same screen: the teacher list, subjects and terminology come
   from the parent's own institution.
   ========================================================================== */
(function () {
  const state = {
    me: null,
    sessions: [],
    sessionId: null,
    children: [],
    studentId: null,
    teacherId: null,
    slots: [],
    bookings: [],
    confirmation: null,
    error: "",
  };

  function esc(v) {
    return String(v === null || v === undefined ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function fmtDate(v) {
    if (!v) return "—";
    try { return new Date(String(v).slice(0, 10)).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }); }
    catch (e) { return String(v); }
  }
  function root() { return document.getElementById("app"); }
  function childName(child) { return [child.first_name, child.last_name].filter(Boolean).join(" ").trim() || "Student"; }

  function shell(inner) {
    return `
      <main id="main-content" class="school-public ptm-portal-page">
        <div class="container" style="padding:40px 0 64px">
          <p class="section-kicker">Parent portal</p>
          <h1 style="margin:6px 0 6px">Book a meeting</h1>
          <p style="max-width:640px;color:#6d6878">Choose your child, pick one of their teachers and reserve a time for the parent-teacher meeting. Your booking is confirmed immediately and both you and the teacher are notified.</p>
          <div class="ptm-portal" style="margin-top:22px">${inner}</div>
        </div>
      </main>`;
  }

  /* ------------------------------- sign in -------------------------------- */
  function renderSignIn(message) {
    root().innerHTML = shell(`
      <div class="ptm-portal-card" style="max-width:420px">
        <h3>Sign in</h3>
        <p class="ptm-muted">Use the parent account your child's school gave you.</p>
        ${message ? `<p class="ptm-error" role="alert">${esc(message)}</p>` : ""}
        <form id="ptmLoginForm">
          <label style="display:block;margin-bottom:10px">Username<br><input name="username" autocomplete="username" required style="width:100%;min-height:44px;padding:0 12px;border:1px solid #e6e2ee;border-radius:9px"></label>
          <label style="display:block;margin-bottom:14px">Password<br><input name="password" type="password" autocomplete="current-password" required style="width:100%;min-height:44px;padding:0 12px;border:1px solid #e6e2ee;border-radius:9px"></label>
          <button class="button button-primary" type="submit" style="width:100%">Sign in</button>
        </form>
      </div>`);
    const form = document.getElementById("ptmLoginForm");
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const username = (form.elements.username.value || "").trim();
      const password = form.elements.password.value || "";
      if (!username || !password) return renderSignIn("Enter both your username and your password.");
      let result;
      try { result = await window.API.login(username, password); }
      catch (e) { return renderSignIn(e && e.message ? e.message : "Could not sign in. Please try again."); }
      if (!result || result.role !== "parent") {
        try { await window.API.logout(); } catch (e) { /* best effort */ }
        return renderSignIn("That account is not a parent account. Meeting bookings are made from a parent account.");
      }
      await boot();
    });
  }

  /* ------------------------------- data loads ------------------------------ */
  async function loadSessions() {
    const data = await window.API.get("/ptm?upcoming=1&status=open");
    state.sessions = data.sessions || [];
    if (!state.sessions.some((s) => Number(s.id) === Number(state.sessionId))) {
      state.sessionId = state.sessions.length ? Number(state.sessions[0].id) : null;
    }
  }
  async function loadChildren() {
    if (!state.sessionId) { state.children = []; state.bookings = []; return; }
    const data = await window.API.get(`/ptm/${state.sessionId}/teachers`);
    state.children = data.children || [];
    state.bookings = data.bookings || [];
    if (!state.children.some((c) => Number(c.id) === Number(state.studentId))) {
      state.studentId = state.children.length ? Number(state.children[0].id) : null;
      state.teacherId = null;
      state.slots = [];
    }
  }
  async function loadSlots() {
    if (!state.sessionId || !state.teacherId) { state.slots = []; return; }
    const data = await window.API.get(`/ptm/${state.sessionId}/available-slots?teacherId=${encodeURIComponent(state.teacherId)}`);
    state.slots = data.slots || [];
  }

  /* -------------------------------- render -------------------------------- */
  function currentChild() { return state.children.find((c) => Number(c.id) === Number(state.studentId)) || null; }
  function currentSession() { return state.sessions.find((s) => Number(s.id) === Number(state.sessionId)) || null; }

  function render() {
    const session = currentSession();
    const child = currentChild();
    const teachers = child ? (child.teachers || []) : [];

    if (state.confirmation) {
      const c = state.confirmation;
      root().innerHTML = shell(`
        <div class="ptm-confirmation" role="status">
          <h3 style="margin:0">Meeting confirmed</h3>
          <p class="ptm-muted" style="margin:6px 0 0">You and the teacher have both been notified.</p>
          <dl>
            <dt>Meeting</dt><dd>${esc(c.title)}</dd>
            <dt>Child</dt><dd>${esc(c.student_name)}</dd>
            <dt>Teacher</dt><dd>${esc(c.teacher_name || "—")}</dd>
            <dt>Date</dt><dd>${fmtDate(c.date)}</dd>
            <dt>Time</dt><dd>${esc(c.slot_time)}${c.slot_end ? `–${esc(c.slot_end)}` : ""} (slot ${esc(c.slot_number)})</dd>
            <dt>Location</dt><dd>${esc(c.location || "To be announced")}</dd>
          </dl>
          <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:14px">
            <button class="button button-primary" id="ptmBookAnother" type="button">Book another meeting</button>
            <button class="button" id="ptmCancelBooking" type="button" data-booking="${esc(c.booking_id)}">Cancel this booking</button>
          </div>
        </div>`);
      document.getElementById("ptmBookAnother").addEventListener("click", () => { state.confirmation = null; state.teacherId = null; state.slots = []; refresh(); });
      document.getElementById("ptmCancelBooking").addEventListener("click", async (event) => {
        if (!window.confirm("Cancel this meeting booking?")) return;
        try {
          await window.API.del(`/ptm/bookings/${event.currentTarget.dataset.booking}`);
          state.confirmation = null; state.teacherId = null; state.slots = [];
          await refresh();
        } catch (e) { state.error = e.message || "Could not cancel the booking."; render(); }
      });
      return;
    }

    const sessionCard = `
      <div class="ptm-portal-card">
        <h3>1. Meeting session</h3>
        <p class="ptm-muted">Only sessions your school has opened for booking are listed.</p>
        ${state.sessions.length ? `<div class="ptm-choice-grid">${state.sessions.map((s) => `
          <button type="button" class="ptm-choice${Number(s.id) === Number(state.sessionId) ? " is-active" : ""}" data-ptm-session="${s.id}">
            ${esc(s.title)}<small>${fmtDate(s.date)} · ${esc(s.session_start)}–${esc(s.session_end)}${s.location ? ` · ${esc(s.location)}` : ""}</small>
          </button>`).join("")}</div>` : `<p class="ptm-status">There are no meeting sessions open for booking right now. Your school will let you know when bookings open.</p>`}
      </div>`;

    const childCard = state.sessionId ? `
      <div class="ptm-portal-card">
        <h3>2. Your child</h3>
        ${state.children.length ? `<div class="ptm-choice-grid">${state.children.map((c) => `
          <button type="button" class="ptm-choice${Number(c.id) === Number(state.studentId) ? " is-active" : ""}" data-ptm-child="${c.id}">
            ${esc(childName(c))}<small>${esc(c.class_en || "No class")}${c.admission_no ? ` · ${esc(c.admission_no)}` : ""}</small>
          </button>`).join("")}</div>` : `<p class="ptm-status">No children are linked to your account yet. Contact the school office.</p>`}
      </div>` : "";

    const teacherCard = child ? `
      <div class="ptm-portal-card">
        <h3>3. Teacher</h3>
        <p class="ptm-muted">Teachers of ${esc(childName(child))}${child.class_en ? ` (${esc(child.class_en)})` : ""} who are taking part.</p>
        ${teachers.length ? `<div class="ptm-choice-grid">${teachers.map((t) => `
          <button type="button" class="ptm-choice${Number(t.id) === Number(state.teacherId) ? " is-active" : ""}" data-ptm-teacher="${t.id}">
            ${esc(t.full_name || t.username)}<small>${esc((t.subjects || []).join(", ") || "Class teacher")}</small>
          </button>`).join("")}</div>` : `<p class="ptm-status">None of this child's teachers is available for this meeting session yet.</p>`}
      </div>` : "";

    const freeSlots = state.slots.filter((s) => s.available).length;
    const slotCard = (child && state.teacherId) ? `
      <div class="ptm-portal-card">
        <h3>4. Time slot</h3>
        <p class="ptm-muted">${freeSlots} slot(s) still free. Slots you already booked with another teacher are hidden from selection.</p>
        ${state.slots.length ? `<div class="ptm-slot-grid">${state.slots.map((s) => `
          <button type="button" class="ptm-slot${s.taken ? " is-taken" : ""}" data-ptm-slot="${s.slot_number}" ${s.available ? "" : "disabled"} title="${s.taken ? "Already booked" : (s.clashes_with_my_booking ? "You already have a meeting at this time" : "")}">
            ${esc(s.start)}
          </button>`).join("")}</div>` : `<p class="ptm-status">This meeting session has no time slots.</p>`}
      </div>` : "";

    const myBookings = state.bookings.length ? `
      <div class="ptm-portal-card">
        <h3>Your bookings for this session</h3>
        <ul class="ptm-booking-list">${state.bookings.map((b) => `
          <li>
            <span><strong>${esc(String(b.slot_time || "").slice(0, 5))}</strong> · ${esc(b.teacher_name || "Teacher")} · ${esc([b.first_name, b.last_name].filter(Boolean).join(" ").trim())}</span>
            <button type="button" class="button button-small" data-ptm-cancel="${b.id}">Cancel</button>
          </li>`).join("")}</ul>
      </div>` : "";

    root().innerHTML = shell(`
      <div class="ptm-portal-card" style="display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between">
        <span>Signed in as <strong>${esc((state.me && state.me.user && (state.me.user.fullName || state.me.user.username)) || "parent")}</strong>${state.me && state.me.institutionName ? ` · ${esc(state.me.institutionName)}` : ""}</span>
        <button type="button" class="button button-small" id="ptmSignOut">Sign out</button>
      </div>
      ${state.error ? `<p class="ptm-error" role="alert">${esc(state.error)}</p>` : ""}
      ${sessionCard}${childCard}${teacherCard}${slotCard}${myBookings}`);

    document.getElementById("ptmSignOut").addEventListener("click", async () => {
      try { await window.API.logout(); } catch (e) { /* best effort */ }
      state.me = null;
      renderSignIn("You have been signed out.");
    });

    root().querySelectorAll("[data-ptm-session]").forEach((btn) => btn.addEventListener("click", async () => {
      state.sessionId = Number(btn.dataset.ptmSession); state.teacherId = null; state.slots = []; state.error = "";
      await refresh();
    }));
    root().querySelectorAll("[data-ptm-child]").forEach((btn) => btn.addEventListener("click", async () => {
      state.studentId = Number(btn.dataset.ptmChild); state.teacherId = null; state.slots = []; state.error = "";
      render();
    }));
    root().querySelectorAll("[data-ptm-teacher]").forEach((btn) => btn.addEventListener("click", async () => {
      state.teacherId = Number(btn.dataset.ptmTeacher); state.error = "";
      try { await loadSlots(); } catch (e) { state.error = e.message || "Could not load the available slots."; }
      render();
    }));
    root().querySelectorAll("[data-ptm-slot]").forEach((btn) => btn.addEventListener("click", () => book(Number(btn.dataset.ptmSlot))));
    root().querySelectorAll("[data-ptm-cancel]").forEach((btn) => btn.addEventListener("click", async () => {
      if (!window.confirm("Cancel this meeting booking?")) return;
      try { await window.API.del(`/ptm/bookings/${btn.dataset.ptmCancel}`); state.error = ""; }
      catch (e) { state.error = e.message || "Could not cancel the booking."; }
      state.slots = []; state.teacherId = null;
      await refresh();
    }));
  }

  async function book(slotNumber) {
    state.error = "";
    try {
      const result = await window.API.post("/ptm/bookings", {
        ptm_session_id: state.sessionId,
        teacher_user_id: state.teacherId,
        student_id: state.studentId,
        slot_number: slotNumber,
      });
      state.confirmation = result.confirmation || null;
      await loadChildren();
      render();
    } catch (e) {
      state.error = e.message || "That slot could not be booked.";
      try { await loadSlots(); } catch (x) { /* keep the message */ }
      render();
    }
  }

  async function refresh() {
    try {
      await loadSessions();
      await loadChildren();
      if (state.teacherId) await loadSlots();
    } catch (e) {
      state.error = e.message || "Could not load your meeting information.";
    }
    render();
  }

  async function boot() {
    root().innerHTML = shell(`<div class="ptm-portal-card"><p class="ptm-status">Loading…</p></div>`);
    let me = null;
    try { me = await window.API.me(); } catch (e) { me = null; }
    if (!me || !me.loggedIn) return renderSignIn("");
    if (me.role !== "parent") {
      return renderSignIn("You are signed in with a " + esc(me.role || "different") + " account. Meeting bookings are made from a parent account.");
    }
    state.me = me;
    await refresh();
  }

  window.BelloParentMeetings = {
    mount() {
      document.body.classList.remove("western-experience", "western-menu-open", "islamic-experience");
      document.title = "Book a meeting — BELLO";
      boot();
    },
  };
})();
