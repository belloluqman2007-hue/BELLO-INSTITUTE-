"use strict";
/* ============================================================================
   MULTI-MADRASA PLATFORM — PUBLIC SITE (visible BEFORE login)
   ----------------------------------------------------------------------------
   Everything in this file renders for anonymous visitors:
     home          → hero, platform stats, madrasa directory
     directory     → every public madrasa, searchable + city filter
     madrasa page  → profile, notices, and the two self-service panels
     results       → verify an admission number, open a published report card
     apply         → online admission application + status tracking

   It talks only to /api/public/* (see server/routes/public.js); no session,
   no CSRF and no tenant ids are sent from here — the server decides what a
   logged-out visitor may see, per madrasa switch.
   ========================================================================== */
(function () {
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const t = (k) => (window.I18N && window.I18N.t(k)) || k;
  const isAr = () => window.I18N && window.I18N.lang === "ar";

  function esc(s) {
    return String(s === null || s === undefined ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function errMsg(e) {
    const m = (e && e.data && e.data.error) || (e && e.data && e.data.message) || (e && e.message) || "";
    return typeof m === "string" && m ? m : "Something went wrong. Please try again.";
  }
  function toast(msg, type) {
    if (window.__mmToast) return window.__mmToast(msg, type);
    const el = document.createElement("div");
    el.className = "toast" + (type ? " " + type : "");
    el.innerHTML = `<span>${esc(msg)}</span>`;
    let box = document.getElementById("toastBox");
    if (!box) { box = document.createElement("div"); box.id = "toastBox"; document.body.appendChild(box); }
    box.appendChild(el);
    setTimeout(() => el.remove(), 3200);
  }
  /** Re-render the current public route (language / theme change). */
  function load(route) {
    if (window.App && window.App.routeTo) return window.App.routeTo(route);
    location.hash = "#/" + String(route || "");
  }

  /* ---------------------------- chrome --------------------------------- */

  const PUBLIC_PREFIXES = ["madaris", "madrasa/", "results-check", "apply"];
  function isPublicPath(path) {
    const p = String(path || "").split("?")[0].replace(/^\/+|\/+$/g, "");
    if (p === "") return true;
    return PUBLIC_PREFIXES.some((pre) => p === pre || p.startsWith(pre));
  }

  function nav(active) {
    const link = (href, label, key) => `<a href="#/${href}" class="${active === key ? "on" : ""}">${esc(label)}</a>`;
    return `<nav class="pub-nav">
      ${link("", t("pub.nav.home"), "home")}
      ${link("madaris", t("pub.nav.madaris"), "madaris")}
      ${link("results-check", t("pub.nav.results"), "results")}
      ${link("apply", t("pub.nav.apply"), "apply")}
    </nav>`;
  }

  function shell(active, route) {
    const s = window.__publicSite || {};
    document.body.innerHTML = `
      <header class="pub-header">
        <a class="pub-brand" href="#/">
          ${s.logoPath ? `<img src="${esc(s.logoPath)}" alt="">` : `<span class="pub-mark">🕌</span>`}
          <span class="pub-title">${esc(s.title || t("app.name"))}</span>
        </a>
        ${nav(active)}
        <div class="pub-actions">
          <button class="iconbtn" id="pubLang" title="${esc(t("common.language"))}">${isAr() ? "EN" : "ع"}</button>
          <button class="iconbtn" id="pubTheme" title="${esc(t("common.appearance"))}">${window.Theme && window.Theme.get() === "dark" ? "☀" : "🌙"}</button>
          <a class="btn small" href="#/login">${esc(t("pub.nav.login"))}</a>
        </div>
      </header>
      <main class="pub-main" id="view"><div class="empty">${esc(t("common.loading"))}</div></main>
      <footer class="pub-footer">
        <div>${esc(s.intro || t("pub.footer"))}</div>
        <div class="pf-contact">${[s.contactPhone, s.contactEmail].filter(Boolean).map((v) => `<span>${esc(v)}</span>`).join("")}</div>
      </footer>`;
    $("#pubLang").addEventListener("click", () => {
      window.I18N.setLang(isAr() ? "en" : "ar");
      shell(active, route);
      load(route);
    });
    $("#pubTheme").addEventListener("click", () => {
      window.Theme.toggle();
      shell(active, route);
      load(route);
    });
    window.I18N.applyStatic(document.body);
    window.scrollTo(0, 0);
  }

  function render(html) {
    const v = $("#view");
    if (v) v.innerHTML = html;
    if (window.I18N) window.I18N.applyStatic(v);
  }

  /* ---------------------------- shared data ---------------------------- */

  async function site() {
    if (window.__publicSite && window.__publicSiteLoaded) return window.__publicSiteData;
    const d = await window.API.public.get("/site");
    window.__publicSite = d.site || {};
    window.__publicSiteData = d;
    window.__publicSiteLoaded = true;
    return d;
  }

  function pick(en, ar) {
    return isAr() && ar ? ar : (en || ar || "");
  }

  function card(m) {
    return `<a class="pub-madrasa" href="#/madrasa/${encodeURIComponent(m.slug)}">
      <span class="pm-logo">${m.logoPath ? `<img src="${esc(m.logoPath)}" alt="">` : "🕌"}</span>
      <span class="pm-body">
        <span class="pm-name">${esc(pick(m.nameEn, m.nameAr))}</span>
        <span class="pm-meta">${esc([m.city, m.state].filter(Boolean).join(", "))}${m.currentSession ? " • " + esc(m.currentSession) : ""}${m.foundedYear ? " • " + esc(t("pub.founded")) + " " + esc(m.foundedYear) : ""}</span>
        ${pick(m.mottoEn, m.mottoAr) ? `<span class="pm-motto">“${esc(pick(m.mottoEn, m.mottoAr))}”</span>` : ""}
        ${pick(m.descriptionEn, m.descriptionAr) ? `<span class="pm-desc">${esc(pick(m.descriptionEn, m.descriptionAr).slice(0, 160))}${pick(m.descriptionEn, m.descriptionAr).length > 160 ? "…" : ""}</span>` : ""}
        <span class="pm-stats">
          <span><b>${Number(m.students) || 0}</b> ${esc(t("pub.students"))}</span>
          <span><b>${Number(m.teachers) || 0}</b> ${esc(t("pub.teachers"))}</span>
          <span><b>${Number(m.classes) || 0}</b> ${esc(t("pub.classes"))}</span>
        </span>
        <span class="pm-flags">
          ${m.canCheckResults ? `<span class="pill ok">🔎 ${esc(t("pub.nav.results"))}</span>` : ""}
          ${m.canApply ? `<span class="pill gold">📝 ${esc(t("pub.nav.apply"))}</span>` : ""}
        </span>
      </span>
      <span class="pm-cta">${esc(t("pub.view"))} →</span>
    </a>`;
  }

  function gridOf(list) {
    return `<div class="pub-grid">${list.map(card).join("") || `<div class="empty">🏫<div class="small muted" style="margin-top:8px">${esc(t("pub.directoryEmpty"))}</div></div>`}</div>`;
  }

  /* ------------------------------ HOME ---------------------------------- */

  async function home() {
    shell("home", "");
    let d;
    try { d = await site(); } catch (e) { render(`<div class="empty">${esc(errMsg(e))}</div>`); return; }
    const list = d.madaris || [];
    render(`
      <section class="pub-hero">
        <div class="ph-inner">
          <span class="ph-badge">${esc(t("pub.hero.badge"))}</span>
          <h1>${esc(d.site.title || "Bello Institute")}</h1>
          <p class="ph-sub">${esc(d.site.tagline || "")}</p>
          ${d.site.intro ? `<p class="ph-intro">${esc(d.site.intro)}</p>` : ""}
          <div class="ph-cta">
            <a class="btn" href="#/results-check">🔎 ${esc(t("pub.hero.resultsBtn"))}</a>
            <a class="btn secondary" href="#/apply">📝 ${esc(t("pub.hero.applyBtn"))}</a>
            <a class="btn ghost" href="#/login">${esc(t("pub.nav.login"))} →</a>
          </div>
          ${d.directoryEnabled ? `<div class="ph-stats">
            <div><b>${Number(d.stats.madaris) || 0}</b><span>${esc(t("pub.stats.madaris"))}</span></div>
            <div><b>${Number(d.stats.students) || 0}</b><span>${esc(t("pub.stats.students"))}</span></div>
            <div><b>${Number(d.stats.teachers) || 0}</b><span>${esc(t("pub.stats.teachers"))}</span></div>
          </div>` : ""}
        </div>
      </section>
      ${d.directoryEnabled ? `
      <section class="pub-section">
        <div class="pub-sec-head">
          <h2>${esc(t("pub.directory"))}</h2>
          <div class="searchbar"><span class="ico">🔍</span><input id="pubSearch" placeholder="${esc(t("pub.search.placeholder"))}"></div>
        </div>
        <div id="pubList">${gridOf(list)}</div>
      </section>` : ""}
      <section class="pub-section">
        <h2>${esc(t("pub.how"))}</h2>
        <div class="pub-steps">
          <div class="step"><span class="n">1</span><b>${esc(t("pub.step1"))}</b><p>${esc(t("pub.step1d"))}</p></div>
          <div class="step"><span class="n">2</span><b>${esc(t("pub.step2"))}</b><p>${esc(t("pub.step2d"))}</p></div>
          <div class="step"><span class="n">3</span><b>${esc(t("pub.step3"))}</b><p>${esc(t("pub.step3d"))}</p></div>
        </div>
      </section>`);
    const search = $("#pubSearch");
    if (search) search.addEventListener("input", () => {
      const q = search.value.trim().toLowerCase();
      const hit = list.filter((m) => !q || [m.nameEn, m.nameAr, m.slug, m.city, m.descriptionEn, m.mottoEn].filter(Boolean).join(" ").toLowerCase().includes(q));
      $("#pubList").innerHTML = gridOf(hit);
    });
  }

  /* ---------------------------- DIRECTORY -------------------------------- */

  async function directory() {
    shell("madaris", "madaris");
    let d;
    try {
      d = await window.API.public.get("/madaris");
    } catch (e) { render(`<div class="empty">${esc(errMsg(e))}</div>`); return; }
    const list = d.madaris || [];
    const cities = d.cities || [];
    render(`
      <section class="pub-section">
        <div class="pub-sec-head">
          <h1>${esc(t("pub.directory"))} <span class="muted small">(${list.length})</span></h1>
          <div class="searchbar"><span class="ico">🔍</span><input id="pubSearch" placeholder="${esc(t("pub.search.placeholder"))}"></div>
        </div>
        ${cities.length > 1 ? `<div class="pub-chips">${cities.map((c) => `<button class="chip" data-city="${esc(c)}">${esc(c)}</button>`).join("")}</div>` : ""}
        <div id="pubList">${gridOf(list)}</div>
      </section>`);
    let city = "";
    const search = $("#pubSearch");
    function apply() {
      const q = search.value.trim().toLowerCase();
      $("#pubList").innerHTML = gridOf(list.filter((m) =>
        (!q || [m.nameEn, m.nameAr, m.slug, m.city, m.descriptionEn].filter(Boolean).join(" ").toLowerCase().includes(q)) &&
        (!city || m.city === city)));
    }
    search.addEventListener("input", apply);
    $$("#view .chip").forEach((b) => b.addEventListener("click", () => {
      city = city === b.dataset.city ? "" : b.dataset.city;
      $$("#view .chip").forEach((x) => x.classList.toggle("on", x.dataset.city === city));
      apply();
    }));
  }

  /* --------------------------- MADRASA PROFILE --------------------------- */

  async function madrasaPage(slug) {
    shell("madaris", "madrasa/" + slug);
    let d;
    try {
      d = await window.API.public.get("/madaris/" + encodeURIComponent(slug));
    } catch (e) { render(`<div class="empty">🚫 ${esc(errMsg(e))}<div style="margin-top:12px"><a class="btn small secondary" href="#/madaris">${esc(t("pub.nav.madaris"))}</a></div></div>`); return; }
    const m = d.madrasa;
    window.__publicMadrasa = m;
    render(`
      <div class="pub-profile">
        <div class="pp-logo">${m.logoPath ? `<img src="${esc(m.logoPath)}" alt="">` : "🕌"}</div>
        <div class="pp-head">
          <h1>${esc(pick(m.nameEn, m.nameAr))}</h1>
          ${pick(m.nameAr, m.nameEn) ? `<div class="pp-alt" dir="${isAr() ? "ltr" : "rtl"}">${esc(pick(m.nameAr, m.nameEn))}</div>` : ""}
          ${pick(m.mottoEn, m.mottoAr) ? `<div class="pp-motto">“${esc(pick(m.mottoEn, m.mottoAr))}”</div>` : ""}
          <div class="pp-meta">
            ${m.city ? `<span>📍 ${esc([m.city, m.state].filter(Boolean).join(", "))}</span>` : ""}
            ${m.currentSession ? `<span>🎓 ${esc(m.currentSession)}</span>` : ""}
            ${m.foundedYear ? `<span>🗓 ${esc(t("pub.founded"))} ${esc(m.foundedYear)}</span>` : ""}
            ${m.phone ? `<span>📞 ${esc(m.phone)}</span>` : ""}
            ${m.email ? `<span>✉️ ${esc(m.email)}</span>` : ""}
            ${m.website ? `<span>🌐 <a href="${esc(m.website)}" rel="noopener" target="_blank">${esc(m.website.replace(/^https?:\/\//, ""))}</a></span>` : ""}
          </div>
          <div class="pp-stats">
            <div><b>${m.students}</b><span>${esc(t("pub.students"))}</span></div>
            <div><b>${m.teachers}</b><span>${esc(t("pub.teachers"))}</span></div>
            <div><b>${m.classes}</b><span>${esc(t("pub.classes"))}</span></div>
          </div>
          <div class="pp-cta">
            ${m.canCheckResults ? `<a class="btn" href="#/results-check?madrasa=${encodeURIComponent(m.slug)}">🔎 ${esc(t("pub.results.title"))}</a>` : ""}
            ${m.canApply ? `<a class="btn secondary" href="#/apply/${encodeURIComponent(m.slug)}">📝 ${esc(t("pub.apply.title"))}</a>` : ""}
            <a class="btn ghost" href="#/login">${esc(t("pub.nav.login"))} →</a>
          </div>
        </div>
      </div>
      <div class="pub-tabs">
        <button class="tab on" data-tab="about">${esc(t("pub.overview"))}</button>
        <button class="tab" data-tab="notices">${esc(t("pub.notices"))} ${d.notices && d.notices.length ? `<span class="pill info">${d.notices.length}</span>` : ""}</button>
        <button class="tab" data-tab="results">${esc(t("pub.results.title"))}</button>
        <button class="tab" data-tab="apply">${esc(t("pub.apply.title"))}</button>
      </div>
      <div class="pub-tab-body" id="pubTab"></div>`);

    const panels = {
      about() {
        return `<div class="card">
            ${pick(m.descriptionEn, m.descriptionAr) ? `<div class="pp-about">${esc(pick(m.descriptionEn, m.descriptionAr)).replace(/\n/g, "<br>")}</div>` : `<div class="muted small">${esc(t("common.noData"))}</div>`}
          </div>
          <div class="card">
            <div class="card-title">📚 ${esc(t("pub.offered"))}</div>
            <div class="pub-pills">
              ${(d.classes || []).map((c) => `<span class="pill info">${esc(pick(c.name_en, c.name_ar))}</span>`).join("")}
              ${(d.subjects || []).map((s) => `<span class="pill gold">${esc(pick(s.name_en, s.name_ar))}</span>`).join("")}
              ${!(d.classes || []).length && !(d.subjects || []).length ? `<span class="muted small">${esc(t("common.noData"))}</span>` : ""}
            </div>
          </div>`;
      },
      notices() {
        const list = d.notices || [];
        if (!list.length) return `<div class="card"><div class="empty">📢<div class="small muted" style="margin-top:8px">${esc(t("common.noData"))}</div></div></div>`;
        return list.map((n) => `<div class="card pub-notice">
            <div class="card-title">📢 <b>${esc(n.title)}</b></div>
            <div class="pp-about">${esc(n.body).replace(/\n/g, "<br>")}</div>
            <div class="muted small">${esc(new Date(n.created_at).toLocaleDateString())}</div>
          </div>`).join("");
      },
      results() { return resultsPanel(m); },
      apply() { return applyPanel(m); },
    };
    let current = "about";
    function show(key) {
      current = key;
      $$("#view .tab").forEach((b) => b.classList.toggle("on", b.dataset.tab === key));
      const box = $("#pubTab");
      box.innerHTML = panels[key]();
      if (key === "results") wireResults(box, m);
      if (key === "apply") wireApply(box, m);
    }
    $$("#view .tab").forEach((b) => b.addEventListener("click", () => show(b.dataset.tab)));
    show(window.__pubWantApply === m.slug ? "apply" : "about");
  }

  /* --------------------------- RESULT CHECKER ---------------------------- */

  function resultsPanel(m) {
    if (m && !m.canCheckResults) {
      return `<div class="card"><div class="empty">🔒<div class="small muted" style="margin-top:8px">${esc(t("pub.resultsClosed"))}</div></div></div>`;
    }
    return `<div class="card">
        <div class="card-title">🔎 ${esc(t("pub.results.title"))}</div>
        <div class="muted small" style="margin-bottom:10px">${esc(t("pub.results.intro"))}</div>
        <div class="row">
          <div><label>${esc(t("pub.results.madrasa"))}</label>
            <select id="rcMadrasa">${m ? `<option value="${esc(m.slug)}">${esc(m.nameEn)}</option>` : `<option value="">${esc(t("common.none"))}</option>`}</select></div>
          <div><label>${esc(t("pub.results.admission"))}</label><input id="rcAdmission" placeholder="ABC0001" autocomplete="off"></div>
        </div>
        <div class="row">
          <div><label>${esc(t("pub.results.surname"))}</label><input id="rcSurname" autocomplete="off"></div>
          <div><label>${esc(t("pub.results.dob"))}</label><input id="rcDob" placeholder="2012-04-01" autocomplete="off"></div>
        </div>
        <div class="form-actions"><button class="btn" id="rcGo">${esc(t("pub.results.check"))}</button></div>
        <div id="rcOut"></div>
      </div>`;
  }

  async function globalResults(slug) {
    shell("results", "results-check" + (slug ? "?madrasa=" + encodeURIComponent(slug) : ""));
    let options = [];
    try {
      const d = await window.API.public.get("/madaris");
      options = d.madaris || [];
    } catch (e) { /* directory may be off — still allow checking with the slug from the URL */ }
    if (slug && !options.some((o) => o.slug === slug)) {
      options = [{ slug, nameEn: slug, nameAr: "", canCheckResults: true, students: 0, teachers: 0, classes: 0 }].concat(options);
    }
    const fake = Object.assign({}, options.find((o) => o.slug === slug) || { canCheckResults: true, slug: slug || "" });
    render(`
      <section class="pub-section">
        <h1>🔎 ${esc(t("pub.results.title"))}</h1>
        <div id="rcBox"></div>
      </section>`);
    const box = $("#rcBox");
    box.innerHTML = `<div class="card">
        <div class="muted small" style="margin-bottom:10px">${esc(t("pub.results.intro"))}</div>
        <div class="row">
          <div><label>${esc(t("pub.results.madrasa"))}</label>
            <select id="rcMadrasa">${options.map((o) => `<option value="${esc(o.slug)}" ${o.slug === slug ? "selected" : ""}>${esc(o.nameEn)}</option>`).join("")}</select></div>
          <div><label>${esc(t("pub.results.admission"))}</label><input id="rcAdmission" placeholder="ABC0001" autocomplete="off"></div>
        </div>
        <div class="row">
          <div><label>${esc(t("pub.results.surname"))}</label><input id="rcSurname" autocomplete="off"></div>
          <div><label>${esc(t("pub.results.dob"))}</label><input id="rcDob" placeholder="2012-04-01" autocomplete="off"></div>
        </div>
        <div class="form-actions"><button class="btn" id="rcGo">${esc(t("pub.results.check"))}</button></div>
        <div id="rcOut"></div>
      </div>`;
    wireResults(box, fake);
    // Deep links from an approval notice arrive with the number already known:
    // #/results-check?madrasa=<slug>&admissionNo=<ADM>&surname=<family name>
    const q = window.__query || {};
    if (q.admissionNo) $("#rcAdmission", box).value = String(q.admissionNo).slice(0, 60);
    if (q.surname) $("#rcSurname", box).value = String(q.surname).slice(0, 100);
    if (q.dob || q.dateOfBirth) $("#rcDob", box).value = String(q.dob || q.dateOfBirth).slice(0, 20);
    if (q.admissionNo && (q.surname || q.dob || q.dateOfBirth)) $("#rcGo", box).click();
    else if (q.admissionNo) ($("#rcSurname", box) || {}).focus?.();
  }

  function wireResults(root, fixed) {
    const go2 = async () => {
      const btn = $("#rcGo", root);
      const out = $("#rcOut", root);
      const madrasaSlug = ($("#rcMadrasa", root) || {}).value || (fixed && fixed.slug) || "";
      const body = {
        madrasaSlug,
        admissionNo: ($("#rcAdmission", root) || {}).value.trim(),
        surname: ($("#rcSurname", root) || {}).value.trim(),
        dateOfBirth: ($("#rcDob", root) || {}).value.trim(),
      };
      if (!body.admissionNo) { toast(t("common.required"), "err"); return; }
      btn.disabled = true; btn.textContent = "…";
      try {
        const d = await window.API.public.post("/results/verify", body);
        if (!d.terms || !d.terms.length) {
          out.innerHTML = `<div class="msg warn" style="margin-top:12px">${esc(d.message || t("pub.results.none"))}</div>`;
          return;
        }
        out.innerHTML = `
          <div class="rc-student">
            <div><b>${esc(d.student.name)}</b> <span class="mono muted">${esc(d.student.admissionNo)}</span></div>
            ${d.student.className ? `<div class="muted small">${esc(d.student.className)}</div>` : ""}
          </div>
          <div class="rc-terms">${d.terms.map((term, i) => `
            <div class="rc-term ${i === 0 ? "on" : ""}">
              <div class="rct-head"><b>${esc(pick(term.name_en, term.name_ar))}</b><span class="muted small">${esc(term.session_label || "")}</span></div>
              <div class="rct-grid">
                <div><span>${esc(t("results.total"))}</span><b>${Number(term.total).toFixed(1)}</b></div>
                <div><span>${esc(t("pub.results.average"))}</span><b>${Number(term.average).toFixed(1)}%</b></div>
                <div><span>${esc(t("pub.results.grade"))}</span><b>${esc(term.overall_grade || "—")}</b></div>
                <div><span>${esc(t("pub.results.position"))}</span><b>${term.position || "—"}</b></div>
              </div>
              <a class="btn small" target="_blank" rel="noopener" href="${esc(window.API.url("/public/results/report/" + term.token))}">🖨 ${esc(t("pub.results.print"))}</a>
            </div>`).join("")}</div>
          <div class="muted small" style="margin-top:10px">${esc(t("pub.results.expired"))}</div>`;
      } catch (e) {
        out.innerHTML = `<div class="msg err" style="margin-top:12px">${esc(errMsg(e))}</div>`;
      } finally {
        btn.disabled = false; btn.textContent = t("pub.results.check");
      }
    };
    const btn = $("#rcGo", root);
    if (btn) btn.addEventListener("click", go2);
    const form = $("#rcBox", root) || root;
    $$("input", form).forEach((i) => i.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); go2(); } }));
  }

  /* ---------------------------- ADMISSION FORM --------------------------- */

  function applyPanel(m) {
    if (m && !m.canApply) {
      return `<div class="card"><div class="empty">📝<div class="small muted" style="margin-top:8px">${esc(t("pub.apply.closed"))}</div></div></div>`;
    }
    const classes = (window.__publicClasses && window.__publicClasses[m && m.slug]) || [];
    const field = (id, label, attrs) => `<label>${esc(label)}</label><input id="${id}" ${attrs || ""}>`;
    return `<div class="card">
        <div class="card-title">📝 ${esc(t("pub.apply.title"))}</div>
        <div class="muted small" style="margin-bottom:10px">${esc(t("pub.apply.intro"))}</div>
        <h3 class="pub-group">${esc(t("pub.apply.studentSection"))}</h3>
        <div class="row">
          <div>${field("apFirst", t("pub.apply.firstName"), "required")}</div>
          <div>${field("apLast", t("pub.apply.lastName"))}</div>
        </div>
        <div class="row">
          <div><label>${esc(t("pub.apply.nameAr"))}</label><input id="apAr" dir="rtl"></div>
          <div><label>${esc(t("pub.apply.gender"))}</label><select id="apGender"><option value="">—</option><option value="M">${esc(t("pub.apply.male"))}</option><option value="F">${esc(t("pub.apply.female"))}</option></select></div>
        </div>
        <div class="row">
          <div>${field("apDob", t("pub.apply.dob"), "placeholder=\"2013-01-01\"")}</div>
          <div><label>${esc(t("pub.apply.class"))}</label><select id="apClass"><option value="">${esc(t("pub.apply.any"))}</option>${classes.map((c) => `<option value="${c.id}">${esc(pick(c.name_en, c.name_ar))}</option>`).join("")}</select></div>
        </div>
        <div class="row">
          <div>${field("apPrev", t("pub.apply.previous"))}</div>
          <div>${field("apLevel", t("pub.apply.level"))}</div>
        </div>
        <h3 class="pub-group">${esc(t("pub.apply.parentSection"))}</h3>
        <div class="row">
          <div>${field("apPName", t("pub.apply.parentName"), "required")}</div>
          <div>${field("apPPhone", t("pub.apply.parentPhone"), "required placeholder=\"+234…\"")}</div>
        </div>
        <div class="row">
          <div>${field("apPEmail", t("pub.apply.parentEmail"))}</div>
          <div>${field("apAddr", t("pub.apply.address"))}</div>
        </div>
        <label>${esc(t("pub.apply.message"))}</label><textarea id="apMsg" rows="3"></textarea>
        <div style="display:none" aria-hidden="true"><label>website</label><input id="apWeb" tabindex="-1" autocomplete="off"></div>
        <div class="form-actions"><button class="btn" id="apGo">${esc(t("pub.apply.submit"))}</button></div>
        <div id="apOut"></div>
      </div>
      ${trackPanel(m)}`;
  }

  function trackPanel(m) {
    return `<div class="card">
        <div class="card-title">🕘 ${esc(t("pub.apply.track"))}</div>
        <div class="row">
          <div>${field2("trRef", t("pub.apply.reference"))}</div>
          <div>${field2("trPhone", t("pub.apply.phoneHint"))}</div>
        </div>
        <div class="form-actions"><button class="btn secondary" id="trGo">${esc(t("pub.apply.status"))}</button></div>
        <div id="trOut"></div>
      </div>`;
  }
  function field2(id, label) { return `<label>${esc(label)}</label><input id="${id}" autocomplete="off">`; }

  async function globalApply(slug) {
    shell("apply", slug ? "apply/" + encodeURIComponent(slug) : "apply");
    let options = [];
    try {
      const d = await window.API.public.get("/madaris");
      options = (d.madaris || []).filter((o) => o.canApply);
    } catch (e) { /* ignore */ }
    if (!slug) {
      render(`
        <section class="pub-section">
          <h1>📝 ${esc(t("pub.apply.title"))}</h1>
          <p class="muted">${esc(t("pub.apply.intro"))}</p>
          ${options.length ? gridOf(options) : `<div class="card"><div class="empty">📝<div class="small muted" style="margin-top:8px">${esc(t("pub.apply.closed"))}</div></div></div>`}
        </section>`);
      return;
    }
    render(`<div id="apBox"></div>`);
    let madrasa = { slug, canApply: true };
    try {
      const d = await window.API.public.get("/madaris/" + encodeURIComponent(slug));
      madrasa = d.madrasa;
      window.__publicClasses = window.__publicClasses || {};
      window.__publicClasses[slug] = d.classes || [];
    } catch (e) {
      render(`<div class="empty">${esc(errMsg(e))}</div>`);
      return;
    }
    const box = $("#apBox");
    box.innerHTML = `<div class="pub-apply-head"><h1>${esc(t("pub.apply.title"))}</h1><div class="muted">${esc(madrasa.nameEn)}</div></div>${applyPanel(madrasa)}`;
    wireApply(box, madrasa);
  }

  function wireApply(root, m) {
    const btn = $("#apGo", root);
    if (!btn) return;
    btn.addEventListener("click", async () => {
      const v = (id) => (($("#" + id, root) || {}).value || "").trim();
      const body = {
        first_name: v("apFirst"), last_name: v("apLast"), name_ar: v("apAr"), gender: v("apGender"),
        date_of_birth: v("apDob"), previous_school: v("apPrev"), quran_level: v("apLevel"),
        parent_name: v("apPName"), parent_phone: v("apPPhone"), parent_email: v("apPEmail"),
        address: v("apAddr"), message: v("apMsg"), website: v("apWeb"),
      };
      const cls = $("#apClass", root);
      if (cls && cls.value) body.class_id = Number(cls.value);
      if (!body.first_name || !body.parent_name || !body.parent_phone) { toast(t("common.required"), "err"); return; }
      btn.disabled = true; btn.textContent = t("pub.apply.sending");
      const out = $("#apOut", root);
      try {
        const d = await window.API.public.post("/madaris/" + encodeURIComponent(m.slug) + "/apply", body);
        out.innerHTML = `<div class="msg ok" style="margin-top:12px"><b>${esc(t("pub.apply.doneTitle"))}</b> — ${esc(t("pub.apply.reference"))}: <span class="mono" style="font-weight:700">${esc(d.reference)}</span>
          <div class="small" style="margin-top:4px">${esc(t("pub.apply.intro"))}</div></div>`;
        $$("input, textarea", root).forEach((i) => { i.value = ""; });
        const ref = $("#trRef", root); if (ref) ref.value = d.reference;
      } catch (e) {
        out.innerHTML = `<div class="msg err" style="margin-top:12px">${esc(errMsg(e))}</div>`;
      } finally {
        btn.disabled = false; btn.textContent = t("pub.apply.submit");
      }
    });
    const track = $("#trGo", root);
    if (track) track.addEventListener("click", async () => {
      const out = $("#trOut", root);
      try {
        const q = new URLSearchParams({ reference: ($("#trRef", root).value || "").trim(), phone: ($("#trPhone", root).value || "").trim() });
        const d = await window.API.public.get("/madaris/" + encodeURIComponent(m.slug) + "/apply-status?" + q.toString());
        const labels = { pending: t("adm.pending"), approved: t("adm.approved"), rejected: t("adm.rejected"), on_hold: t("adm.onhold") };
        out.innerHTML = `<div class="msg ${d.status === "approved" ? "ok" : d.status === "rejected" ? "err" : "warn"}" style="margin-top:12px">
            <b>${esc(d.student)}</b> — ${esc(labels[d.status] || d.status)}
            ${d.note ? `<div class="small">${esc(d.note)}</div>` : ""}
            ${d.admissionNo ? `<div class="small">${esc(t("pub.admittedAs"))}: <b class="mono">${esc(d.admissionNo)}</b></div>` : ""}
            ${d.resultsUrl ? `<div class="small"><a href="#${esc(d.resultsUrl)}">${esc(t("pub.checkResults"))}</a></div>` : ""}
            <div class="small muted">${esc(new Date(d.submittedAt).toLocaleDateString())}</div>
          </div>`;
      } catch (e) { out.innerHTML = `<div class="msg err" style="margin-top:12px">${esc(errMsg(e))}</div>`; }
    });
  }

  window.Public = {
    isPublicPath,
    home,
    directory,
    madrasaPage,
    globalResults,
    globalApply,
  };
})();
