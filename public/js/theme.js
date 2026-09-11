"use strict";

/* Theme controls are intentionally not mounted on the cleared starter page. */
const STARTER_THEME_KEY = "mm_theme";
window.Theme = Object.freeze({
  get: () => "light",
  set: () => "light",
  toggle: () => "light",
});
