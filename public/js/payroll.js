"use strict";
/* ============================================================================
   EduSphere — Payroll workspace (admin)
   ----------------------------------------------------------------------------
   Self-contained module for the Payroll sidebar section: salary structures,
   pay periods, payslips and salary advances. It renders into the dashboard's
   unchanged shell and design system (dashboard.js owns the sidebar, modals
   and helpers handed over through the context object) — the same pattern as
   the Academic & Admissions workspace. Both institution categories share
   these screens; only copy varies through the category terms (T()).
   All money is naira (₦). Charts are inline SVG only — CSP-safe.
   ========================================================================== */
(function () {
  const ROUTES = new Set(["payroll/structures", "payroll/periods", "payroll/payslips", "payroll/advances"]);
  let C;
  const $ = (selector, scope) => (scope || document).querySelector(selector);
  const $$ = (selector, scope) => [...(scope || document).querySelectorAll(selector)];
  const formObject = (form) => Object.fromEntries(new FormData(form));
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const statusLabel = (value) => String(value || "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const pill = (status, tone) => `<span class="dash-pill ${tone || C.pillFor(status)}">${C.esc(statusLabel(status))}</span>`;

  function pageHead(crumb, title, description, actions) {
    return `<div class="dash-page-head"><div><div class="dash-crumb">${C.esc(crumb)}</div><h2>${C.esc(title)}</h2><p>${C.esc(description)}</p></div>${actions ? `<div class="dash-actions">${actions}</div>` : ""}</div>`;
  }
  function empty(message) {
    return `<div class="dash-coming-soon"><div class="icon">${C.I.file}</div><h3>No records yet</h3><p>${C.esc(message)}</p></div>`;
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
  function money(value) { return C.fmtMoney(value); }
  function monthLabel(month) { return MONTHS[Number(month) - 1] || String(month); }
  function periodName(period) { return `${monthLabel(period.month)} ${period.year}`; }
  function teacherName(t) { return t.full_name || t.full_name_ar || t.username || `Teacher #${t.user_id}`; }
  function teacherOptions(teachers, selected) {
    return C.options(teachers || [], selected, (t) => `${t.full_name || t.username}${t.staff_id ? ` (${t.staff_id})` : ""}`);
  }
  /** Active teachers of this institution (users with the teacher role). */
  async function loadTeachers() {
    try {
      const data = await window.API.get("/teachers?status=active&perPage=200");
      return (data.teachers || []).map((t) => ({ id: t.id, user_id: t.user_id || t.id, full_name: t.full_name || t.username, staff_id: t.staff_id || "" }));
    } catch (e) { return []; }
  }

  /* ======================== SALARY STRUCTURES ========================== */

  async function structuresPage(content) {
    let data;
    try { data = await window.API.get("/payroll/structures"); } catch (e) { content.innerHTML = loadError(e); return; }
    const structures = data.structures || [];
    const monthlyGross = structures.reduce((a, s) => a + Number(s.base_ngn || 0) + Number(s.allowance_total || 0), 0);
    content.innerHTML = pageHead("Payroll", "Salary Structures",
      `Set each teacher's grade, basic salary, allowances and statutory deductions. A raise is a new structure with a later effective date.`,
      `<button id="addStructure" class="dash-btn dash-btn-primary">${C.I.plus} Add Structure</button>`) + `
      <div class="dash-stats-grid">
        ${C.statCard("payroll", structures.length, "Structures")}
        ${C.statCard("money", money(monthlyGross), "Monthly Gross (all staff)", true)}
      </div>
      <div class="dash-card" style="margin-top:18px">
        <div class="dash-table-wrap"><table class="dash-table">
          <thead><tr><th>Teacher</th><th>Grade</th><th>Basic</th><th>Allowances</th><th>Deductions</th><th>Monthly Gross</th><th>Effective</th><th></th></tr></thead>
          <tbody>
            ${structures.length ? structures.map((s) => `
              <tr>
                <td><strong>${C.esc(teacherName(s))}</strong><small>${C.esc(s.username || "")}${Number(s.is_active) === 1 ? "" : " · inactive"}</small></td>
                <td>${C.esc(s.grade || "—")}</td>
                <td>${money(s.base_ngn)}</td>
                <td><small>Housing ${money(s.allowances && s.allowances.housing)} · Transport ${money(s.allowances && s.allowances.transport)} · Medical ${money(s.allowances && s.allowances.medical)}${s.allowances && Number(s.allowances.other) ? ` · Other ${money(s.allowances.other)}` : ""}</small></td>
                <td><small>Tax ${money(s.deductions && s.deductions.tax)} · Pension ${money(s.deductions && s.deductions.pension)}${s.deductions && Number(s.deductions.other) ? ` · Other ${money(s.deductions.other)}` : ""}</small></td>
                <td><strong>${money(Number(s.base_ngn || 0) + Number(s.allowance_total || 0))}</strong></td>
                <td>${C.fmtDate(s.effective_from)}</td>
                <td><div class="dash-table-actions">
                  <button class="dash-btn dash-btn-ghost dash-btn-sm" data-edit-structure="${s.id}">${C.I.edit}</button>
                  <button class="dash-btn dash-btn-danger dash-btn-sm" data-delete-structure="${s.id}">${C.I.trash}</button>
                </div></td>
              </tr>`).join("") : C.emptyRow(8, "No salary structures yet. Add the first teacher structure to enable payroll.")}
          </tbody>
        </table></div>
      </div>
      <div class="dash-card" style="margin-top:18px"><div class="dash-card-pad">
        <h3>How payroll uses these figures</h3>
        <p class="hint">Gross = basic + housing + transport + medical + other allowances. Deductions = tax + pension + other, plus any outstanding salary advance instalment. Processing a pay period computes one payslip per salaried teacher automatically.</p>
      </div></div>`;

    const reload = () => structuresPage(content);
    $("#addStructure", content).addEventListener("click", async () => openStructureForm(null, await loadTeachers(), reload));
    $$("[data-edit-structure]", content).forEach((button) => button.addEventListener("click", async () => {
      const structure = structures.find((s) => Number(s.id) === Number(button.dataset.editStructure));
      openStructureForm(structure, await loadTeachers(), reload);
    }));
    $$("[data-delete-structure]", content).forEach((button) => button.addEventListener("click", async () => {
      if (!window.confirm("Delete this salary structure? Computed payslips keep their recorded amounts.")) return;
      try {
        await window.API.del(`/payroll/structures/${button.dataset.deleteStructure}`);
        C.toast("Salary structure deleted.", "success");
        reload();
      } catch (e) { C.toast(e.message || "Could not delete structure.", "error"); }
    }));
  }

  function openStructureForm(structure, teachers, done) {
    const editing = Boolean(structure);
    const a = (editing && structure.allowances) || {};
    const d = (editing && structure.deductions) || {};
    const modal = C.openModal(editing ? `Edit structure — ${teacherName(structure)}` : "Add salary structure", `
      <form id="structureForm">
        <div class="dash-form-grid">
          <div class="dash-field"><label>Teacher *</label>
            <select name="user_id" required ${editing ? "disabled" : ""}>
              <option value="">Select teacher</option>${teacherOptions(teachers, editing && structure.user_id)}
            </select></div>
          <div class="dash-field"><label>Grade</label><input name="grade" placeholder="e.g. Senior Teacher / Level 8" value="${C.esc(structure && structure.grade)}"></div>
          <div class="dash-field"><label>Basic salary (₦) *</label><input name="base_ngn" type="number" min="0" step="0.01" required value="${C.esc(structure && structure.base_ngn || 0)}"></div>
          <div class="dash-field"><label>Effective from *</label><input name="effective_from" type="date" required value="${C.esc((structure && structure.effective_from) || C.todayIso())}"></div>
        </div>
        <h4 style="margin:16px 0 8px;font-size:.85rem;">Allowances (₦ per month)</h4>
        <div class="dash-form-grid">
          <div class="dash-field"><label>Housing</label><input name="housing" type="number" min="0" step="0.01" value="${C.esc(a.housing || 0)}"></div>
          <div class="dash-field"><label>Transport</label><input name="transport" type="number" min="0" step="0.01" value="${C.esc(a.transport || 0)}"></div>
          <div class="dash-field"><label>Medical</label><input name="medical" type="number" min="0" step="0.01" value="${C.esc(a.medical || 0)}"></div>
          <div class="dash-field"><label>Other</label><input name="other_allowance" type="number" min="0" step="0.01" value="${C.esc(a.other || 0)}"></div>
        </div>
        <h4 style="margin:16px 0 8px;font-size:.85rem;">Deductions (₦ per month)</h4>
        <div class="dash-form-grid">
          <div class="dash-field"><label>Tax</label><input name="tax" type="number" min="0" step="0.01" value="${C.esc(d.tax || 0)}"></div>
          <div class="dash-field"><label>Pension</label><input name="pension" type="number" min="0" step="0.01" value="${C.esc(d.pension || 0)}"></div>
          <div class="dash-field"><label>Other</label><input name="other_deduction" type="number" min="0" step="0.01" value="${C.esc(d.other || 0)}"></div>
        </div>
        <p class="hint" style="margin-top:12px">Loan repayments are added automatically from the Advances ledger — do not include them here.</p>
        <div class="dash-actions" style="margin-top:14px">
          <button class="dash-btn dash-btn-primary" type="submit">${C.I.check} Save structure</button>
        </div>
      </form>`);
    $("#structureForm", modal).addEventListener("submit", async (e) => {
      e.preventDefault();
      const body = formObject(e.currentTarget);
      const payload = {
        user_id: editing ? structure.user_id : body.user_id,
        grade: body.grade,
        base_ngn: body.base_ngn,
        effective_from: body.effective_from,
        allowances: { housing: body.housing, transport: body.transport, medical: body.medical, other: body.other_allowance },
        deductions: { tax: body.tax, pension: body.pension, other: body.other_deduction },
      };
      try {
        if (editing) await window.API.patch(`/payroll/structures/${structure.id}`, payload);
        else await window.API.post("/payroll/structures", payload);
        C.toast("Salary structure saved.", "success");
        C.closeModal();
        done();
      } catch (err) { C.toast(err.message || "Could not save structure.", "error"); }
    });
  }

  /* =========================== PAY PERIODS ============================= */

  async function periodsPage(content) {
    const t = C.T();
    let data, base;
    try {
      [data, base] = await Promise.all([window.API.get("/payroll/periods"), C.catalogue()]);
    } catch (e) { content.innerHTML = loadError(e); return; }
    const periods = data.periods || [];
    const sessions = base.sessions || [];
    const statusTone = { draft: "warn", processed: "info", paid: "ok" };
    const currentYear = new Date().getFullYear();

    content.innerHTML = pageHead("Payroll", "Pay Periods",
      "Open a calendar month inside an academic session, process every payslip in one action, then mark the period paid.",
      `<button id="addPeriod" class="dash-btn dash-btn-primary">${C.I.plus} Add Period</button>`) + `
      <div class="dash-card"><div class="dash-table-wrap"><table class="dash-table">
        <thead><tr><th>Period</th><th>Session</th><th>Status</th><th>Payslips</th><th>Total Gross</th><th>Total Net</th><th></th></tr></thead>
        <tbody>
          ${periods.length ? periods.map((p) => `
            <tr>
              <td><strong>${C.esc(periodName(p))}</strong></td>
              <td>${C.esc(p.session_label || "—")}</td>
              <td>${pill(p.status, statusTone[p.status] || "info")}</td>
              <td>${Number(p.slip_count || 0)}</td>
              <td>${money(p.total_gross)}</td>
              <td><strong>${money(p.total_net)}</strong></td>
              <td><div class="dash-table-actions">
                <button class="dash-btn dash-btn-ghost dash-btn-sm" data-view-period="${p.id}" title="View payslips">${C.I.external}</button>
                ${p.status !== "paid" ? `<button class="dash-btn dash-btn-primary dash-btn-sm" data-process-period="${p.id}">${C.I.refresh} ${p.status === "draft" ? "Process" : "Reprocess"}</button>` : ""}
                ${p.status === "processed" ? `<button class="dash-btn dash-btn-accent dash-btn-sm" data-pay-period="${p.id}">${C.I.check} Mark Paid</button>` : ""}
                ${Number(p.slip_count || 0) > 0 ? `<a class="dash-btn dash-btn-ghost dash-btn-sm" href="${window.API.url(`/payroll/periods/${p.id}/export.csv`)}" target="_blank" rel="noopener">${C.I.download}</a>` : ""}
                ${p.status === "draft" && !Number(p.slip_count || 0) ? `<button class="dash-btn dash-btn-danger dash-btn-sm" data-delete-period="${p.id}">${C.I.trash}</button>` : ""}
              </div></td>
            </tr>`).join("") : C.emptyRow(7, "No pay periods yet. Add the month you want to pay, then process it.")}
        </tbody>
      </table></div></div>
      <div class="dash-card" style="margin-top:18px"><div class="dash-card-pad">
        <h3>Status flow</h3>
        <p class="hint">Draft → Processed → Paid. Processing (re)computes one payslip per salaried teacher and applies salary advance instalments; marking paid stamps the pay date and locks the period.</p>
      </div></div>`;

    const reload = () => periodsPage(content);
    $("#addPeriod", content).addEventListener("click", () => openPeriodForm(sessions, reload));
    $$("[data-view-period]", content).forEach((button) => button.addEventListener("click", () => {
      C.state.cache.payrollPeriodId = Number(button.dataset.viewPeriod);
      C.go("payroll/payslips");
    }));
    $$("[data-process-period]", content).forEach((button) => button.addEventListener("click", async () => {
      const restore = busy(button, "Processing…");
      try {
        const r = await window.API.post(`/payroll/periods/${button.dataset.processPeriod}/process`);
        C.toast(`Processed ${r.created || 0} payslip(s) — net ${C.fmtMoney(r.totalNet || 0)}.`, "success");
        reload();
      } catch (e) { C.toast(e.message || "Could not process period.", "error"); restore(); }
    }));
    $$("[data-pay-period]", content).forEach((button) => button.addEventListener("click", async () => {
      if (!window.confirm("Mark this period paid? Payslips will be stamped with today's date and locked.")) return;
      const restore = busy(button, "Marking…");
      try {
        const r = await window.API.post(`/payroll/periods/${button.dataset.payPeriod}/pay`);
        C.toast(`Period marked paid — ${r.paid || 0} payslip(s).`, "success");
        reload();
      } catch (e) { C.toast(e.message || "Could not mark period paid.", "error"); restore(); }
    }));
    $$("[data-delete-period]", content).forEach((button) => button.addEventListener("click", async () => {
      if (!window.confirm("Delete this draft pay period?")) return;
      try {
        await window.API.del(`/payroll/periods/${button.dataset.deletePeriod}`);
        C.toast("Pay period deleted.", "success");
        reload();
      } catch (e) { C.toast(e.message || "Could not delete period.", "error"); }
    }));
  }

  function openPeriodForm(sessions, done) {
    const now = new Date();
    const modal = C.openModal("Add pay period", `
      <form id="periodForm">
        <div class="dash-form-grid">
          <div class="dash-field"><label>Academic session *</label>
            <select name="session_id" required><option value="">Select session</option>${C.options(sessions, null, (s) => s.label)}</select></div>
          <div class="dash-field"><label>Month *</label>
            <select name="month" required>${MONTHS.map((m, i) => `<option value="${i + 1}" ${now.getMonth() + 1 === i + 1 ? "selected" : ""}>${m}</option>`).join("")}</select></div>
          <div class="dash-field"><label>Year *</label><input name="year" type="number" min="1990" max="2200" required value="${now.getFullYear()}"></div>
        </div>
        <button class="dash-btn dash-btn-primary" type="submit" style="margin-top:14px">${C.I.check} Create period</button>
      </form>`);
    $("#periodForm", modal).addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        await window.API.post("/payroll/periods", formObject(e.currentTarget));
        C.toast("Pay period created.", "success");
        C.closeModal();
        done();
      } catch (err) { C.toast(err.message || "Could not create period.", "error"); }
    });
  }

  /* ============================= PAYSLIPS ============================== */

  async function payslipsPage(content) {
    let periods, teachers;
    try {
      [periods, teachers] = await Promise.all([
        window.API.get("/payroll/periods").then((d) => d.periods || []),
        loadTeachers(),
      ]);
    } catch (e) { content.innerHTML = loadError(e); return; }
    const selectedPeriod = C.state.cache.payrollPeriodId || (periods[0] && periods[0].id) || "";
    const selectedTeacher = C.state.cache.payrollTeacherId || "";
    const selectedStatus = C.state.cache.payrollPayslipStatus || "";

    content.innerHTML = pageHead("Payroll", "Payslips",
      "Computed salary slips per teacher per period. Filter, print or remove them before the period is paid.") + `
      <div class="dash-card"><div class="dash-card-pad"><div class="dash-form-grid">
        <div class="dash-field"><label>Pay period</label>
          <select id="slipPeriod"><option value="">All periods</option>${C.options(periods, selectedPeriod, (p) => periodName(p))}</select></div>
        <div class="dash-field"><label>Teacher</label>
          <select id="slipTeacher"><option value="">All teachers</option>${teacherOptions(teachers, selectedTeacher)}</select></div>
        <div class="dash-field"><label>Status</label>
          <select id="slipStatus"><option value="">All</option><option value="unpaid" ${selectedStatus === "unpaid" ? "selected" : ""}>Pending</option><option value="paid" ${selectedStatus === "paid" ? "selected" : ""}>Paid</option></select></div>
        <div class="dash-field" style="align-self:end"><button id="slipRefresh" class="dash-btn dash-btn-ghost">${C.I.refresh} Refresh</button></div>
      </div></div></div>
      <div id="slipSummary" style="margin:18px 0;"></div>
      <div class="dash-card"><div class="dash-table-wrap"><table class="dash-table">
        <thead><tr><th>Teacher</th><th>Period</th><th>Session</th><th>Gross</th><th>Deductions</th><th>Net Pay</th><th>Status</th><th></th></tr></thead>
        <tbody id="slipRows">${C.emptyRow(8, "Choose a period and refresh.")}</tbody>
      </table></div></div>`;

    const load = async () => {
      const periodId = $("#slipPeriod", content).value;
      const userId = $("#slipTeacher", content).value;
      const status = $("#slipStatus", content).value;
      C.state.cache.payrollPeriodId = periodId ? Number(periodId) : "";
      C.state.cache.payrollTeacherId = userId ? Number(userId) : "";
      C.state.cache.payrollPayslipStatus = status;
      const params = new URLSearchParams();
      if (periodId) params.set("periodId", periodId);
      if (userId) params.set("userId", userId);
      if (status) params.set("status", status);
      const suffix = params.toString() ? `?${params}` : "";
      let data;
      try { data = await window.API.get(`/payroll/payslips${suffix}`); }
      catch (e) { $("#slipRows", content).innerHTML = C.emptyRow(8, e.message || "Could not load payslips."); return; }
      const slips = data.payslips || [];
      const summary = data.summary || {};
      $("#slipSummary", content).innerHTML = `
        <div class="dash-stats-grid">
          ${C.statCard("file", summary.count || 0, "Payslips")}
          ${C.statCard("money", money(summary.totalGross), "Total Gross")}
          ${C.statCard("close", money(summary.totalDeductions), "Total Deductions", true)}
          ${C.statCard("check", money(summary.totalNet), "Total Net Pay", true)}
        </div>`;
      $("#slipRows", content).innerHTML = slips.length ? slips.map((s) => `
        <tr>
          <td><strong>${C.esc(teacherName(s))}</strong><small>${C.esc(s.username || "")}</small></td>
          <td>${C.esc(s.period_label)}</td>
          <td>${C.esc(s.session_label || "—")}</td>
          <td>${money(s.gross)}</td>
          <td><small>${money(s.deductions && s.deductions.total)}${s.deductions && Number(s.deductions.advance_total) ? ` (incl. ${money(s.deductions.advance_total)} advance)` : ""}</small></td>
          <td><strong>${money(s.net)}</strong></td>
          <td>${s.paid_at ? pill("paid") : pill("pending")}</td>
          <td><div class="dash-table-actions">
            <button class="dash-btn dash-btn-ghost dash-btn-sm" data-print-slip="${s.id}" title="Print payslip">${C.I.external}</button>
            ${s.paid_at ? "" : `<button class="dash-btn dash-btn-danger dash-btn-sm" data-delete-slip="${s.id}" title="Delete payslip">${C.I.trash}</button>`}
          </div></td>
        </tr>`).join("") : C.emptyRow(8, "No payslips match these filters. Process a pay period first.");
      $$("[data-print-slip]", content).forEach((button) => button.addEventListener("click", () => {
        window.open(window.API.url(`/payroll/payslips/${button.dataset.printSlip}/print`), "_blank", "noopener");
      }));
      $$("[data-delete-slip]", content).forEach((button) => button.addEventListener("click", async () => {
        if (!window.confirm("Delete this payslip? Any advance instalment it applied will be restored.")) return;
        try {
          await window.API.del(`/payroll/payslips/${button.dataset.deleteSlip}`);
          C.toast("Payslip deleted.", "success");
          load();
        } catch (e) { C.toast(e.message || "Could not delete payslip.", "error"); }
      }));
    };
    ["#slipPeriod", "#slipTeacher", "#slipStatus"].forEach((selector) => $(selector, content).addEventListener("change", load));
    $("#slipRefresh", content).addEventListener("click", load);
    await load();
  }

  /* ============================= ADVANCES ============================== */

  async function advancesPage(content) {
    const t = C.T();
    let data;
    try { data = await window.API.get("/payroll/advances"); } catch (e) { content.innerHTML = loadError(e); return; }
    const advances = data.advances || [];
    const summary = data.summary || {};

    content.innerHTML = pageHead("Payroll", "Advances & Loans",
      "Issue salary advances and track repayment. Instalments are deducted automatically from each processed pay period until the balance clears.",
      `<button id="addAdvance" class="dash-btn dash-btn-primary">${C.I.plus} Issue Advance</button>`) + `
      <div class="dash-stats-grid">
        ${C.statCard("payroll", summary.count || 0, "Advances Issued")}
        ${C.statCard("money", money(summary.issued), "Total Issued")}
        ${C.statCard("clock", money(summary.outstanding), "Outstanding Balance", true)}
      </div>
      <div class="dash-card" style="margin-top:18px"><div class="dash-table-wrap"><table class="dash-table">
        <thead><tr><th>Teacher</th><th>Amount</th><th>Reason</th><th>Monthly Instalment</th><th>Repaid</th><th>Balance</th><th>Issued</th><th></th></tr></thead>
        <tbody>
          ${advances.length ? advances.map((a) => {
            const outstanding = Number(a.balance || 0) > 0;
            const repaidPct = Number(a.amount) > 0 ? Math.min(100, Math.round((Number(a.repaid || 0) / Number(a.amount)) * 100)) : 0;
            return `
            <tr>
              <td><strong>${C.esc(teacherName(a))}</strong><small>${C.esc(a.username || "")}</small></td>
              <td>${money(a.amount)}</td>
              <td>${C.esc(a.reason || "—")}</td>
              <td>${money(a.monthly_instalment)} <small>over ${a.repayment_months} month(s)</small></td>
              <td>${money(a.repaid)} <small>(${repaidPct}%)</small></td>
              <td><strong>${money(a.balance)}</strong> ${outstanding ? pill("active", "warn") : pill("settled", "ok")}</td>
              <td>${C.fmtDate(a.created_at)}</td>
              <td><div class="dash-table-actions">
                ${outstanding ? `<button class="dash-btn dash-btn-ghost dash-btn-sm" data-repay-advance="${a.id}">${C.I.money || ""} Repay</button>` : ""}
                ${Number(a.balance) === Number(a.amount) ? `<button class="dash-btn dash-btn-danger dash-btn-sm" data-delete-advance="${a.id}">${C.I.trash}</button>` : ""}
              </div></td>
            </tr>`;
          }).join("") : C.emptyRow(8, "No salary advances issued yet.")}
        </tbody>
      </table></div></div>
      <div class="dash-card" style="margin-top:18px"><div class="dash-card-pad">
        <h3>Repayment progress</h3>
        ${advances.length ? `<div class="dash-progress-pair">${advances.slice(0, 6).map((a) => {
          const pct = Number(a.amount) > 0 ? Math.min(100, Math.round((Number(a.repaid || 0) / Number(a.amount)) * 100)) : 0;
          return `<div><span>${C.esc(teacherName(a))}</span><strong>${pct}%</strong><i><b style="width:${pct}%"></b></i></div>`;
        }).join("")}</div>` : `<p class="hint">Issue an advance to see repayment progress here.</p>`}
      </div></div>`;

    const reload = () => advancesPage(content);
    $("#addAdvance", content).addEventListener("click", async () => openAdvanceForm(await loadTeachers(), reload));
    $$("[data-repay-advance]", content).forEach((button) => button.addEventListener("click", () => {
      const advance = advances.find((a) => Number(a.id) === Number(button.dataset.repayAdvance));
      openRepayForm(advance, reload);
    }));
    $$("[data-delete-advance]", content).forEach((button) => button.addEventListener("click", async () => {
      if (!window.confirm("Delete this advance? It has no repayments recorded.")) return;
      try {
        await window.API.del(`/payroll/advances/${button.dataset.deleteAdvance}`);
        C.toast("Advance deleted.", "success");
        reload();
      } catch (e) { C.toast(e.message || "Could not delete advance.", "error"); }
    }));
  }

  function openAdvanceForm(teachers, done) {
    const modal = C.openModal("Issue salary advance", `
      <form id="advanceForm">
        <div class="dash-form-grid">
          <div class="dash-field"><label>Teacher *</label>
            <select name="user_id" required><option value="">Select teacher</option>${teacherOptions(teachers)}</select></div>
          <div class="dash-field"><label>Amount (₦) *</label><input name="amount" type="number" min="1" step="0.01" required></div>
          <div class="dash-field"><label>Repayment months *</label><input name="repayment_months" type="number" min="1" max="60" required value="6"></div>
          <div class="dash-field"><label>Reason</label><input name="reason" placeholder="e.g. Rent support, medical" value=""></div>
        </div>
        <p class="hint" style="margin-top:12px">The monthly instalment (amount ÷ months) is deducted automatically from each processed payslip. You can also record an out-of-payroll repayment at any time.</p>
        <button class="dash-btn dash-btn-primary" type="submit" style="margin-top:14px">${C.I.check} Issue advance</button>
      </form>`);
    $("#advanceForm", modal).addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        await window.API.post("/payroll/advances", formObject(e.currentTarget));
        C.toast("Advance issued.", "success");
        C.closeModal();
        done();
      } catch (err) { C.toast(err.message || "Could not issue advance.", "error"); }
    });
  }

  function openRepayForm(advance, done) {
    const modal = C.openModal(`Record repayment — ${teacherName(advance)}`, `
      <form id="repayForm">
        <p class="hint">Outstanding balance: <strong>${money(advance.balance)}</strong> · Monthly instalment: ${money(advance.monthly_instalment)}</p>
        <div class="dash-form-grid">
          <div class="dash-field"><label>Repayment amount (₦) *</label><input name="amount" type="number" min="0.01" step="0.01" required value="${C.esc(advance.monthly_instalment || "")}"></div>
        </div>
        <button class="dash-btn dash-btn-primary" type="submit" style="margin-top:14px">${C.I.check} Record repayment</button>
      </form>`);
    $("#repayForm", modal).addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        const r = await window.API.post(`/payroll/advances/${advance.id}/repay`, formObject(e.currentTarget));
        C.toast(`Repayment recorded — remaining balance ${money(r.balance)}.`, "success");
        C.closeModal();
        done();
      } catch (err) { C.toast(err.message || "Could not record repayment.", "error"); }
    });
  }

  /* ============================== ROUTER =============================== */

  async function render(context, content, route) {
    C = context;
    if (route === "payroll/structures") return structuresPage(content);
    if (route === "payroll/periods") return periodsPage(content);
    if (route === "payroll/payslips") return payslipsPage(content);
    if (route === "payroll/advances") return advancesPage(content);
  }

  window.BelloPayroll = { handles: (route) => ROUTES.has(route), render };
})();
