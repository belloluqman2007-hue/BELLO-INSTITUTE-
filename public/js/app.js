"use strict";

/* BELLO public platform homepage */
(function () {
  const app = document.getElementById("app");
  if (!app) return;

  const icons = {
    arrow: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6"/></svg>`,
    pin: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 10.2c0 5.2-8 10.3-8 10.3s-8-5.1-8-10.3a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10.2" r="2.6"/></svg>`,
    check: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.2 4.2L19.5 6.5"/></svg>`,
    menu: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>`,
    close: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>`,
    book: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.7A3.7 3.7 0 0 1 7.7 2H12v18H7.7A3.7 3.7 0 0 0 4 23V5.7ZM20 5.7A3.7 3.7 0 0 0 16.3 2H12v18h4.3A3.7 3.7 0 0 1 20 23V5.7Z"/></svg>`,
    sound: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 10v4h3l4 4V6L8 10H5Zm10.5-.8a4.2 4.2 0 0 1 0 5.6M18 6.4a8 8 0 0 1 0 11.2"/></svg>`,
    quote: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.7 7.2C5.6 8.3 4 10.7 4 14.4h4.5v-4H6.8c.4-1.2 1.3-2 2.9-2.7V7.2Zm8.5 0c-3.1 1.1-4.7 3.5-4.7 7.2H17v-4h-1.7c.4-1.2 1.3-2 2.9-2.7V7.2Z"/></svg>`,
    balance: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v18M7 21h10M5 7h14M7 7l-4 7h8L7 7Zm10 0-4 7h8l-4-7Z"/></svg>`,
    star: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.2 4.7L19.3 8l-3.7 3.7.9 5.3-4.5-2.5-4.5 2.5.9-5.3L4.7 8l5.1-.3L12 3Z"/></svg>`,
    language: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h11M9.5 3v2c0 6-2.2 10.1-6.5 12.2M6 10.5c2.2 2.3 4.7 3.8 7.6 4.6M15 18l3.3-8 3.2 8M16.2 15h4.2"/></svg>`,
    compass: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="m15.8 8.2-2.3 5.3-5.3 2.3 2.3-5.3 5.3-2.3Z"/></svg>`,
    library: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h4v16H4zM9 4h4v16H9zM14 4h4v16h-4zM19 6h1v14h-1z"/></svg>`,
    users: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3"/><path d="M3.5 20v-2.1A4.9 4.9 0 0 1 8.4 13h1.2a4.9 4.9 0 0 1 4.9 4.9V20M16 5.5a3 3 0 0 1 0 5.8M18.3 13.4a4.7 4.7 0 0 1 2.2 4V20"/></svg>`,
    chart: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20V4M4 20h17M8 16v-4M12 16V7M16 16v-7M20 16V5"/></svg>`,
    calendar: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18"/></svg>`,
    document: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h8l4 4v14H6zM14 3v5h5M9 13h6M9 17h6"/></svg>`,
    bell: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 10a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 22h4"/></svg>`,
    message: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11.5a7.5 7.5 0 0 1-8 7.5 8.8 8.8 0 0 1-3-.5L4 20l1.6-4a7.3 7.3 0 0 1-1.1-4.4 7.5 7.5 0 0 1 8-7.5 7.5 7.5 0 0 1 7.5 7.5Z"/></svg>`,
    teacher: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h12v10H4zM8 19h4M10 15v4M19 8v7M17 15h4"/><circle cx="19" cy="5" r="2"/></svg>`,
    instagram: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r=".8" fill="currentColor" stroke="none"/></svg>`,
    linkedin: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 9.5V18M6.5 6.5v.1M10.5 18v-5a3.5 3.5 0 0 1 7 0v5M10.5 10v8"/><circle cx="6.5" cy="6.5" r="1"/></svg>`,
    facebook: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 21v-8h3l.5-3H14V8.1c0-.9.3-1.6 1.7-1.6h2V3.8c-.4-.1-1.2-.2-2.2-.2-2.3 0-3.8 1.4-3.8 4V10H9v3h2.7v8"/></svg>`
  };

  const subjectData = [
    ["Qur'an", "Build a meaningful relationship with the Book of Allah.", "book", "emerald"],
    ["Tajweed", "Learn clear and confident Qur'an recitation.", "sound", "gold"],
    ["Hadith", "Explore prophetic wisdom for everyday life.", "quote", "sand"],
    ["Fiqh", "Understand worship and practice with clarity.", "balance", "blue"],
    ["Tawheed", "Strengthen the foundations of your faith.", "star", "violet"],
    ["Arabic", "Open the language of the Qur'an and tradition.", "language", "rose"],
    ["Seerah", "Journey through the life of Prophet Muhammad ﷺ.", "compass", "teal"],
    ["Islamic Studies", "Connect the essentials across every stage.", "library", "clay"]
  ];

  const subjectCards = subjectData.map(([title, copy, icon, tone]) => `
    <article class="subject-card reveal">
      <div class="subject-icon ${tone}">${icons[icon]}</div>
      <h3>${title}</h3>
      <p>${copy}</p>
      <a href="#madrasas" class="text-link">Explore <span>${icons.arrow}</span></a>
    </article>`).join("");

  app.innerHTML = `
    <header class="site-header" id="home">
      <div class="nav-shell">
        <a class="brand" href="#home" aria-label="BELLO home">
          <span class="brand-logo"><img src="/assets/bello-multi-madrasa-platform-logo.png" alt="BELLO Multi Madrasa Platform logo"></span>
          <span class="brand-words"><strong>BELLO</strong><small>Multi Madrasa Platform</small></span>
        </a>
        <nav class="desktop-nav" aria-label="Primary navigation">
          <a class="active" href="#home">Home</a>
          <a href="#madrasas">Find a Madrasa</a>
          <a href="#subjects">Courses</a>
          <a href="#about">About</a>
          <a href="#footer">Contact</a>
        </nav>
        <div class="nav-actions">
          <a class="login-link" href="#students">Login</a>
          <a class="button button-small" href="#administrators">Get Started <span>${icons.arrow}</span></a>
        </div>
        <button class="menu-toggle" type="button" aria-expanded="false" aria-controls="mobile-menu" aria-label="Open menu">
          <span class="open-icon">${icons.menu}</span><span class="close-icon">${icons.close}</span>
        </button>
      </div>
      <nav class="mobile-nav" id="mobile-menu" aria-label="Mobile navigation" aria-hidden="true">
        <a href="#home">Home</a>
        <a href="#madrasas">Find a Madrasa</a>
        <a href="#subjects">Courses</a>
        <a href="#about">About</a>
        <a href="#footer">Contact</a>
        <a href="#students">Login</a>
        <a class="button" href="#administrators">Get Started <span>${icons.arrow}</span></a>
      </nav>
    </header>

    <main id="main-content">
      <section class="hero section-pattern" aria-labelledby="hero-title">
        <div class="hero-orb hero-orb-one"></div><div class="hero-orb hero-orb-two"></div>
        <div class="container hero-grid">
          <div class="hero-content reveal">
            <div class="eyebrow"><span class="eyebrow-dot"></span> Islamic education, connected</div>
            <h1 id="hero-title">One Platform.<br><em>Many Madrasas.</em><br>One Ummah.</h1>
            <p class="hero-copy">Discover madrasas, connect with qualified teachers, access Islamic education, and manage learning—all in one platform.</p>
            <div class="hero-actions">
              <a class="button button-primary" href="#madrasas">Find a Madrasa <span>${icons.arrow}</span></a>
              <a class="button button-secondary" href="#administrators">Register Your Madrasa</a>
            </div>
            <div class="hero-reassurance"><span class="mini-check">${icons.check}</span><span>Designed for learners, families, teachers, and madrasas.</span></div>
          </div>
          <div class="hero-visual reveal reveal-delay" aria-label="Students learning in BELLO's digital education environment">
            <div class="visual-frame">
              <img src="/assets/bello-learning-studio.jpg" alt="A teacher guiding students as they learn together with a tablet and books">
              <div class="visual-shade"></div>
              <div class="visual-label"><span class="live-dot"></span>Learning, together</div>
            </div>
            <div class="floating-card card-progress">
              <span class="float-icon gold-fill">${icons.book}</span>
              <div><small>Today's learning</small><strong>Qur'an Studies</strong><div class="progress-track"><span></span></div></div>
            </div>
            <div class="floating-card card-community">
              <div class="avatar-group"><span>A</span><span>N</span><span>S</span></div>
              <div><strong>One connected community</strong><small>Students · teachers · families</small></div>
            </div>
            <div class="hero-accent"></div>
          </div>
        </div>
      </section>

      <section class="trust-strip" aria-label="BELLO platform overview">
        <div class="container trust-grid">
          <div class="trust-intro reveal"><p class="section-kicker">A platform for every step</p><p>Made to grow with your learning community.</p></div>
          <div class="stat-card reveal"><span class="stat-mark">—</span><div><strong>Multiple Madrasas</strong><small>A growing network</small></div></div>
          <div class="stat-card reveal"><span class="stat-mark">—</span><div><strong>Qualified Teachers</strong><small>Knowledgeable guidance</small></div></div>
          <div class="stat-card reveal"><span class="stat-mark">—</span><div><strong>Students Learning</strong><small>Progressing together</small></div></div>
          <div class="stat-card reveal"><span class="stat-mark">—</span><div><strong>Islamic Courses</strong><small>Paths to explore</small></div></div>
        </div>
      </section>

      <section class="section how-section" id="about" aria-labelledby="how-title">
        <div class="container">
          <div class="section-heading centered reveal">
            <p class="section-kicker">Simple by design</p>
            <h2 id="how-title">How BELLO Works</h2>
            <p>Everything you need to begin, learn, and stay connected—brought into one thoughtful experience.</p>
          </div>
          <div class="steps-grid">
            <article class="step-card reveal"><span class="step-number">01</span><div class="step-icon">${icons.pin}</div><h3>Find a Madrasa</h3><p>Discover madrasas that match your learning needs.</p></article>
            <article class="step-card reveal"><span class="step-number">02</span><div class="step-icon">${icons.compass}</div><h3>Choose Your Learning Path</h3><p>Explore available subjects, classes, and courses.</p></article>
            <article class="step-card reveal"><span class="step-number">03</span><div class="step-icon">${icons.users}</div><h3>Learn &amp; Connect</h3><p>Learn from teachers and stay connected with your madrasa.</p></article>
            <article class="step-card reveal"><span class="step-number">04</span><div class="step-icon">${icons.chart}</div><h3>Grow in Knowledge</h3><p>Track your learning and continue your Islamic education journey.</p></article>
          </div>
        </div>
      </section>

      <section class="section subjects-section" id="subjects" aria-labelledby="subjects-title">
        <div class="container">
          <div class="section-heading split-heading reveal">
            <div><p class="section-kicker">Learn with purpose</p><h2 id="subjects-title">Explore Islamic Subjects</h2></div>
            <p>Find the right foundation, deepen your understanding, and learn at a pace that works for you.</p>
          </div>
          <div class="subjects-grid">${subjectCards}</div>
        </div>
      </section>

      <section class="section madrasas-section section-pattern-light" id="madrasas" aria-labelledby="madrasas-title">
        <div class="container">
          <div class="section-heading split-heading reveal">
            <div><p class="section-kicker">Find your community</p><h2 id="madrasas-title">Discover Madrasas</h2></div>
            <p>Explore a welcoming network of Islamic learning communities. These sample profiles show how madrasas can appear on BELLO.</p>
          </div>
          <div class="madrasa-grid">
            <article class="madrasa-card reveal">
              <div class="madrasa-image madrasa-image-one"><span class="demo-flag">Demo example</span><div class="madrasa-emblem">N</div><div class="image-wordmark">NOOR<span>Academy</span></div></div>
              <div class="madrasa-content"><div class="madrasa-location">${icons.pin} <span>Central London, UK</span></div><h3>Al Noor Learning Academy</h3><p>A warm, community-led learning space for children, young people, and families.</p><div class="course-tags"><span>Qur'an</span><span>Arabic</span><span>Fiqh</span></div><a class="button card-button" href="#administrators">View Madrasa <span>${icons.arrow}</span></a></div>
            </article>
            <article class="madrasa-card featured-madrasa reveal">
              <div class="madrasa-image madrasa-image-two"><span class="demo-flag">Demo example</span><div class="madrasa-emblem crescent">☾</div><div class="image-wordmark">HIKMAH<span>Institute</span></div></div>
              <div class="madrasa-content"><div class="madrasa-location">${icons.pin} <span>Lagos, Nigeria</span></div><h3>Hikmah Islamic Institute</h3><p>A contemporary institute cultivating lifelong learners through meaningful Islamic education.</p><div class="course-tags"><span>Tajweed</span><span>Hadith</span><span>Seerah</span></div><a class="button card-button" href="#administrators">View Madrasa <span>${icons.arrow}</span></a></div>
            </article>
            <article class="madrasa-card reveal">
              <div class="madrasa-image madrasa-image-three"><span class="demo-flag">Demo example</span><div class="madrasa-emblem">A</div><div class="image-wordmark">AMANAH<span>Education</span></div></div>
              <div class="madrasa-content"><div class="madrasa-location">${icons.pin} <span>Toronto, Canada</span></div><h3>Amanah Education Centre</h3><p>Inclusive weekend and online learning pathways rooted in care, excellence, and connection.</p><div class="course-tags"><span>Tawheed</span><span>Qur'an</span><span>Studies</span></div><a class="button card-button" href="#administrators">View Madrasa <span>${icons.arrow}</span></a></div>
            </article>
          </div>
          <div class="all-link-wrap reveal"><a class="button button-outline" href="#administrators">View All Madrasas <span>${icons.arrow}</span></a></div>
        </div>
      </section>

      <section class="section admin-section" id="administrators" aria-labelledby="admin-title">
        <div class="container admin-layout">
          <div class="admin-visual reveal">
            <div class="admin-panel">
              <div class="panel-top"><span class="panel-brand"><img src="/assets/bello-multi-madrasa-platform-logo.png" alt=""> BELLO</span><span class="panel-dots"><i></i><i></i><i></i></span></div>
              <div class="panel-body"><aside><span class="active-line"></span><span></span><span></span><span></span><span></span></aside><div class="dashboard-area"><div class="dashboard-welcome"><span><small>Good morning</small><strong>Your madrasa, in view</strong></span><b>${icons.bell}</b></div><div class="dashboard-stats"><div><span class="dash-mini-icon green">${icons.users}</span><small>Students</small><strong>•••</strong></div><div><span class="dash-mini-icon gold">${icons.teacher}</span><small>Teachers</small><strong>•••</strong></div><div><span class="dash-mini-icon blue">${icons.calendar}</span><small>Classes</small><strong>•••</strong></div></div><div class="dashboard-chart"><div><small>Learning overview</small><span class="chart-key"><i></i> This term</span></div><svg viewBox="0 0 300 88" aria-hidden="true"><defs><linearGradient id="graphfill" x1="0" x2="0" y1="0" y2="1"><stop stop-color="#d8ad42" stop-opacity=".32"/><stop offset="1" stop-color="#d8ad42" stop-opacity="0"/></linearGradient></defs><path d="M0 72 C18 65 24 68 39 54 S72 61 87 42 S121 51 137 36 S166 45 182 30 S213 36 228 20 S261 30 300 8 V88 H0Z" fill="url(#graphfill)"/><path d="M0 72 C18 65 24 68 39 54 S72 61 87 42 S121 51 137 36 S166 45 182 30 S213 36 228 20 S261 30 300 8" fill="none" stroke="#c99116" stroke-width="3" stroke-linecap="round"/></svg></div></div></div>
            </div>
            <div class="admin-float admin-float-one"><span>${icons.check}</span> Attendance recorded</div>
            <div class="admin-float admin-float-two"><div class="tiny-stack"><i></i><i></i><i></i></div><span>Families informed</span></div>
          </div>
          <div class="admin-copy reveal reveal-delay">
            <p class="section-kicker light-kicker">For madrasa administrators</p>
            <h2 id="admin-title">Bring Your Madrasa Into the <em>Digital Age</em></h2>
            <p>BELLO gives administrators a calm, connected way to manage their institution and serve their community—from the first enrolment to every milestone after.</p>
            <div class="admin-features">
              <div>${icons.check}<span>Student management</span></div><div>${icons.check}<span>Teacher management</span></div><div>${icons.check}<span>Classes &amp; courses</span></div><div>${icons.check}<span>Attendance</span></div><div>${icons.check}<span>Results &amp; assessments</span></div><div>${icons.check}<span>Announcements</span></div><div>${icons.check}<span>Parent communication</span></div><div>${icons.check}<span>Academic records</span></div>
            </div>
            <a class="button button-gold" href="#footer">Register Your Madrasa <span>${icons.arrow}</span></a>
          </div>
        </div>
      </section>

      <section class="section students-section" id="students" aria-labelledby="students-title">
        <div class="container students-layout">
          <div class="student-copy reveal">
            <p class="section-kicker">For students</p>
            <h2 id="students-title">A clearer path to <em>learning well.</em></h2>
            <p>Spend less time finding information and more time growing in knowledge. BELLO keeps your learning journey organised, accessible, and connected.</p>
            <ul class="benefit-list"><li>${icons.compass}<span>Discover madrasas that feel right for you</span></li><li>${icons.calendar}<span>Join classes and access learning materials</span></li><li>${icons.chart}<span>Follow your progress with confidence</span></li><li>${icons.bell}<span>Receive important announcements</span></li><li>${icons.message}<span>Stay connected with your teachers</span></li></ul>
            <a class="button button-primary" href="#subjects">Start Learning <span>${icons.arrow}</span></a>
          </div>
          <div class="student-visual reveal reveal-delay" aria-hidden="true">
            <div class="portal-card"><div class="portal-header"><div class="profile-avatar">SA</div><div><small>Welcome back</small><strong>Salma A.</strong></div><span class="portal-notice">${icons.bell}</span></div><div class="portal-course"><div class="course-book-icon">${icons.book}</div><div><small>Continue learning</small><strong>Foundations of Tajweed</strong><div class="portal-progress"><span></span></div><em>Lesson 6 of 12</em></div></div><div class="next-class"><small>Up next</small><div><span class="class-time">4:30</span><span><strong>Arabic language</strong><em>Today · Online classroom</em></span><b>${icons.arrow}</b></div></div></div>
            <div class="progress-ring"><svg viewBox="0 0 42 42"><circle cx="21" cy="21" r="16"/><circle class="ring-progress" cx="21" cy="21" r="16"/></svg><span>Progress<br><strong>↑</strong></span></div>
            <div class="star-chip">✦ New lesson added</div>
          </div>
        </div>
      </section>

      <section class="final-cta" aria-labelledby="cta-title">
        <div class="cta-pattern"></div>
        <div class="container cta-content reveal">
          <div class="cta-orbit cta-orbit-one"></div><div class="cta-orbit cta-orbit-two"></div>
          <p class="section-kicker light-kicker">Your next chapter starts here</p>
          <h2 id="cta-title">Your Journey in Islamic<br>Knowledge Starts Here.</h2>
          <p>Whether you are a student looking to learn or a madrasa ready to grow, BELLO brings Islamic education closer to you.</p>
          <div class="cta-actions"><a class="button button-gold" href="#madrasas">Find a Madrasa <span>${icons.arrow}</span></a><a class="button button-ghost" href="#administrators">Register Your Madrasa</a></div>
        </div>
      </section>
    </main>

    <footer class="site-footer" id="footer">
      <div class="container footer-grid">
        <div class="footer-brand"><a class="brand footer-logo" href="#home"><span class="brand-logo"><img src="/assets/bello-multi-madrasa-platform-logo.png" alt="BELLO Multi Madrasa Platform logo"></span><span class="brand-words"><strong>BELLO</strong><small>Multi Madrasa Platform</small></span></a><p>A connected platform for madrasas, learners, teachers, and families to learn, grow, and move forward together.</p><div class="socials"><a href="#footer" aria-label="BELLO on Instagram">${icons.instagram}</a><a href="#footer" aria-label="BELLO on LinkedIn">${icons.linkedin}</a><a href="#footer" aria-label="BELLO on Facebook">${icons.facebook}</a></div></div>
        <div class="footer-col"><h3>Platform</h3><a href="#madrasas">Find a Madrasa</a><a href="#subjects">Courses</a><a href="#about">About</a><a href="#footer">Contact</a></div>
        <div class="footer-col"><h3>For Madrasas</h3><a href="#administrators">Register Your Madrasa</a><a href="#administrators">Administration</a></div>
        <div class="footer-col"><h3>Legal</h3><a href="#footer">Privacy Policy</a><a href="#footer">Terms of Service</a></div>
      </div>
      <div class="container footer-bottom"><span>© <span id="year"></span> BELLO Multi Madrasa Platform. All rights reserved.</span><span>Connect <i></i> Learn <i></i> Grow</span></div>
    </footer>
  `;

  const toggle = document.querySelector(".menu-toggle");
  const menu = document.querySelector(".mobile-nav");
  const header = document.querySelector(".site-header");
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

  const onScroll = () => header.classList.toggle("is-scrolled", window.scrollY > 8);
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  document.getElementById("year").textContent = new Date().getFullYear();
  if ("IntersectionObserver" in window && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    const observer = new IntersectionObserver((entries) => entries.forEach((entry) => {
      if (entry.isIntersecting) { entry.target.classList.add("is-visible"); observer.unobserve(entry.target); }
    }), { threshold: 0.12 });
    document.querySelectorAll(".reveal").forEach((element) => observer.observe(element));
  } else document.querySelectorAll(".reveal").forEach((element) => element.classList.add("is-visible"));

  window.App = { mount: () => {}, routeTo: async () => {}, refreshMe: async () => null, me: null };
})();
