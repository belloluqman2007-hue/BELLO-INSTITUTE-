"use strict";
/* ============================================================================
   BELLO PLATFORM — institution category catalogue
   ----------------------------------------------------------------------------
   A single source of truth mapping the "institution type" an applicant picks
   at registration to the coarse admin experience they get afterwards
   ('islamic' | 'western'). Nothing here touches the database — it is pure
   classification used by the registration/approval routes and by the
   dashboards to pick their sidebar labels and subject catalogue.
   ========================================================================== */

const ISLAMIC_TYPES = [
  "Madrasa",
  "Islamic School",
  "Qur'an School",
  "Arabic School",
  "Islamic Learning Centre",
];

const WESTERN_TYPES = [
  "Nursery & Primary School",
  "Secondary School",
  "Nursery, Primary & Secondary School",
  "International School",
  "College",
  "Academy",
];

function categoryForType(type) {
  const t = String(type || "").trim();
  if (WESTERN_TYPES.includes(t)) return "western";
  if (ISLAMIC_TYPES.includes(t)) return "islamic";
  // Unknown/"Other" free text defaults to islamic ONLY when explicitly
  // flagged that way by the caller; otherwise the caller must pass a
  // category alongside a custom type. See normalizeCategory().
  return null;
}

/** Resolves a definitive category, preferring an explicit choice, then the
 *  type catalogue, then a safe default. */
function normalizeCategory(explicitCategory, type) {
  const c = String(explicitCategory || "").trim().toLowerCase();
  if (c === "islamic" || c === "western") return c;
  const guessed = categoryForType(type);
  return guessed || "islamic";
}

/* Islamic Subjects sidebar catalogue (fixed labels from the spec). */
const ISLAMIC_SUBJECTS = [
  "Qur'an", "Qur'an Memorization", "Tajweed", "Hadith", "Fiqh", "Tawheed",
  "Aqeedah", "Seerah", "Arabic", "Nahw", "Sarf", "Islamic Studies", "Other Subjects",
];

/* Western Academic Programs sidebar catalogue (fixed labels from the spec). */
const WESTERN_SUBJECTS = [
  "Mathematics", "English", "Sciences", "Computer Science", "Technology",
  "Business", "Arts", "Social Sciences", "Languages", "Other Subjects",
];

function subjectCatalogue(category) {
  return category === "western" ? WESTERN_SUBJECTS : ISLAMIC_SUBJECTS;
}

/** Copy differences between the two admin experiences (labels only). */
function terminology(category) {
  if (category === "western") {
    return {
      institutionLabel: "Academy",
      institutionNoun: "academy",
      subjectsMenuLabel: "Academic Programs",
      aboutPageLabel: "About Academy",
      programsLabel: "Programs",
      settingsLabel: "Academy Settings",
      myInstitutionLabel: "My Academy",
      websiteCardTitle: "Your Academy Website",
    };
  }
  return {
    institutionLabel: "Institution",
    institutionNoun: "institution",
    subjectsMenuLabel: "Islamic Subjects",
    aboutPageLabel: "About Institution",
    programsLabel: "Programs/Courses",
    settingsLabel: "Institution Settings",
    myInstitutionLabel: "My Institution",
    websiteCardTitle: "Your Institution Website",
  };
}

module.exports = {
  ISLAMIC_TYPES,
  WESTERN_TYPES,
  ISLAMIC_SUBJECTS,
  WESTERN_SUBJECTS,
  categoryForType,
  normalizeCategory,
  subjectCatalogue,
  terminology,
};
