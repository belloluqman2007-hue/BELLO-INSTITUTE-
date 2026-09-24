"use strict";
/* ============================================================================
   EduSphere — School Expense & Budget Workspace (Admin & Staff)
   ----------------------------------------------------------------------------
   Interactive frontend module for school expense management:
     • Expense Categories: hierarchical tree view, add/edit modal, type badges
     • Record Expense: multi-field form with receipt upload, session/term linking
     • Expense List: filterable data table, status badges, admin approval /
       rejection actions, receipt download / preview
     • Budget vs Actual: per-category budget tracker with inline CSS progress
       bars and variance calculations (no external charting libraries)
     • Expense Reports: filterable spending breakdowns by category, month,
       vendor, payment method, and direct CSV download
   Both Islamic and Western school categories share this module.
   ========================================================================== */
(function () {
  const ROUTES = new Set([
    "finance/expenses",
    "finance/expenses/list",
    "finance/expenses/record",
    "finance/expenses/new",
    "finance/expenses/categories",
    "finance/categories",
    "finance/expenses/budget",
    "finance/budget",
    "finance/expenses/reports",
    "finance/reports/expenses",
  ]);

  let C; // context handed over by dashboard.js

  const $ = (scope, selector) => (scope || document).querySelector(selector);
  const $$ = (scope, selector) => [...(scope || document).querySelectorAll(selector)];

  const esc = (s) =>
    String(s === null || s === undefined ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  function money(n) {
    const v = Number(n || 0);
    return "₦" + v.toLocaleString("en-NG", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }

  function fmtDate(v) {
    if (!v) return "—";
    try {
      return new Date(v).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
    } catch (e) {
      return String(v);
    }
  }

  const typeLabels = {
    operating: "Operating",
    capital: "Capital",
    salary: "Salary & Personnel",
    other: "Other",
  };

  const typeColors = {
    operating: "var(--d-info, #2563eb)",
    capital: "var(--d-accent, #7c3aed)",
    salary: "var(--d-ok, #059669)",
    other: "var(--d-muted, #64748b)",
  };

  function typeBadge(type) {
    const t = String(type || "operating").toLowerCase();
    const label = typeLabels[t] || "Operating";
    return `<span class="dash-pill" style="background:rgba(0,0,0,0.06);color:inherit;font-size:0.75rem;">${esc(label)}</span>`;
  }

  function statusPill(status) {
    const s = String(status || "draft").toLowerCase();
    if (s === "approved") return `<span class="dash-pill ok">Approved</span>`;
    if (s === "rejected") return `<span class="dash-pill danger">Rejected</span>`;
    if (s === "cancelled") return `<span class="dash-pill" style="opacity:0.6;">Cancelled</span>`;
    return `<span class="dash-pill warn">Draft</span>`;
  }

  function pageHead(crumb, title, description, actions = "") {
    return `
      <div class="dash-page-head">
        <div>
          <div class="dash-crumb">${esc(crumb)}</div>
          <h2>${esc(title)}</h2>
          <p>${esc(description)}</p>
        </div>
        ${actions ? `<div class="dash-actions">${actions}</div>` : ""}
      </div>`;
  }

  function emptyRow(colspan, text) {
    return `<tr><td colspan="${colspan}" class="dash-empty" style="text-align:center;padding:32px;color:var(--d-muted);">${esc(text)}</td></tr>`;
  }

  async function loadSessionsAndTerms() {
    try {
      const [sessRes, termsRes] = await Promise.all([
        window.API.get("/sessions").catch(() => ({ sessions: [] })),
        window.API.get("/terms").catch(() => ({ terms: [] })),
      ]);
      const sessions = sessRes.sessions || [];
      const terms = termsRes.terms || [];
      return { sessions, terms };
    } catch (e) {
      return { sessions: [], terms: [] };
    }
  }

  /* ==========================================================================
     1. EXPENSE CATEGORIES (Tree View + Modal CRUD)
     ========================================================================== */

  async function categoriesPage(root) {
    let data;
    try {
      data = await window.API.get("/expenses/categories");
    } catch (e) {
      root.innerHTML = `<div class="dash-coming-soon"><div class="icon">${C.I.close}</div><h3>Could not load categories</h3><p>${esc(e.message)}</p></div>`;
      return;
    }

    const categories = data.categories || [];
    const topLevel = categories.filter((c) => !c.parent_id);
    const childrenMap = new Map();
    categories.forEach((c) => {
      if (c.parent_id) {
        const pid = Number(c.parent_id);
        if (!childrenMap.has(pid)) childrenMap.set(pid, []);
        childrenMap.get(pid).push(c);
      }
    });

    root.innerHTML = `
      ${pageHead(
        "Finance · Expenses",
        "Expense Categories",
        "Organize school expenditures into operating, capital, salary, and custom categories with multi-level subcategories.",
        `<button class="dash-btn dash-btn-primary" id="openAddCategoryBtn">${C.I.plus} Add Category</button>`
      )}

      <div class="dash-card">
        <div class="dash-card-head">
          <h3>Category Structure</h3>
          <span class="hint">${categories.length} total categories</span>
        </div>
        <div class="dash-table-wrap">
          <table class="dash-table">
            <thead>
              <tr>
                <th style="min-width:240px;">Category Name</th>
                <th>Type</th>
                <th>Subcategories</th>
                <th>Approved Spent</th>
                <th>Approved Records</th>
                <th style="text-align:right;">Actions</th>
              </tr>
            </thead>
            <tbody id="categoryTableBody">
              ${
                topLevel.length
                  ? topLevel
                      .map((cat) => {
                        const subs = childrenMap.get(Number(cat.id)) || [];
                        let html = `
                          <tr style="font-weight:600;background:var(--d-surface-2, rgba(0,0,0,0.02));">
                            <td>
                              <span style="display:inline-flex;align-items:center;gap:6px;">
                                <span style="font-size:1.1rem;">📁</span>
                                <strong>${esc(cat.name)}</strong>
                              </span>
                            </td>
                            <td>${typeBadge(cat.type)}</td>
                            <td><span class="dash-pill">${subs.length} subcategory/ies</span></td>
                            <td>${money(cat.total_spent_ngn)}</td>
                            <td>${Number(cat.expense_count || 0)}</td>
                            <td style="text-align:right;">
                              <button class="dash-btn dash-btn-ghost dash-btn-sm add-sub-btn" data-parent-id="${cat.id}" data-parent-name="${esc(cat.name)}" title="Add subcategory">+ Sub</button>
                              <button class="dash-btn dash-btn-ghost dash-btn-sm edit-cat-btn" data-id="${cat.id}">Edit</button>
                              <button class="dash-btn dash-btn-danger dash-btn-sm del-cat-btn" data-id="${cat.id}" data-name="${esc(cat.name)}">Delete</button>
                            </td>
                          </tr>`;
                        subs.forEach((sub) => {
                          html += `
                            <tr>
                              <td style="padding-left:36px;">
                                <span style="color:var(--d-muted);margin-right:6px;">↳</span>
                                <span>${esc(sub.name)}</span>
                              </td>
                              <td>${typeBadge(sub.type)}</td>
                              <td><span style="color:var(--d-muted);font-size:0.8rem;">—</span></td>
                              <td>${money(sub.total_spent_ngn)}</td>
                              <td>${Number(sub.expense_count || 0)}</td>
                              <td style="text-align:right;">
                                <button class="dash-btn dash-btn-ghost dash-btn-sm edit-cat-btn" data-id="${sub.id}">Edit</button>
                                <button class="dash-btn dash-btn-danger dash-btn-sm del-cat-btn" data-id="${sub.id}" data-name="${esc(sub.name)}">Delete</button>
                              </td>
                            </tr>`;
                        });
                        return html;
                      })
                      .join("")
                  : emptyRow(6, "No expense categories found. Click 'Add Category' to create your first category.")
              }
            </tbody>
          </table>
        </div>
      </div>`;

    function categoryModal(cat = null, defaultParentId = null) {
      const isEdit = !!cat;
      const title = isEdit ? "Edit Category" : defaultParentId ? "Add Subcategory" : "Add Expense Category";

      // Options for parent category dropdown
      const parentOptions = [
        `<option value="">None (Top-Level Category)</option>`,
        ...categories
          .filter((c) => !isEdit || Number(c.id) !== Number(cat.id))
          .map((c) => `<option value="${c.id}" ${((isEdit && Number(cat.parent_id) === Number(c.id)) || (!isEdit && Number(defaultParentId) === Number(c.id))) ? "selected" : ""}>${c.parent_id ? "— " : ""}${esc(c.name)} (${typeLabels[c.type] || c.type})</option>`),
      ].join("");

      const contentHtml = `
        <form id="categoryForm">
          <div class="dash-form-grid">
            <div class="dash-field" style="grid-column:1/-1;">
              <label>Category Name *</label>
              <input name="name" type="text" required maxlength="160" value="${isEdit ? esc(cat.name) : ""}" placeholder="e.g. Utilities, Fuel & Generator, Office Stationery">
            </div>
            <div class="dash-field">
              <label>Expense Type *</label>
              <select name="type" required>
                <option value="operating" ${isEdit && cat.type === "operating" ? "selected" : ""}>Operating Expenses</option>
                <option value="capital" ${isEdit && cat.type === "capital" ? "selected" : ""}>Capital Expenditures</option>
                <option value="salary" ${isEdit && cat.type === "salary" ? "selected" : ""}>Salary & Personnel</option>
                <option value="other" ${isEdit && cat.type === "other" ? "selected" : ""}>Other Expenses</option>
              </select>
            </div>
            <div class="dash-field">
              <label>Parent Category (Optional)</label>
              <select name="parent_id">
                ${parentOptions}
              </select>
            </div>
          </div>
          <div class="dash-actions" style="margin-top:20px;justify-content:flex-end;">
            <button type="button" class="dash-btn dash-btn-ghost" id="cancelCatModal">Cancel</button>
            <button type="submit" class="dash-btn dash-btn-primary" id="saveCatBtn">${isEdit ? "Update Category" : "Create Category"}</button>
          </div>
        </form>`;

      const modalEl = C.openModal(title, contentHtml);
      const form = $(modalEl, "#categoryForm");
      $(modalEl, "#cancelCatModal").onclick = () => C.closeModal();

      form.onsubmit = async (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        const name = (fd.get("name") || "").trim();
        const type = fd.get("type");
        const parent_id = fd.get("parent_id") ? Number(fd.get("parent_id")) : null;

        if (!name) return C.toast("Category name is required.", "error");

        const btn = $(modalEl, "#saveCatBtn");
        btn.disabled = true;
        btn.textContent = "Saving…";

        try {
          if (isEdit) {
            await window.API.patch(`/expenses/categories/${cat.id}`, { name, type, parent_id });
            C.toast("Category updated.", "success");
          } else {
            await window.API.post("/expenses/categories", { name, type, parent_id });
            C.toast("Category created.", "success");
          }
          C.closeModal();
          categoriesPage(root);
        } catch (err) {
          btn.disabled = false;
          btn.textContent = isEdit ? "Update Category" : "Create Category";
          C.toast(err.message || "Failed to save category.", "error");
        }
      };
    }

    $(root, "#openAddCategoryBtn").onclick = () => categoryModal();

    root.querySelectorAll(".add-sub-btn").forEach((b) => {
      b.onclick = () => {
        const pid = Number(b.dataset.parentId);
        categoryModal(null, pid);
      };
    });

    root.querySelectorAll(".edit-cat-btn").forEach((b) => {
      b.onclick = () => {
        const id = Number(b.dataset.id);
        const cat = categories.find((c) => Number(c.id) === id);
        if (cat) categoryModal(cat);
      };
    });

    root.querySelectorAll(".del-cat-btn").forEach((b) => {
      b.onclick = async () => {
        const id = Number(b.dataset.id);
        const name = b.dataset.name;
        if (!confirm(`Are you sure you want to delete the category "${name}"?`)) return;
        try {
          await window.API.del(`/expenses/categories/${id}`);
          C.toast("Category deleted.", "success");
          categoriesPage(root);
        } catch (err) {
          C.toast(err.message || "Could not delete category.", "error");
        }
      };
    });
  }

  /* ==========================================================================
     2. RECORD EXPENSE (Form + Receipt Upload)
     ========================================================================== */

  async function recordExpensePage(root) {
    let categories = [], sessions = [], terms = [];
    try {
      const [catRes, st] = await Promise.all([
        window.API.get("/expenses/categories").catch(() => ({ categories: [] })),
        loadSessionsAndTerms(),
      ]);
      categories = catRes.categories || [];
      sessions = st.sessions || [];
      terms = st.terms || [];
    } catch (e) {
      /* ignore */
    }

    const currentSession = sessions.find((s) => Number(s.is_current) === 1) || sessions[0];
    const defaultDate = new Date().toISOString().slice(0, 10);

    const categoryOptions = categories.length
      ? categories
          .map((c) => `<option value="${c.id}">${c.parent_id ? "  ↳ " : ""}${esc(c.name)} (${typeLabels[c.type] || c.type})</option>`)
          .join("")
      : `<option value="">No categories yet (Create one first)</option>`;

    root.innerHTML = `
      ${pageHead(
        "Finance · Expenses",
        "Record School Expense",
        "Record an expenditure for operational, capital, or staff costs. Submissions start as draft for admin verification.",
        `<button class="dash-btn dash-btn-ghost" id="viewExpensesBtn">${C.I.list || "📋"} Expense List</button>`
      )}

      <div class="dash-card" style="max-width:860px;margin:0 auto;">
        <div class="dash-card-head">
          <h3>Expense Details</h3>
          <span class="hint">Naira (₦) Ledger</span>
        </div>
        <div class="dash-card-pad">
          <form id="recordExpenseForm">
            <div class="dash-form-grid">
              <div class="dash-field">
                <label>Category *</label>
                <select name="category_id" required id="expenseCategorySelect">
                  <option value="">Select Expense Category</option>
                  ${categoryOptions}
                </select>
              </div>

              <div class="dash-field">
                <label>Amount (₦) *</label>
                <input name="amount_ngn" type="number" min="0.01" step="0.01" required placeholder="0.00">
              </div>

              <div class="dash-field">
                <label>Vendor / Payee</label>
                <input name="vendor" type="text" maxlength="180" placeholder="e.g. IBEDC, Shell Petroleum, ABC Books">
              </div>

              <div class="dash-field">
                <label>Payment Date *</label>
                <input name="payment_date" type="date" required value="${defaultDate}">
              </div>

              <div class="dash-field">
                <label>Payment Method *</label>
                <select name="payment_method" required>
                  <option value="cash" selected>Cash</option>
                  <option value="bank_transfer">Bank Transfer</option>
                  <option value="pos">POS / Card</option>
                  <option value="cheque">Cheque</option>
                  <option value="online">Online Payment Gateway</option>
                  <option value="other">Other</option>
                </select>
              </div>

              <div class="dash-field">
                <label>Academic Session</label>
                <select name="session_id" id="expenseSessionSelect">
                  <option value="">None / Current Session</option>
                  ${sessions.map((s) => `<option value="${s.id}" ${currentSession && s.id === currentSession.id ? "selected" : ""}>${esc(s.label)}${Number(s.is_current) === 1 ? " (Current)" : ""}</option>`).join("")}
                </select>
              </div>

              <div class="dash-field">
                <label>Term / Semester</label>
                <select name="term_id" id="expenseTermSelect">
                  <option value="">None / General</option>
                  ${terms.map((t) => `<option value="${t.id}">${esc(t.name_en || t.label || `Term ${t.position}`)}</option>`).join("")}
                </select>
              </div>

              <div class="dash-field">
                <label>Receipt / Invoice File (Optional)</label>
                <input name="receipt" type="file" accept="image/jpeg,image/png,image/webp,image/gif,application/pdf">
                <small class="hint">Accepted: JPG, PNG, WEBP, GIF, PDF (Max 10MB)</small>
              </div>

              <div class="dash-field" style="grid-column:1/-1;">
                <label>Description / Purpose of Expense</label>
                <textarea name="description" rows="3" placeholder="Provide details regarding the items purchased, services rendered, or reason for expense…"></textarea>
              </div>
            </div>

            <div class="dash-actions" style="margin-top:24px;justify-content:flex-end;">
              <button type="reset" class="dash-btn dash-btn-ghost">Clear</button>
              <button type="submit" class="dash-btn dash-btn-primary" id="submitExpenseBtn">${C.I.check} Save Expense (Draft)</button>
            </div>
          </form>
        </div>
      </div>`;

    $(root, "#viewExpensesBtn").onclick = () => C.go("finance/expenses");

    const form = $(root, "#recordExpenseForm");
    form.onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const category_id = Number(fd.get("category_id"));
      const amount_ngn = Number(fd.get("amount_ngn"));
      const vendor = (fd.get("vendor") || "").trim();
      const payment_date = fd.get("payment_date");
      const payment_method = fd.get("payment_method");
      const session_id = fd.get("session_id") ? Number(fd.get("session_id")) : null;
      const term_id = fd.get("term_id") ? Number(fd.get("term_id")) : null;
      const description = (fd.get("description") || "").trim();
      const receiptFile = fd.get("receipt");

      if (!category_id) return C.toast("Please select an expense category.", "error");
      if (!amount_ngn || amount_ngn <= 0) return C.toast("Please enter a valid expense amount.", "error");
      if (!payment_date) return C.toast("Please select a payment date.", "error");

      const submitBtn = $(root, "#submitExpenseBtn");
      submitBtn.disabled = true;
      submitBtn.textContent = "Saving…";

      try {
        const payload = {
          category_id,
          amount_ngn,
          vendor,
          payment_date,
          payment_method,
          session_id,
          term_id,
          description,
        };

        const res = await window.API.post("/expenses", payload);
        const expenseId = res.id || (res.expense && res.expense.id);

        if (receiptFile && receiptFile.size > 0 && expenseId) {
          const fileFd = new FormData();
          fileFd.append("receipt", receiptFile);
          try {
            await window.API.post(`/expenses/${expenseId}/receipt`, fileFd);
          } catch (uploadErr) {
            C.toast("Expense saved, but receipt upload failed: " + uploadErr.message, "warn");
          }
        }

        C.toast("Expense recorded successfully as draft.", "success");
        C.go("finance/expenses");
      } catch (err) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = `${C.I.check} Save Expense (Draft)`;
        C.toast(err.message || "Failed to record expense.", "error");
      }
    };
  }

  /* ==========================================================================
     3. EXPENSE LIST (Table, Filters, Approval/Rejection, Receipts)
     ========================================================================== */

  async function expensesListPage(root) {
    let categories = [], sessions = [], terms = [];
    try {
      const [catRes, st] = await Promise.all([
        window.API.get("/expenses/categories").catch(() => ({ categories: [] })),
        loadSessionsAndTerms(),
      ]);
      categories = catRes.categories || [];
      sessions = st.sessions || [];
      terms = st.terms || [];
    } catch (e) {
      /* ignore */
    }

    root.innerHTML = `
      ${pageHead(
        "Finance · Expenses",
        "Expense Management",
        "Review, approve, and track all institutional expenditures and payment receipts.",
        `
        <button class="dash-btn dash-btn-ghost" id="goCategoriesBtn">${C.I.folder || "📁"} Categories</button>
        <button class="dash-btn dash-btn-ghost" id="goBudgetBtn">${C.I.chart || "📊"} Budget vs Actual</button>
        <a class="dash-btn dash-btn-ghost" id="exportExpensesCsvBtn" target="_blank" rel="noopener">${C.I.download} Export CSV</a>
        <button class="dash-btn dash-btn-primary" id="recordNewExpenseBtn">${C.I.plus} Record Expense</button>
        `
      )}

      <div class="dash-stats-grid" id="expenseKpiGrid">
        <div class="dash-stat-card"><div class="dash-stat-label">Total Approved</div><div class="dash-stat-value" id="kpiApproved">₦0</div></div>
        <div class="dash-stat-card"><div class="dash-stat-label">Pending Drafts</div><div class="dash-stat-value" id="kpiDrafts">₦0</div></div>
        <div class="dash-stat-card"><div class="dash-stat-label">Total Recorded</div><div class="dash-stat-value" id="kpiTotal">₦0</div></div>
        <div class="dash-stat-card"><div class="dash-stat-label">Rejected</div><div class="dash-stat-value" id="kpiRejected">₦0</div></div>
      </div>

      <div class="dash-card" style="margin-bottom:20px;">
        <div class="dash-card-pad" style="padding:14px 18px;">
          <div class="dash-form-grid" style="grid-template-columns:repeat(auto-fit, minmax(160px, 1fr));gap:12px;align-items:end;">
            <div class="dash-field">
              <label>Search</label>
              <input type="search" id="filterSearch" placeholder="Vendor or description…">
            </div>
            <div class="dash-field">
              <label>Status</label>
              <select id="filterStatus">
                <option value="">Active (Draft & Approved)</option>
                <option value="draft">Draft (Pending Approval)</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
                <option value="cancelled">Cancelled</option>
                <option value="all">All Statuses</option>
              </select>
            </div>
            <div class="dash-field">
              <label>Category</label>
              <select id="filterCategory">
                <option value="">All Categories</option>
                ${categories.map((c) => `<option value="${c.id}">${c.parent_id ? "↳ " : ""}${esc(c.name)}</option>`).join("")}
              </select>
            </div>
            <div class="dash-field">
              <label>Session</label>
              <select id="filterSession">
                <option value="">All Sessions</option>
                ${sessions.map((s) => `<option value="${s.id}">${esc(s.label)}</option>`).join("")}
              </select>
            </div>
            <div class="dash-field">
              <label>From Date</label>
              <input type="date" id="filterFrom">
            </div>
            <div class="dash-field">
              <label>To Date</label>
              <input type="date" id="filterTo">
            </div>
            <div class="dash-field">
              <button class="dash-btn dash-btn-ghost" id="resetFiltersBtn" style="width:100%;">Reset</button>
            </div>
          </div>
        </div>
      </div>

      <div class="dash-card">
        <div class="dash-table-wrap">
          <table class="dash-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Category</th>
                <th>Vendor / Payee</th>
                <th>Description</th>
                <th>Method</th>
                <th>Amount (₦)</th>
                <th>Status</th>
                <th>Receipt</th>
                <th style="text-align:right;">Actions</th>
              </tr>
            </thead>
            <tbody id="expenseListBody">
              ${emptyRow(9, "Loading expenses…")}
            </tbody>
          </table>
        </div>
      </div>`;

    $(root, "#goCategoriesBtn").onclick = () => C.go("finance/expenses/categories");
    $(root, "#goBudgetBtn").onclick = () => C.go("finance/expenses/budget");
    $(root, "#recordNewExpenseBtn").onclick = () => C.go("finance/expenses/record");

    async function loadExpenses() {
      const search = $(root, "#filterSearch").value.trim();
      const status = $(root, "#filterStatus").value;
      const categoryId = $(root, "#filterCategory").value;
      const sessionId = $(root, "#filterSession").value;
      const from = $(root, "#filterFrom").value;
      const to = $(root, "#filterTo").value;

      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (status) params.set("status", status);
      if (categoryId) params.set("categoryId", categoryId);
      if (sessionId) params.set("sessionId", sessionId);
      if (from) params.set("from", from);
      if (to) params.set("to", to);

      const qs = params.toString();
      $(root, "#exportExpensesCsvBtn").href = window.API.url(`/expenses/report.csv?${qs}`);

      const tbody = $(root, "#expenseListBody");
      try {
        const res = await window.API.get(`/expenses?${qs}`);
        const list = res.expenses || [];
        const summary = res.summary || {};

        $(root, "#kpiApproved").textContent = money(summary.approved_amount || 0);
        $(root, "#kpiDrafts").textContent = money(summary.draft_amount || 0);
        $(root, "#kpiTotal").textContent = money(summary.total_amount || 0);
        $(root, "#kpiRejected").textContent = money(summary.rejected_amount || 0);

        if (!list.length) {
          tbody.innerHTML = emptyRow(9, "No expenses match the selected filters.");
          return;
        }

        tbody.innerHTML = list
          .map((e) => {
            const isDraft = e.status === "draft";
            const isApproved = e.status === "approved";
            const isCancelled = e.status === "cancelled";

            let receiptHtml = `<span style="color:var(--d-muted);font-size:0.8rem;">None</span>`;
            if (e.receipt_path) {
              receiptHtml = `<a class="dash-btn dash-btn-ghost dash-btn-sm" href="${esc(e.receipt_path)}" target="_blank" rel="noopener" style="padding:4px 8px;font-size:0.75rem;">${C.I.download || "📎"} View</a>`;
            } else if (!isCancelled) {
              receiptHtml = `<button class="dash-btn dash-btn-ghost dash-btn-sm upload-receipt-btn" data-id="${e.id}" style="padding:4px 8px;font-size:0.75rem;">+ Upload</button>`;
            }

            let actionsHtml = "";
            if (isDraft) {
              actionsHtml = `
                <button class="dash-btn dash-btn-primary dash-btn-sm approve-expense-btn" data-id="${e.id}" title="Approve expense">Approve</button>
                <button class="dash-btn dash-btn-danger dash-btn-sm reject-expense-btn" data-id="${e.id}" title="Reject expense">Reject</button>
                <button class="dash-btn dash-btn-ghost dash-btn-sm cancel-expense-btn" data-id="${e.id}" title="Cancel">Cancel</button>
              `;
            } else if (!isCancelled) {
              actionsHtml = `
                <button class="dash-btn dash-btn-ghost dash-btn-sm cancel-expense-btn" data-id="${e.id}" title="Cancel/Delete">Cancel</button>
              `;
            }

            return `
              <tr>
                <td>${fmtDate(e.payment_date)}</td>
                <td>
                  <strong>${esc(e.category_name || "Uncategorized")}</strong><br>
                  <small style="color:var(--d-muted);">${typeLabels[e.category_type] || e.category_type || ""}</small>
                </td>
                <td>${esc(e.vendor || "—")}</td>
                <td style="max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(e.description || "")}">
                  ${esc(e.description || "—")}
                </td>
                <td><span style="text-transform:capitalize;font-size:0.82rem;">${esc(String(e.payment_method || "cash").replace(/_/g, " "))}</span></td>
                <td><strong>${money(e.amount_ngn)}</strong></td>
                <td>${statusPill(e.status)}</td>
                <td>${receiptHtml}</td>
                <td style="text-align:right;white-space:nowrap;">${actionsHtml}</td>
              </tr>`;
          })
          .join("");

        // Bind Action Buttons
        tbody.querySelectorAll(".approve-expense-btn").forEach((btn) => {
          btn.onclick = async () => {
            const id = Number(btn.dataset.id);
            btn.disabled = true;
            try {
              await window.API.patch(`/expenses/${id}/approve`, {});
              C.toast("Expense approved.", "success");
              loadExpenses();
            } catch (err) {
              btn.disabled = false;
              C.toast(err.message || "Approval failed.", "error");
            }
          };
        });

        tbody.querySelectorAll(".reject-expense-btn").forEach((btn) => {
          btn.onclick = async () => {
            const id = Number(btn.dataset.id);
            if (!confirm("Are you sure you want to reject this expense?")) return;
            btn.disabled = true;
            try {
              await window.API.patch(`/expenses/${id}/reject`, {});
              C.toast("Expense rejected.", "success");
              loadExpenses();
            } catch (err) {
              btn.disabled = false;
              C.toast(err.message || "Rejection failed.", "error");
            }
          };
        });

        tbody.querySelectorAll(".cancel-expense-btn").forEach((btn) => {
          btn.onclick = async () => {
            const id = Number(btn.dataset.id);
            if (!confirm("Are you sure you want to cancel this expense?")) return;
            try {
              await window.API.del(`/expenses/${id}`);
              C.toast("Expense cancelled.", "success");
              loadExpenses();
            } catch (err) {
              C.toast(err.message || "Cancel failed.", "error");
            }
          };
        });

        tbody.querySelectorAll(".upload-receipt-btn").forEach((btn) => {
          btn.onclick = () => {
            const id = Number(btn.dataset.id);
            openUploadModal(id);
          };
        });
      } catch (err) {
        tbody.innerHTML = emptyRow(9, "Error loading expenses: " + err.message);
      }
    }

    function openUploadModal(expenseId) {
      const modalContent = `
        <form id="uploadReceiptForm">
          <div class="dash-field">
            <label>Select Receipt / Invoice File</label>
            <input type="file" name="receipt" required accept="image/jpeg,image/png,image/webp,image/gif,application/pdf">
            <small class="hint">Images (JPG, PNG, WEBP, GIF) or PDF documents up to 10MB.</small>
          </div>
          <div class="dash-actions" style="margin-top:20px;justify-content:flex-end;">
            <button type="button" class="dash-btn dash-btn-ghost" id="cancelUploadBtn">Cancel</button>
            <button type="submit" class="dash-btn dash-btn-primary" id="submitUploadBtn">${C.I.upload || "⬆"} Upload Receipt</button>
          </div>
        </form>`;

      const modalEl = C.openModal("Upload Expense Receipt", modalContent);
      $(modalEl, "#cancelUploadBtn").onclick = () => C.closeModal();

      const form = $(modalEl, "#uploadReceiptForm");
      form.onsubmit = async (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        const file = fd.get("receipt");
        if (!file || !file.size) return C.toast("Please choose a file to upload.", "error");

        const btn = $(modalEl, "#submitUploadBtn");
        btn.disabled = true;
        btn.textContent = "Uploading…";

        try {
          await window.API.post(`/expenses/${expenseId}/receipt`, fd);
          C.toast("Receipt uploaded successfully.", "success");
          C.closeModal();
          loadExpenses();
        } catch (err) {
          btn.disabled = false;
          btn.textContent = "Upload Receipt";
          C.toast(err.message || "Failed to upload receipt.", "error");
        }
      };
    }

    let filterTimeout;
    const triggerFilter = () => {
      clearTimeout(filterTimeout);
      filterTimeout = setTimeout(loadExpenses, 200);
    };

    $(root, "#filterSearch").oninput = triggerFilter;
    $(root, "#filterStatus").onchange = triggerFilter;
    $(root, "#filterCategory").onchange = triggerFilter;
    $(root, "#filterSession").onchange = triggerFilter;
    $(root, "#filterFrom").onchange = triggerFilter;
    $(root, "#filterTo").onchange = triggerFilter;

    $(root, "#resetFiltersBtn").onclick = () => {
      $(root, "#filterSearch").value = "";
      $(root, "#filterStatus").value = "";
      $(root, "#filterCategory").value = "";
      $(root, "#filterSession").value = "";
      $(root, "#filterFrom").value = "";
      $(root, "#filterTo").value = "";
      loadExpenses();
    };

    loadExpenses();
  }

  /* ==========================================================================
     4. BUDGET VS ACTUAL (Category Progress Bars + Upsert Modal)
     ========================================================================== */

  async function budgetPage(root) {
    let sessions = [];
    try {
      const sRes = await window.API.get("/sessions").catch(() => ({ sessions: [] }));
      sessions = sRes.sessions || [];
    } catch (e) {
      /* ignore */
    }

    const currentSession = sessions.find((s) => Number(s.is_current) === 1) || sessions[0];

    root.innerHTML = `
      ${pageHead(
        "Finance · Expenses",
        "Budget vs. Actual Expenditure",
        "Track per-category budget allocations against actual approved expenditures per academic session.",
        `
        <button class="dash-btn dash-btn-ghost" id="budgetExpensesListBtn">Expense List</button>
        <button class="dash-btn dash-btn-primary" id="openSetBudgetBtn">${C.I.plus} Set Category Budget</button>
        `
      )}

      <div class="dash-card" style="margin-bottom:20px;">
        <div class="dash-card-pad" style="padding:14px 18px;display:flex;align-items:center;gap:14px;flex-wrap:wrap;">
          <label style="font-weight:600;">Academic Session:</label>
          <select id="budgetSessionSelector" style="max-width:280px;">
            ${sessions.map((s) => `<option value="${s.id}" ${currentSession && s.id === currentSession.id ? "selected" : ""}>${esc(s.label)}${Number(s.is_current) === 1 ? " (Current)" : ""}</option>`).join("")}
          </select>
        </div>
      </div>

      <div class="dash-stats-grid" id="budgetKpiGrid">
        <div class="dash-stat-card"><div class="dash-stat-label">Total Budgeted</div><div class="dash-stat-value" id="kpiBudgeted">₦0</div></div>
        <div class="dash-stat-card"><div class="dash-stat-label">Actual Spent</div><div class="dash-stat-value" id="kpiSpent">₦0</div></div>
        <div class="dash-stat-card"><div class="dash-stat-label">Remaining Variance</div><div class="dash-stat-value" id="kpiRemaining">₦0</div></div>
        <div class="dash-stat-card"><div class="dash-stat-label">Overall % Used</div><div class="dash-stat-value" id="kpiPctUsed">0%</div></div>
      </div>

      <div class="dash-card">
        <div class="dash-card-head">
          <h3>Category Budget Breakdown</h3>
          <span class="hint">Approved expenses only</span>
        </div>
        <div class="dash-table-wrap">
          <table class="dash-table">
            <thead>
              <tr>
                <th>Category</th>
                <th>Type</th>
                <th>Budgeted (₦)</th>
                <th>Actual Spent (₦)</th>
                <th>Remaining (₦)</th>
                <th style="min-width:180px;">Budget Utilization</th>
                <th style="text-align:right;">Actions</th>
              </tr>
            </thead>
            <tbody id="budgetTableBody">
              ${emptyRow(7, "Loading budget data…")}
            </tbody>
          </table>
        </div>
      </div>`;

    $(root, "#budgetExpensesListBtn").onclick = () => C.go("finance/expenses");

    async function loadBudgetSummary() {
      const sessionId = $(root, "#budgetSessionSelector").value;
      const tbody = $(root, "#budgetTableBody");

      try {
        const res = await window.API.get(`/budget/summary?sessionId=${sessionId}`);
        const categories = res.categories || [];
        const totals = res.totals || {};

        $(root, "#kpiBudgeted").textContent = money(totals.budgeted_ngn || 0);
        $(root, "#kpiSpent").textContent = money(totals.spent_ngn || 0);
        $(root, "#kpiRemaining").textContent = money(totals.remaining_ngn || 0);
        $(root, "#kpiPctUsed").textContent = `${totals.percent_used || 0}%`;

        if (!categories.length) {
          tbody.innerHTML = emptyRow(7, "No expense categories found. Create categories under Expense Categories first.");
          return;
        }

        tbody.innerHTML = categories
          .map((c) => {
            const pct = Number(c.percent_used || 0);
            let barColor = "var(--d-ok, #059669)";
            if (pct > 100) barColor = "var(--d-danger, #dc2626)";
            else if (pct >= 80) barColor = "var(--d-warn, #d97706)";

            const isOverBudget = c.remaining_ngn < 0;

            return `
              <tr>
                <td>
                  <strong>${esc(c.name || c.category_name)}</strong>
                  ${c.parent_name ? `<br><small style="color:var(--d-muted);">Parent: ${esc(c.parent_name)}</small>` : ""}
                </td>
                <td>${typeBadge(c.type)}</td>
                <td>${money(c.budgeted_ngn)}</td>
                <td><strong>${money(c.spent_ngn)}</strong></td>
                <td style="color:${isOverBudget ? "var(--d-danger, #dc2626)" : "inherit"};">
                  <strong>${money(c.remaining_ngn)}</strong>
                  ${isOverBudget ? `<br><small style="color:var(--d-danger);font-weight:600;">(Over Budget)</small>` : ""}
                </td>
                <td>
                  <div style="display:flex;align-items:center;gap:10px;">
                    <div style="flex:1;height:8px;background:var(--d-line, #e2e8f0);border-radius:999px;overflow:hidden;position:relative;">
                      <div style="height:100%;width:${Math.min(100, pct)}%;background:${barColor};border-radius:999px;transition:width 0.3s ease;"></div>
                    </div>
                    <span style="font-size:0.8rem;font-weight:600;min-width:44px;text-align:right;">${pct}%</span>
                  </div>
                </td>
                <td style="text-align:right;">
                  <button class="dash-btn dash-btn-ghost dash-btn-sm edit-budget-btn"
                    data-cat-id="${c.category_id}"
                    data-cat-name="${esc(c.name || c.category_name)}"
                    data-budget="${c.budgeted_ngn}"
                    data-notes="${esc(c.notes || "")}">
                    Edit Budget
                  </button>
                </td>
              </tr>`;
          })
          .join("");

        tbody.querySelectorAll(".edit-budget-btn").forEach((btn) => {
          btn.onclick = () => {
            const catId = Number(btn.dataset.catId);
            const catName = btn.dataset.catName;
            const currentBudget = Number(btn.dataset.budget || 0);
            const notes = btn.dataset.notes || "";
            openBudgetModal(catId, catName, currentBudget, notes);
          };
        });
      } catch (err) {
        tbody.innerHTML = emptyRow(7, "Failed to load budget summary: " + err.message);
      }
    }

    function openBudgetModal(defaultCatId = null, defaultCatName = "", defaultAmount = 0, defaultNotes = "") {
      const currentSessId = $(root, "#budgetSessionSelector").value;

      window.API.get("/expenses/categories").then((catRes) => {
        const catList = catRes.categories || [];
        const catOptions = catList
          .map((c) => `<option value="${c.id}" ${defaultCatId && Number(c.id) === Number(defaultCatId) ? "selected" : ""}>${c.parent_id ? "↳ " : ""}${esc(c.name)} (${typeLabels[c.type] || c.type})</option>`)
          .join("");

        const sessOptions = sessions
          .map((s) => `<option value="${s.id}" ${Number(s.id) === Number(currentSessId) ? "selected" : ""}>${esc(s.label)}</option>`)
          .join("");

        const modalHtml = `
          <form id="setBudgetForm">
            <div class="dash-form-grid">
              <div class="dash-field" style="grid-column:1/-1;">
                <label>Academic Session *</label>
                <select name="session_id" required>${sessOptions}</select>
              </div>
              <div class="dash-field" style="grid-column:1/-1;">
                <label>Expense Category *</label>
                <select name="category_id" required ${defaultCatId ? "" : ""}>
                  <option value="">Select Category</option>
                  ${catOptions}
                </select>
              </div>
              <div class="dash-field" style="grid-column:1/-1;">
                <label>Budgeted Amount (₦) *</label>
                <input name="budgeted_ngn" type="number" min="0" step="0.01" required value="${defaultAmount || ""}" placeholder="0.00">
              </div>
              <div class="dash-field" style="grid-column:1/-1;">
                <label>Budget Notes / Assumptions</label>
                <textarea name="notes" rows="2" placeholder="e.g. Approved board budget for 2026/2027 session">${esc(defaultNotes)}</textarea>
              </div>
            </div>
            <div class="dash-actions" style="margin-top:20px;justify-content:flex-end;">
              <button type="button" class="dash-btn dash-btn-ghost" id="cancelBudgetBtn">Cancel</button>
              <button type="submit" class="dash-btn dash-btn-primary" id="saveBudgetBtn">Save Budget</button>
            </div>
          </form>`;

        const modalEl = C.openModal("Set Category Budget", modalHtml);
        $(modalEl, "#cancelBudgetBtn").onclick = () => C.closeModal();

        const form = $(modalEl, "#setBudgetForm");
        form.onsubmit = async (e) => {
          e.preventDefault();
          const fd = new FormData(form);
          const session_id = Number(fd.get("session_id"));
          const category_id = Number(fd.get("category_id"));
          const budgeted_ngn = Number(fd.get("budgeted_ngn"));
          const notes = (fd.get("notes") || "").trim();

          if (!category_id) return C.toast("Please select a category.", "error");

          const saveBtn = $(modalEl, "#saveBudgetBtn");
          saveBtn.disabled = true;
          saveBtn.textContent = "Saving…";

          try {
            await window.API.post("/budget", { session_id, category_id, budgeted_ngn, notes });
            C.toast("Budget allocation saved.", "success");
            C.closeModal();
            loadBudgetSummary();
          } catch (err) {
            saveBtn.disabled = false;
            saveBtn.textContent = "Save Budget";
            C.toast(err.message || "Failed to save budget.", "error");
          }
        };
      });
    }

    $(root, "#budgetSessionSelector").onchange = loadBudgetSummary;
    $(root, "#openSetBudgetBtn").onclick = () => openBudgetModal();

    loadBudgetSummary();
  }

  /* ==========================================================================
     5. EXPENSE REPORTS (Filterable Breakdown by Category, Month, Vendor)
     ========================================================================== */

  async function reportsPage(root) {
    let categories = [], sessions = [], terms = [];
    try {
      const [catRes, st] = await Promise.all([
        window.API.get("/expenses/categories").catch(() => ({ categories: [] })),
        loadSessionsAndTerms(),
      ]);
      categories = catRes.categories || [];
      sessions = st.sessions || [];
      terms = st.terms || [];
    } catch (e) {
      /* ignore */
    }

    root.innerHTML = `
      ${pageHead(
        "Finance · Expenses",
        "Expense Reports & Analytics",
        "Comprehensive breakdown of school expenditure by category, monthly trends, and vendor payments.",
        `<a class="dash-btn dash-btn-ghost" id="exportReportCsvBtn" target="_blank" rel="noopener">${C.I.download} Export CSV</a>`
      )}

      <div class="dash-card" style="margin-bottom:20px;">
        <div class="dash-card-pad" style="padding:14px 18px;">
          <div class="dash-form-grid" style="grid-template-columns:repeat(auto-fit, minmax(160px, 1fr));gap:12px;align-items:end;">
            <div class="dash-field">
              <label>From Date</label>
              <input type="date" id="repFrom">
            </div>
            <div class="dash-field">
              <label>To Date</label>
              <input type="date" id="repTo">
            </div>
            <div class="dash-field">
              <label>Category</label>
              <select id="repCategory">
                <option value="">All Categories</option>
                ${categories.map((c) => `<option value="${c.id}">${c.parent_id ? "↳ " : ""}${esc(c.name)}</option>`).join("")}
              </select>
            </div>
            <div class="dash-field">
              <label>Session</label>
              <select id="repSession">
                <option value="">All Sessions</option>
                ${sessions.map((s) => `<option value="${s.id}">${esc(s.label)}</option>`).join("")}
              </select>
            </div>
            <div class="dash-field">
              <label>Term</label>
              <select id="repTerm">
                <option value="">All Terms</option>
                ${terms.map((t) => `<option value="${t.id}">${esc(t.name_en || t.label || `Term ${t.position}`)}</option>`).join("")}
              </select>
            </div>
            <div class="dash-field">
              <label>Vendor</label>
              <input type="text" id="repVendor" placeholder="Filter vendor…">
            </div>
            <div class="dash-field">
              <button class="dash-btn dash-btn-primary" id="runReportBtn" style="width:100%;">Generate Report</button>
            </div>
          </div>
        </div>
      </div>

      <div class="dash-stats-grid">
        <div class="dash-stat-card"><div class="dash-stat-label">Total Spent</div><div class="dash-stat-value" id="repKpiTotal">₦0</div></div>
        <div class="dash-stat-card"><div class="dash-stat-label">Approved Transactions</div><div class="dash-stat-value" id="repKpiCount">0</div></div>
        <div class="dash-stat-card"><div class="dash-stat-label">Average Transaction</div><div class="dash-stat-value" id="repKpiAvg">₦0</div></div>
        <div class="dash-stat-card"><div class="dash-stat-label">Top Category</div><div class="dash-stat-value" id="repKpiTop" style="font-size:1.1rem;">—</div></div>
      </div>

      <div class="dash-grid-2" style="margin-bottom:20px;">
        <div class="dash-card">
          <div class="dash-card-head"><h3>Spending by Category</h3></div>
          <div class="dash-table-wrap">
            <table class="dash-table">
              <thead><tr><th>Category</th><th>Type</th><th>Spent (₦)</th><th>% of Total</th></tr></thead>
              <tbody id="repCategoryTable"></tbody>
            </table>
          </div>
        </div>

        <div class="dash-card">
          <div class="dash-card-head"><h3>Monthly Expenditure</h3></div>
          <div class="dash-table-wrap">
            <table class="dash-table">
              <thead><tr><th>Month</th><th>Transactions</th><th>Amount (₦)</th></tr></thead>
              <tbody id="repMonthTable"></tbody>
            </table>
          </div>
        </div>
      </div>

      <div class="dash-grid-2" style="margin-bottom:20px;">
        <div class="dash-card">
          <div class="dash-card-head"><h3>Top Vendors / Payees</h3></div>
          <div class="dash-table-wrap">
            <table class="dash-table">
              <thead><tr><th>Vendor</th><th>Transactions</th><th>Total Paid (₦)</th><th>% of Total</th></tr></thead>
              <tbody id="repVendorTable"></tbody>
            </table>
          </div>
        </div>

        <div class="dash-card">
          <div class="dash-card-head"><h3>Payment Methods</h3></div>
          <div class="dash-table-wrap">
            <table class="dash-table">
              <thead><tr><th>Method</th><th>Transactions</th><th>Total Amount (₦)</th></tr></thead>
              <tbody id="repMethodTable"></tbody>
            </table>
          </div>
        </div>
      </div>

      <div class="dash-card">
        <div class="dash-card-head">
          <h3>Expense Records</h3>
          <span class="hint">Approved entries in selected period</span>
        </div>
        <div class="dash-table-wrap">
          <table class="dash-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Category</th>
                <th>Vendor</th>
                <th>Description</th>
                <th>Method</th>
                <th>Amount (₦)</th>
              </tr>
            </thead>
            <tbody id="repDetailedTable"></tbody>
          </table>
        </div>
      </div>`;

    async function generateReport() {
      const from = $(root, "#repFrom").value;
      const to = $(root, "#repTo").value;
      const categoryId = $(root, "#repCategory").value;
      const sessionId = $(root, "#repSession").value;
      const termId = $(root, "#repTerm").value;
      const vendor = $(root, "#repVendor").value.trim();

      const params = new URLSearchParams();
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      if (categoryId) params.set("categoryId", categoryId);
      if (sessionId) params.set("sessionId", sessionId);
      if (termId) params.set("termId", termId);
      if (vendor) params.set("vendor", vendor);
      params.set("status", "approved");

      const qs = params.toString();
      $(root, "#exportReportCsvBtn").href = window.API.url(`/expenses/report.csv?${qs}`);

      try {
        const res = await window.API.get(`/expenses/report?${qs}`);
        const summary = res.summary || {};
        const byCat = res.byCategory || [];
        const byMonth = res.byMonth || [];
        const byVendor = res.byVendor || [];
        const byMethod = res.byPaymentMethod || [];
        const expenses = res.expenses || [];

        $(root, "#repKpiTotal").textContent = money(summary.total_spent || 0);
        $(root, "#repKpiCount").textContent = String(summary.expense_count || 0);
        $(root, "#repKpiAvg").textContent = money(summary.average_expense || 0);
        $(root, "#repKpiTop").textContent = byCat.length ? byCat[0].category_name : "—";

        // Categories Table
        $(root, "#repCategoryTable").innerHTML = byCat.length
          ? byCat.map((c) => `<tr><td><strong>${esc(c.category_name)}</strong></td><td>${typeBadge(c.type)}</td><td>${money(c.amount)}</td><td>${c.percent}%</td></tr>`).join("")
          : emptyRow(4, "No category breakdown data.");

        // Month Table
        $(root, "#repMonthTable").innerHTML = byMonth.length
          ? byMonth.map((m) => `<tr><td><strong>${esc(m.label || m.month)}</strong></td><td>${m.count}</td><td><strong>${money(m.amount)}</strong></td></tr>`).join("")
          : emptyRow(3, "No monthly expenditure data.");

        // Vendor Table
        $(root, "#repVendorTable").innerHTML = byVendor.length
          ? byVendor.map((v) => `<tr><td><strong>${esc(v.vendor)}</strong></td><td>${v.count}</td><td>${money(v.amount)}</td><td>${v.percent}%</td></tr>`).join("")
          : emptyRow(4, "No vendor breakdown data.");

        // Method Table
        $(root, "#repMethodTable").innerHTML = byMethod.length
          ? byMethod.map((m) => `<tr><td style="text-transform:capitalize;">${esc(String(m.method || "cash").replace(/_/g, " "))}</td><td>${m.count}</td><td>${money(m.amount)}</td></tr>`).join("")
          : emptyRow(3, "No payment method data.");

        // Detailed Table
        $(root, "#repDetailedTable").innerHTML = expenses.length
          ? expenses.map((e) => `<tr><td>${fmtDate(e.payment_date)}</td><td><strong>${esc(e.category_name || "—")}</strong></td><td>${esc(e.vendor || "—")}</td><td>${esc(e.description || "—")}</td><td><span style="text-transform:capitalize;">${esc(String(e.payment_method || "cash").replace(/_/g, " "))}</span></td><td><strong>${money(e.amount_ngn)}</strong></td></tr>`).join("")
          : emptyRow(6, "No expense records found for the selected period.");
      } catch (err) {
        C.toast(err.message || "Failed to generate report.", "error");
      }
    }

    $(root, "#runReportBtn").onclick = generateReport;
    generateReport();
  }

  /* ==========================================================================
     MODULE EXPORT (window.BelloExpenses)
     ========================================================================== */

  window.BelloExpenses = {
    handles(route) {
      return ROUTES.has(route);
    },
    async render(context, root, route) {
      C = context;
      if (route === "finance/expenses/categories" || route === "finance/categories") {
        return categoriesPage(root);
      }
      if (route === "finance/expenses/record" || route === "finance/expenses/new") {
        return recordExpensePage(root);
      }
      if (route === "finance/expenses/budget" || route === "finance/budget") {
        return budgetPage(root);
      }
      if (route === "finance/expenses/reports" || route === "finance/reports/expenses") {
        return reportsPage(root);
      }
      return expensesListPage(root);
    },
  };
})();
