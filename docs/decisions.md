# Locked decisions

_Ye final hain. Badalna ho to yahan update karके batao._

| # | Faisla | Value | Note |
|---|--------|-------|------|
| Platform | Database + stack | **Firestore** + React/Vite + Firebase Hosting + Auth + Cloud Functions + FCM | Sheets se poora migrate |
| Approach | Sheets rebuild vs Firestore | **Seedha Firestore** (Option B) | Sheets ka rebuild throwaway tha |
| Domain | URL | **`paris-crm.web.app`** (free) | Baad mein `crm.parisfashiondelhi.com` add kar sakte hain |
| Passwords | User migration | **Temp password + first-login pe forced reset** | Main temp set karunga, user pehli baar login pe naya banayega |
| Notifications | Kaise | **FCM lock-screen push only** | WhatsApp API **NAHI**. iOS pe PWA install zaroori |
| Re-marketing | Call-back campaign | App sirf **number list export** karega + "resurrect as fresh lead" button | App khud message nahi bhejega. `wa.me` 1-to-1 button rahega (free) |
| Prod sheet | Migration source | **COPY of prod sheet**, prod ko haath nahi | Cutover pe final delta |
| Old code | `Code.gs` etc. | **Mat chherna** — sab kuch `firestore-crm/` mein | Purana live chalta rahega ~7 hafte |
| Backup | Old system | **Skip** — sirf naye system ka backup setup karenge | User ne kaha purane ka rehne do |
| Region | Firestore location | **asia-south1 (Mumbai)** | Baad mein badal nahi sakte |
| Timeline | Total | **~7 hafte** | Har hafta: build → test → fix → retest |

---

## Form fields — reporting ke liye (maine chune, dimensions banenge `stats_cohort` mein)

Business: fashion wholesale lead qualification. Ye 5 dropdown fields lead-quality ke sabse strong signals hain —
inpe admin dashboard mein breakdown dikhega ("is mahine 45 Existing Shop Owner aaye, 12 qualify hue").

| Field | Options (approx — Dynamic_Forms se) | Kyun report-worthy |
|-------|-------------------------------------|---------------------|
| **Customer Type** | Existing Shop Owner · Boutique Owner · Online Seller · Reseller · New Business · Personal Use ❌ | Lead kaun hai — quality signal #1 |
| **Bulk Requirement?** | Yes ✅ · No ❌ | Wholesale target — bulk buyer hi asli lead |
| **Buying Intent** | Exploring · (Ready / Comparing / Urgent) | Hot vs cold |
| **Customer Interested In** | Visit Store · Video Call Showing · WhatsApp Catalog · Not Interested | Engagement channel + "Not Interested" = disqualifier |
| **Approx Quantity Interested In** | 10–20 pcs · 20–50 pcs · 50+ pcs | Deal size predictor |

_Baaki form answers (Purchase Purpose, Senior Sales Transfer, etc.) `form_answers` map mein store honge — bas inpe
pre-aggregated report nahi banegi. Baad mein add kar sakte hain._

---

## Abhi tak pending / open

- `firebaseConfig` keys (Phase 0 step 6)
- Team ke 25 users ki confirmed list (naam, email, role, phone)
- Team ke phones ki list (testing ke liye)
- Existing pipeline stage names — `Stages_Config` se aayenge, migration mein lock honge
