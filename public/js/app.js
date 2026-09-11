"use strict";

/*
 * Bello Institute — frontend starting point
 *
 * The previous frontend modules have intentionally been removed from the
 * rendered site. This file only mounts the empty starter screen and keeps a
 * tiny App surface for the next frontend build. It does not call the API,
 * create sessions, change routes on the server, or read/write application
 * data.
 */
(function () {
  const app = document.getElementById("app");

  function mount() {
    if (!app) return;
    app.innerHTML = `
      <section class="starter" aria-labelledby="starter-title">
        <div class="starter-card">
          <div class="starter-mark" aria-hidden="true">✦</div>
          <p class="starter-eyebrow">Bello Institute</p>
          <h1 class="starter-title" id="starter-title">A new beginning</h1>
          <p class="starter-copy">The website has been cleared and is ready for the next features.</p>
        </div>
      </section>`;
  }

  // Keep the mountable surface small and predictable for the next build.
  window.App = {
    mount,
    routeTo: async function () { mount(); },
    refreshMe: async function () { return null; },
    me: null,
  };

  mount();
})();
