"use strict";
/* ============================================================================
   BELLO PLATFORM — MY INSTITUTION (admin section) shared definitions
   ----------------------------------------------------------------------------
   One server-side source of truth for the eight "My Institution" screens:

     1 Institution Profile   5 Website Pages
     2 Institution Info      6 Gallery
     3 Public Website        7 Contact Information
     4 Website Appearance    8 Institution Settings

   Nothing here performs data access or authorisation — routes/madrasa.js owns
   both, so tenant isolation stays enforced in exactly one place. This module
   only supplies the editable field catalogue, validation rules, the default
   page set and the appearance defaults, so the admin UI, the API and the
   public projection can never drift apart.
   ========================================================================== */
const institution = require("./institution");

/* --------------------------------------------------------------------------
   Vocabulary
   -------------------------------------------------------------------------- */
const OWNERSHIP_TYPES = Object.freeze([
  "Private", "Community", "Government", "Faith-based", "Trust / Foundation", "Non-profit",
]);

const BOARDING_STATUSES = Object.freeze(["Day school", "Boarding", "Day & Boarding"]);
const ADMISSION_STATUSES = Object.freeze(["open", "closed"]);
const SCHOOL_DAY_OPTIONS = Object.freeze(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);

const GALLERY_CATEGORIES = Object.freeze([
  "Academic", "Islamic", "Graduation", "Anniversary", "Events", "Sports", "School Activities",
]);

const FONT_CHOICES = Object.freeze([
  { value: "system", label: "System (Inter / Segoe UI)" },
  { value: "serif", label: "Classic serif" },
  { value: "rounded", label: "Rounded sans" },
  { value: "humanist", label: "Humanist sans" },
]);
const HEADER_STYLES = Object.freeze(["solid", "transparent", "compact"]);
const FOOTER_STYLES = Object.freeze(["detailed", "simple", "minimal"]);
const BUTTON_STYLES = Object.freeze(["rounded", "pill", "square"]);
const CARD_STYLES = Object.freeze(["elevated", "outlined", "flat"]);
const HOMEPAGE_LAYOUTS = Object.freeze(["hero-stats", "hero-split", "classic"]);
const WEBSITE_THEMES = Object.freeze(["light", "warm", "dark"]);

const CURRENCIES = Object.freeze(["NGN", "USD", "GBP", "EUR", "SAR", "AED", "GHS", "XOF"]);
const LANGUAGES = Object.freeze([
  { value: "en", label: "English" },
  { value: "ar", label: "العربية (Arabic)" },
  { value: "yo", label: "Yorùbá" },
  { value: "ha", label: "Hausa" },
]);
const DATE_FORMATS = Object.freeze(["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD", "D MMM YYYY"]);
const TIMEZONES = Object.freeze([
  "Africa/Lagos", "Africa/Accra", "Africa/Cairo", "Europe/London", "Asia/Riyadh", "Asia/Dubai", "UTC",
]);

/* --------------------------------------------------------------------------
   Appearance defaults
   --------------------------------------------------------------------------
   The institution keeps ONE identity. The Islamic and Western sections differ
   only by accent, so a visitor always recognises the same website.
   -------------------------------------------------------------------------- */
function appearanceDefaults(category) {
  const isWestern = institution.normalizeCategory(category) === "western";
  return {
    brand_color: isWestern ? "#0A2342" : "#200A3D",
    secondary_color: isWestern ? "#39A5E7" : "#C8952C",
    background_color: "#FFFFFF",
    text_color: "#25202C",
    islamic_color: "#200A3D",
    western_color: "#0A2342",
    font_family: "system",
    header_style: "solid",
    footer_style: "detailed",
    button_style: "rounded",
    card_style: "elevated",
    homepage_layout: "hero-stats",
    website_theme: "light",
  };
}

/** Effective appearance = saved values, falling back to the category default. */
function resolveAppearance(madrasa) {
  const defaults = appearanceDefaults(madrasa && madrasa.category);
  const out = {};
  for (const [key, fallback] of Object.entries(defaults)) {
    const saved = madrasa ? madrasa[key] : "";
    out[key] = saved === null || saved === undefined || saved === "" ? fallback : saved;
  }
  return out;
}

/* --------------------------------------------------------------------------
   Default website pages
   --------------------------------------------------------------------------
   Seeded once per tenant the first time Website Pages is opened. They start
   UNPUBLISHED except the handful a school always wants live, because the
   administrator — not the platform — decides what the public sees.
   -------------------------------------------------------------------------- */
const DEFAULT_PAGES = Object.freeze([
  { slug: "home", title: "Homepage", system: true, published: true, nav: true },
  { slug: "about-us", title: "About Us", system: true, published: true, nav: true },
  { slug: "our-history", title: "Our History", published: false, nav: false },
  { slug: "mission-vision", title: "Mission & Vision", published: false, nav: false },
  { slug: "programs", title: "Programs/Courses", system: true, published: true, nav: true },
  { slug: "islamic-education", title: "Islamic Education", published: false, nav: false },
  { slug: "western-education", title: "Western Education", published: false, nav: false },
  { slug: "classes-levels", title: "Classes/Levels", published: false, nav: false },
  { slug: "teachers", title: "Teachers/Staff", system: true, published: false, nav: false },
  { slug: "admissions", title: "Admissions", system: true, published: true, nav: true },
  { slug: "fees", title: "Fees", published: false, nav: false },
  { slug: "gallery", title: "Gallery", system: true, published: false, nav: false },
  { slug: "news", title: "News", system: true, published: false, nav: false },
  { slug: "events", title: "Events", published: false, nav: false },
  { slug: "announcements", title: "Announcements", published: false, nav: false },
  { slug: "achievements", title: "Student Achievements", published: false, nav: false },
  { slug: "contact-us", title: "Contact Us", system: true, published: true, nav: true },
  { slug: "faqs", title: "FAQs", published: false, nav: false },
  { slug: "policies", title: "Policies", published: false, nav: false },
  { slug: "terms", title: "Terms & Conditions", published: false, nav: false },
  { slug: "privacy", title: "Privacy Policy", published: false, nav: false },
]);

/**
 * Legacy copy written by the older "Website → Edit <page>" screens lives in
 * settings as website_<key>_title / website_<key>_content. When the page
 * records are first created that copy is carried over so no administrator
 * loses text they already wrote.
 */
const LEGACY_SETTING_KEY = Object.freeze({
  home: "homepage",
  "about-us": "about",
  programs: "programs",
  teachers: "teachers",
  admissions: "admissions",
  "contact-us": "contact",
  news: "news",
});

/* --------------------------------------------------------------------------
   Editable field catalogues (used by PUT /api/madrasa/institution)
   --------------------------------------------------------------------------
   [column, maxLength]. Anything not listed here can never be written through
   the My Institution endpoints, whatever the request body contains.
   -------------------------------------------------------------------------- */
const TEXT_FIELDS = Object.freeze({
  profile: Object.freeze([
    ["name_en", 160], ["name_ar", 160], ["motto_en", 160], ["motto_ar", 160],
    ["tagline", 200], ["short_description", 400], ["description_en", 4000],
    ["description_ar", 4000], ["history", 6000], ["mission", 3000], ["vision", 3000],
    ["core_values", 3000], ["philosophy", 3000], ["institution_type", 60],
    ["ownership_type", 60], ["founded_year", 8], ["head_name", 160], ["head_title", 80],
    ["admin_full_name", 160], ["admin_position", 80],
    ["registration_no", 80], ["accreditation_body", 160], ["accreditation_details", 2000],
  ]),
  information: Object.freeze([
    ["name_en", 160], ["address", 255], ["city", 80], ["state_name", 80], ["country", 80],
    ["phone", 60], ["alt_phone", 60], ["email", 120], ["admissions_email", 120],
    ["website", 160], ["opening_time", 5], ["closing_time", 5], ["school_days", 120],
    ["levels_offered", 400], ["islamic_education_info", 3000], ["western_education_info", 3000],
    ["languages_of_instruction", 200], ["boarding_status", 40],
    ["registration_no", 80], ["accreditation_body", 160], ["accreditation_details", 2000],
  ]),
  appearance: Object.freeze([
    ["font_family", 60], ["header_style", 30], ["footer_style", 30], ["button_style", 30],
    ["card_style", 30], ["homepage_layout", 30], ["website_theme", 30],
  ]),
  website: Object.freeze([
    ["custom_domain", 255], ["seo_title", 160], ["seo_description", 320], ["seo_keywords", 255],
    ["facebook", 200], ["instagram", 200], ["twitter", 200], ["youtube", 200],
    ["linkedin", 200], ["tiktok", 200],
  ]),
  contact: Object.freeze([
    ["address", 255], ["city", 80], ["state_name", 80], ["country", 80],
    ["phone", 60], ["alt_phone", 60], ["email", 120], ["admissions_email", 120],
    ["whatsapp", 60], ["website", 160], ["maps_link", 255],
    ["opening_time", 5], ["closing_time", 5], ["school_days", 120],
    ["emergency_contact", 160], ["head_name", 160], ["head_title", 80],
    ["facebook", 200], ["instagram", 200], ["twitter", 200], ["youtube", 200],
    ["linkedin", 200], ["tiktok", 200],
  ]),
  settings: Object.freeze([
    ["name_en", 160], ["institution_type", 60], ["school_code", 40], ["registration_no", 80],
    ["country", 80], ["state_name", 80], ["timezone", 60], ["currency", 10],
    ["default_language", 10], ["date_format", 20],
  ]),
});

/** Colour columns, validated as hex. */
const COLOR_FIELDS = Object.freeze([
  "brand_color", "secondary_color", "background_color", "text_color",
  "islamic_color", "western_color",
]);

/** 0/1 columns. */
const BOOLEAN_FIELDS = Object.freeze([
  "website_published", "public_listing", "public_results", "public_admissions",
  "show_phone", "show_alt_phone", "show_email", "show_admissions_email", "show_whatsapp",
  "show_address", "show_map", "show_hours", "show_socials", "show_head", "show_emergency",
  "contact_form_enabled",
]);

/** Values restricted to a known vocabulary (empty string always allowed). */
const ENUM_FIELDS = Object.freeze({
  ownership_type: OWNERSHIP_TYPES,
  boarding_status: BOARDING_STATUSES,
  admission_status: ADMISSION_STATUSES,
  font_family: FONT_CHOICES.map((f) => f.value),
  header_style: HEADER_STYLES,
  footer_style: FOOTER_STYLES,
  button_style: BUTTON_STYLES,
  card_style: CARD_STYLES,
  homepage_layout: HOMEPAGE_LAYOUTS,
  website_theme: WEBSITE_THEMES,
  currency: CURRENCIES,
  default_language: LANGUAGES.map((l) => l.value),
  date_format: DATE_FORMATS,
  timezone: TIMEZONES,
});

/** Every writable text column across all eight sections, de-duplicated. */
function allTextFields() {
  const map = new Map();
  for (const list of Object.values(TEXT_FIELDS)) {
    for (const [field, max] of list) {
      if (!map.has(field) || map.get(field) < max) map.set(field, max);
    }
  }
  return map;
}

/** Slugify a page title into a tenant-unique, URL-safe key. */
function pageSlug(value) {
  return String(value || "")
    .toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/** Safe serialisable vocabulary for the admin SPA. */
function clientConfig() {
  return {
    ownershipTypes: [...OWNERSHIP_TYPES],
    boardingStatuses: [...BOARDING_STATUSES],
    admissionStatuses: [...ADMISSION_STATUSES],
    schoolDays: [...SCHOOL_DAY_OPTIONS],
    galleryCategories: [...GALLERY_CATEGORIES],
    fonts: FONT_CHOICES.map((f) => ({ ...f })),
    headerStyles: [...HEADER_STYLES],
    footerStyles: [...FOOTER_STYLES],
    buttonStyles: [...BUTTON_STYLES],
    cardStyles: [...CARD_STYLES],
    homepageLayouts: [...HOMEPAGE_LAYOUTS],
    websiteThemes: [...WEBSITE_THEMES],
    currencies: [...CURRENCIES],
    languages: LANGUAGES.map((l) => ({ ...l })),
    dateFormats: [...DATE_FORMATS],
    timezones: [...TIMEZONES],
    islamicTypes: [...institution.ISLAMIC_TYPES],
    westernTypes: [...institution.WESTERN_TYPES],
    defaultPages: DEFAULT_PAGES.map((p) => ({ ...p })),
  };
}

module.exports = {
  OWNERSHIP_TYPES,
  BOARDING_STATUSES,
  ADMISSION_STATUSES,
  SCHOOL_DAY_OPTIONS,
  GALLERY_CATEGORIES,
  FONT_CHOICES,
  CURRENCIES,
  LANGUAGES,
  DATE_FORMATS,
  TIMEZONES,
  DEFAULT_PAGES,
  LEGACY_SETTING_KEY,
  TEXT_FIELDS,
  COLOR_FIELDS,
  BOOLEAN_FIELDS,
  ENUM_FIELDS,
  allTextFields,
  appearanceDefaults,
  resolveAppearance,
  pageSlug,
  clientConfig,
};
