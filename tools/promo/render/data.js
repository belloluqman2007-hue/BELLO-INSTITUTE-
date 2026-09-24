"use strict";

/*
 * Loads REAL demo data from the seeded EduSphere dev database so the promo
 * screens show genuine seeded records (never invented people). Falls back
 * to the documented demo seed values when the DB has not been created yet.
 */
const path = require("path");

function load() {
    const fallback = {
        institution: {
            nameEn: "Al-Quraniyya Model Madrasa",
            nameAr: "مدرسة القرونية النموذجية",
            motto: "Knowledge, Faith, Character",
            slug: "demo-quraniyya",
            city: "Ijebu-Ode",
            state: "Ogun",
            address: "12 Market Road, Ijebu-Ode",
            founded: 2018,
            session: "2026/2027",
            email: "info@demo-quraniyya.example",
            phone: "+234 803 000 0000",
            description: "A model madrasa combining Qur'an memorisation, Arabic and the Nigerian classroom subjects",
        },
        institution2: { nameEn: "Fatihah Islamic Studies College", slug: "demo-fatihah", plan: "free" },
        stats: { students: 4, teachers: 1, classes: 4, subjects: 10, pending: 2, fees: 14000, expenses: 0, present: 4, marked: 4 },
        platform: { madaris: 2, active: 2, students: 8, teachers: 2, parents: 4, pending: 2, plans: [["free", 1], ["basic", 1], ["premium", 0]] },
        students: [{ first: "Adeyemi", last: "Kunle", adm: "ALQ0001", gender: "M", cls: "Al-Qur'an Class 1" }],
        classes: ["Al-Qur'an Class 1", "Al-Qur'an Class 2", "Arabic Studies 1", "Arabic Studies 2"],
        teacher: "Ustadh Ibrahim Oluwaseun",
        timetable: [
            ["08:00", "08:50", "Mathematics"],
            ["08:50", "09:40", "Qur'an (Tajwid)"],
            ["09:40", "10:30", "Fiqh"],
            ["10:30", "11:20", "Arabic Language"],
        ],
    };
    try {
        const { DatabaseSync } = require("node:sqlite");
        const dbFile = path.join(__dirname, "..", "..", "..", "data", "madrasa_platform.sqlite");
        const db = new DatabaseSync(dbFile, { readOnly: true });
        const m = db.prepare("SELECT * FROM madaris WHERE slug='demo-quraniyya'").get();
        if (m) {
            fallback.institution.nameEn = m.name_en || fallback.institution.nameEn;
            fallback.institution.nameAr = m.name_ar || fallback.institution.nameAr;
            fallback.institution.motto = m.motto_en || fallback.institution.motto;
            fallback.institution.city = m.city || fallback.institution.city;
            fallback.institution.state = m.state_name || fallback.institution.state;
            fallback.institution.address = m.address || fallback.institution.address;
            fallback.institution.founded = m.founded_year || fallback.institution.founded;
            fallback.institution.email = m.email || fallback.institution.email;
            fallback.institution.phone = m.phone || fallback.institution.phone;
            fallback.institution.description = (m.description_en || fallback.institution.description).split(". ")[0];
        }
        const m2 = db.prepare("SELECT name_en, slug FROM madaris WHERE id != ? ORDER BY id LIMIT 1").get(m ? m.id : 0);
        if (m2) fallback.institution2 = { nameEn: m2.name_en, slug: m2.slug, plan: "free" };
        const st = db.prepare(
            `SELECT s.first_name, s.last_name, s.admission_no, s.gender, c.name_en AS cls
               FROM students s LEFT JOIN classes c ON c.id = s.class_id
              WHERE s.madrasa_id = ? ORDER BY s.id LIMIT 6`
        ).all(m ? m.id : 1);
        if (st.length) {
            fallback.students = st.map((r) => ({ first: r.first_name, last: r.last_name, adm: r.admission_no, gender: r.gender, cls: r.cls || "—" }));
            fallback.stats.students = st.length;
        }
        const cls = db.prepare("SELECT name_en FROM classes WHERE madrasa_id = ? ORDER BY id").all(m ? m.id : 1);
        if (cls.length) { fallback.classes = cls.map((c) => c.name_en); fallback.stats.classes = cls.length; }
        const t = db.prepare("SELECT full_name FROM teachers WHERE madrasa_id = ? LIMIT 1").get(m ? m.id : 1);
        if (t) fallback.teacher = t.full_name;
        const fees = db.prepare("SELECT COALESCE(SUM(amount_ngn),0) AS total FROM payments WHERE madrasa_id = ?").get(m ? m.id : 1);
        if (fees && Number.isFinite(fees.total)) fallback.stats.fees = fees.total;
        const subj = db.prepare("SELECT COUNT(*) AS n FROM subjects WHERE madrasa_id = ?").get(m ? m.id : 1);
        if (subj) fallback.stats.subjects = subj.n;
        db.close();
    } catch (e) { /* fall back to documented demo seed values */ }
    return fallback;
}

module.exports = { load };
