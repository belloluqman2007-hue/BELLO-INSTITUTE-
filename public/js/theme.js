"use strict";
/* ============================================================================
   MULTI-MADRASA PLATFORM — theme (light / dark)
   ----------------------------------------------------------------------------
   Loaded from <head> so the stored theme is applied BEFORE the first paint
   (no white flash for dark-mode users). The app's CSP allows 'self' scripts
   only, which is why this is a file rather than an inline <script>.
   ========================================================================== */
(function () {
  const KEY = "mm_theme";

  function current() {
    let v = null;
    try { v = localStorage.getItem(KEY); } catch (e) { /* private mode */ }
    if (v === "dark" || v === "light") return v;
    // Follow the OS until the user picks something explicitly.
    try {
      if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) return "dark";
    } catch (e) { /* ignore */ }
    return "light";
  }

  function apply(v) {
    const theme = v === "dark" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", theme);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", theme === "dark" ? "#08130c" : "#0f3d21");
    return theme;
  }

  function set(v) {
    try { localStorage.setItem(KEY, apply(v)); } catch (e) { apply(v); }
  }

  // Apply as early as possible (documentElement already exists while the
  // <head> is still parsing). Nothing is persisted here: an OS preference must
  // stay a preference, so only an explicit toggle is remembered.
  apply(current());

  window.Theme = {
    get: current,
    set,
    toggle() { set(current() === "dark" ? "light" : "dark"); return current(); },
  };
})();
