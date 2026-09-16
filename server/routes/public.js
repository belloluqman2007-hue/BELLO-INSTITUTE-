"use strict";
/* ============================================================================
   MULTI-MADRASA PLATFORM — PUBLIC routes (viewable BEFORE login)
   ----------------------------------------------------------------------------
   Nothing here requires a session, so parents, students and the general public
   can see the platform without an account:

     GET  /api/public/site                        landing data + madrasa directory
     GET  /api/public/madaris                     directory (?q= & ?city=)
     GET  /api/public/madaris/:slug               one madrasa's public profile
     GET  /api/public/madaris/:slug/notices       notices the school published publicly
     POST /api/public/madaris/:slug/apply         online admission application
     GET  /api/public/madaris/:slug/apply-status  check an application (ref + phone)
     POST /api/public/results/verify              verify a student, get published terms
     GET  /api/public/results/report/:token       printable report card (short-lived token)

   Deliberate limits, because this is the internet-facing surface:
     • only status='active' madaris, and only the sections the school opted in
       to (public_listing / public_results / public_admissions)
     • platform-wide "public directory" switch in Platform → Settings
     • no fee data, no contact details of students, no unpublished marks —
       result checking only ever returns PUBLISHED term summaries
     • writes are rate limited per IP, a honeypot field rejects bot spam, and
       every public result access is written to the activity log
   ========================================================================== */
const express = require("express");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const db = require("../db");
const { asyncHandler, err, ok, cleanStr, validDate, validPhone, validEmail, logActivity } = require("../util");
const grading = require("../services/grading");
const tokens = require("../services/tokens");
const { renderReportCard } = require("./results");
const { publicLimiter, publicWriteLimiter, verifyLimiter } = require("../middleware/ratelimit");
const institution = require("../services/institution");
const myInstitution = require("../services/my-institution");

const router = express.Router();
const REPORT_TTL_SECONDS = 15 * 60;

/* ------------------------- platform-level visibility -------------------- */

async function publicSettings() {
  const rows = await db.all(
    `SELECT key_name, value FROM platform_settings
     WHERE key_name IN ('public_directory_enabled','public_site_title','public_site_tagline',
                        'public_site_intro','public_contact_email','public_contact_phone','public_apply_url')`
  );
  const out = {};
  rows.forEach((r) => { out[r.key_name] = r.value; });
  return {
    directoryEnabled: (() => {
      const v = out.public_directory_enabled;
      if (v === undefined || v === null) return true;
      return !(v === "0" || v === 0 || v === false || v === "false");
    })(),
    title: out.public_site_title || "Bello Institute",
    tagline: out.public_site_tagline || "Multi-Madrasa Management Platform",
    intro: out.public_site_intro || "",
    contactEmail: out.public_contact_email || "",
    contactPhone: out.public_contact_phone || "",
    applyUrl: out.public_apply_url || "",
  };
}

/* Shared projection for every public card/profile. m.id is kept internally.
   The My Institution columns are included so the public site renders exactly
   what the administrator configured — identity, appearance and the contact
   details they chose to publish. */
const CARD_SELECT = `
  SELECT m.id, m.slug, m.custom_domain, m.name_en, m.name_ar, m.motto_en, m.motto_ar, m.logo_path, m.hero_image_path,
         m.brand_color, m.category, m.city, m.state_name, m.maps_link,
         m.description_en, m.description_ar, m.founded_year, m.website, m.phone, m.email,
         m.public_listing, m.public_results, m.public_admissions,
         m.tagline, m.address, m.whatsapp, m.institution_type, m.badge_path, m.favicon_path,
         m.short_description, m.history, m.mission, m.vision, m.core_values, m.philosophy,
         m.ownership_type, m.head_name, m.head_title, m.registration_no, m.accreditation_body,
         m.accreditation_details, m.country, m.alt_phone, m.admissions_email, m.emergency_contact,
         m.opening_time, m.closing_time, m.school_days, m.levels_offered,
         m.islamic_education_info, m.western_education_info, m.languages_of_instruction,
         m.student_capacity, m.boarding_status, m.admission_status,
         m.secondary_color, m.background_color, m.text_color, m.islamic_color, m.western_color,
         m.font_family, m.header_style, m.footer_style, m.button_style, m.card_style,
         m.homepage_layout, m.website_theme, m.website_published,
         m.seo_title, m.seo_description, m.seo_keywords,
         m.facebook, m.instagram, m.twitter, m.youtube, m.linkedin, m.tiktok,
         m.show_phone, m.show_alt_phone, m.show_email, m.show_admissions_email, m.show_whatsapp,
         m.show_address, m.show_map, m.show_hours, m.show_socials, m.show_head, m.show_emergency,
         m.contact_form_enabled,
         (SELECT COUNT(*) FROM students s WHERE s.madrasa_id = m.id AND s.status IN ('active','promoted','suspended')) AS student_count,
         (SELECT COUNT(*) FROM users u WHERE u.madrasa_id = m.id AND u.role = 'teacher' AND u.is_active = 1) AS teacher_count,
         (SELECT COUNT(*) FROM classes c WHERE c.madrasa_id = m.id AND c.is_active = 1) AS class_count,
         (SELECT COUNT(*) FROM subjects su WHERE su.madrasa_id = m.id AND su.is_active = 1) AS subject_count,
         (SELECT label FROM academic_sessions a WHERE a.madrasa_id = m.id AND a.is_current = 1 ORDER BY a.id DESC LIMIT 1) AS current_session
  FROM madaris m`;

/** A contact channel is published only when the administrator allows it. */
function ifShown(flag, value) {
  return Number(flag) === 1 ? (value || "") : "";
}

function cardOut(m) {
  const appearance = myInstitution.resolveAppearance(m);
  return {
    slug: m.slug,
    // Modern canonical website path. `sharePath` is retained for directory
    // clients that predate /schools/:slug; its alias still resolves this same
    // tenant website, never the platform homepage.
    websitePath: "/schools/" + encodeURIComponent(m.slug),
    sharePath: "/s/" + encodeURIComponent(m.slug),
    customDomain: m.custom_domain || "",
    nameEn: m.name_en,
    nameAr: m.name_ar || "",
    mottoEn: m.motto_en || "",
    mottoAr: m.motto_ar || "",
    tagline: m.tagline || "",
    logoPath: m.logo_path || "",
    heroImagePath: m.hero_image_path || "",
    badgePath: m.badge_path || "",
    faviconPath: m.favicon_path || "",
    brandColor: m.brand_color || "",
    category: m.category || "islamic",
    institutionType: m.institution_type || "",
    mapsLink: ifShown(m.show_map, m.maps_link),
    address: ifShown(m.show_address, m.address),
    city: m.city || "",
    state: m.state_name || "",
    country: m.country || "",
    descriptionEn: m.description_en || "",
    descriptionAr: m.description_ar || "",
    shortDescription: m.short_description || "",
    foundedYear: m.founded_year || "",
    website: m.website || "",
    phone: ifShown(m.show_phone, m.phone),
    altPhone: ifShown(m.show_alt_phone, m.alt_phone),
    email: ifShown(m.show_email, m.email),
    admissionsEmail: ifShown(m.show_admissions_email, m.admissions_email),
    whatsapp: ifShown(m.show_whatsapp, m.whatsapp),
    students: Number(m.student_count || 0),
    teachers: Number(m.teacher_count || 0),
    classes: Number(m.class_count || 0),
    subjects: Number(m.subject_count || 0),
    currentSession: m.current_session || "",
    canCheckResults: Number(m.public_results) === 1,
    canApply: Number(m.public_admissions) === 1,
    // --- My Institution: identity, operations and appearance -------------
    profile: {
      history: m.history || "",
      mission: m.mission || "",
      vision: m.vision || "",
      coreValues: m.core_values || "",
      philosophy: m.philosophy || "",
      ownershipType: m.ownership_type || "",
      headName: ifShown(m.show_head, m.head_name),
      headTitle: ifShown(m.show_head, m.head_title),
      registrationNo: m.registration_no || "",
      accreditationBody: m.accreditation_body || "",
      accreditationDetails: m.accreditation_details || "",
    },
    information: {
      levelsOffered: m.levels_offered || "",
      islamicEducation: m.islamic_education_info || "",
      westernEducation: m.western_education_info || "",
      languages: m.languages_of_instruction || "",
      studentCapacity: m.student_capacity === null || m.student_capacity === undefined ? null : Number(m.student_capacity),
      boardingStatus: m.boarding_status || "",
      admissionStatus: m.admission_status || "open",
      openingTime: ifShown(m.show_hours, m.opening_time),
      closingTime: ifShown(m.show_hours, m.closing_time),
      schoolDays: ifShown(m.show_hours, m.school_days),
    },
    contact: {
      emergency: ifShown(m.show_emergency, m.emergency_contact),
      formEnabled: Number(m.contact_form_enabled) === 1,
      socials: Number(m.show_socials) === 1 ? {
        facebook: m.facebook || "", instagram: m.instagram || "", twitter: m.twitter || "",
        youtube: m.youtube || "", linkedin: m.linkedin || "", tiktok: m.tiktok || "",
      } : {},
    },
    appearance,
    seo: {
      title: m.seo_title || "",
      description: m.seo_description || m.short_description || "",
      keywords: m.seo_keywords || "",
    },
    websitePublished: Number(m.website_published) !== 0,
  };
}

async function findPublicMadrasa(slug) {
  const s = cleanStr(slug, 80).toLowerCase();
  if (!s) return null;
  return db.get(CARD_SELECT + " WHERE m.slug = ? AND m.status = 'active'", [s]);
}

function domainFrom(value) {
  return cleanStr(value, 255).toLowerCase().replace(/\.$/, "").replace(/^www\./, "");
}

/** Resolve an optional custom host to its ONE active institution. */
async function findPublicMadrasaByDomain(hostname) {
  const domain = domainFrom(hostname);
  if (!domain || !domain.includes(".")) return null;
  return db.get(CARD_SELECT + " WHERE m.custom_domain = ? AND m.status = 'active'", [domain]);
}

function publicWebsiteAddress(req, m) {
  if (m.custom_domain) return `https://${m.custom_domain}`;
  const host = cleanStr(req.get("host"), 255);
  const protocol = req.protocol === "https" ? "https" : "http";
  // Host comes from the current request; it is never a deployment constant.
  return host ? `${protocol}://${host}/schools/${encodeURIComponent(m.slug)}` : `/schools/${encodeURIComponent(m.slug)}`;
}

function parseStoredList(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return String(value || "").split(/\n|,/).map((item) => item.trim()).filter(Boolean);
  }
}

/**
 * Complete public-site projection for a single resolved institution.
 * Every content query is parameterised with m.id. Do not replace these
 * predicates with a global "published" query: that would cross tenants.
 */
async function publicWebsitePayload(req, m) {
  const [classes, subjects, notices, summaryCount, pageRows, sitePages, albums, media, teachers, programs, events, admissionRows] = await Promise.all([
    db.all("SELECT id, name_en, name_ar FROM classes WHERE madrasa_id = ? AND is_active = 1 ORDER BY sort_order, id", [m.id]),
    db.all("SELECT name_en, name_ar, description, education_track, category FROM subjects WHERE madrasa_id = ? AND is_active = 1 ORDER BY name_en", [m.id]),
    db.all(
      `SELECT a.id, a.title, a.body, a.created_at, a.publish_until, a.image_path
       FROM announcements a
       WHERE a.madrasa_id = ? AND a.is_active = 1 AND a.publish_public = 1
         AND (a.publish_until IS NULL OR a.publish_until >= ?)
       ORDER BY a.created_at DESC, a.id DESC LIMIT 24`,
      [m.id, today()]
    ),
    db.get(
      `SELECT COUNT(*) AS n FROM term_summaries ts
       JOIN students s ON s.id = ts.student_id AND s.madrasa_id = ts.madrasa_id
       WHERE ts.madrasa_id = ? AND ts.published_at IS NOT NULL`, [m.id]
    ),
    db.all(
      `SELECT key_name, value FROM settings WHERE madrasa_id = ? AND key_name IN
       ('website_homepage_title', 'website_homepage_content',
        'website_about_title', 'website_about_content',
        'website_programs_title', 'website_programs_content',
        'website_teachers_title', 'website_teachers_content',
        'website_admissions_title', 'website_admissions_content')`, [m.id]
    ),
    db.all(
      `SELECT slug, title, summary, body, seo_title, seo_description, in_navigation, sort_order
       FROM website_pages WHERE madrasa_id = ? AND is_published = 1 ORDER BY sort_order, id`, [m.id]
    ),
    db.all(
      `SELECT a.id, a.title, a.description, a.category, a.is_featured, a.sort_order,
              (SELECT g.image_path FROM gallery_images g WHERE g.id = a.cover_image_id AND g.madrasa_id = a.madrasa_id) AS cover_path
       FROM gallery_albums a WHERE a.madrasa_id = ? AND a.is_published = 1 ORDER BY a.sort_order, a.id`, [m.id]
    ),
    db.all(
      `SELECT id, album_id, image_path, video_url, media_type, caption, category, is_featured, sort_order
       FROM gallery_images WHERE madrasa_id = ? AND is_published = 1 ORDER BY is_featured DESC, sort_order, id LIMIT 200`, [m.id]
    ),
    // Intentionally narrow public teacher projection: no email, phone,
    // address, HR documents, salary or private employment details.
    db.all(
      `SELECT u.full_name, p.photo_path, p.position, p.qualifications, p.specialization,
              p.public_bio, p.education_track,
              (SELECT GROUP_CONCAT(s.name_en)
                 FROM teacher_assignments ta
                 JOIN subjects s ON s.id = ta.subject_id AND s.madrasa_id = ta.madrasa_id
                WHERE ta.madrasa_id = p.madrasa_id AND ta.user_id = p.user_id
                  AND COALESCE(ta.status, 'active') <> 'archived') AS subject_names
       FROM teacher_profiles p
       JOIN users u ON u.id = p.user_id AND u.madrasa_id = p.madrasa_id
       WHERE p.madrasa_id = ? AND p.is_public = 1 AND p.status = 'active'
         AND u.role = 'teacher' AND u.is_active = 1
       ORDER BY u.full_name, u.id`, [m.id]
    ),
    db.all(
      `SELECT id, title, description, education_track, image_path, is_featured
       FROM public_programs WHERE madrasa_id = ? AND is_published = 1
       ORDER BY is_featured DESC, sort_order, id`, [m.id]
    ),
    db.all(
      `SELECT id, title, description, event_date, location, image_path, is_featured
       FROM public_events WHERE madrasa_id = ? AND is_published = 1
       ORDER BY CASE WHEN event_date IS NULL THEN 1 ELSE 0 END, event_date, sort_order, id`, [m.id]
    ),
    db.all(
      `SELECT key_name, value FROM settings WHERE madrasa_id = ? AND key_name IN
       ('admission_open', 'application_start_date', 'application_closing_date',
        'available_session_ids', 'available_class_ids', 'available_programs',
        'application_fee', 'required_information', 'required_documents',
        'interview_instructions', 'acceptance_instructions')`, [m.id]
    ),
  ]);
  const pages = {}; pageRows.forEach((row) => { pages[row.key_name] = row.value || ""; });
  const admission = {}; admissionRows.forEach((row) => { admission[row.key_name] = row.value || ""; });
  const availableClassIds = parseStoredList(admission.available_class_ids).map(Number);
  const availableSessionIds = parseStoredList(admission.available_session_ids).map(Number);
  const sessions = availableSessionIds.length
    ? await db.all(`SELECT id, label FROM academic_sessions WHERE madrasa_id = ? AND id IN (${availableSessionIds.map(() => "?").join(",")}) ORDER BY id DESC`, [m.id, ...availableSessionIds])
    : await db.all("SELECT id, label FROM academic_sessions WHERE madrasa_id = ? AND is_current = 1 ORDER BY id DESC LIMIT 1", [m.id]);

  return {
    madrasa: cardOut(m),
    website: {
      path: `/schools/${encodeURIComponent(m.slug)}`,
      url: publicWebsiteAddress(req, m),
      customDomain: m.custom_domain || "",
      usesCustomDomain: Boolean(m.custom_domain),
    },
    classes: classes.filter((row) => !availableClassIds.length || availableClassIds.includes(Number(row.id))),
    subjects,
    notices,
    events: events.map((event) => ({
      id: Number(event.id), title: event.title, description: event.description || "", date: event.event_date || "",
      location: event.location || "", imagePath: event.image_path || "", featured: Number(event.is_featured) === 1,
    })),
    programs: programs.map((program) => ({
      id: Number(program.id), title: program.title, description: program.description || "",
      educationTrack: program.education_track || "general", imagePath: program.image_path || "", featured: Number(program.is_featured) === 1,
    })),
    teachers: teachers.map((teacher) => ({
      name: teacher.full_name || "", photoPath: teacher.photo_path || "", position: teacher.position || "",
      qualification: teacher.qualifications || "", specialization: teacher.specialization || "", bio: teacher.public_bio || "",
      educationTrack: teacher.education_track || "both",
      subjects: String(teacher.subject_names || "").split(",").map((name) => name.trim()).filter(Boolean),
    })),
    admissions: {
      open: Number(m.public_admissions) === 1 && admission.admission_open !== "false" && m.admission_status !== "closed",
      status: m.admission_status || "open", currentSession: sessions.map((session) => ({ id: Number(session.id), label: session.label })),
      availablePrograms: parseStoredList(admission.available_programs),
      applicationFee: admission.application_fee || "",
      requirements: parseStoredList(admission.required_information),
      requiredDocuments: parseStoredList(admission.required_documents),
      process: admission.interview_instructions || "",
      acceptanceInstructions: admission.acceptance_instructions || "",
      applicationPath: `/api/public/madaris/${encodeURIComponent(m.slug)}/apply`,
    },
    publishedTermCount: Number(summaryCount.n), pages,
    sitePages: sitePages.map((page) => ({
      slug: page.slug, title: page.title, summary: page.summary || "", body: page.body || "",
      seoTitle: page.seo_title || "", seoDescription: page.seo_description || "",
      inNavigation: Number(page.in_navigation) === 1,
    })),
    navigation: sitePages.filter((page) => Number(page.in_navigation) === 1).map((page) => ({ slug: page.slug, title: page.title })),
    gallery: {
      albums: albums.map((album) => ({ id: album.id, title: album.title, description: album.description || "", category: album.category || "", coverPath: album.cover_path || "", featured: Number(album.is_featured) === 1 })),
      media: media.map((item) => ({ id: item.id, albumId: item.album_id || null, path: item.image_path || "", videoUrl: item.video_url || "", type: item.media_type || "image", caption: item.caption || "", category: item.category || "", featured: Number(item.is_featured) === 1 })),
    },
    loginUrl: "/login",
  };
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

/* ------------------------------ landing / directory -------------------- */

router.get("/site", publicLimiter, asyncHandler(async (req, res) => {
  const site = await publicSettings();
  if (!site.directoryEnabled) {
    return ok(res, { site, directoryEnabled: false, madaris: [], stats: { madaris: 0, students: 0, teachers: 0 } });
  }
  const [rows, totals] = await Promise.all([
    db.all(CARD_SELECT + " WHERE m.status = 'active' AND m.public_listing = 1 ORDER BY m.name_en"),
    db.get(`SELECT
        (SELECT COUNT(*) FROM madaris WHERE status = 'active' AND public_listing = 1) AS madaris,
        (SELECT COUNT(*) FROM students s WHERE s.status IN ('active','promoted','suspended')
           AND EXISTS (SELECT 1 FROM madaris m WHERE m.id = s.madrasa_id AND m.status = 'active' AND m.public_listing = 1)) AS students,
        (SELECT COUNT(*) FROM users u WHERE u.role = 'teacher' AND u.is_active = 1
           AND EXISTS (SELECT 1 FROM madaris m WHERE m.id = u.madrasa_id AND m.status = 'active' AND m.public_listing = 1)) AS teachers`),
  ]);
  ok(res, {
    site,
    directoryEnabled: true,
    stats: { madaris: Number(totals.madaris), students: Number(totals.students), teachers: Number(totals.teachers) },
    cities: [...new Set(rows.map((r) => r.city).filter(Boolean))].sort(),
    madaris: rows.map(cardOut),
  });
}));

router.get("/madaris", publicLimiter, asyncHandler(async (req, res) => {
  const site = await publicSettings();
  if (!site.directoryEnabled) return ok(res, { madaris: [], cities: [], directoryEnabled: false });
  const q = cleanStr(req.query.q, 80).toLowerCase();
  const city = cleanStr(req.query.city, 80).toLowerCase();
  let rows = await db.all(CARD_SELECT + " WHERE m.status = 'active' AND m.public_listing = 1 ORDER BY m.name_en");
  if (q) rows = rows.filter((m) => [m.name_en, m.name_ar, m.slug, m.city, m.description_en, m.motto_en].filter(Boolean).join(" ").toLowerCase().includes(q));
  if (city) rows = rows.filter((m) => String(m.city || "").toLowerCase() === city);
  ok(res, { madaris: rows.map(cardOut), cities: [...new Set(rows.map((m) => m.city).filter(Boolean))].sort() });
}));

router.get("/madaris/:slug", publicLimiter, asyncHandler(async (req, res) => {
  const m = await findPublicMadrasa(req.params.slug);
  if (!m || Number(m.public_listing) !== 1) return err(res, 404, "That madrasa page is not available.");
  // Admin → My Institution → Public Website can take the site offline without
  // touching the directory listing or any of the data behind it.
  if (Number(m.website_published) === 0) {
    return err(res, 404, "This institution's website is currently unpublished.");
  }
  const [classes, subjects, notices, summaryCount, pageRows] = await Promise.all([
    db.all("SELECT id, name_en, name_ar FROM classes WHERE madrasa_id = ? AND is_active = 1 ORDER BY sort_order, id", [m.id]),
    db.all("SELECT name_en, name_ar FROM subjects WHERE madrasa_id = ? AND is_active = 1 ORDER BY name_en", [m.id]),
    db.all(
      `SELECT a.id, a.title, a.body, a.created_at, a.publish_until FROM announcements a
       WHERE a.madrasa_id = ? AND a.is_active = 1 AND a.publish_public = 1
         AND (a.publish_until IS NULL OR a.publish_until >= ?)
       ORDER BY a.created_at DESC, a.id DESC LIMIT 10`,
      [m.id, today()]
    ),
    db.get(
      `SELECT COUNT(*) AS n FROM term_summaries ts
       JOIN students s ON s.id = ts.student_id AND s.madrasa_id = ts.madrasa_id
       WHERE ts.madrasa_id = ? AND ts.published_at IS NOT NULL`,
      [m.id]
    ),
    // A small, allow-listed public projection of page copy saved by the
    // school administrator. Notification and operational settings remain
    // private in the same settings table.
    db.all(
      `SELECT key_name, value FROM settings
       WHERE madrasa_id = ? AND key_name IN
         ('website_homepage_title', 'website_homepage_content',
          'website_about_title', 'website_about_content',
          'website_programs_title', 'website_programs_content',
          'website_teachers_title', 'website_teachers_content',
          'website_admissions_title', 'website_admissions_content')`,
      [m.id]
    ),
  ]);
  const pages = {};
  pageRows.forEach((row) => { pages[row.key_name] = row.value || ""; });

  // Website Pages + Gallery, as configured under ADMIN → MY INSTITUTION.
  // Only records the administrator explicitly published are returned; an
  // unpublished page or album is invisible to the public API entirely.
  const [sitePages, albums, media] = await Promise.all([
    db.all(
      `SELECT slug, title, summary, body, seo_title, seo_description, in_navigation, sort_order
         FROM website_pages WHERE madrasa_id = ? AND is_published = 1 ORDER BY sort_order, id`,
      [m.id]
    ),
    db.all(
      `SELECT a.id, a.title, a.description, a.category, a.is_featured, a.sort_order,
              (SELECT g.image_path FROM gallery_images g WHERE g.id = a.cover_image_id AND g.madrasa_id = a.madrasa_id) AS cover_path
         FROM gallery_albums a WHERE a.madrasa_id = ? AND a.is_published = 1 ORDER BY a.sort_order, a.id`,
      [m.id]
    ),
    db.all(
      `SELECT id, album_id, image_path, video_url, media_type, caption, category, is_featured, sort_order
         FROM gallery_images WHERE madrasa_id = ? AND is_published = 1 ORDER BY sort_order, id LIMIT 200`,
      [m.id]
    ),
  ]);

  ok(res, {
    madrasa: cardOut(m),
    classes,
    subjects,
    notices,
    publishedTermCount: Number(summaryCount.n),
    pages,
    sitePages: sitePages.map((p) => ({
      slug: p.slug,
      title: p.title,
      summary: p.summary || "",
      body: p.body || "",
      seoTitle: p.seo_title || "",
      seoDescription: p.seo_description || "",
      inNavigation: Number(p.in_navigation) === 1,
    })),
    navigation: sitePages.filter((p) => Number(p.in_navigation) === 1).map((p) => ({ slug: p.slug, title: p.title })),
    gallery: {
      albums: albums.map((a) => ({
        id: a.id, title: a.title, description: a.description || "",
        category: a.category || "", coverPath: a.cover_path || "", featured: Number(a.is_featured) === 1,
      })),
      media: media.map((g) => ({
        id: g.id, albumId: g.album_id || null, path: g.image_path || "", videoUrl: g.video_url || "",
        type: g.media_type || "image", caption: g.caption || "", category: g.category || "",
        featured: Number(g.is_featured) === 1,
      })),
    },
    // The administrator sign-in page — a real address (always asks for a
    // password) rather than the old hash route.
    loginUrl: "/login",
  });
}));

/* ---------------------- dedicated institution websites ----------------- */

/** Canonical public website by tenant slug. Directory visibility is separate. */
router.get("/schools/:slug", publicLimiter, asyncHandler(async (req, res) => {
  const m = await findPublicMadrasa(req.params.slug);
  if (!m || Number(m.website_published) === 0) return err(res, 404, "Institution website not found.");
  ok(res, await publicWebsitePayload(req, m));
}));

/** Custom-domain bootstrapping; www and apex resolve to the same tenant. */
router.get("/schools/domain/current", publicLimiter, asyncHandler(async (req, res) => {
  // `domain` supports deployments whose public frontend and API use
  // different origins. It is only a lookup key; the resolved tenant still
  // supplies every subsequent scoped query.
  const m = await findPublicMadrasaByDomain(req.query.domain || req.hostname);
  if (!m || Number(m.website_published) === 0) return err(res, 404, "Institution website not found for this domain.");
  ok(res, await publicWebsitePayload(req, m));
}));

/** Contact requests are delivered only into the website's resolved tenant. */
router.post("/schools/:slug/contact", publicWriteLimiter, asyncHandler(async (req, res) => {
  const m = await findPublicMadrasa(req.params.slug);
  if (!m || Number(m.website_published) === 0 || Number(m.contact_form_enabled) !== 1) return err(res, 404, "This institution contact form is not available.");
  const b = req.body || {}; const name = cleanStr(b.name, 160); const message = cleanStr(b.message, 5000);
  const email = cleanStr(b.email, 120); const phone = cleanStr(b.phone, 60);
  if (!name || !message) return err(res, 400, "Your name and message are required.");
  if (email && !validEmail(email)) return err(res, 400, "Enter a valid email address.");
  if (phone && !validPhone(phone)) return err(res, 400, "Enter a valid phone number.");
  const result = await db.run(
    "INSERT INTO public_contact_messages (madrasa_id, name, email, phone, subject, message, ip) VALUES (?,?,?,?,?,?,?)",
    [m.id, name, email, phone, cleanStr(b.subject, 200), message, cleanStr(req.ip, 64)]
  );
  await logActivity(db, { madrasaId: m.id, action: "website.contact", entity: "public_contact_message", entityId: String(result.lastInsertRowid), ip: req.ip });
  ok(res, { ok: true, message: "Thank you. Your message has been sent to " + m.name_en + "." });
}));

/* ------------------------------ public notices ------------------------- */

router.get("/madaris/:slug/notices", publicLimiter, asyncHandler(async (req, res) => {
  const m = await findPublicMadrasa(req.params.slug);
  if (!m || Number(m.public_listing) !== 1) return err(res, 404, "That madrasa page is not available.");
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 10));
  const rows = await db.all(
    `SELECT a.id, a.title, a.body, a.created_at, a.publish_until FROM announcements a
     WHERE a.madrasa_id = ? AND a.is_active = 1 AND a.publish_public = 1
       AND (a.publish_until IS NULL OR a.publish_until >= ?)
     ORDER BY a.created_at DESC, a.id DESC LIMIT ?`,
    [m.id, today(), limit]
  );
  ok(res, { notices: rows });
}));

/* ------------------------------ result checking ------------------------ */

/**
 * POST /api/public/results/verify
 * body: { madrasaSlug, admissionNo, surname? , dateOfBirth?, termId? }
 * surname OR date of birth must match the record, so an admission number
 * alone is not enough to read somebody else's results.
 */
router.post("/results/verify", verifyLimiter, asyncHandler(async (req, res) => {
  const b = req.body || {};
  const slug = cleanStr(b.madrasaSlug, 80).toLowerCase();
  const admission = cleanStr(b.admissionNo, 60).toUpperCase();
  const surname = cleanStr(b.surname, 100).toLowerCase();
  const dob = validDate(b.dateOfBirth);
  if (!slug || !admission) return err(res, 400, "Madrasa and admission number are required.");
  if (!surname && !dob) return err(res, 400, "Enter the surname or date of birth on the record to verify.");

  const m = await findPublicMadrasa(slug);
  if (!m) return err(res, 404, "No matching record.");
  if (Number(m.public_results) !== 1) return err(res, 403, "This madrasa does not publish results online.");

  const student = await db.get("SELECT * FROM students WHERE madrasa_id = ? AND UPPER(admission_no) = ?", [m.id, admission]);
  const okSurname = student && surname && String(student.last_name || "").trim().toLowerCase() === surname;
  const okDob = student && dob && String(student.date_of_birth || "").slice(0, 10) === dob;
  if (!student || (!okSurname && !okDob)) {
    await logActivity(db, { madrasaId: m.id, action: "public.result_failed", entity: "student", entityId: admission, ip: req.ip });
    return err(res, 404, "No matching record. Check the admission number and surname.");
  }

  const terms = await db.all(
    `SELECT ts.term_id, ts.average, ts.overall_grade, ts.position, ts.total, ts.subject_count,
            ts.promotion_status, ts.published_at, t.name_en, t.name_ar, t.position AS term_position,
            s.label AS session_label
     FROM term_summaries ts
     JOIN terms t ON t.id = ts.term_id
     JOIN academic_sessions s ON s.id = ts.session_id
     WHERE ts.madrasa_id = ? AND ts.student_id = ? AND ts.published_at IS NOT NULL
     ORDER BY s.id DESC, t.position DESC`,
    [m.id, student.id]
  );
  const classRow = student.class_id ? await db.get("SELECT name_en, name_ar FROM classes WHERE id = ?", [student.class_id]) : null;

  if (!terms.length) {
    return ok(res, {
      verified: true,
      student: { name: `${student.first_name} ${student.last_name}`.trim(), admissionNo: student.admission_no, className: classRow ? classRow.name_en : "" },
      terms: [],
      message: "Your results have not been published for this term yet. Please check again later.",
    });
  }

  const wanted = b.termId ? Number(b.termId) : Number(terms[0].term_id);
  const chosen = terms.find((t) => Number(t.term_id) === wanted) || terms[0];
  // One short-lived link per published term, so a parent can print or share
  // last term's card as well as this term's without verifying again.
  const withTokens = terms.map((t) => {
    const token = tokens.sign({ purpose: "public-report", m: m.id, s: student.id, t: Number(t.term_id) }, REPORT_TTL_SECONDS);
    return Object.assign({}, t, { termId: Number(t.term_id), token, reportUrl: `/api/public/results/report/${token}` });
  });

  await logActivity(db, { madrasaId: m.id, action: "public.result_view", entity: "student", entityId: String(student.id), ip: req.ip });
  ok(res, {
    verified: true,
    madrasa: { nameEn: m.name_en, nameAr: m.name_ar, logoPath: m.logo_path, mottoEn: m.motto_en },
    student: {
      name: `${student.first_name} ${student.last_name}`.trim(),
      nameAr: student.name_ar || "",
      admissionNo: student.admission_no,
      className: classRow ? classRow.name_en : "",
      classNameAr: classRow ? classRow.name_ar : "",
    },
    terms: withTokens,
    selectedTermId: Number(chosen.term_id),
    reportUrl: `/api/public/results/report/${withTokens.find((t) => t.termId === Number(chosen.term_id)).token}`,
    expiresIn: REPORT_TTL_SECONDS,
  });
}));

/** Serves a report card for a verified, still-valid token (no session needed). */
router.get("/results/report/:token", publicLimiter, asyncHandler(async (req, res) => {
  const payload = tokens.verify(req.params.token, "public-report");
  if (!payload) return err(res, 403, "This link has expired. Please verify again.");
  const m = await db.get("SELECT id, status, public_results FROM madaris WHERE id = ?", [payload.m]);
  if (!m || m.status !== "active" || Number(m.public_results) !== 1) return err(res, 404, "Not available.");
  const data = await grading.reportCardData(payload.m, payload.s, payload.t);
  if (!data) return err(res, 404, "Report card not found.");
  // Only published summaries may be printed publicly.
  const summary = await db.get("SELECT published_at FROM term_summaries WHERE madrasa_id = ? AND student_id = ? AND term_id = ?", [payload.m, payload.s, payload.t]);
  if (!summary || !summary.published_at) return err(res, 403, "This result is not published yet.");
  const html = renderReportCard(data).replace("</body>",
    '<div style="text-align:center;font-size:11px;color:#6b7280;padding:6px 0">Published online copy — verified ' + new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC</div></body>");
  res.type("html").send(html);
}));

/* ------------------------------ applications --------------------------- */

async function newReference(madrasaId) {
  if (!madrasaId) return "ADM-" + new Date().getFullYear() + "-" + crypto.randomBytes(3).toString("hex").toUpperCase();
  const setting = await db.get("SELECT value FROM settings WHERE madrasa_id=? AND key_name='application_number_format'", [madrasaId]);
  const format = cleanStr(setting && setting.value, 80);
  if (!format) return "ADM-" + new Date().getFullYear() + "-" + crypto.randomBytes(3).toString("hex").toUpperCase();
  const year = String(new Date().getFullYear());
  const count = await db.get("SELECT COUNT(*) AS n FROM admission_requests WHERE madrasa_id=?", [madrasaId]);
  let seq = Number(count && count.n || 0) + 1;
  for (let attempt = 0; attempt < 1000; attempt++, seq++) {
    const match = format.match(/\{SEQ(?::(\d+))?\}/i); const width = match ? Math.min(10, Math.max(1, Number(match[1] || 5))) : 5;
    const candidate = format.replace(/\{YYYY\}/gi, year).replace(/\{YY\}/gi, year.slice(-2)).replace(/\{SEQ(?::\d+)?\}/gi, String(seq).padStart(width, "0")).replace(/[^A-Za-z0-9/_-]/g, "").slice(0, 30).toUpperCase();
    if (candidate && !await db.get("SELECT id FROM admission_requests WHERE madrasa_id=? AND reference=?", [madrasaId, candidate])) return candidate;
  }
  return "ADM-" + year + "-" + crypto.randomBytes(3).toString("hex").toUpperCase();
}

/**
 * POST /api/public/madaris/:slug/apply
 * Only works when the madrasa turned on "Online admission". A hidden
 * `website` field (honeypot) traps automated spam.
 */
router.post("/madaris/:slug/apply", publicWriteLimiter, asyncHandler(async (req, res) => {
  const b = req.body || {};
  if (cleanStr(b.website, 200)) {
    // Bot: pretend it worked so the form keeps getting filled with junk.
    return ok(res, { ok: true, reference: await newReference(), queued: true });
  }
  const m = await findPublicMadrasa(req.params.slug);
  if (!m || Number(m.public_admissions) !== 1) return err(res, 404, "Online admission is not open at this madrasa.");
  const admissionSettingsRows = await db.all("SELECT key_name,value FROM settings WHERE madrasa_id=? AND key_name IN ('admission_open','application_start_date','application_closing_date','available_session_ids','available_class_ids','available_programs')", [m.id]);
  const admissionSettings = {}; admissionSettingsRows.forEach((row) => { admissionSettings[row.key_name] = row.value; });
  if (admissionSettings.admission_open === "false") return err(res, 403, "Admissions are currently closed.");
  const todayDate = new Date().toISOString().slice(0, 10);
  if (admissionSettings.application_start_date && todayDate < admissionSettings.application_start_date) return err(res, 403, `Applications open on ${admissionSettings.application_start_date}.`);
  if (admissionSettings.application_closing_date && todayDate > admissionSettings.application_closing_date) return err(res, 403, "The application period has closed.");

  const firstName = cleanStr(b.first_name, 100);
  const parentName = cleanStr(b.parent_name, 160);
  const parentPhone = cleanStr(b.parent_phone, 60);
  if (!firstName || !parentName || !parentPhone) return err(res, 400, "Student name, parent/guardian name and phone are required.");
  if (!validPhone(parentPhone)) return err(res, 400, "Enter a valid phone number (digits, + and spaces).");
  if (b.parent_email && !validEmail(b.parent_email)) return err(res, 400, "Enter a valid email address.");
  const dob = validDate(b.date_of_birth);
  if (b.date_of_birth && !dob) return err(res, 400, "Date of birth must be YYYY-MM-DD.");
  const gender = ["M", "F"].includes(cleanStr(b.gender, 1)) ? cleanStr(b.gender, 1) : "";

  const yesterday = new Date(Date.now() - 24 * 3600 * 1000).toISOString().slice(0, 19).replace("T", " ");
  const existing = await db.get(
    "SELECT reference FROM admission_requests WHERE madrasa_id = ? AND parent_phone = ? AND LOWER(first_name) = ? AND created_at > ?",
    [m.id, parentPhone, firstName.toLowerCase(), yesterday]
  );
  if (existing) return err(res, 409, "An application for this student was already submitted today. Reference: " + existing.reference);

  const classId = b.class_id ? Number(b.class_id) : null;
  const classRow = classId ? await db.get("SELECT id FROM classes WHERE id = ? AND madrasa_id = ? AND is_active = 1", [classId, m.id]) : null;
  if (classId && !classRow) return err(res, 400, "Unknown class.");
  const parseList = (value) => { try { const out = JSON.parse(value || "[]"); return Array.isArray(out) ? out : []; } catch (_) { return []; } };
  const availableClasses = parseList(admissionSettings.available_class_ids).map(Number);
  if (classId && availableClasses.length && !availableClasses.includes(classId)) return err(res, 400, "That class is not currently open for admission.");
  const desiredSessionId = b.desired_session_id ? Number(b.desired_session_id) : null;
  if (desiredSessionId && !await db.get("SELECT id FROM academic_sessions WHERE id=? AND madrasa_id=?", [desiredSessionId, m.id])) return err(res, 400, "Unknown academic session.");
  const availableSessions = parseList(admissionSettings.available_session_ids).map(Number);
  if (desiredSessionId && availableSessions.length && !availableSessions.includes(desiredSessionId)) return err(res, 400, "That academic session is not currently accepting applications.");
  const availablePrograms = parseList(admissionSettings.available_programs).map((x) => String(x).toLowerCase());
  if (b.program && availablePrograms.length && !availablePrograms.includes(cleanStr(b.program,120).toLowerCase())) return err(res, 400, "That program is not currently accepting applications.");

  const reference = await newReference(m.id);
  const columns = ["madrasa_id","reference","status","first_name","middle_name","last_name","preferred_name","name_ar","gender","date_of_birth",
    "nationality","state_of_origin","lga","religion","class_id","previous_school","previous_class","quran_level","program","education_track",
    "desired_session_id","parent_name","father_name","mother_name","guardian_name","guardian_relationship","parent_phone","alternative_phone","parent_email",
    "contact_phone","contact_email","address","emergency_contact","additional_info","message","ip"];
  const values = [
    m.id, reference, "pending", firstName, cleanStr(b.middle_name,100), cleanStr(b.last_name,100), cleanStr(b.preferred_name,100), cleanStr(b.name_ar,160), gender, dob,
    cleanStr(b.nationality,80), cleanStr(b.state_of_origin,80), cleanStr(b.lga,80), cleanStr(b.religion,60), classRow?classRow.id:null, cleanStr(b.previous_school,200), cleanStr(b.previous_class,120), cleanStr(b.quran_level,80), cleanStr(b.program,120), ["islamic","western","both"].includes(cleanStr(b.education_track,20).toLowerCase())?cleanStr(b.education_track,20).toLowerCase():"both",
    desiredSessionId, parentName, cleanStr(b.father_name,160), cleanStr(b.mother_name,160), cleanStr(b.guardian_name,160), cleanStr(b.guardian_relationship,80), parentPhone, cleanStr(b.alternative_phone,60), cleanStr(b.parent_email,120),
    cleanStr(b.contact_phone,60), cleanStr(b.contact_email,120), cleanStr(b.address,255), cleanStr(b.emergency_contact,160), cleanStr(b.additional_info,2000), cleanStr(b.message,2000), cleanStr(req.ip,64),
  ];
  const r = await db.run(`INSERT INTO admission_requests (${columns.join(",")}) VALUES (${columns.map(()=>"?").join(",")})`, values);
  await logActivity(db, { madrasaId: m.id, action: "admission.public_apply", entity: "admission_request", entityId: String(r.lastInsertRowid), meta: { reference }, ip: req.ip });
  ok(res, { ok: true, reference, submittedAt: new Date().toISOString(), madrasaSlug: m.slug, madrasaName: m.name_en });
}));

/** GET /api/public/madaris/:slug/apply-status?reference=ADM-…&phone=… */
router.get("/madaris/:slug/apply-status", publicLimiter, asyncHandler(async (req, res) => {
  const m = await findPublicMadrasa(req.params.slug);
  if (!m || Number(m.public_admissions) !== 1) return err(res, 404, "Online admission is not open at this madrasa.");
  const reference = cleanStr(req.query.reference, 30).toUpperCase();
  const phone = cleanStr(req.query.phone, 60).replace(/\s+/g, "");
  if (!reference || !phone) return err(res, 400, "Reference number and the phone you gave are required.");
  const row = await db.get(
    `SELECT ar.status, ar.reference, ar.first_name, ar.last_name, ar.review_note, ar.reviewed_at, ar.created_at,
            ar.parent_phone, ar.admission_no_assigned, s.admission_no AS student_admission_no, s.class_id AS student_class_id
     FROM admission_requests ar
     LEFT JOIN students s ON s.id = ar.student_id AND s.madrasa_id = ar.madrasa_id
     WHERE ar.madrasa_id = ? AND UPPER(ar.reference) = ?`,
    [m.id, reference]
  );
  if (!row) return err(res, 404, "No application with that reference.");
  // Compare on the last 7 digits so formatting differences do not matter.
  const tail = (v) => String(v || "").replace(/\D+/g, "").slice(-7);
  if (tail(row.parent_phone) !== tail(phone)) return err(res, 404, "Reference and phone do not match an application.");
  const admissionNo = row.admission_no_assigned || row.student_admission_no || "";
  ok(res, {
    reference: row.reference,
    status: row.status,
    student: `${row.first_name} ${row.last_name}`.trim(),
    note: row.review_note || "",
    reviewedAt: row.reviewed_at || null,
    submittedAt: row.created_at,
    // Once admitted, the family needs this number to read results later on.
    admissionNo,
    resultsUrl: ["approved", "enrolled"].includes(row.status) && admissionNo && Number(m.public_results) === 1
      ? `/results-check?madrasa=${m.slug}&admissionNo=${encodeURIComponent(admissionNo)}` : "",
  });
}));

/* ------------------------------ madrasa registration -------------------- */

function newMadrasaRegistrationId() {
  return "REG-" + new Date().getFullYear() + "-" + crypto.randomBytes(3).toString("hex").toUpperCase();
}

function newMadrasaId() {
  return "madrasa_" + crypto.randomBytes(4).toString("hex").toLowerCase();
}

/**
 * POST /api/public/register-madrasa   (also mounted as /register-academy)
 * Institution onboarding submission — used by BOTH the Islamic School and
 * the Western Academy registration forms. The request body's `category`
 * (or, failing that, the institutionType) decides which admin dashboard the
 * institution is promoted into once a super admin approves it.
 */
const registerHandler = asyncHandler(async (req, res) => {
  const b = req.body || {};
  const madrasaData = b.madrasa || b.academy || {};
  const adminData = b.administrator || {};
  const termsAccepted = b.termsAccepted === true || b.termsAccepted === "true" || b.termsAccepted === 1;
  const category = institution.normalizeCategory(b.category || madrasaData.category, madrasaData.institutionType);

  // Validate Madrasa required fields
  const name = cleanStr(madrasaData.name, 160);
  const country = cleanStr(madrasaData.country, 80) || "Nigeria";
  const state = cleanStr(madrasaData.state, 80);
  const city = cleanStr(madrasaData.city, 80);
  const address = cleanStr(madrasaData.address, 255);
  const phone = cleanStr(madrasaData.phone, 60);

  if (!name) return err(res, 400, "Madrasa name is required.");
  if (!state) return err(res, 400, "State is required.");
  if (!city) return err(res, 400, "City or town is required.");
  if (!address) return err(res, 400, "Full madrasa address is required.");
  if (!phone) return err(res, 400, "Official madrasa phone number is required.");
  if (!validPhone(phone)) return err(res, 400, "Please enter a valid official phone number.");

  if (madrasaData.email && !validEmail(madrasaData.email)) {
    return err(res, 400, "Please enter a valid madrasa email address.");
  }

  // Validate Administrator required fields
  const adminFullName = cleanStr(adminData.fullName, 160);
  const adminPosition = cleanStr(adminData.position, 80);
  const adminEmail = cleanStr(adminData.email, 120);
  const adminPhone = cleanStr(adminData.phone, 60);
  const adminPassword = String(adminData.password || "");

  if (!adminFullName) return err(res, 400, "Administrator full name is required.");
  if (!adminPosition) return err(res, 400, "Administrator position/role is required.");
  if (!adminEmail) return err(res, 400, "Administrator email address is required.");
  if (!validEmail(adminEmail)) return err(res, 400, "Please enter a valid administrator email address.");
  if (!adminPhone) return err(res, 400, "Administrator phone number is required.");
  if (!validPhone(adminPhone)) return err(res, 400, "Please enter a valid administrator phone number.");
  if (!adminPassword || adminPassword.length < 6) {
    return err(res, 400, "Password must be at least 6 characters.");
  }
  if (!termsAccepted) {
    return err(res, 400, "You must agree to the Terms of Service and Privacy Policy.");
  }

  const registrationId = newMadrasaRegistrationId();
  const madrasaId = madrasaData.id || newMadrasaId();
  // MySQL runs in strict mode in production and does not accept the ISO 8601
  // `T` separator for a DATETIME/TIMESTAMP parameter. SQLite is permissive,
  // which hid this until registrations were submitted against the live DB.
  // Keep the API response ISO-formatted, but use the portable SQL form for the
  // persisted value.
  const now = new Date();
  const submittedAt = now.toISOString();
  const databaseSubmittedAt = submittedAt.slice(0, 19).replace("T", " ");

  const officialName = cleanStr(madrasaData.officialName, 160);
  const logo = String(madrasaData.logo || "");
  const description = cleanStr(madrasaData.description, 3000);
  const yearEstablished = cleanStr(madrasaData.yearEstablished, 10);
  const institutionType = cleanStr(madrasaData.institutionType, 60) || (category === "western" ? "Nursery & Primary School" : "Madrasa");
  const mapsLink = cleanStr(madrasaData.mapsLink, 255);
  const whatsapp = cleanStr(madrasaData.whatsapp, 60);
  const madrasaEmail = cleanStr(madrasaData.email, 120);
  const website = cleanStr(madrasaData.website, 200);
  const facebook = cleanStr(madrasaData.facebook, 200);
  const instagram = cleanStr(madrasaData.instagram, 200);
  const subjects = Array.isArray(madrasaData.subjects) ? madrasaData.subjects.map(s => cleanStr(s, 80)).filter(Boolean) : [];
  const studentCount = cleanStr(madrasaData.studentCount, 20);
  const teacherCount = cleanStr(madrasaData.teacherCount, 20);
  const classCount = cleanStr(madrasaData.classCount, 20);
  const ageGroups = Array.isArray(madrasaData.ageGroups) ? madrasaData.ageGroups.map(a => cleanStr(a, 60)).filter(Boolean) : [];

  // A hash of the chosen password is kept so approval can create the real
  // login with the SAME credentials the applicant chose — never re-hashed
  // from plaintext later, and the plaintext itself is never stored.
  const adminPasswordHash = bcrypt.hashSync(adminPassword, 10);
  const adminUsername = cleanStr(adminData.username, 100).toLowerCase()
    || (name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "admin") + "-admin";

  // The INSERT is the registration. If it fails the applicant must be told to
  // try again — NEVER handed a reference number for a row that does not
  // exist. Swallowing this error is exactly why madaris and academies
  // "registered and submitted" but never appeared in the super admin's
  // Registrations screen: the browser showed a receipt while the database
  // had nothing, so there was no application for anyone to approve.
  try {
    await db.run(
      `INSERT INTO madrasa_registrations
        (registration_id, madrasa_id, status, name, official_name, logo_data, description,
         year_established, institution_type, category, country, state_name, city, address, maps_link,
         phone, whatsapp, email, website, facebook, instagram, subjects_json, student_count,
         teacher_count, class_count, age_groups_json, admin_full_name, admin_position,
         admin_email, admin_phone, admin_username, admin_password_hash, ip, submitted_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        registrationId, madrasaId, "Pending", name, officialName, logo ? logo.slice(0, 500000) : "", description,
        yearEstablished, institutionType, category, country, state, city, address, mapsLink,
        phone, whatsapp, madrasaEmail, website, facebook, instagram, JSON.stringify(subjects),
        studentCount, teacherCount, classCount, JSON.stringify(ageGroups), adminFullName,
        adminPosition, adminEmail, adminPhone, adminUsername, adminPasswordHash, cleanStr(req.ip, 64), databaseSubmittedAt,
      ]
    );
  } catch (e) {
    console.error("Failed to save madrasa registration " + registrationId + ":", e);
    return err(res, 500, "We could not save your registration. Nothing was submitted — please try again.");
  }

  await logActivity(db, {
    action: "registration.madrasa_submitted",
    entity: "madrasa_registration",
    entityId: registrationId,
    meta: { name, registrationId, adminEmail, category },
    ip: req.ip,
  }).catch(() => {});

  ok(res, {
    ok: true,
    message: "Registration submitted successfully for review.",
    registration: {
      registrationId,
      madrasaId,
      status: "Pending",
      category,
      submittedAt: now,
    },
    madrasa: {
      id: madrasaId,
      name,
      officialName,
      logo,
      description,
      yearEstablished,
      institutionType,
      country,
      state,
      city,
      address,
      mapsLink,
      phone,
      whatsapp,
      email: madrasaEmail,
      website,
      facebook,
      instagram,
      subjects,
      studentCount,
      teacherCount,
      classCount,
      ageGroups,
    },
    administrator: {
      fullName: adminFullName,
      position: adminPosition,
      email: adminEmail,
      phone: adminPhone,
    },
  });
});

router.post("/register-madrasa", publicWriteLimiter, registerHandler);
router.post("/register-academy", publicWriteLimiter, registerHandler);

/**
 * GET /api/public/registration-status/:id or ?ref=...&phone=...
 */
router.get("/registration-status/:id", publicLimiter, asyncHandler(async (req, res) => {
  const regId = cleanStr(req.params.id, 60).toUpperCase();
  if (!regId) return err(res, 400, "Registration ID is required.");

  let row = null;
  try {
    row = await db.get(
      "SELECT * FROM madrasa_registrations WHERE UPPER(registration_id) = ?",
      [regId]
    );
  } catch (e) {
    // Table might not exist or empty
  }

  if (!row) {
    return ok(res, {
      found: false,
      registrationId: regId,
      status: "Pending",
      message: "Registration received and queued for review.",
    });
  }

  ok(res, {
    found: true,
    registrationId: row.registration_id,
    madrasaId: row.madrasa_id,
    status: row.status || "Pending",
    madrasaName: row.name,
    officialName: row.official_name,
    city: row.city,
    state: row.state_name,
    adminFullName: row.admin_full_name,
    adminPosition: row.admin_position,
    adminEmail: row.admin_email,
    submittedAt: row.submitted_at,
  });
}));

router.get("/registration-status", publicLimiter, asyncHandler(async (req, res) => {
  const ref = cleanStr(req.query.ref || req.query.reference, 60).toUpperCase();
  const phone = cleanStr(req.query.phone, 60).replace(/\s+/g, "");
  if (!ref) return err(res, 400, "Registration reference is required.");

  let row = null;
  try {
    row = await db.get(
      "SELECT * FROM madrasa_registrations WHERE UPPER(registration_id) = ?",
      [ref]
    );
  } catch (e) {}

  if (!row) {
    return err(res, 404, "No registration found with that reference.");
  }

  if (phone) {
    const tail = (v) => String(v || "").replace(/\D+/g, "").slice(-7);
    if (tail(row.admin_phone) !== tail(phone) && tail(row.phone) !== tail(phone)) {
      return err(res, 404, "Registration reference and phone number do not match.");
    }
  }

  ok(res, {
    found: true,
    registrationId: row.registration_id,
    madrasaId: row.madrasa_id,
    status: row.status || "Pending",
    madrasaName: row.name,
    officialName: row.official_name,
    city: row.city,
    state: row.state_name,
    adminFullName: row.admin_full_name,
    adminPosition: row.admin_position,
    adminEmail: row.admin_email,
    submittedAt: row.submitted_at,
  });
}));

/* ------------------------------ health for the landing page ------------- */

router.get("/status", (req, res) => {
  res.json({ ok: true, publicApi: true, env: require("../config").NODE_ENV });
});

module.exports = router;
