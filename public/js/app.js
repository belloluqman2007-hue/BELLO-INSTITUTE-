"use strict";

/* BELLO public education platform application & client router */
(function () {
  const app = document.getElementById("app");
  if (!app) return;

  const icons = {
    arrow: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6"/></svg>`,
    arrowUp: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17 17 7M9 7h8v8"/></svg>`,
    menu: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>`,
    close: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>`,
    check: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.2 4.2L19.5 6.5"/></svg>`,
    book: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.7A3.7 3.7 0 0 1 7.7 2H12v18H7.7A3.7 3.7 0 0 0 4 23V5.7ZM20 5.7A3.7 3.7 0 0 0 16.3 2H12v18h4.3A3.7 3.7 0 0 1 20 23V5.7Z"/></svg>`,
    compass: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="m15.8 8.2-2.3 5.3-5.3 2.3 2.3-5.3 5.3-2.3Z"/></svg>`,
    school: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 10 9-5 9 5-9 5-9-5Z"/><path d="M6 12.2V17c2.9 2.7 9.1 2.7 12 0v-4.8M21 10v6"/></svg>`,
    pin: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 10.2c0 5.2-8 10.3-8 10.3s-8-5.1-8-10.3a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10.2" r="2.6"/></svg>`,
    search: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.4"/><path d="m16 16 4.4 4.4"/></svg>`,
    spark: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5L12 3ZM19 16l.6 2.4L22 19l-2.4.6L19 22l-.6-2.4L16 19l2.4-.6L19 16Z"/></svg>`,
    globe: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.3 2.3 3.5 5.1 3.5 8.5S14.3 18.2 12 20.5C9.7 18.2 8.5 15.4 8.5 12S9.7 5.8 12 3.5Z"/></svg>`,
    users: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3"/><path d="M3.5 20v-2.1A4.9 4.9 0 0 1 8.4 13h1.2a4.9 4.9 0 0 1 4.9 4.9V20M16 5.5a3 3 0 0 1 0 5.8M18.3 13.4a4.7 4.7 0 0 1 2.2 4V20"/></svg>`,
    instagram: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r=".8" fill="currentColor" stroke="none"/></svg>`,
    linkedin: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 9.5V18M6.5 6.5v.1M10.5 18v-5a3.5 3.5 0 0 1 7 0v5M10.5 10v8"/><circle cx="6.5" cy="6.5" r="1"/></svg>`,
    facebook: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 21v-8h3l.5-3H14V8.1c0-.9.3-1.6 1.7-1.6h2V3.8c-.4-.1-1.2-.2-2.2-.2-2.3 0-3.8 1.4-3.8 4V10H9v3h2.7v8"/></svg>`
  };

  let scrollHandler = null;

  function brandMarkup() {
    return `
      <a class="brand" href="/" data-route="/" aria-label="BELLO home">
        <span class="brand-logo"><img src="/assets/bello-multi-madrasa-platform-logo.png" alt="BELLO logo"></span>
        <span class="brand-words"><strong>BELLO</strong><small>Education Platform</small></span>
      </a>`;
  }

  function navLink(label, href, active) {
    return `<a${active ? " class=\"active\" aria-current=\"page\"" : ""} href="${href}" data-route="${href}">${label}</a>`;
  }

  function headerMarkup(active) {
    return `
      <header class="site-header" id="top">
        <div class="nav-shell">
          ${brandMarkup()}
          <nav class="desktop-nav platform-nav" aria-label="Primary navigation">
            ${navLink("Home", "/", active === "home")}
            ${navLink("Islamic Schools", "/islamic-schools", active === "islamic")}
            ${navLink("Western Academies", "/western-schools", active === "western")}
            <a href="/#how-bello" data-route="/#how-bello">How BELLO Works</a>
          </nav>
          <div class="nav-actions">
            <a class="login-link" href="/#institution-future" data-route="/#institution-future">For institutions</a>
            <a class="button button-small" href="/islamic-schools" data-route="/islamic-schools">Explore schools <span>${icons.arrow}</span></a>
          </div>
          <button class="menu-toggle" type="button" aria-expanded="false" aria-controls="mobile-menu" aria-label="Open menu">
            <span class="open-icon">${icons.menu}</span><span class="close-icon">${icons.close}</span>
          </button>
        </div>
        <nav class="mobile-nav" id="mobile-menu" aria-label="Mobile navigation" aria-hidden="true">
          ${navLink("Home", "/", active === "home")}
          ${navLink("Islamic Schools", "/islamic-schools", active === "islamic")}
          ${navLink("Western Academies", "/western-schools", active === "western")}
          <a href="/#how-bello" data-route="/#how-bello">How BELLO Works</a>
          <a href="/#institution-future" data-route="/#institution-future">For institutions</a>
          <a class="button" href="/islamic-schools" data-route="/islamic-schools">Explore schools <span>${icons.arrow}</span></a>
        </nav>
      </header>`;
  }

  function footerMarkup() {
    return `
      <footer class="site-footer" id="footer">
        <div class="container footer-grid">
          <div class="footer-brand">
            ${brandMarkup()}
            <p>A connected education platform helping families discover the right school and helping independent institutions grow with confidence.</p>
            <div class="socials"><a href="#footer" aria-label="BELLO on Instagram">${icons.instagram}</a><a href="#footer" aria-label="BELLO on LinkedIn">${icons.linkedin}</a><a href="#footer" aria-label="BELLO on Facebook">${icons.facebook}</a></div>
          </div>
          <div class="footer-col"><h3>Explore</h3><a href="/islamic-schools" data-route="/islamic-schools">Islamic Schools</a><a href="/western-schools" data-route="/western-schools">Western Academies</a><a href="/#how-bello" data-route="/#how-bello">How BELLO works</a></div>
          <div class="footer-col"><h3>For institutions</h3><a href="/register-madrasa" data-route="/register-madrasa">Register an Islamic School</a><a href="/western-schools#western-registration" data-route="/western-schools#western-registration">Register a Western Academy</a></div>
          <div class="footer-col"><h3>Platform</h3><a href="/#institution-future" data-route="/#institution-future">Independent school sites</a><a href="#footer">Contact</a><a href="#footer">Privacy &amp; Terms</a></div>
        </div>
        <div class="container footer-bottom"><span>© <span id="year"></span> BELLO Education Platform. All rights reserved.</span><span>Discover <i></i> Connect <i></i> Grow</span></div>
      </footer>`;
  }

  function schoolChoiceCard(kind) {
    const islamic = kind === "islamic";
    const title = islamic ? "Islamic School" : "Western Academy";
    const description = islamic
      ? "Discover madrasas, Arabic schools, Qur'an schools, and Islamic learning institutions."
      : "Discover modern academic schools offering quality education and a wide range of subjects.";
    const href = islamic ? "/islamic-schools" : "/western-schools";
    const image = islamic ? "/assets/islamic-school-learning.jpg" : "/assets/western-academy-learning.jpg";
    const alt = islamic ? "Students learning together in an Islamic school" : "Students collaborating in a modern academy";
    const label = islamic ? "Faith-led learning" : "Modern academic learning";
    const button = islamic ? "Explore Islamic Schools" : "Explore Western Academies";
    return `
      <article class="education-choice education-choice--${kind} reveal">
        <a class="choice-image" href="${href}" data-route="${href}" aria-label="${button}">
          <img src="${image}" alt="${alt}">
          <span class="choice-image-overlay"></span>
          <span class="choice-image-label">${islamic ? icons.book : icons.school} ${label}</span>
        </a>
        <div class="choice-content">
          <div class="choice-icon">${islamic ? icons.book : icons.school}</div>
          <h3>${title}</h3>
          <p>${description}</p>
          <a class="button choice-button" href="${href}" data-route="${href}">${button} <span>${icons.arrow}</span></a>
        </div>
      </article>`;
  }

  function renderHomepage() {
    document.title = "BELLO — Education Platform";
    app.innerHTML = `
      ${headerMarkup("home")}
      <main id="main-content" class="platform-home">
        <section class="platform-hero section-pattern" aria-labelledby="hero-title">
          <div class="hero-orb hero-orb-one"></div><div class="hero-orb hero-orb-two"></div>
          <div class="container">
            <div class="platform-hero-intro reveal">
              <p class="eyebrow"><span class="eyebrow-dot"></span>One connected education platform</p>
              <h1 id="hero-title">Welcome to <em>BELLO</em></h1>
              <p class="platform-hero-copy">A smarter way to discover, connect, and manage education.</p>
            </div>
            <div class="choice-heading reveal">
              <span class="choice-heading-line"></span>
              <h2>What type of school are you looking for?</h2>
              <span class="choice-heading-line"></span>
            </div>
            <div class="education-choice-grid">
              ${schoolChoiceCard("islamic")}
              ${schoolChoiceCard("western")}
            </div>
            <p class="hero-reassurance platform-reassurance reveal"><span class="mini-check">${icons.check}</span><span>Choose a path to begin exploring a growing network of independent institutions.</span></p>
          </div>
        </section>

        <section class="platform-intro-section" id="how-bello" aria-labelledby="how-title">
          <div class="container platform-intro-grid">
            <div class="platform-intro-copy reveal">
              <p class="section-kicker">Simple by design</p>
              <h2 id="how-title">One platform. <em>Many schools.</em></h2>
              <p>BELLO makes it easy to start with the education that matters to you, then connect directly with the institutions that serve your family.</p>
              <a class="text-link platform-text-link" href="/islamic-schools" data-route="/islamic-schools">Explore the platform <span>${icons.arrow}</span></a>
            </div>
            <ol class="journey-steps reveal" aria-label="How the BELLO education journey works">
              <li><span class="journey-number">01</span><div><strong>Choose an education type</strong><small>Islamic School or Western Academy</small></div></li>
              <li><span class="journey-number">02</span><div><strong>Explore the public directory</strong><small>Discover institutions and their learning paths</small></div></li>
              <li><span class="journey-number">03</span><div><strong>Connect with a school</strong><small>Visit the institution and begin your journey</small></div></li>
            </ol>
          </div>
        </section>

        <section class="institution-future-section" id="institution-future" aria-labelledby="institution-title">
          <div class="container">
            <div class="institution-future-card reveal">
              <div class="future-copy">
                <p class="section-kicker light-kicker">Built for independent institutions</p>
                <h2 id="institution-title">Every school can grow with its <em>own identity.</em></h2>
                <p>BELLO is the technology behind the experience—not the identity of the school. Each institution can have its own public presence, information, courses, people, admissions and announcements.</p>
              </div>
              <div class="identity-path" aria-label="Future BELLO platform architecture">
                <div class="identity-node identity-node--bello"><span>${icons.spark}</span><strong>BELLO</strong><small>Platform</small></div>
                <i class="identity-connector" aria-hidden="true">${icons.arrow}</i>
                <div class="identity-node"><span>${icons.compass}</span><strong>Education type</strong><small>Directory</small></div>
                <i class="identity-connector" aria-hidden="true">${icons.arrow}</i>
                <div class="identity-node identity-node--school"><span>${icons.globe}</span><strong>School website</strong><small>school.bello.ng</small></div>
              </div>
            </div>
          </div>
        </section>

        <section class="platform-cta-section" aria-labelledby="start-title">
          <div class="container platform-cta-content reveal">
            <p class="section-kicker">Made for the next generation of schools</p>
            <h2 id="start-title">Find the right place to <em>learn and grow.</em></h2>
            <p>Start by choosing the kind of education you want to explore.</p>
            <div class="cta-actions"><a class="button button-primary" href="/islamic-schools" data-route="/islamic-schools">Islamic Schools <span>${icons.arrow}</span></a><a class="button button-secondary" href="/western-schools" data-route="/western-schools">Western Academies <span>${icons.arrow}</span></a></div>
          </div>
        </section>
      </main>
      ${footerMarkup()}`;
    initPageEvents();
  }

  const categoryData = {
    islamic: {
      active: "islamic",
      shortName: "Islamic Schools",
      title: "Islamic education, ready to discover.",
      copy: "A dedicated BELLO destination for madrasas, Arabic schools, Qur'an schools, and Islamic learning institutions.",
      image: "/assets/islamic-school-learning.jpg",
      imageAlt: "Students studying the Qur'an and Arabic books together",
      eyebrow: "BELLO / Islamic Schools",
      theme: "islamic",
      audienceTitle: "A home for every Islamic learning path.",
      audienceCopy: "We are preparing a thoughtful public directory that makes it easier for learners and families to discover the institutions and subjects that meet their needs.",
      types: ["Madrasa", "Arabic School", "Qur'an School", "Islamic Learning Centre"],
      typeIcon: "book",
      listingTitle: "The Islamic school directory is taking shape.",
      listingCopy: "Search, location, subjects, featured institutions and school registration will live here as the BELLO Islamic Schools network grows.",
      registerTitle: "Bring your Islamic school to BELLO.",
      registerCopy: "Create your institution profile today and join the foundation of a connected Islamic education community.",
      registerLabel: "Register an Islamic School",
      registerHref: "/register-madrasa",
      registerRoute: "/register-madrasa",
      featureCards: [["Find institutions", "Discover schools in the communities that matter to you.", "search"], ["Explore subjects", "See the learning paths and programmes each school offers.", "book"], ["Connect with confidence", "Get to know an institution before taking the next step.", "users"]]
    },
    western: {
      active: "western",
      shortName: "Western Academies",
      title: "Modern education, ready to discover.",
      copy: "A dedicated BELLO destination for independent academic schools, programmes and learning communities.",
      image: "/assets/western-academy-learning.jpg",
      imageAlt: "Students and a teacher collaborating in a modern academy",
      eyebrow: "BELLO / Western Academies",
      theme: "western",
      audienceTitle: "A home for every academic journey.",
      audienceCopy: "We are preparing a clear public directory that will help families find modern schools and discover the classes, programmes and subjects that suit their goals.",
      types: ["Primary School", "Secondary School", "College", "Other Academy"],
      typeIcon: "school",
      listingTitle: "The Western Academy directory is taking shape.",
      listingCopy: "Search, location, subjects, featured schools and academy registration will live here as the BELLO Western Academies network grows.",
      registerTitle: "Western Academy registration is coming next.",
      registerCopy: "This public foundation is ready. Separate academy registration and category setup will be introduced as the directory grows.",
      registerLabel: "Registration opening soon",
      registerHref: "#western-registration",
      registerRoute: "#western-registration",
      featureCards: [["Find schools", "Discover academic institutions in the places that work for your family.", "search"], ["Explore programmes", "See the subjects, classes and learning opportunities on offer.", "school"], ["Plan with clarity", "Get the information you need before connecting with a school.", "compass"]]
    }
  };

  function categoryFeatureCards(data) {
    return data.featureCards.map(([title, copy, icon]) => `
      <article class="category-feature-card reveal"><span class="category-feature-icon">${icons[icon]}</span><h3>${title}</h3><p>${copy}</p></article>`).join("");
  }

  function categoryTypeCards(data) {
    return data.types.map((type, index) => `
      <article class="institution-type-card reveal"><span>${String(index + 1).padStart(2, "0")}</span><div class="institution-type-icon">${icons[data.typeIcon]}</div><h3>${type}</h3><p>Built to be discoverable through BELLO.</p></article>`).join("");
  }

  function renderCategory(kind) {
    const data = categoryData[kind];
    if (!data) return renderHomepage();
    document.title = `BELLO — ${data.shortName}`;
    app.innerHTML = `
      ${headerMarkup(data.active)}
      <main id="main-content" class="category-page category-page--${data.theme}">
        <section class="category-hero section-pattern" aria-labelledby="category-title">
          <div class="hero-orb hero-orb-one"></div><div class="hero-orb hero-orb-two"></div>
          <div class="container category-hero-grid">
            <div class="category-hero-copy reveal">
              <p class="eyebrow"><span class="eyebrow-dot"></span>${data.eyebrow}</p>
              <a class="breadcrumb" href="/" data-route="/">BELLO <span>/</span> ${data.shortName}</a>
              <h1 id="category-title">${data.title}</h1>
              <p>${data.copy}</p>
              <div class="hero-actions"><a class="button button-primary" href="#directory-preview">Explore the directory <span>${icons.arrow}</span></a><a class="button button-secondary" href="/" data-route="/">Choose another path</a></div>
            </div>
            <div class="category-hero-image reveal reveal-delay">
              <img src="${data.image}" alt="${data.imageAlt}">
              <span class="category-hero-image-shade"></span>
              <span class="category-image-badge">${icons.spark} A growing BELLO community</span>
            </div>
          </div>
        </section>

        <section class="category-purpose-section" aria-labelledby="purpose-title">
          <div class="container">
            <div class="section-heading centered reveal">
              <p class="section-kicker">Public directory, in progress</p>
              <h2 id="purpose-title">${data.audienceTitle}</h2>
              <p>${data.audienceCopy}</p>
            </div>
            <div class="category-feature-grid">${categoryFeatureCards(data)}</div>
          </div>
        </section>

        <section class="institution-types-section" aria-labelledby="types-title">
          <div class="container">
            <div class="section-heading split-heading reveal"><div><p class="section-kicker">Built for the community</p><h2 id="types-title">Explore by institution type.</h2></div><p>Each school will have the space to be discovered on its own terms, with its own story and public identity.</p></div>
            <div class="institution-type-grid">${categoryTypeCards(data)}</div>
          </div>
        </section>

        <section class="directory-preview-section" id="directory-preview" aria-labelledby="directory-title">
          <div class="container directory-preview-card reveal">
            <div class="directory-preview-icon">${icons.search}</div>
            <div><p class="section-kicker">Coming next</p><h2 id="directory-title">${data.listingTitle}</h2><p>${data.listingCopy}</p></div>
            <a class="text-link directory-home-link" href="/" data-route="/">Return to BELLO <span>${icons.arrow}</span></a>
          </div>
        </section>

        <section class="category-register-section" id="${kind === "western" ? "western-registration" : "register-islamic-school"}" aria-labelledby="register-title">
          <div class="container category-register-card reveal">
            <div><p class="section-kicker light-kicker">For school leaders</p><h2 id="register-title">${data.registerTitle}</h2><p>${data.registerCopy}</p></div>
            <a class="button button-gold" href="${data.registerHref}"${data.registerRoute.startsWith("/") ? ` data-route="${data.registerRoute}"` : ""}>${data.registerLabel} ${data.registerRoute.startsWith("/") ? `<span>${icons.arrow}</span>` : ""}</a>
          </div>
        </section>
      </main>
      ${footerMarkup()}`;
    initPageEvents();
  }

  function initPageEvents() {
    const toggle = document.querySelector(".menu-toggle");
    const menu = document.querySelector(".mobile-nav");
    const header = document.querySelector(".site-header");

    if (toggle && menu) {
      const closeMenu = () => {
        toggle.setAttribute("aria-expanded", "false");
        toggle.setAttribute("aria-label", "Open menu");
        menu.setAttribute("aria-hidden", "true");
        document.body.classList.remove("menu-open");
      };
      toggle.addEventListener("click", () => {
        const open = toggle.getAttribute("aria-expanded") !== "true";
        toggle.setAttribute("aria-expanded", String(open));
        toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
        menu.setAttribute("aria-hidden", String(!open));
        document.body.classList.toggle("menu-open", open);
      });
      menu.querySelectorAll("a").forEach((link) => link.addEventListener("click", closeMenu));
    }

    if (scrollHandler) window.removeEventListener("scroll", scrollHandler);
    if (header) {
      scrollHandler = () => header.classList.toggle("is-scrolled", window.scrollY > 8);
      scrollHandler();
      window.addEventListener("scroll", scrollHandler, { passive: true });
    }

    const year = document.getElementById("year");
    if (year) year.textContent = new Date().getFullYear();

    if ("IntersectionObserver" in window && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const observer = new IntersectionObserver((entries) => entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      }), { threshold: 0.12 });
      document.querySelectorAll(".reveal").forEach((element) => observer.observe(element));
    } else {
      document.querySelectorAll(".reveal").forEach((element) => element.classList.add("is-visible"));
    }

    document.querySelectorAll("[data-route]").forEach((link) => {
      link.addEventListener("click", (event) => {
        const route = link.getAttribute("data-route");
        if (!route) return;
        event.preventDefault();
        window.BelloRouter.navigate(route);
      });
    });
  }

  function renderRegistration() {
    if (window.BelloRegister && typeof window.BelloRegister.mount === "function") {
      window.BelloRegister.mount();
    }
  }

  function renderRoute() {
    const path = window.location.pathname.replace(/\/+$/, "") || "/";
    const hash = window.location.hash;

    if (path === "/register-madrasa" || hash === "#/register-madrasa" || hash === "#register-madrasa") {
      renderRegistration();
    } else if (path === "/islamic-schools") {
      renderCategory("islamic");
    } else if (path === "/western-schools") {
      renderCategory("western");
    } else {
      renderHomepage();
    }
  }

  window.BelloRouter = {
    navigate(route) {
      if (route.startsWith("/#") || route.startsWith("#")) {
        const targetId = route.replace(/^\/#|^#/, "");
        if (window.location.pathname !== "/") {
          history.pushState(null, "", "/");
          renderRoute();
        }
        requestAnimationFrame(() => {
          const target = document.getElementById(targetId);
          if (target) target.scrollIntoView({ behavior: "smooth" });
        });
        return;
      }

      const [pathname, fragment] = route.split("#");
      history.pushState(null, "", pathname || "/");
      renderRoute();
      requestAnimationFrame(() => {
        if (fragment) {
          const target = document.getElementById(fragment);
          if (target) target.scrollIntoView({ behavior: "smooth" });
        } else {
          window.scrollTo({ top: 0, behavior: "smooth" });
        }
      });
    }
  };

  window.addEventListener("popstate", renderRoute);
  renderRoute();

  /* Small compatibility surface kept for existing integrations. */
  window.App = {
    mount: renderRoute,
    routeTo: async (path) => window.BelloRouter.navigate("/" + String(path).replace(/^\//, "")),
    refreshMe: async () => null,
    me: null
  };
})();
