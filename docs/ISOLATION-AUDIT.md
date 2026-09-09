# Isolation Audit — Old Production Configuration Found & Disposition

**Date:** 2026-09-09
**Source inspected:** `Result-main.zip` (uploaded starting source, 182 files, Node.js/Express + MySQL single-school "Ameenullah School Result System")
**Purpose:** Prove, item by item, that the new Multi-Madrasa Platform contains **zero** connections to the old production system.

---

## 1. OLD/PRODUCTION CONFIGURATION DISCOVERED IN THE UPLOADED SOURCE

| # | Old production artifact | Where found in old source | Disposition in NEW project |
|---|--------------------------|---------------------------|----------------------------|
| 1 | **Old Render deployment** — service `ameenullah-school`, public URL `https://result-cfn8.onrender.com/` | `render.yaml` (service name), `server.js` lines 44–140 (canonical/301 redirect logic, `AMS_KNOWN_PUBLIC_HOSTS`), `.env.example` comments, `test/attendance-page-client-test.js` (live fetch to old domain), `CHANGES.md` | **REMOVED.** New project ships a NEW `render.yaml` with a NEW service name (`multi-madrasa-platform`). No code references `result-cfn8.onrender.com` or any old host. Old test files NOT carried over. |
| 2 | **Old Railway deployment** — `https://result-production-69ea.up.railway.app/` | `server.js` (same SEO block), `.env.example` comments, `CHANGES.md` | **REMOVED.** No Railway references remain. New deployment is created fresh (see `docs/DEPLOYMENT.md`). |
| 3 | **Old database** — MySQL db `school_result_db`, Railway-style env vars (`MYSQLHOST`, `MYSQLPASSWORD`, …), old `db.js` comment referencing a formerly-baked-in default password `"0802"` | `.env.example`, `db.js` | **REPLACED.** New project uses brand-new DB names (`madrasa_platform_dev` / `madrasa_platform_prod`), brand-new env var names (`DATABASE_URL`, `DB_*` redefined), and **refuses to boot without explicit credentials**. The "0802" reference does not exist anywhere in the new code. |
| 4 | **Old school identity / PII** — "Ameenullah School of Arabic and Islamic Studies (AMSAIS)", email `madrasatuameenillah22@gmail.com` (VAPID push identity), phone numbers `+2348062445559`, `08058306889`, `08062445559`, `099511627776`, old logo `images/LOGO.JPG`, backup file name `ameenullah-backup-*.json` | `server.js` (AI prompts, VAPID, backup), `manifest.webmanifest`, dozens of HTML pages | **REMOVED.** The new platform is a generic multi-tenant SaaS. School name/logo/motto/address/phone are **per-madrasa data entered by each madrasa admin**, never hard-coded. Old logo and branding NOT carried over. |
| 5 | **Google Search Console verification files** for the old domain (public verification tokens) | `googlea6892f129dcb5282.html`, `googlez78gd5ZFlM0Uo8Y_tBVvz_Gunc0j6rZpbOFg5eM5-xo.html` | **DELETED.** New deployment gets its own domain + its own verification (when a domain is attached). |
| 6 | **Old AI integration keys (env-driven)** — `OPENAI_API_KEY` / `AI_API_KEY` (no key values present in code), Google Generative Language endpoint as default base | `server.js` AI block, `.env.example` | **REPLACED.** New opt-in AI block uses new env var names, **disabled by default**, no default provider endpoint baked in. |
| 7 | **Old VAPID web-push identity** stored in the old DB `push_keys` table | `server.js` push block | **REPLACED.** New project self-generates its own VAPID key pair on first boot of the NEW database (never imported from the old DB). |
| 8 | **Dangerous legacy endpoints** — `POST /wipe-all-data` (full data wipe), robots.txt `Disallow: /sql/` implying a SQL endpoint existed | `server.js` | **NOT carried over.** No raw-SQL or wipe-all endpoints exist in the new API. |
| 9 | **Old changelogs** describing old deployments and old domains | `CHANGES.md`, `CHANGES-PACK26.md`, `CHANGES-*.md` (8 files) | **NOT carried over.** Replaced by new project documentation. |
| 10 | **Old package identity** — package name `result-system` | `package.json` | **REPLACED** with `multi-madrasa-platform`. |

## 2. CREDENTIALS CHECK

The uploaded ZIP contains **no live secret values**:
- No database password, API key, OAuth token, webhook secret, or email credential values were found in any file (all credential access was environment-variable driven).
- The only tokens present are **public** Google site-verification tokens for the old domain (already publicly visible on the old live site) — deleted anyway.
- **No values from the old `.env` were copied anywhere.** The old ZIP contained only `.env.example` (a template), which itself was replaced.

## 3. WHAT THE NEW PROJECT DOES NOT DO

- Does not connect to `school_result_db` or any old database.
- Does not run migrations against, alter, or drop anything in the old database.
- Does not call `result-cfn8.onrender.com`, `result-production-69ea.up.railway.app`, or any old API/frontend URL.
- Does not deploy to the old Render service `ameenullah-school` or the old Railway project (a NEW service name is used).
- Does not reuse the old VAPID identity, old AI keys, or any old environment variable values.

## 4. VERIFICATION (re-run anytime)

```bash
# Must return NOTHING:
grep -rniE "result-cfn8|result-production-69ea|result-1rto|ameenullah|ameenillah|madrasatu|school_result_db|0802" \
  --exclude-dir=node_modules --exclude-dir=.git --exclude=Result-main.zip .

# Old starting ZIP is kept verbatim as the uploaded source snapshot only.
```
