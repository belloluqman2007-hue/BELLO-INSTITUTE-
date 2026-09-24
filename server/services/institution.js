"use strict";
/* ============================================================================
   EDUSPHERE PLATFORM — institution category configuration
   ----------------------------------------------------------------------------
   This is the single server-side source of truth for the two institution
   experiences. Core data operations stay tenant-scoped and category-neutral;
   this configuration only supplies vocabulary, starter catalogues, visual
   defaults, and category-specific module availability.
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

const CATEGORY_CONFIG = Object.freeze({
  islamic: Object.freeze({
    categoryLabel: "Islamic School",
    institutionLabel: "Institution",
    institutionNoun: "institution",
    myInstitutionLabel: "My Institution",
    feesLabel: "School Fees",
    subjectsLabel: "Islamic Subjects",
    aboutLabel: "About Institution",
    programsLabel: "Programs/Courses",
    settingsLabel: "Institution Settings",
    websiteCardTitle: "Your Institution Website",
    adminLabel: "Islamic School Admin",
    primaryColor: "#200A3D",
    hifzEnabledByDefault: true,
    subjectCatalogue: Object.freeze([
      "Qur'an",
      "Qur'an Memorization",
      "Tajweed",
      "Hadith",
      "Fiqh",
      "Tawheed",
      "Aqeedah",
      "Seerah",
      "Arabic",
      "Nahw",
      "Sarf",
      "Islamic Studies",
      "Imla'",
      "Arabic Reading",
      "Arabic Expression",
      "Other Subjects",
    ]),
  }),
  western: Object.freeze({
    categoryLabel: "Western Academy",
    institutionLabel: "Academy",
    institutionNoun: "academy",
    myInstitutionLabel: "My Academy",
    feesLabel: "Academy Fees",
    subjectsLabel: "Academic Programs",
    aboutLabel: "About Academy",
    programsLabel: "Programs",
    settingsLabel: "Academy Settings",
    websiteCardTitle: "Your Academy Website",
    adminLabel: "Western Academy Admin",
    primaryColor: "#0A2342",
    hifzEnabledByDefault: false,
    subjectCatalogue: Object.freeze([
      "Mathematics",
      "English",
      "Sciences",
      "Computer Science",
      "Technology",
      "Business",
      "Arts",
      "Social Sciences",
      "Languages",
      "Other Subjects",
    ]),
  }),
});

function normalizeCategory(explicitCategory, type) {
  const category = String(explicitCategory || "").trim().toLowerCase();
  if (CATEGORY_CONFIG[category]) return category;
  return categoryForType(type) || "islamic";
}

function categoryForType(type) {
  const value = String(type || "").trim();
  if (WESTERN_TYPES.includes(value)) return "western";
  if (ISLAMIC_TYPES.includes(value)) return "islamic";
  return null;
}

function categoryConfig(category) {
  return CATEGORY_CONFIG[normalizeCategory(category)] || CATEGORY_CONFIG.islamic;
}

function subjectCatalogue(category) {
  return categoryConfig(category).subjectCatalogue;
}

/** Existing callers use terminology(); keep that shared contract intact. */
function terminology(category) {
  const config = categoryConfig(category);
  return {
    institutionLabel: config.institutionLabel,
    institutionNoun: config.institutionNoun,
    subjectsMenuLabel: config.subjectsLabel,
    feesLabel: config.feesLabel,
    aboutPageLabel: config.aboutLabel,
    programsLabel: config.programsLabel,
    settingsLabel: config.settingsLabel,
    myInstitutionLabel: config.myInstitutionLabel,
    websiteCardTitle: config.websiteCardTitle,
    primaryColor: config.primaryColor,
    hifzEnabledByDefault: config.hifzEnabledByDefault,
  };
}

/** Safe serialisable configuration exposed by /app-config.js to the SPA. */
function clientCategoryConfig() {
  return Object.fromEntries(Object.entries(CATEGORY_CONFIG).map(([key, value]) => [key, {
    categoryLabel: value.categoryLabel,
    institutionLabel: value.institutionLabel,
    institutionNoun: value.institutionNoun,
    myInstitutionLabel: value.myInstitutionLabel,
    feesLabel: value.feesLabel,
    subjectsLabel: value.subjectsLabel,
    aboutLabel: value.aboutLabel,
    programsLabel: value.programsLabel,
    settingsLabel: value.settingsLabel,
    websiteCardTitle: value.websiteCardTitle,
    adminLabel: value.adminLabel,
    primaryColor: value.primaryColor,
    hifzEnabledByDefault: value.hifzEnabledByDefault,
    subjectCatalogue: [...value.subjectCatalogue],
  }]));
}

const ISLAMIC_SUBJECTS = CATEGORY_CONFIG.islamic.subjectCatalogue;
const WESTERN_SUBJECTS = CATEGORY_CONFIG.western.subjectCatalogue;

module.exports = {
  CATEGORY_CONFIG,
  ISLAMIC_TYPES,
  WESTERN_TYPES,
  ISLAMIC_SUBJECTS,
  WESTERN_SUBJECTS,
  categoryForType,
  normalizeCategory,
  categoryConfig,
  subjectCatalogue,
  terminology,
  clientCategoryConfig,
};
