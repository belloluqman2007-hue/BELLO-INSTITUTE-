"use strict";

/* Translation UI is intentionally not mounted on the cleared starter page. */
window.I18N = Object.freeze({
  lang: "en",
  t: (key) => String(key || ""),
  setLang: () => "en",
  applyStatic: () => {},
});
