   # Migration script — kaise chalayenge

Purana data (Google Sheets **copy**) → Firestore.

⚠️ **Prod sheet ko haath nahi.** Pehle `File → Make a copy` karo, us copy se CSV export.

**Full go-live sequence + verification checklist: `../docs/go-live-runbook.md` dekho.**
`npm run validate` pehle chalao (read-only) — `reports/` me issue-list + cleaned-preview CSV banta hai
jo Excel me review karo. `npm run migrate:dry` phir. Tabhi `npm run migrate:wipe`.
**Bulk Import screen migration ke liye use MAT karo** — wo sirf naye fresh leads ke liye hai
(status / stage / owner / history sab kho jayega).

---

## Step 1 — Sheet-copy se CSV export karo

Migration copy sheet kholo. Har tab ke liye: **File → Download → Comma Separated Values (.csv)**

In 6 tabs ko export karo aur `csv-exports/` folder mein rakho, **exact ye naam** deke:

| Tab | File name |
|-----|-----------|
| Leads | `Leads.csv` |
| ARCHIVED_LEADS | `ARCHIVED_LEADS.csv` |
| Users | `Users.csv` |
| Dynamic_Forms | `Dynamic_Forms.csv` |
| Stages_Config | `Stages_Config.csv` |
| Settings | `Settings.csv` |

_(Logs tab migrate nahi ho raha — 46k purane logs, fresh start.)_

---

## Step 2 — auth (gcloud ADC — key file ki zaroorat NAHI)

Org policy service-account key banane se rokta hai, isliye hum **Application Default
Credentials** use karte hain — tumhare apne gcloud login se.

```bash
gcloud auth application-default login
```

Browser khulega → **Work account** (jisse Firebase project banaya) se login → "You are now
authenticated". Bas. `migrate.js` khud is login ko utha lega.

_(Agar kabhi org key allow kar de: Firebase Console → Project Settings → Service accounts →
Generate new private key → rename `serviceAccountKey.json` → `migration/` folder mein rakho.
migrate.js pehle key file check karta hai, phir ADC.)_

---

## Step 3 — install

```bash
cd firestore-crm/migration
npm install
```

---

## Step 4 — chalao

### Pehle DRY RUN (kuch likhega nahi, sirf batayega kya hoga)
```bash
npm run migrate:dry
```
Report dekho: kitni leads, kitni junk, kitne phone invalid, kitne orders, kitni activity.

### Phir asli migration (TEST Firestore par)
```bash
npm run migrate:wipe
```
`--wipe` = target collections pehle clear karke fresh likhta hai (safe re-run ke liye).

### Report
`reports/migration-report-<timestamp>.json` — poora summary.
`user-credentials.csv` — 25 users ke temp passwords (distribute karne ke liye).

---

## Kya karta hai

1. **Users** → Firebase Auth users banata hai (temp password: `Paris@2026`, first-login pe reset) + `users/{uid}` docs
2. **Config** → `config/forms`, `config/stages`, `config/settings`
3. **Leads + ARCHIVED_LEADS** → `leads/{id}` docs:
   - Naam trim; khaali/junk (`"0"`, `"No"`, `"..."`) → `needs_review: true` (delete nahi hoti)
   - Phone → `+CC NUMBER` normalize; invalid → `phone_invalid: true`, original `phone_raw` mein
   - Duplicate phone → newer wale par `dup_of` flag
   - Assignee numeric id → Firebase uid
   - 5 reporting form-fields flat (`f_customer_type` etc.)
   - `archived: true` for ARCHIVED_LEADS rows
4. **Notes parse** → har `🕒` entry ek `activity/{autoId}` doc (time, user, action, from→to, remark)
5. **Orders** → har "💰 ORDER WON: ₹X" entry ek `orders/{autoId}` doc + lead ka `order_count`/`total_revenue`
6. **Milestones** → `qualified_at`, `assigned_sales_at`, `closed_at`, `last_action_at`, `outcome` — Notes se compute
7. **meta/counters** → next lead id set

---

## Verify (migration ke baad)

- Firebase Console → Firestore → `leads` count == (Leads rows + ARCHIVED_LEADS rows)
- 50 random leads spot-check: naam, phone, status, assignee sahi
- `activity` count report se match
- `orders` total revenue purane MECA "Total Sales" se roughly match

Mismatch mile → mujhe report bhejo → script fix → `npm run migrate:wipe` dobara.
