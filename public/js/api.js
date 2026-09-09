"use strict";
/* ============================================================================
   MULTI-MADRASA PLATFORM — API client
   ----------------------------------------------------------------------------
   Same-origin fetch with CSRF double-submit token. All requests go to the
   NEW platform API. The base URL comes from the runtime config served by
   this deployment (window.__APP_CONFIG__.apiBase, via /app-config.js) and
   falls back to same-origin "/api". No hard-coded/old production URLs.
   ========================================================================== */
(function () {
  const BASE =
    (window.__APP_CONFIG__ && window.__APP_CONFIG__.apiBase) || "/api";
  let csrfToken = null;

  async function ensureCsrf() {
    if (csrfToken) return csrfToken;
    const r = await fetch(BASE + "/csrf-token", { credentials: "same-origin" });
    if (!r.ok) throw new Error("Could not obtain CSRF token");
    const d = await r.json();
    csrfToken = d.csrfToken;
    return csrfToken;
  }

  async function request(method, path, body, opts = {}) {
    const headers = { Accept: "application/json" };
    if (body && !(body instanceof FormData)) headers["Content-Type"] = "application/json";
    if (["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
      headers["X-CSRF-Token"] = await ensureCsrf();
    }
    const res = await fetch(BASE + path, {
      method,
      headers,
      credentials: "same-origin",
      body: body instanceof FormData ? body : (body ? JSON.stringify(body) : undefined),
    });
    if (res.status === 403 && headers["X-CSRF-Token"]) {
      // CSRF token expired — refresh once and retry
      csrfToken = null;
      return request(method, path, body, Object.assign({ retried: true }, opts));
    }
    let data = null;
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("application/json")) data = await res.json().catch(() => null);
    if (!res.ok) {
      const e = new Error((data && data.error) || `Request failed (${res.status})`);
      e.status = res.status;
      e.data = data;
      throw e;
    }
    return data;
  }

  window.API = {
    get: (p) => request("GET", p),
    post: (p, b) => request("POST", p, b),
    put: (p, b) => request("PUT", p, b),
    patch: (p, b) => request("PATCH", p, b),
    del: (p) => request("DELETE", p),
    async login(username, password) {
      const r = await fetch(BASE + "/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ username, password }),
      });
      const d = await r.json().catch(() => null);
      if (!r.ok) { const e = new Error((d && d.error) || "Login failed"); e.status = r.status; throw e; }
      return d;
    },
    async me() {
      const r = await fetch(BASE + "/auth/me", { credentials: "same-origin" });
      return r.json();
    },
    logout: () => request("POST", "/auth/logout", {}),
    reportCardUrl: (studentId, termId) => `${BASE}/results/report-card/${studentId}/${termId}`,
    portalReportUrl: (termId, studentId) =>
      studentId ? `${BASE}/portal/report-card?termId=${termId}&studentId=${studentId}`
                : `${BASE}/portal/report-card?termId=${termId}`,
  };
})();
