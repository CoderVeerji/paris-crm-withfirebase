# Go-Live Runbook — Paris CRM (Sheets → Firestore, final cutover)

The old GROW sheet stays the source of truth **until the moment of cutover**. This is a one-shot
wipe-and-reload of the new system with the latest data, then flip everyone over.

Do NOT use the app's **Bulk Import** for this — that only creates fresh leads and loses status,
stage, owner, history, and orders. The migration script (`migrate.js`) is the correct tool: it
rebuilds `leads`, `activity`, `orders`, milestones, `users` (Auth) and `config` from the CSVs.

---

## Timeline

| When | Step |
|---|---|
| T-3 days | Dry-run + validation on a full export; fix critical issues in the source sheet |
| T-1 day | Second validation — confirm clean; brief the team; freeze big data changes |
| **T-0 (after work hours, e.g. Sunday night)** | Final export → validate → `migrate:wipe` → verify → announce |
| T-0 +1 hr | Team logs in with temp password `Paris@2026`, sets their own |
| T+2 days | Turn ON Automation rules (Settings → Automation) once the team is settled |

---

## Step 1 — Export from the old system  ⭐ RECOMMENDED: the Apps Script

Manual CSV export is fragile — the `Notes` column has emoji, newlines, commas and quotes that
break CSV, and it can't create records for ex-employees who still own leads. Use the Apps Script
instead (`migration/OLD-SYSTEM-EXPORT.gs`):

1. Open the **live GROW sheet** → `Extensions → Apps Script`.
2. New script file, paste all of `OLD-SYSTEM-EXPORT.gs`, Save.
3. Function dropdown → `exportForMigration` → **Run**. Authorize (own account) on first run.
4. The execution log prints a **DOWNLOAD link** + a summary (users / leads / **ghost users** /
   duplicate IDs). It reads the sheet only — changes nothing.
5. Download that JSON, save it as `firestore-crm/migration/csv-exports/export.json`.

`validate.js` and `migrate.js` auto-detect `export.json` and use it instead of CSVs. The script:
- **creates an inactive "ghost user" for every ex-employee still owning leads** (name pulled from
  the lead's own history notes) → **no owner is ever lost**. Admin can reassign them later in the app.
- flags duplicate lead IDs (the migration keeps the first row of each).

**Fallback — manual CSV** (only if the Apps Script can't run): `File → Make a copy`, then per tab
`File → Download → Comma Separated Values`, into `csv-exports/` as `Leads.csv`, `ARCHIVED_LEADS.csv`,
`Users.csv`, `Dynamic_Forms.csv`, `Stages_Config.csv`, `Settings.csv`. With CSVs you must fix the
duplicate-ID and ex-employee-owner rows in the sheet by hand first.

## Step 2 — Auth (once per machine)

```bash
gcloud auth application-default login   # work account that owns the Firebase project
cd firestore-crm/migration && npm install
```

## Step 3 — VALIDATE (read-only, no writes)

```bash
npm run validate
```

Produces in `reports/`:
- **`validation-issues-<ts>.csv`** — every problem row: `lead_id | field | issue | value | suggested_fix`. Open in Excel.
- **`leads-cleaned-preview-<ts>.csv`** — the full leads table *after cleaning*, exactly as it will land in Firestore (normalized phone, trimmed name, resolved owner name, dup flag). Eyeball this.
- **`validation-summary.txt`** — counts.

**Fix these in the source sheet, then re-export and re-validate:**
- **duplicate lead ID** — two rows share an ID; only one survives. Give one a new ID.
- **unmapped LDR / Sales owner** — the lead points at a user id not in `Users.csv` (usually an ex-employee). Either add that person to the Users tab (status `inactive` is fine) so their leads keep an owner, or reassign the lead to a current person.

**Acceptable to leave (the script handles them safely):**
- junk / empty names → imported with `needs_review: true` (show up in the Review screen, not lost)
- invalid phone → kept in `phone_raw`, `phone_invalid: true` (no dedup / click-to-call until fixed)
- duplicate phone → both imported; merge later with the app's Duplicate Finder (Data Health / Recycle area)
- unknown status / sales_status → imported as-is; fix in the app afterwards

## Step 4 — DRY RUN

```bash
npm run migrate:dry
```

Check the report totals against the sheet: leads count, orders count + revenue (roughly matches
old MECA "Total Sales"), activity count. No writes happen.

### Cost of the migration itself (one-time)

Latest dry-run: **25 users, 11,161 leads, 21,595 activity, ~11,159 phone_index, 244 orders**
≈ **~44k writes**; `--wipe` first deletes the current ~15–20k docs. Firestore free tier is
20k writes + 20k deletes per day, so the cutover day goes ~25k writes over free ≈ a
**one-time ~₹5–15** on the bill. Expected and fine for a one-shot — just don't run
`migrate:wipe` repeatedly the same day. (`migrate:dry` and `validate` cost nothing.)

### What `--wipe` does and does NOT touch

**Reloaded from the old system:** `users` (Auth + docs), `leads`, `activity`, `orders`,
`phone_index` (dedup), `meta/counters`, `config/forms`, `config/stages`.

**Merged, not overwritten:** `config/settings` — old business keys (sources, states, company
name, WhatsApp template…) layer on; the new operational keys survive (`ai_ready`,
`mail_password_set`, `Report_Email`, SLA rules, `Morning_Brief`, theme).

**Left completely alone:** `config/ai_secret` (AI key), `config/mail_secret` (Gmail password),
`config/access`, `config/ad_spend`.

**Cleared for a clean launch (dev/test data + auto-rebuilt):** `help_queries`, `tickets`,
`notifications`, `help_kb`, `admin_tasks`, `stats_daily`, `stats_cohort`, `reports_weekly`,
`audit`, `recycle`. → After go-live, run **Settings → Data Tools → "Rebuild stats"** so the
dashboards populate from the full 11k dataset.

### Logins after the wipe

Everyone signs in with the **email from the old Users sheet** + password **`Paris@2026`**
(first login forces a reset). The old admin is `admin@test.com` — if you want a real admin
email, either fix it in the Users sheet before exporting, or change it in-app afterwards
(Users screen → open the user → edit email).

## Step 5 — THE CUTOVER (after hours)

1. Tell the team: "GROW is now read-only, do not enter anything."
2. Do a **final fresh export** (Step 1) — you want the very latest rows.
3. `npm run validate` one last time — confirm no new critical issues.
4. ```bash
   npm run migrate:wipe
   ```
   `--wipe` clears `users` (Auth + docs), `leads`, `activity`, `orders`, `config`, `meta` and
   reloads from scratch. Safe to re-run if something looks wrong.
5. `reports/migration-report-<ts>.json` — full summary. `user-credentials.csv` — temp passwords to hand out.

## Step 6 — VERIFY (in the app, as admin)

- **Data Health screen** — Total Leads matches the sheet; check Unassigned / No Name / Never Contacted counts look sane.
- Firestore console: `leads` count == (Leads rows + ARCHIVED_LEADS rows − duplicate IDs).
- Spot-check 30 random leads: name, phone, status, **LDR owner, Sales owner** all correct.
- Open 5 qualified leads → the qualification form answers (chip strip) are there.
- `orders` total revenue ≈ old system's total.
- Log in as one LDR and one salesperson (temp password) — they see only their own leads + the fresh pool.

## Step 7 — Go live

- Send the team `user-credentials.csv` rows (each person their own). First login forces a password reset.
- Point everyone at **https://paris-crm.web.app** (or pariscrm.web.app).
- **Leave Automation OFF for ~2 days** (Settings → Automation → all rules to 0). The migrated
  backlog has thousands of "overdue" follow-ups; turning SLA on immediately would spam the whole
  sales team. Once the team has triaged, turn on: Pehli call 5m, Fresh touch 30–45m, Followup
  overdue 1–2d, Morning brief on.
- Turn on push: each person opens the app → bell icon → "Turn on notifications" (iPhone: Add to
  Home Screen first).

## Rollback

Nothing is deleted from the old sheet — GROW is still fully intact. If the migration is bad:
tell the team to keep using GROW, fix `migrate.js` / the CSVs, and re-run `migrate:wipe`. No data
is at risk because the new system is disposable until you say go.
