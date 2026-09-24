"use strict";
/* ============================================================================
   EduSphere — Staff Leave workspace (admin + staff self-service)
   ----------------------------------------------------------------------------
   Self-contained module for the "Staff Leave" sidebar section: the leave type
   catalogue, leave requests with approve/reject, the monthly leave calendar,
   session balances and the staff self-service screen.

   It renders into the dashboard's unchanged shell and design system —
   dashboard.js owns the sidebar, router, modals, toasts and helpers, all of
   which arrive through the context object (C) — exactly like the Payroll and
   Academic & Admissions workspaces. Both institution categories share these
   screens; only wording varies through the category terms (C.T()).
   All markup is built here (no inline handlers / no inline <script>) so the
   Content-Security-Policy stays untouched.
   ========================================================================== */
(function () {
  const ROUTES = new Set(["hr/requests", "hr/calendar", "hr/balances", "hr/types", "hr/my-leave"]);
  let C;
  const $ = (selector, scope) => (scope || document).querySelector(selector);
  const $$ = (selector, scope) => [...(scope || document).querySelectorAll(selector)];
  const formObject = (form) => Object.fromEntries(new FormData(form));
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const statusLabel = (value) => String(value || "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const pill = (status, tone) => `<span class="dash-pill ${tone || C.pillFor(status)}">${C.esc(statusLabel(status))}</span>`;
  const query = (params) => Object.entries(params)
    .filter(([, v]) => v !== "" && v !== null && v !== undefined)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");

  function pageHead(crumb, title, description, actions) {
    return `<div class="dash-page-head"><div><div class="dash-crumb">${C.esc(crumb)}</div><h2>${C.esc(title)}</h2><p>${C.esc(description)}</p></div>${actions ? `<div class="dash-actions">${actions}</div>` : ""}</div>`;
  }
  function loadError(error) {
    return `<div class="dash-coming-soon"><div class="icon">${C.I.close}</div><h3>Could not load this section</h3><p>${C.esc(error.message || "Please try again.")}</p></div>`;
  }
  function busy(button, text) {
    if (!button) return () => {};
    const old = button.innerHTML;
    button.disabled = true;
    button.textContent = text || "Working…";
    return () => { button.disabled = false; button.innerHTML = old; };
  }
  function isAdmin() {
    const role = (C.state.me && C.state.me.role) || "";
    return role === "madrasa_admin" || role === "super_admin";
  }
  function staffName(row) { return row.teacher_name || row.full_name || row.username || `Staff #${row.user_id}`; }
  function typeSwatch(colour, label) {
    return `<span class="leave-swatch" style="background:${C.esc(colour || "#5f5b6b")}"></span>${C.esc(label || "")}`;
  }
  function dateRange(row) {
    return row.start_date === row.end_date
      ? C.fmtDate(row.start_date)
      : `${C.fmtDate(row.start_date)} → ${C.fmtDate(row.end_date)}`;
  }
  /** Active teaching staff — reuses the existing teachers endpoint. */
  async function loadStaff() {
    try {
      const data = await window.API.get("/teachers?status=active&perPage=200");
      return (data.teachers || []).map((t) => ({
        id: t.user_id || t.id, user_id: t.user_id || t.id,
        full_name: t.full_name || t.username, staff_id: t.staff_id || "",
      }));
    } catch (e) { return []; }
  }
  function staffOptions(staff, selected) {
    return C.options(staff || [], selected, (s) => `${s.full_name}${s.staff_id ? ` (${s.staff_id})` : ""}`);
  }
  function typeOptions(types, selected) {
    return C.options(types || [], selected, (t) => `${t.name}${Number(t.days_per_year) ? ` · ${t.days_per_year} days` : ""}`);
  }

  /* ========================== LEAVE REQUESTS ============================ */

  async function requestsPage(content) {
    let base;
    try {
      base = { types: (await window.API.get("/leave/types")).types || [], staff: await loadStaff() };
    } catch (e) { content.innerHTML = loadError(e); return; }

    const admin = isAdmin();
    const filters = { search: "", status: "", typeId: "", userId: "", from: "", to: "", page: 1 };

    content.innerHTML = pageHead("Staff Leave", "Leave Requests",
      admin
        ? "Review every leave application. Approving one records the staff member as on leave in the teacher attendance register for each working day covered."
        : "Your leave applications and their decisions.",
      `${admin ? `<button id="leaveNew" class="dash-btn dash-btn-primary">${C.I.plus} New Request</button>` : ""}
       <a id="leaveExport" class="dash-btn dash-btn-ghost" target="_blank" rel="noopener" href="${window.API.url("/leave/export.csv")}">${C.I.download} Export</a>`) + `
      <div class="dash-stats-grid" id="leaveStats"></div>
      <div class="dash-card" style="margin-top:18px"><div class="dash-card-pad">
        <div class="leave-toolbar">
          <div class="dash-field search-wide"><label>Search</label><input id="lvSearch" type="search" placeholder="Staff name or reason"></div>
          <div class="dash-field"><label>Status</label><select id="lvStatus">
            <option value="">All statuses</option>
            ${["pending", "approved", "rejected", "cancelled"].map((s) => `<option value="${s}">${statusLabel(s)}</option>`).join("")}
          </select></div>
          <div class="dash-field"><label>Leave type</label><select id="lvType"><option value="">All types</option>${typeOptions(base.types)}</select></div>
          ${admin ? `<div class="dash-field"><label>Staff member</label><select id="lvStaff"><option value="">All staff</option>${staffOptions(base.staff)}</select></div>` : ""}
          <div class="dash-field"><label>From</label><input id="lvFrom" type="date"></div>
          <div class="dash-field"><label>To</label><input id="lvTo" type="date"></div>
        </div>
      </div></div>
      <div class="dash-card" style="margin-top:18px">
        <div class="dash-table-wrap"><table class="dash-table">
          <thead><tr><th>Staff member</th><th>Leave type</th><th>Dates</th><th>Days</th><th>Status</th><th>Reviewed</th><th></th></tr></thead>
          <tbody id="lvRows"><tr class="dash-empty-row"><td colspan="7">Loading leave requests…</td></tr></tbody>
        </table></div>
        <div class="student-pagination"><span id="lvCount">—</span><span id="lvPage">Page 1</span>
          <button id="lvPrev" class="dash-btn dash-btn-ghost dash-btn-sm">Previous</button>
          <button id="lvNext" class="dash-btn dash-btn-ghost dash-btn-sm">Next</button></div>
      </div>`;

    const load = async () => {
      const qs = query(filters);
      $("#leaveExport", content).href = window.API.url(`/leave/export.csv?${qs}`);
      let data;
      try { data = await window.API.get(`/leave?${qs}`); }
      catch (e) { $("#lvRows", content).innerHTML = C.emptyRow(7, e.message || "Could not load leave requests."); return; }
      const s = data.stats || {};
      $("#leaveStats", content).innerHTML =
        C.statCard("clock", s.pending || 0, "Pending approval") +
        C.statCard("check", s.approved || 0, "Approved", true) +
        C.statCard("close", s.rejected || 0, "Rejected") +
        C.statCard("calendar", s.approvedDays || 0, "Approved days");
      $("#lvRows", content).innerHTML = (data.requests || []).length ? data.requests.map((r) => `
        <tr>
          <td><strong>${C.esc(staffName(r))}</strong><small>${C.esc(r.staff_id || r.username || "")}${r.department ? ` · ${C.esc(r.department)}` : ""}</small></td>
          <td>${typeSwatch(r.type_colour, r.type_name)}${r.type_paid ? "" : `<small>unpaid</small>`}</td>
          <td>${C.esc(dateRange(r))}<small>${C.esc(r.session_label || "")}</small></td>
          <td>${C.esc(r.days)}</td>
          <td>${pill(r.status)}</td>
          <td>${r.reviewed_by_name ? `${C.esc(r.reviewed_by_name)}<small>${C.fmtDate(r.reviewed_at)}</small>` : "—"}</td>
          <td><div class="leave-row-actions">
            <button class="dash-btn dash-btn-ghost dash-btn-sm" data-view="${r.id}">View</button>
            ${admin && r.status === "pending" ? `
              <button class="dash-btn dash-btn-primary dash-btn-sm" data-approve="${r.id}">${C.I.check} Approve</button>
              <button class="dash-btn dash-btn-ghost dash-btn-sm" data-reject="${r.id}">Reject</button>` : ""}
            ${["pending", "approved"].includes(r.status) ? `<button class="dash-btn dash-btn-ghost dash-btn-sm" data-cancel="${r.id}">Cancel</button>` : ""}
            ${admin ? `<button class="dash-btn dash-btn-danger dash-btn-sm" data-delete="${r.id}">${C.I.trash}</button>` : ""}
          </div></td>
        </tr>`).join("") : C.emptyRow(7, "No leave requests match these filters.");

      $("#lvCount", content).textContent = `${data.total || 0} request(s)`;
      $("#lvPage", content).textContent = `Page ${data.page} of ${data.totalPages}`;
      $("#lvPrev", content).disabled = data.page <= 1;
      $("#lvNext", content).disabled = data.page >= data.totalPages;

      const byId = (id) => (data.requests || []).find((r) => Number(r.id) === Number(id));
      $$("[data-view]", content).forEach((b) => b.addEventListener("click", () => openDetail(byId(b.dataset.view), base, load)));
      $$("[data-approve]", content).forEach((b) => b.addEventListener("click", () => openDecision(byId(b.dataset.approve), "approve", load)));
      $$("[data-reject]", content).forEach((b) => b.addEventListener("click", () => openDecision(byId(b.dataset.reject), "reject", load)));
      $$("[data-cancel]", content).forEach((b) => b.addEventListener("click", () => openDecision(byId(b.dataset.cancel), "cancel", load)));
      $$("[data-delete]", content).forEach((b) => b.addEventListener("click", async () => {
        if (!window.confirm("Delete this leave record permanently? Any attendance rows it created are removed too.")) return;
        try {
          const r = await window.API.del(`/leave/${b.dataset.delete}`);
          C.toast(`Leave record deleted.${r.attendanceRowsRemoved ? ` ${r.attendanceRowsRemoved} register row(s) reversed.` : ""}`, "success");
          load();
        } catch (e) { C.toast(e.message || "Could not delete this record.", "error"); }
      }));
    };

    const bind = (selector, key, event) => {
      const el = $(selector, content);
      if (el) el.addEventListener(event || "change", () => { filters[key] = el.value; filters.page = 1; load(); });
    };
    bind("#lvStatus", "status"); bind("#lvType", "typeId"); bind("#lvStaff", "userId");
    bind("#lvFrom", "from"); bind("#lvTo", "to");
    let timer;
    $("#lvSearch", content).addEventListener("input", (e) => {
      clearTimeout(timer);
      timer = setTimeout(() => { filters.search = e.target.value.trim(); filters.page = 1; load(); }, 300);
    });
    $("#lvPrev", content).addEventListener("click", () => { if (filters.page > 1) { filters.page -= 1; load(); } });
    $("#lvNext", content).addEventListener("click", () => { filters.page += 1; load(); });
    if (admin) $("#leaveNew", content).addEventListener("click", () => openRequestForm(base, load, null));
    await load();
  }

  /** Read-only detail drawer — dates, reason and the reviewer's note. */
  function openDetail(request, base, done) {
    if (!request) return;
    const modal = C.openModal(`Leave — ${staffName(request)}`, `
      <div class="leave-detail-grid">
        <div><b>Leave type</b>${typeSwatch(request.type_colour, request.type_name)} ${request.type_paid ? "(paid)" : "(unpaid)"}</div>
        <div><b>Status</b>${pill(request.status)}</div>
        <div><b>Dates</b>${C.esc(dateRange(request))}</div>
        <div><b>Working days</b>${C.esc(request.days)}</div>
        <div><b>Academic session</b>${C.esc(request.session_label || "—")}</div>
        <div><b>Applied</b>${C.fmtDate(request.created_at)}</div>
      </div>
      <div class="leave-detail-block"><b>Reason</b><p>${C.esc(request.reason || "No reason recorded.")}</p></div>
      ${request.reviewed_by_name || request.review_note ? `<div class="leave-detail-block"><b>Decision note</b><p>${C.esc(request.review_note || "—")}</p><small>${C.esc(request.reviewed_by_name || "")} · ${C.fmtDate(request.reviewed_at)}</small></div>` : ""}
      <div class="dash-actions" style="margin-top:16px">
        ${request.status === "pending" ? `<button id="lvEdit" class="dash-btn dash-btn-ghost">${C.I.edit} Edit request</button>` : ""}
        <button id="lvClose" class="dash-btn dash-btn-ghost">Close</button>
      </div>`);
    $("#lvClose", modal).addEventListener("click", C.closeModal);
    const edit = $("#lvEdit", modal);
    if (edit) edit.addEventListener("click", () => openRequestForm(base, done, request));
  }

  /** Approve / reject / cancel — one modal, optional note, matching the API. */
  function openDecision(request, action, done) {
    if (!request) return;
    const titles = { approve: "Approve leave", reject: "Reject leave", cancel: "Cancel leave" };
    const hints = {
      approve: "The staff member will be recorded as on leave in the teacher attendance register for every working day (Mon–Sat) covered, and their balance updated.",
      reject: "The request is closed and no attendance or balance is affected.",
      cancel: "The request is withdrawn. Any attendance rows created by this leave are removed and the balance restored.",
    };
    const modal = C.openModal(`${titles[action]} — ${staffName(request)}`, `
      <form id="leaveDecision">
        <div class="leave-detail-grid">
          <div><b>Leave type</b>${typeSwatch(request.type_colour, request.type_name)}</div>
          <div><b>Dates</b>${C.esc(dateRange(request))}</div>
          <div><b>Working days</b>${C.esc(request.days)}</div>
          <div><b>Current status</b>${pill(request.status)}</div>
        </div>
        ${request.reason ? `<div class="leave-detail-block"><b>Reason given</b><p>${C.esc(request.reason)}</p></div>` : ""}
        <div class="dash-field" style="margin-top:12px"><label>Note (optional)</label>
          <textarea name="note" rows="3" maxlength="2000" placeholder="Visible to the staff member on their record"></textarea></div>
        <p class="hint">${C.esc(hints[action])}</p>
        <div class="dash-actions" style="margin-top:14px">
          <button class="dash-btn ${action === "approve" ? "dash-btn-primary" : "dash-btn-ghost"}" type="submit">${titles[action]}</button>
        </div>
      </form>`);
    $("#leaveDecision", modal).addEventListener("submit", async (e) => {
      e.preventDefault();
      const restore = busy(e.submitter || $("button[type=submit]", e.currentTarget), "Saving…");
      try {
        const r = await window.API.patch(`/leave/${request.id}/${action}`, formObject(e.currentTarget));
        const extra = r.attendanceRows ? ` ${r.attendanceRows} attendance row(s) recorded.`
          : r.attendanceRowsRemoved ? ` ${r.attendanceRowsRemoved} attendance row(s) reversed.` : "";
        C.toast(`Leave ${r.status}.${extra}`, "success");
        C.closeModal();
        done();
      } catch (err) { restore(); C.toast(err.message || "Could not save this decision.", "error"); }
    });
  }

  /** Create or edit a pending request. Administrators may file on behalf of
      any staff member; a teacher only ever files for themselves. */
  function openRequestForm(base, done, request) {
    const editing = Boolean(request);
    const admin = isAdmin();
    const modal = C.openModal(editing ? `Edit leave request — ${staffName(request)}` : "New leave request", `
      <form id="leaveRequestForm">
        <div class="dash-form-grid">
          ${admin ? `<div class="dash-field"><label>Staff member *</label>
            <select name="user_id" required ${editing ? "disabled" : ""}>
              <option value="">Select staff member</option>${staffOptions(base.staff, editing && request.user_id)}
            </select></div>` : ""}
          <div class="dash-field"><label>Leave type *</label>
            <select name="type_id" required><option value="">Select type</option>${typeOptions(base.types, editing && request.type_id)}</select></div>
          <div class="dash-field"><label>Start date *</label><input type="date" name="start_date" required value="${C.esc(editing ? request.start_date : C.todayIso())}"></div>
          <div class="dash-field"><label>End date *</label><input type="date" name="end_date" required value="${C.esc(editing ? request.end_date : C.todayIso())}"></div>
        </div>
        <div class="dash-field" style="margin-top:12px"><label>Reason</label>
          <textarea name="reason" rows="3" maxlength="2000" placeholder="Why is the leave needed?">${C.esc(editing ? request.reason || "" : "")}</textarea></div>
        <p class="hint" id="lvDayCount">Only working days (Mon–Sat) are counted against the entitlement.</p>
        <button class="dash-btn dash-btn-primary" type="submit" style="margin-top:14px">${C.I.check} ${editing ? "Save changes" : "Submit request"}</button>
      </form>`);

    const form = $("#leaveRequestForm", modal);
    const start = $("[name=start_date]", form);
    const end = $("[name=end_date]", form);
    const count = () => {
      const days = workingDays(start.value, end.value);
      $("#lvDayCount", modal).textContent = days
        ? `${days} working day(s) (Mon–Sat) will be counted against the entitlement.`
        : "Only working days (Mon–Sat) are counted against the entitlement.";
    };
    start.addEventListener("change", () => { if (end.value < start.value) end.value = start.value; count(); });
    end.addEventListener("change", count);
    count();

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const restore = busy($("button[type=submit]", form), "Saving…");
      const body = formObject(form);
      if (editing && admin) delete body.user_id;
      try {
        if (editing) await window.API.patch(`/leave/${request.id}`, body);
        else await window.API.post("/leave", body);
        C.toast(editing ? "Leave request updated." : "Leave request submitted for approval.", "success");
        C.closeModal();
        done();
      } catch (err) { restore(); C.toast(err.message || "Could not save this request.", "error"); }
    });
  }

  /** Mirror of the server's working-day rule, for the live day counter only. */
  function workingDays(startIso, endIso) {
    const first = Date.parse(`${startIso}T00:00:00Z`);
    const last = Date.parse(`${endIso}T00:00:00Z`);
    if (!Number.isFinite(first) || !Number.isFinite(last) || last < first) return 0;
    let days = 0;
    for (let t = first; t <= last; t += 86400000) {
      if (new Date(t).getUTCDay() !== 0) days += 1; // Mon–Sat, matching the timetable
      if (days > 366) break;
    }
    return days;
  }

  /* ========================== LEAVE CALENDAR ============================ */

  async function calendarPage(content) {
    const now = new Date();
    const view = { month: now.getUTCMonth() + 1, year: now.getUTCFullYear(), typeId: "" };

    content.innerHTML = pageHead("Staff Leave", "Leave Calendar",
      "Every approved leave in the month, colour-coded by leave type. Sundays are not counted as leave days.",
      `<button id="lvPrevMonth" class="dash-btn dash-btn-ghost">Previous</button>
       <button id="lvToday" class="dash-btn dash-btn-ghost">This month</button>
       <button id="lvNextMonth" class="dash-btn dash-btn-ghost">Next</button>`) + `
      <div class="dash-card"><div class="dash-card-pad">
        <div class="leave-calendar-head">
          <h3 id="lvMonthLabel">—</h3>
          <div class="dash-field"><label>Leave type</label><select id="lvCalType"><option value="">All types</option></select></div>
        </div>
        <div id="lvLegend" class="dash-chip-list"></div>
        <div id="lvGrid" class="leave-calendar"></div>
        <div id="lvCalSummary" class="module-summary" style="margin-top:14px"></div>
      </div></div>`;

    const load = async () => {
      const grid = $("#lvGrid", content);
      grid.innerHTML = `<p class="hint">Loading calendar…</p>`;
      let data;
      try { data = await window.API.get(`/leave/calendar?${query(view)}`); }
      catch (e) { grid.innerHTML = `<p class="dash-error">${C.esc(e.message || "Could not load the calendar.")}</p>`; return; }

      $("#lvMonthLabel", content).textContent = `${MONTHS[data.month - 1]} ${data.year}`;
      const select = $("#lvCalType", content);
      if (select.options.length <= 1) {
        select.innerHTML = `<option value="">All types</option>${(data.types || []).map((t) => `<option value="${t.id}">${C.esc(t.name)}</option>`).join("")}`;
        select.value = view.typeId;
      }
      $("#lvLegend", content).innerHTML = (data.types || []).map((t) =>
        `<span class="dash-chip">${typeSwatch(t.colour, t.name)}</span>`).join("");

      const cells = [];
      for (let i = 0; i < data.first_weekday; i++) cells.push(`<div class="leave-day muted"></div>`);
      for (let day = 1; day <= data.days_in_month; day++) {
        const iso = `${data.year}-${String(data.month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        const entries = data.byDay[iso] || [];
        const weekday = new Date(Date.UTC(data.year, data.month - 1, day)).getUTCDay();
        cells.push(`
          <div class="leave-day${weekday === 0 ? " rest" : ""}${entries.length ? " has-leave" : ""}">
            <span class="leave-day-num">${day}</span>
            ${entries.slice(0, 4).map((e) => `<span class="leave-entry" style="border-left-color:${C.esc(e.type_colour || "#5f5b6b")}" title="${C.esc(e.teacher_name)} — ${C.esc(e.type_name)}">${C.esc(e.teacher_name)}</span>`).join("")}
            ${entries.length > 4 ? `<span class="leave-more">+${entries.length - 4} more</span>` : ""}
          </div>`);
      }
      grid.innerHTML = `<div class="leave-weekdays">${WEEKDAYS.map((d) => `<span>${d}</span>`).join("")}</div><div class="leave-grid">${cells.join("")}</div>`;
      $("#lvCalSummary", content).innerHTML = `<strong>${data.summary.leaves}</strong> approved leave(s) · <strong>${data.summary.staff}</strong> staff member(s) away this month`;
    };

    const shift = (delta) => {
      let m = view.month + delta;
      if (m < 1) { m = 12; view.year -= 1; } else if (m > 12) { m = 1; view.year += 1; }
      view.month = m;
      load();
    };
    $("#lvPrevMonth", content).addEventListener("click", () => shift(-1));
    $("#lvNextMonth", content).addEventListener("click", () => shift(1));
    $("#lvToday", content).addEventListener("click", () => { view.month = now.getUTCMonth() + 1; view.year = now.getUTCFullYear(); load(); });
    $("#lvCalType", content).addEventListener("change", (e) => { view.typeId = e.target.value; load(); });
    await load();
  }

  /* ========================== LEAVE BALANCES ============================ */

  async function balancesPage(content) {
    let sessions = [];
    try { sessions = (await window.API.get("/sessions")).sessions || []; } catch (e) { sessions = []; }

    content.innerHTML = pageHead("Staff Leave", "Leave Balances",
      "Entitlement minus days taken in the selected academic session, for every staff member and leave type.",
      "") + `
      <div class="dash-card"><div class="dash-card-pad">
        <div class="leave-toolbar compact">
          <div class="dash-field"><label>Academic session</label><select id="lvBalSession"><option value="">Current session</option>${C.options(sessions, null, (s) => s.label)}</select></div>
          <div class="dash-field search-wide"><label>Search staff</label><input id="lvBalSearch" type="search" placeholder="Staff name"></div>
        </div>
      </div></div>
      <div class="dash-stats-grid" id="lvBalStats" style="margin-top:18px"></div>
      <div class="dash-card" style="margin-top:18px">
        <div class="dash-table-wrap"><table class="dash-table" id="lvBalTable">
          <tbody><tr class="dash-empty-row"><td>Loading balances…</td></tr></tbody>
        </table></div>
      </div>`;

    const load = async () => {
      const table = $("#lvBalTable", content);
      let data;
      try { data = await window.API.get(`/leave/balances?${query({ sessionId: $("#lvBalSession", content).value })}`); }
      catch (e) { table.innerHTML = `<tbody>${C.emptyRow(1, e.message || "Could not load balances.")}</tbody>`; return; }

      const types = data.types || [];
      const search = $("#lvBalSearch", content).value.trim().toLowerCase();
      // Pivot the per-type rows into one row per staff member.
      const people = new Map();
      for (const row of data.balances || []) {
        if (!people.has(row.user_id)) people.set(row.user_id, { name: staffName(row), staff_id: row.staff_id || "", cells: {} });
        people.get(row.user_id).cells[row.type_id] = row;
      }
      const rows = [...people.values()].filter((p) => !search || p.name.toLowerCase().includes(search));
      const t = data.totals || { entitlement: 0, taken: 0, remaining: 0, pending: 0 };
      $("#lvBalStats", content).innerHTML =
        C.statCard("users", people.size, "Staff with balances") +
        C.statCard("calendar", t.entitlement, "Total entitlement (days)") +
        C.statCard("check", t.taken, "Days taken", true) +
        C.statCard("clock", t.pending, "Days awaiting approval");

      table.innerHTML = `
        <thead><tr><th>Staff member</th>${types.map((ty) => `<th>${typeSwatch(ty.colour, ty.name)}<small>${ty.days_per_year} days/year</small></th>`).join("")}<th>Total left</th></tr></thead>
        <tbody>${rows.length ? rows.map((p) => {
          const left = types.reduce((a, ty) => a + Number((p.cells[ty.id] || {}).remaining || 0), 0);
          return `<tr>
            <td><strong>${C.esc(p.name)}</strong>${p.staff_id ? `<small>${C.esc(p.staff_id)}</small>` : ""}</td>
            ${types.map((ty) => {
              const cell = p.cells[ty.id];
              if (!cell) return `<td class="leave-balance-cell">—</td>`;
              const tone = cell.remaining <= 0 ? "danger" : cell.remaining <= 2 ? "warn" : "ok";
              return `<td class="leave-balance-cell">
                <span class="dash-pill ${tone}">${cell.remaining} left</span>
                <small>${cell.taken} taken of ${cell.entitlement}${cell.pending ? ` · ${cell.pending} pending` : ""}</small></td>`;
            }).join("")}
            <td><strong>${left}</strong></td>
          </tr>`;
        }).join("") : C.emptyRow(types.length + 2, data.session ? "No staff balances yet for this session." : "Create an academic session to track leave balances.")}</tbody>`;
    };

    $("#lvBalSession", content).addEventListener("change", load);
    let timer;
    $("#lvBalSearch", content).addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(load, 250); });
    await load();
  }

  /* ============================ LEAVE TYPES ============================= */

  async function typesPage(content) {
    const admin = isAdmin();
    let types;
    try { types = (await window.API.get("/leave/types?includeArchived=1")).types || []; }
    catch (e) { content.innerHTML = loadError(e); return; }

    content.innerHTML = pageHead("Staff Leave", "Leave Types",
      "The leave catalogue for this institution. Days per year is the default entitlement every staff member receives each academic session.",
      admin ? `<button id="lvAddType" class="dash-btn dash-btn-primary">${C.I.plus} Add Leave Type</button>` : "") + `
      <div class="dash-card">
        <div class="dash-table-wrap"><table class="dash-table">
          <thead><tr><th>Leave type</th><th>Days / year</th><th>Paid</th><th>Status</th><th>Description</th>${admin ? "<th></th>" : ""}</tr></thead>
          <tbody>${types.length ? types.map((t) => `
            <tr>
              <td><strong>${typeSwatch(t.colour, t.name)}</strong>${t.name_ar ? `<small dir="rtl">${C.esc(t.name_ar)}</small>` : ""}</td>
              <td>${C.esc(t.days_per_year)}</td>
              <td>${t.paid ? `<span class="dash-pill ok">Paid</span>` : `<span class="dash-pill muted">Unpaid</span>`}</td>
              <td>${pill(t.status, t.status === "active" ? "ok" : t.status === "archived" ? "muted" : "warn")}</td>
              <td><small>${C.esc(t.description || "—")}</small></td>
              ${admin ? `<td><div class="leave-row-actions">
                <button class="dash-btn dash-btn-ghost dash-btn-sm" data-edit-type="${t.id}">${C.I.edit}</button>
                <button class="dash-btn dash-btn-danger dash-btn-sm" data-delete-type="${t.id}">${C.I.trash}</button>
              </div></td>` : ""}
            </tr>`).join("") : C.emptyRow(admin ? 6 : 5, "No leave types yet.")}</tbody>
        </table></div>
      </div>
      <div class="dash-card" style="margin-top:18px"><div class="dash-card-pad">
        <h3>How entitlements are applied</h3>
        <p class="hint">Each staff member starts every academic session with the days-per-year figure above. Approved leave is deducted automatically and written into the teacher attendance register as <strong>on leave</strong> for each working day (Mon–Sat). A type that already has requests is archived rather than deleted, so historical records stay intact.</p>
      </div></div>`;

    if (!admin) return;
    const reload = () => typesPage(content);
    $("#lvAddType", content).addEventListener("click", () => openTypeForm(null, reload));
    $$("[data-edit-type]", content).forEach((b) => b.addEventListener("click", () =>
      openTypeForm(types.find((t) => Number(t.id) === Number(b.dataset.editType)), reload)));
    $$("[data-delete-type]", content).forEach((b) => b.addEventListener("click", async () => {
      if (!window.confirm("Remove this leave type? If staff have already used it, it is archived instead of deleted.")) return;
      try {
        const r = await window.API.del(`/leave/types/${b.dataset.deleteType}`);
        C.toast(r.archived ? "Leave type archived (existing records kept)." : "Leave type deleted.", "success");
        reload();
      } catch (e) { C.toast(e.message || "Could not remove this leave type.", "error"); }
    }));
  }

  function openTypeForm(type, done) {
    const editing = Boolean(type);
    const modal = C.openModal(editing ? `Edit ${type.name}` : "Add leave type", `
      <form id="leaveTypeForm">
        <div class="dash-form-grid">
          <div class="dash-field"><label>Name *</label><input name="name" required maxlength="80" value="${C.esc(editing ? type.name : "")}"></div>
          <div class="dash-field"><label>Name (Arabic)</label><input name="name_ar" dir="rtl" maxlength="80" value="${C.esc(editing ? type.name_ar || "" : "")}"></div>
          <div class="dash-field"><label>Days per year *</label><input name="days_per_year" type="number" min="0" max="366" required value="${C.esc(editing ? type.days_per_year : 0)}"></div>
          <div class="dash-field"><label>Colour</label><input name="colour" type="color" value="${C.esc((editing && type.colour) || "#2d6f8f")}"></div>
          <div class="dash-field"><label>Status</label><select name="status">
            ${["active", "inactive", "archived"].map((s) => `<option value="${s}" ${editing && type.status === s ? "selected" : ""}>${statusLabel(s)}</option>`).join("")}
          </select></div>
          <div class="dash-field"><label>Paid leave</label><select name="paid">
            <option value="1" ${!editing || type.paid ? "selected" : ""}>Paid</option>
            <option value="0" ${editing && !type.paid ? "selected" : ""}>Unpaid</option>
          </select></div>
        </div>
        <div class="dash-field" style="margin-top:12px"><label>Description</label>
          <textarea name="description" rows="2" maxlength="500">${C.esc(editing ? type.description || "" : "")}</textarea></div>
        <button class="dash-btn dash-btn-primary" type="submit" style="margin-top:14px">${C.I.check} ${editing ? "Save changes" : "Add leave type"}</button>
      </form>`);
    $("#leaveTypeForm", modal).addEventListener("submit", async (e) => {
      e.preventDefault();
      const restore = busy($("button[type=submit]", e.currentTarget), "Saving…");
      try {
        const body = formObject(e.currentTarget);
        if (editing) await window.API.patch(`/leave/types/${type.id}`, body);
        else await window.API.post("/leave/types", body);
        C.toast(editing ? "Leave type updated." : "Leave type added.", "success");
        C.closeModal();
        done();
      } catch (err) { restore(); C.toast(err.message || "Could not save this leave type.", "error"); }
    });
  }

  /* ======================= MY LEAVE (self-service) ====================== */

  /** Staff self-service: own balances, own history and the request form.
      This is the screen a teacher portal / teacher dashboard renders — it
      reads the same GET /api/leave/me the server already exposes. */
  async function myLeavePage(content) {
    let data;
    try { data = await window.API.get("/leave/me"); }
    catch (e) { content.innerHTML = loadError(e); return; }

    const base = { types: data.types || [], staff: [] };
    const reload = () => myLeavePage(content);

    if (!data.staff) {
      content.innerHTML = pageHead("Staff Leave", "My Leave",
        "Self-service leave for teaching staff.", "") + `
        <div class="dash-card"><div class="dash-card-pad">
          <h3>Administrator account</h3>
          <p class="hint">This account is an administrator, not a member of teaching staff, so it has no leave entitlement of its own. Use <strong>Leave Requests</strong> to file leave on behalf of a staff member, and <strong>Leave Balances</strong> to see what everyone has left.</p>
          <div class="dash-actions" style="margin-top:12px">
            <button class="dash-btn dash-btn-primary" data-nav-route="hr/requests">Open leave requests</button>
            <button class="dash-btn dash-btn-ghost" data-nav-route="hr/balances">Open leave balances</button>
          </div>
        </div></div>`;
      C.bindRouteButtons(content);
      return;
    }

    const balances = data.balances || [];
    const requests = data.requests || [];
    content.innerHTML = pageHead("Staff Leave", "My Leave",
      `Your entitlement and applications${data.session ? ` for ${data.session.label}` : ""}.`,
      `<button id="lvApply" class="dash-btn dash-btn-primary">${C.I.plus} Request Leave</button>`) + `
      <div class="leave-balance-cards">
        ${balances.length ? balances.map((b) => `
          <div class="dash-card leave-balance-card" style="border-top:3px solid ${C.esc(b.type_colour || "#5f5b6b")}">
            <div class="dash-card-pad">
              <small>${C.esc(b.type_name)}${b.type_paid ? "" : " · unpaid"}</small>
              <p class="leave-balance-value">${C.esc(b.remaining)}<em>of ${C.esc(b.entitlement)} days left</em></p>
              <div class="leave-balance-bar"><span style="width:${b.entitlement ? Math.min(100, Math.round((b.taken / b.entitlement) * 100)) : 0}%;background:${C.esc(b.type_colour || "#5f5b6b")}"></span></div>
              <small>${C.esc(b.taken)} taken${b.pending ? ` · ${C.esc(b.pending)} awaiting approval` : ""}</small>
            </div>
          </div>`).join("") : `<div class="dash-card"><div class="dash-card-pad"><p class="hint">No leave entitlement has been set up for the current session yet.</p></div></div>`}
      </div>
      <div class="dash-card" style="margin-top:18px">
        <div class="dash-card-head"><h3>My applications</h3></div>
        <div class="dash-table-wrap"><table class="dash-table">
          <thead><tr><th>Leave type</th><th>Dates</th><th>Days</th><th>Status</th><th>Decision note</th><th></th></tr></thead>
          <tbody>${requests.length ? requests.map((r) => `
            <tr>
              <td>${typeSwatch(r.type_colour, r.type_name)}</td>
              <td>${C.esc(dateRange(r))}</td>
              <td>${C.esc(r.days)}</td>
              <td>${pill(r.status)}</td>
              <td><small>${C.esc(r.review_note || "—")}</small></td>
              <td>${["pending", "approved"].includes(r.status) ? `<button class="dash-btn dash-btn-ghost dash-btn-sm" data-my-cancel="${r.id}">Cancel</button>` : ""}</td>
            </tr>`).join("") : C.emptyRow(6, "You have not applied for any leave yet.")}</tbody>
        </table></div>
      </div>`;

    $("#lvApply", content).addEventListener("click", () => openRequestForm(base, reload, null));
    $$("[data-my-cancel]", content).forEach((b) => b.addEventListener("click", () =>
      openDecision(requests.find((r) => Number(r.id) === Number(b.dataset.myCancel)), "cancel", reload)));
  }

  /* ============================== ROUTER =============================== */

  async function render(context, content, route) {
    C = context;
    if (route === "hr/requests") return requestsPage(content);
    if (route === "hr/calendar") return calendarPage(content);
    if (route === "hr/balances") return balancesPage(content);
    if (route === "hr/types") return typesPage(content);
    if (route === "hr/my-leave") return myLeavePage(content);
  }

  window.BelloLeave = { handles: (route) => ROUTES.has(route), render };
})();
