"use strict";
/* ============================================================================
   BELLO — print helper for server-rendered print pages
   ----------------------------------------------------------------------------
   The platform CSP is script-src 'self', so print pages (fee receipts,
   payslips) must NOT use inline scripts or inline onclick handlers. This
   same-origin script opens the browser print dialog once the page has loaded
   and wires the visible print button as a manual fallback.
   ========================================================================== */
(function () {
  function printNow() {
    try { window.print(); } catch (e) { /* printing unavailable */ }
  }
  function init() {
    var button = document.getElementById("printPageBtn");
    if (button) button.addEventListener("click", printNow);
    // Small delay lets styles/images settle before the dialog opens.
    window.setTimeout(printNow, 150);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
