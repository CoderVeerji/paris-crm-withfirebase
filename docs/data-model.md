# Firestore data model

Collections aur unke documents. Ye migration script + security rules + app — sab isko follow karte hain.

Naming: `snake_case` fields, collection names plural lowercase.

---

## `users/{uid}`

`uid` = Firebase Auth ka user id (migration ke time banega).

| Field | Type | Note |
|-------|------|------|
| `legacy_id` | string | purana Users sheet ka ID ("2", "35") — leads ke assignee map karne ke liye |
| `full_name` | string | |
| `email` | string | login |
| `phone` | string | |
| `role` | string | `admin` \| `ldr` \| `sales` |
| `status` | string | `active` \| `inactive` |
| `attendance` | string | `Present` \| `Absent` (ek field, history nahi) |
| `created_at` | timestamp | |
| `last_login` | timestamp | |
| `fcm_tokens` | array\<string\> | push notification ke liye (device tokens) |
| `must_reset_password` | bool | temp password wale users ke liye `true` |

---

## `leads/{leadId}`

`leadId` = purana numeric ID, string ke roop mein ("19203"). Naye leads = auto-increment counter (`meta/counters`).

### Core
| Field | Type | Note |
|-------|------|------|
| `created_at` | timestamp | |
| `created_by` | string (uid) | LDR / `"system"` / `"import"` |
| `name` | string | trimmed. Khaali/junk → `needs_review: true`, lead delete nahi hoti |
| `phone` | string | `+CC NUMBER` normalized. Invalid → `phone_invalid: true` + `phone_raw` |
| `phone_digits` | string | sirf digits (dedup + search index) |
| `alt_phone` | string | |
| `email` | string | |
| `company` | string | |
| `city` | string | |
| `state` | string | |
| `source` | string | Facebook / Instagram / … |

### Assignment
| Field | Type | Note |
|-------|------|------|
| `ldr_uid` | string \| null | assigned LDR (uid) |
| `sales_uid` | string \| null | assigned Sales (uid) — qualify hone tak null |
| `ldr_legacy` / `sales_legacy` | string | purana numeric id (migration trace) |

### Pipeline
| Field | Type | Note |
|-------|------|------|
| `status` | string | LDR stage (lowercase). Fixed list — `config/stages` |
| `sales_status` | string | Sales stage (lowercase). "" jab tak sales ne touch na kiya |
| `attempts` | number | call attempts |
| `next_followup` | timestamp \| null | agli call |

### Milestones (naye — abhi Notes se parse hote hain)
| Field | Type | Note |
|-------|------|------|
| `last_action_at` | timestamp | aakhri koi bhi action |
| `last_action_by` | string (uid) | |
| `qualified_at` | timestamp \| null | |
| `assigned_sales_at` | timestamp \| null | |
| `closed_at` | timestamp \| null | sirf lost/dead |
| `outcome` | string | `""` \| `customer` \| `lost` |

### Orders summary (auto — `orders` collection se)
| Field | Type | Note |
|-------|------|------|
| `order_count` | number | |
| `total_revenue` | number | |
| `first_order_at` / `last_order_at` | timestamp \| null | |

### Reporting form-fields (flat — `stats_cohort` dimensions)
| Field | Type | Source |
|-------|------|--------|
| `f_customer_type` | string | form_answers["Customer Type"] |
| `f_bulk` | string | form_answers["Bulk Requirement?"] |
| `f_intent` | string | form_answers["Buying Intent"] |
| `f_interested_in` | string | form_answers["Customer Interested In"] |
| `f_quantity` | string | form_answers["Approx Quantity Interested In"] |

### Other
| Field | Type | Note |
|-------|------|------|
| `form_answers` | map | poore dynamic form answers |
| `notes` | string | SIRF recent ~10 lines (human readable). Analytics ka source **nahi** |
| `archived` | bool | archived leads alag collection nahi — flag. Default `false` |
| `archived_at` | timestamp \| null | |
| `is_urgent` | bool | urgent re-inquiry flag |
| `needs_review` | bool | junk data (no name) — admin review kare |
| `phone_invalid` | bool | migration ne invalid phone flag kiya |
| `dup_of` | string \| null | duplicate phone ka doosra leadId |
| `updated_at` | timestamp | |

**Indexes chahiye:** `ldr_uid + status`, `sales_uid + sales_status`, `status + next_followup`, `archived + status`, `created_at`, `phone_digits`.

---

## `activity/{autoId}` — event log (top-level, cross-lead date query ke liye)

Har action ek document. Dashboard + MECA isi se, **date se filter karke**.

| Field | Type | Note |
|-------|------|------|
| `at` | timestamp | exact time (Notes chunk se parse) |
| `lead_id` | string | |
| `uid` | string | kisne — `"system"` bhi ho sakta hai |
| `uid_legacy` | string | purana numeric (agar mila) |
| `action` | string | `created` \| `call` \| `stage_change` \| `assigned` \| `qualified` \| `order` \| `lost` \| `urgent` \| `note` \| `reassign` \| `bulk` \| `error` |
| `from_status` | string | agar stage_change |
| `to_status` | string | |
| `amount` | number | agar `order` (order value) |
| `channel` | string | `call` \| `whatsapp` \| `visit` \| `system` |
| `remark` | string | rep ka note (💬 wala part) |

**Indexes:** `at`, `uid + at`, `lead_id + at`, `action + at`.
**TTL / archive:** 12 mahine se purane → `activity_archive` (yearly Cloud Function).

---

## `orders/{autoId}`

| Field | Type | Note |
|-------|------|------|
| `lead_id` | string | party |
| `order_date` | timestamp | |
| `amount` | number | |
| `sales_uid` | string | kisne close kiya |
| `sales_legacy` | string | |
| `remark` | string | optional (kya bheja, notes) |
| `source` | string | `migration` \| `app` |

**Index:** `lead_id + order_date`, `sales_uid + order_date`, `order_date`.
Order add hone par → parent `lead` ka `order_count` / `total_revenue` / `last_order_at` update (Cloud Function ya transaction).

---

## `stats_daily/{date}_{scope}` — nightly pre-computed (Dashboard + MECA)

Doc id: `2026-09-03_company`, `2026-09-03_user_<uid>`, `2026-09-03_team_ldr`, `2026-09-03_team_sales`.

| Field | Type |
|-------|------|
| `date` | string `YYYY-MM-DD` |
| `scope` | string |
| `leads_new` | number |
| `leads_worked` | number (unique) |
| `unique_contacts` | number |
| `followups` | number (total activity entries) |
| `qualified` | number |
| `callbacks` | number |
| `lost` | number |
| `orders` | number |
| `revenue` | number |
| `resurrected` | number |

Dashboard "last 30 days" = 30 docs jod do. Set-based (`leads_worked`) ka multi-day sum thoda overcount de sakta hai
(~5%) — acceptable; exact chahiye to `activity` se live.

---

## `stats_cohort/{month}_{dimType}_{dimValue}` — nightly (Business Analytics)

Doc id: `2026-09_source_Facebook`, `2026-09_ctype_Existing Shop Owner`, `2026-09_ldr_<uid>`, `2026-09_all_all`.

`dimType` ∈ `all` \| `source` \| `state` \| `ldr` \| `sales` \| `ctype` \| `bulk` \| `intent` \| `interested` \| `quantity`

| Field | Type | Note |
|-------|------|------|
| `month` | string `YYYY-MM` | lead **created** month |
| `dim_type` / `dim_value` | string | |
| `count` | number | is cohort ki total leads |
| `qualified` | number | |
| `assigned` | number | sales ko gayi |
| `positive` | number | positive sales stage |
| `orders` | number | |
| `revenue` | number | |
| `lost` | number | |

"Is mahine banayi gayi leads ka abhi kya outcome" — trend, funnel, source%, LDR/sales performance.
Har raat pichhle ~120 din ke months re-compute (purani leads ka status badalta rehta hai).

---

## `config/*` — single docs

- `config/forms` → `{ fields: [ {id, label, type, options, role_view, role_edit, is_mandatory, status} ] }`
- `config/stages` → `{ stages: [ {id, name, role, requires_date, color} ] }`
- `config/settings` → `{ company_name, theme_color, lead_sources, state_list, whatsapp_template, ... }`

---

## `logs/{autoId}` — audit + errors

| Field | Type | Note |
|-------|------|------|
| `at` | timestamp | |
| `uid` | string | |
| `user_name` | string | |
| `type` | string | `create` \| `update` \| `delete` \| `login` \| `error` |
| `module` | string | `leads` \| `users` \| `settings` \| `client` \| `function` |
| `detail` | string | |
| `error_stack` | string | agar type=error |

**TTL:** 90 din (Firestore TTL policy on `at`).

---

## `meta/counters` — single doc

`{ leads: 19203, orders: 0, activity: 0 }` — naye leadId ke liye atomic increment (transaction).

---

## Firestore Security Rules (draft — Phase 2 mein finalize)

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function role() { return get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role; }
    function isAdmin() { return isSignedIn() && role() == 'admin'; }
    function isSignedIn() { return request.auth != null; }

    match /users/{uid} {
      allow read: if isSignedIn();
      allow write: if isAdmin() || (request.auth.uid == uid
                    && request.resource.data.diff(resource.data).affectedKeys()
                       .hasOnly(['attendance','fcm_tokens','last_login','must_reset_password']));
    }

    match /leads/{id} {
      allow read: if isAdmin()
                  || (role() == 'ldr'  && (resource.data.ldr_uid == request.auth.uid || resource.data.status in ['fresh','new']))
                  || (role() == 'sales' && resource.data.sales_uid == request.auth.uid);
      allow create: if isSignedIn();
      allow update: if isAdmin()
                  || (role() == 'ldr'  && resource.data.ldr_uid == request.auth.uid)
                  || (role() == 'sales' && resource.data.sales_uid == request.auth.uid);
      allow delete: if isAdmin();
    }

    match /activity/{id}  { allow read: if isSignedIn(); allow create: if isSignedIn(); allow update, delete: if false; }
    match /orders/{id}    { allow read: if isSignedIn(); allow write: if isAdmin() || role() == 'sales'; }
    match /stats_daily/{id}  { allow read: if isAdmin(); allow write: if false; }   // sirf Cloud Function
    match /stats_cohort/{id} { allow read: if isAdmin(); allow write: if false; }
    match /config/{id}   { allow read: if isSignedIn(); allow write: if isAdmin(); }
    match /logs/{id}     { allow read: if isAdmin(); allow create: if isSignedIn(); allow update, delete: if false; }
    match /meta/{id}     { allow read: if isSignedIn(); allow write: if false; }    // sirf server
  }
}
```
