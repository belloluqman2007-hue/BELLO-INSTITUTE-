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
    facebook: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 21v-8h3l.5-3H14V8.1c0-.9.3-1.6 1.7-1.6h2V3.8c-.4-.1-1.2-.2-2.2-.2-2.3 0-3.8 1.4-3.8 4V10H9v3h2.7v8"/></svg>`,
    graduation: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 9 9-5 9 5-9 5-9-5Z"/><path d="M7 11.3v4.4c2.6 2.2 7.4 2.2 10 0v-4.4M21 9v5"/></svg>`,
    calculator: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8 7h8M8 11h.01M12 11h.01M16 11h.01M8 15h.01M12 15h.01M16 15h.01M8 18h.01M12 18h.01M16 18h.01"/></svg>`,
    pen: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 20 4.1-1 10-10a2.1 2.1 0 0 0-3-3l-10 10L4 20Z"/><path d="m13.5 7.5 3 3M4 20l4-4"/></svg>`,
    flask: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6M10 3v6l-5.5 8.6A2.2 2.2 0 0 0 6.3 21h11.4a2.2 2.2 0 0 0 1.8-3.4L14 9V3"/><path d="M7.4 15h9.2"/></svg>`,
    code: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 8-4 4 4 4M16 8l4 4-4 4M14 5l-4 14"/></svg>`,
    monitor: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></svg>`,
    briefcase: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="7" width="18" height="12" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12h18M10 12v2h4v-2"/></svg>`,
    palette: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 1 0 0 18h1.3a1.7 1.7 0 0 0 1.4-2.7 1.7 1.7 0 0 1 1.4-2.7H18A3 3 0 0 0 21 12 9 9 0 0 0 12 3Z"/><circle cx="7.5" cy="12" r=".8" fill="currentColor" stroke="none"/><circle cx="10" cy="8" r=".8" fill="currentColor" stroke="none"/><circle cx="14" cy="8" r=".8" fill="currentColor" stroke="none"/></svg>`,
    chart: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19V5M4 19h16M8 16v-4M12 16V8M16 16v-7"/></svg>`,
    languages: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h9M8.5 3v2c0 5-2.4 8.1-5.5 10M5.5 10h6M14 19l3.5-9 3.5 9M15.2 16h4.6"/></svg>`,
    shieldCheck: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 19 6v5.4c0 4.2-2.8 7.8-7 9.6-4.2-1.8-7-5.4-7-9.6V6l7-3Z"/><path d="m8.5 12 2.2 2.2 4.7-4.7"/></svg>`,
    rocket: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 4.2c2.7-.7 4.5-.2 5.3.5.7.7 1.2 2.5.5 5.3-.7 2.7-2.4 5.5-5.1 8.2l-3.1-3.1c-1.3-1.3-2.3-2.8-3.1-4.4 2.7-2.7 5.5-4.4 8.2-5.1Z"/><path d="m9 10.7-4.2.4-1.8 1.8 4.2 1.4M13.3 15l-.4 4.2-1.8 1.8-1.4-4.2M12.5 7.2h.01"/><path d="m9.5 14.5-4 4"/></svg>`,
    building: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 21V5l8-2v18M20 21V9l-8-2M8 7h1M8 11h1M8 15h1M14 11h1M18 11h1M14 15h1M18 15h1M2 21h20"/></svg>`,
    filter: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4"/></svg>`
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
    document.body.classList.remove("western-experience", "western-menu-open");
    const themeMeta = document.querySelector('meta[name="theme-color"]');
    if (themeMeta) themeMeta.content = "#0b402c";
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


  /* Western Academy is intentionally rendered as a dedicated public experience.
     The directory data below is presentation-only until the academy API is ready. */
  const westernAcademies = [
    {
      name: "Northbridge Academy", mark: "N", tone: "northbridge", location: "Lekki, Lagos", state: "Lagos", city: "Lekki", type: "Independent School", level: "Secondary", verified: true,
      description: "A future-focused secondary school where strong academics meet creativity, technology and leadership.", programs: ["STEAM", "Arts", "Leadership"], subjects: ["Mathematics", "Sciences", "Computer Science"]
    },
    {
      name: "Crestfield College", mark: "C", tone: "crestfield", location: "Ibadan, Oyo", state: "Oyo", city: "Ibadan", type: "College / Sixth Form", level: "College / Sixth Form", verified: true,
      description: "Helping ambitious learners prepare for university, professional study and life beyond the classroom.", programs: ["A-Level", "Business", "Sciences"], subjects: ["Business", "English", "Sciences"]
    },
    {
      name: "Brighton Gate School", mark: "B", tone: "brighton", location: "Wuse, Abuja", state: "FCT", city: "Abuja", type: "Private School", level: "Primary", verified: false,
      description: "A warm, curious learning community built around confident foundations and whole-child development.", programs: ["Primary", "Digital Skills", "Creative Arts"], subjects: ["English", "Technology", "Arts"]
    }
  ];

  const westernWhyCards = [
    ["Academic Excellence", "Rigorous learning pathways that help students think deeply, achieve strongly and keep progressing.", "graduation"],
    ["Qualified Teachers", "Discover academies led by knowledgeable educators who bring subjects to life.", "users"],
    ["Modern Learning", "Explore schools that balance strong foundations with relevant, engaging classroom experiences.", "monitor"],
    ["Technology", "Find learning environments where digital confidence is part of every student’s future.", "code"],
    ["Student Development", "See how academies support confidence, collaboration, wellbeing and individual potential.", "spark"],
    ["Career Preparation", "Connect with programmes that turn ambition into practical next steps and opportunities.", "rocket"]
  ];

  const westernSubjects = [
    ["Mathematics", "Numbers, reasoning & problem-solving", "calculator", "blue"],
    ["English", "Communication & critical reading", "pen", "sky"],
    ["Sciences", "Curiosity, discovery & experimentation", "flask", "violet"],
    ["Computer Science", "Coding, logic & digital creation", "code", "navy"],
    ["Technology", "Practical skills for a changing world", "monitor", "teal"],
    ["Business", "Enterprise, economics & leadership", "briefcase", "amber"],
    ["Arts", "Creative expression & visual thinking", "palette", "coral"],
    ["Social Sciences", "People, society & global perspectives", "chart", "indigo"],
    ["Languages", "New voices & cultural connection", "languages", "mint"]
  ];

  const westernLevels = [
    ["Primary", "A confident beginning for curious young learners.", "01", "school"],
    ["Secondary", "Academic depth, discovery and direction.", "02", "graduation"],
    ["College / Sixth Form", "Advanced study for ambitious next steps.", "03", "book"],
    ["Vocational & Professional", "Practical, career-ready learning pathways.", "04", "briefcase"],
    ["Other", "Alternative academies and specialist education.", "05", "compass"]
  ];

  function westernBrandMarkup() {
    return `
      <a class="western-brand" href="#western-top" aria-label="BELLO Western Academy home">
        <span class="western-brand-icon" aria-hidden="true"><span>B</span></span>
        <span class="western-brand-name"><strong>BELLO</strong><small>Education Platform</small></span>
        <span class="western-brand-divider" aria-hidden="true"></span>
        <span class="western-brand-section">Western Academy</span>
      </a>`;
  }

  function westernHeaderMarkup() {
    return `
      <header class="western-header" id="western-top">
        <div class="western-nav-shell">
          ${westernBrandMarkup()}
          <nav class="western-desktop-nav" aria-label="Western Academy navigation">
            <a class="active" href="#western-top" aria-current="page">Home</a>
            <a href="#academies">Schools</a>
            <a href="#academic-areas">Programs</a>
            <a href="#academic-areas">Subjects</a>
            <a href="#about">About</a>
            <a href="#western-contact">Contact</a>
          </nav>
          <div class="western-nav-actions">
            <a class="western-login" href="/#/login">Login</a>
            <a class="western-register-button" href="#academy-registration">Register Your Academy <span>${icons.arrow}</span></a>
          </div>
          <button class="western-menu-toggle" type="button" aria-expanded="false" aria-controls="western-mobile-menu" aria-label="Open menu">
            <span class="western-open-icon">${icons.menu}</span><span class="western-close-icon">${icons.close}</span>
          </button>
        </div>
        <nav class="western-mobile-nav" id="western-mobile-menu" aria-label="Western Academy mobile navigation" aria-hidden="true">
          <a href="#western-top">Home</a><a href="#academies">Schools</a><a href="#academic-areas">Programs</a><a href="#academic-areas">Subjects</a><a href="#about">About</a><a href="#western-contact">Contact</a>
          <a class="western-mobile-login" href="/#/login">Login</a>
          <a class="western-register-button" href="#academy-registration">Register Your Academy <span>${icons.arrow}</span></a>
        </nav>
      </header>`;
  }

  function westernFooterMarkup() {
    return `
      <footer class="western-footer" id="western-contact">
        <div class="western-container western-footer-grid">
          <div class="western-footer-intro">
            ${westernBrandMarkup()}
            <p>Helping families discover modern academic education, and giving every academy a confident online home.</p>
            <div class="western-footer-socials"><a href="#western-contact" aria-label="BELLO Western Academy on LinkedIn">${icons.linkedin}</a><a href="#western-contact" aria-label="BELLO Western Academy on Instagram">${icons.instagram}</a><a href="#western-contact" aria-label="BELLO Western Academy on Facebook">${icons.facebook}</a></div>
          </div>
          <div class="western-footer-column"><h3>Explore</h3><a href="#academies">Schools</a><a href="#academic-areas">Programs</a><a href="#academic-areas">Subjects</a><a href="#about">About</a></div>
          <div class="western-footer-column"><h3>For academies</h3><a href="#academy-registration">Register Your Academy</a><a href="#about">Your school website</a><a href="/#/login">Login</a><a href="#western-contact">Contact</a></div>
          <div class="western-footer-column"><h3>Platform</h3><a href="#western-contact">Contact</a><a href="#western-contact">Privacy Policy</a><a href="#western-contact">Terms</a><a href="/" data-route="/">BELLO Education Platform</a></div>
        </div>
        <div class="western-container western-footer-bottom"><span>© <span id="western-year"></span> BELLO Western Academy. All rights reserved.</span><span>Powered by BELLO Education Platform</span></div>
      </footer>`;
  }

  function westernIconCard(items, cardClass) {
    return items.map(([title, copy, icon, tone]) => `
      <article class="${cardClass} reveal">
        <span class="western-icon ${tone ? `western-icon--${tone}` : ""}">${icons[icon]}</span>
        <h3>${title}</h3><p>${copy}</p>
      </article>`).join("");
  }

  function westernAcademyCard(academy) {
    const searchTerms = [academy.name, academy.location, academy.type, academy.level, ...academy.programs, ...academy.subjects].join(" ").toLowerCase();
    return `
      <article class="academy-card reveal" data-academy-card data-search="${searchTerms}" data-state="${academy.state}" data-city="${academy.city}" data-type="${academy.type}" data-level="${academy.level}" data-programs="${academy.programs.join("|")}">
        <div class="academy-card-top">
          <span class="academy-logo academy-logo--${academy.tone}" aria-label="${academy.name} logo">${academy.mark}</span>
          <div class="academy-card-top-copy"><span class="academy-location">${icons.pin}${academy.location}</span>${academy.verified ? `<span class="academy-verified">${icons.shieldCheck} Verified Academy</span>` : `<span class="academy-type">${academy.type}</span>`}</div>
        </div>
        <h3>${academy.name}</h3>
        <p>${academy.description}</p>
        <div class="academy-programs"><span>Programs</span><div>${academy.programs.map((program) => `<b>${program}</b>`).join("")}</div></div>
        <a class="academy-view-link" href="#find-academy">View Academy <span>${icons.arrow}</span></a>
      </article>`;
  }

  function renderWesternAcademy() {
    document.body.classList.add("western-experience");
    document.title = "Western Academy — BELLO";
    const themeMeta = document.querySelector('meta[name="theme-color"]');
    if (themeMeta) themeMeta.content = "#0a2342";
    app.innerHTML = `
      ${westernHeaderMarkup()}
      <main id="main-content" class="western-site">
        <section class="western-hero" aria-labelledby="western-hero-title">
          <div class="western-hero-grid western-container">
            <div class="western-hero-copy reveal">
              <p class="western-eyebrow"><span></span>BELLO Education Platform <i></i> Western Academy</p>
              <h1 id="western-hero-title">Discover the Right Academy <em>for Your Future</em></h1>
              <p class="western-hero-text">Explore quality academic institutions, discover educational programs, and connect with schools that help students build a successful future.</p>
              <div class="western-hero-actions"><a class="western-button western-button--sky" href="#academies">Explore Schools <span>${icons.arrow}</span></a><a class="western-button western-button--ghost" href="#academy-registration">Register Your Academy</a></div>
              <div class="western-hero-trust"><span>${icons.shieldCheck}</span><p>A modern academic space for families, students and independent schools.</p></div>
            </div>
            <div class="western-hero-visual reveal reveal-delay">
              <div class="western-photo-frame"><img src="/assets/western-academy-learning.jpg" alt="Students and a teacher collaborating in a modern science classroom"><span class="western-photo-shade"></span><span class="western-photo-label"><i></i> Modern academic learning</span></div>
              <div class="western-float-card western-float-card--program"><span class="western-float-icon">${icons.code}</span><div><small>Explore pathways</small><strong>Programs for every goal</strong></div></div>
              <div class="western-float-card western-float-card--future"><span class="western-future-orbit">↗</span><div><small>Built for tomorrow</small><strong>Learn. Grow. Lead.</strong></div></div>
            </div>
          </div>
        </section>

        <section class="western-proof-strip" aria-label="Western Academy benefits"><div class="western-container western-proof-grid"><div>${icons.school}<span><strong>Explore academies</strong><small>with clarity and confidence</small></span></div><div>${icons.book}<span><strong>Discover programs</strong><small>that fit every ambition</small></span></div><div>${icons.globe}<span><strong>Build connections</strong><small>with a new generation of schools</small></span></div></div></section>

        <section class="western-section western-why" aria-labelledby="why-western-title">
          <div class="western-container">
            <div class="western-section-heading centered reveal"><p class="western-kicker">Why Western Academy</p><h2 id="why-western-title">Quality Education. <em>Greater Opportunities.</em></h2><p>Every student deserves an environment where strong teaching, modern resources and ambitious ideas come together.</p></div>
            <div class="western-why-grid">${westernIconCard(westernWhyCards, "western-why-card")}</div>
          </div>
        </section>

        <section class="western-section western-subjects" id="academic-areas" aria-labelledby="academic-areas-title">
          <div class="western-container">
            <div class="western-section-heading western-heading-row reveal"><div><p class="western-kicker">Explore academic areas</p><h2 id="academic-areas-title">Pathways for <em>every curious mind.</em></h2></div><p>Start with the subjects and programs that move your learner forward.</p></div>
            <div class="western-subject-grid">${westernIconCard(westernSubjects, "western-subject-card")}</div>
          </div>
        </section>

        <section class="western-section western-featured" id="academies" aria-labelledby="featured-academies-title">
          <div class="western-container">
            <div class="western-section-heading western-heading-row reveal"><div><p class="western-kicker">Discover your next school</p><h2 id="featured-academies-title">Featured Academies</h2></div><a class="western-inline-link" href="#find-academy">Find an Academy <span>${icons.arrow}</span></a></div>
            <div class="academy-grid">${westernAcademies.map(westernAcademyCard).join("")}</div>
            <p class="western-demo-note">Featured academies are demo content for this public directory design.</p>
          </div>
        </section>

        <section class="western-find-section" id="find-academy" aria-labelledby="find-academy-title">
          <div class="western-container">
            <div class="western-find-shell reveal">
              <div class="western-find-heading"><p class="western-kicker western-kicker--light">Find a school</p><h2 id="find-academy-title">Find an Academy</h2><p>Search by what matters to your family, then narrow the directory to the right fit.</p></div>
              <form class="western-search-form" id="academy-search-form" novalidate>
                <div class="western-search-grid">
                  <label><span>School name</span><span class="western-input-wrap">${icons.search}<input id="academy-name-search" type="search" placeholder="e.g. Northbridge Academy" autocomplete="off"></span></label>
                  <label><span>Location</span><span class="western-input-wrap">${icons.pin}<input id="academy-location-search" type="search" placeholder="City or area" autocomplete="off"></span></label>
                  <label><span>Program</span><span class="western-select-wrap"><select id="academy-program-search"><option value="">Any program</option><option>STEAM</option><option>Arts</option><option>Leadership</option><option>A-Level</option><option>Business</option><option>Sciences</option><option>Primary</option><option>Digital Skills</option></select></span></label>
                  <label><span>Subject</span><span class="western-select-wrap"><select id="academy-subject-search"><option value="">Any subject</option>${westernSubjects.map(([subject]) => `<option>${subject}</option>`).join("")}</select></span></label>
                </div>
                <div class="western-filter-row"><span class="western-filter-title">${icons.filter} Filters</span><label><span class="sr-only">State</span><select id="academy-state-filter"><option value="">State</option><option>Lagos</option><option>Oyo</option><option>FCT</option></select></label><label><span class="sr-only">City</span><select id="academy-city-filter"><option value="">City</option><option>Lekki</option><option>Ibadan</option><option>Abuja</option></select></label><label><span class="sr-only">School Type</span><select id="academy-type-filter"><option value="">School Type</option><option>Independent School</option><option>College / Sixth Form</option><option>Private School</option></select></label><label><span class="sr-only">Education Level</span><select id="academy-level-filter"><option value="">Education Level</option><option>Primary</option><option>Secondary</option><option>College / Sixth Form</option></select></label><label><span class="sr-only">Programs</span><select id="academy-program-filter"><option value="">Programs</option><option>STEAM</option><option>A-Level</option><option>Primary</option><option>Digital Skills</option></select></label></div>
                <div class="western-search-actions"><button class="western-button western-button--sky" type="submit">Search Academies ${icons.search}</button><button class="western-clear-search" type="button" id="academy-search-reset">Clear filters</button><p id="academy-search-result" aria-live="polite">Showing 3 featured academies</p></div>
              </form>
            </div>
          </div>
        </section>

        <section class="western-section western-levels" aria-labelledby="education-levels-title">
          <div class="western-container">
            <div class="western-section-heading centered reveal"><p class="western-kicker">Explore by stage</p><h2 id="education-levels-title">Education Levels</h2><p>Find a school at the stage that is right for your learner now.</p></div>
            <div class="western-level-grid">${westernLevels.map(([title, copy, num, icon]) => `<a class="western-level-card reveal" href="#find-academy"><span class="western-level-number">${num}</span><span class="western-level-icon">${icons[icon]}</span><h3>${title}</h3><p>${copy}</p><span class="western-level-arrow">${icons.arrow}</span></a>`).join("")}</div>
          </div>
        </section>

        <section class="western-identity-section" id="about" aria-labelledby="academy-identity-title">
          <div class="western-container western-identity-grid">
            <div class="western-identity-copy reveal"><p class="western-kicker western-kicker--light">For independent academies</p><h2 id="academy-identity-title">Your academy. <em>Your online identity.</em></h2><p>BELLO provides the technology behind your public presence while your academy stays unmistakably yours.</p><ul><li>${icons.check}<span>Use your logo, school name and colors</span></li><li>${icons.check}<span>Share programs, subjects, teachers, classes and admissions</span></li><li>${icons.check}<span>Publish your gallery, news, contact details and more</span></li></ul></div>
            <div class="academy-site-preview reveal reveal-delay" aria-label="Example independent academy public website"><div class="academy-browser-top"><span><i></i><i></i><i></i></span><b>northbridge.bello.ng</b><span>${icons.globe}</span></div><div class="academy-preview-page"><div class="academy-preview-nav"><strong><i>N</i> NORTHBRIDGE</strong><span>About&nbsp;&nbsp; Programs&nbsp;&nbsp; Admissions</span></div><div class="academy-preview-hero"><small>WELCOME TO NORTHBRIDGE ACADEMY</small><h3>Learn with purpose.<br><em>Lead with confidence.</em></h3><button type="button">Explore our school</button></div><div class="academy-preview-stats"><span><b>18</b> Subjects</span><span><b>9</b> Programs</span><span><b>1</b> Unique identity</span></div></div></div>
          </div>
        </section>

        <section class="western-registration-section" id="academy-registration" aria-labelledby="academy-registration-title">
          <div class="western-container"><div class="western-registration-card reveal"><div><p class="western-kicker">For academies</p><h2 id="academy-registration-title">Bring Your Academy Online</h2><p>BELLO gives schools the tools they need to build their online presence, manage their institution, and connect with students and parents.</p></div><a class="western-button western-button--navy" href="/#/login">Register Your Academy <span>${icons.arrow}</span></a></div></div>
        </section>
      </main>
      ${westernFooterMarkup()}`;
    initPageEvents();
    initWesternAcademyEvents();
  }

  function initWesternAcademyEvents() {
    const year = document.getElementById("western-year");
    if (year) year.textContent = new Date().getFullYear();

    const toggle = document.querySelector(".western-menu-toggle");
    const menu = document.getElementById("western-mobile-menu");
    if (toggle && menu) {
      const closeMenu = () => { toggle.setAttribute("aria-expanded", "false"); toggle.setAttribute("aria-label", "Open menu"); menu.setAttribute("aria-hidden", "true"); document.body.classList.remove("western-menu-open"); };
      toggle.addEventListener("click", () => {
        const open = toggle.getAttribute("aria-expanded") !== "true";
        toggle.setAttribute("aria-expanded", String(open)); toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu"); menu.setAttribute("aria-hidden", String(!open)); document.body.classList.toggle("western-menu-open", open);
      });
      menu.querySelectorAll("a").forEach((link) => link.addEventListener("click", closeMenu));
    }

    const form = document.getElementById("academy-search-form");
    const cards = Array.from(document.querySelectorAll("[data-academy-card]"));
    const result = document.getElementById("academy-search-result");
    const input = (id) => document.getElementById(id);
    const values = ["academy-name-search", "academy-location-search", "academy-program-search", "academy-subject-search", "academy-state-filter", "academy-city-filter", "academy-type-filter", "academy-level-filter", "academy-program-filter"].map(input).filter(Boolean);
    const value = (id) => String((input(id) || {}).value || "").trim().toLowerCase();
    const applySearch = () => {
      const name = value("academy-name-search"); const location = value("academy-location-search"); const program = value("academy-program-search"); const subject = value("academy-subject-search");
      const state = value("academy-state-filter"); const city = value("academy-city-filter"); const type = value("academy-type-filter"); const level = value("academy-level-filter"); const programs = value("academy-program-filter");
      let visible = 0;
      cards.forEach((card) => {
        const matches = (!name || card.dataset.search.includes(name)) && (!location || card.dataset.search.includes(location)) && (!program || card.dataset.programs.toLowerCase().includes(program)) && (!subject || card.dataset.search.includes(subject)) && (!state || card.dataset.state.toLowerCase() === state) && (!city || card.dataset.city.toLowerCase() === city) && (!type || card.dataset.type.toLowerCase() === type) && (!level || card.dataset.level.toLowerCase() === level) && (!programs || card.dataset.programs.toLowerCase().includes(programs));
        card.hidden = !matches;
        if (matches) visible += 1;
      });
      if (result) result.textContent = visible ? `Showing ${visible} featured ${visible === 1 ? "academy" : "academies"}` : "No featured academies match those filters yet.";
    };
    if (form) form.addEventListener("submit", (event) => { event.preventDefault(); applySearch(); });
    values.forEach((control) => control.addEventListener(control.tagName === "SELECT" ? "change" : "input", applySearch));
    const reset = document.getElementById("academy-search-reset");
    if (reset) reset.addEventListener("click", () => { if (form) form.reset(); applySearch(); });
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
    document.body.classList.remove("western-experience", "western-menu-open");
    const themeMeta = document.querySelector('meta[name="theme-color"]');
    if (themeMeta) themeMeta.content = "#0b402c";
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
    document.body.classList.remove("western-experience", "western-menu-open");
    const themeMeta = document.querySelector('meta[name="theme-color"]');
    if (themeMeta) themeMeta.content = "#0b402c";
    if (window.BelloRegister && typeof window.BelloRegister.mount === "function") {
      window.BelloRegister.mount();
    }
  }

  /* Institution admin dashboard (Islamic + Western) — a self-contained
     module (public/js/dashboard.js) mounted into its own container so it
     never shares markup or styles with the public marketing site. */
  function renderDashboard() {
    // Already mounted: let dashboard.js's own hashchange listener handle
    // in-dashboard navigation instead of tearing the whole shell down.
    if (document.getElementById("dash-app")) return;
    document.body.classList.remove("western-experience", "western-menu-open");
    if (scrollHandler) { window.removeEventListener("scroll", scrollHandler); scrollHandler = null; }
    document.getElementById("app").innerHTML = '<div id="dash-app"></div>';
    if (window.BelloDashboard && typeof window.BelloDashboard.boot === "function") {
      window.BelloDashboard.boot();
    }
  }

  function renderRoute() {
    const path = window.location.pathname.replace(/\/+$/, "") || "/";
    const hash = window.location.hash;

    if (hash.startsWith("#/app") || hash === "#/login" || hash.startsWith("#/login")) {
      renderDashboard();
    } else if (path === "/register-madrasa" || hash === "#/register-madrasa" || hash === "#register-madrasa") {
      renderRegistration();
    } else if (path === "/islamic-schools") {
      renderCategory("islamic");
    } else if (path === "/western-schools") {
      renderWesternAcademy();
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
  window.addEventListener("hashchange", renderRoute);
  renderRoute();

  /* Small compatibility surface kept for existing integrations. */
  window.App = {
    mount: renderRoute,
    routeTo: async (path) => window.BelloRouter.navigate("/" + String(path).replace(/^\//, "")),
    refreshMe: async () => {
      try {
        const me = await window.API.me();
        window.App.me = me && me.loggedIn ? me : null;
        return window.App.me;
      } catch (e) {
        window.App.me = null;
        return null;
      }
    },
    me: null
  };
})();
