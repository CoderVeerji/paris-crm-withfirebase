# Paris CRM — Firestore version

Yeh naya system hai. **Purane 4 files (`Code.gs`, `javascript.html`, `index.html`, `style.html`) ko haath nahi lagana** — wo abhi live chal rahe hain. Saara naya kaam isi `firestore-crm/` folder mein.

Full plan: https://claude.ai/code/artifact/d2a2c63b-562b-48eb-8c20-3159547f6df9

---

## Folder kya-kya hai

```
firestore-crm/
├── README.md              ← ye file (start yahan se)
├── docs/
│   ├── decisions.md        ← locked faisle
│   └── data-model.md       ← Firestore ka poora schema
├── migration/
│   ├── README.md           ← migration script kaise chalayenge
│   ├── migrate.js          ← purana data → Firestore (the script)
│   ├── package.json
│   └── csv-exports/        ← yahan sheet-copy ke CSV rakhne hain
├── firestore.rules         ← security rules (kaun kya padh/likh sake)
└── (app/ aur functions/ baad ke phases mein aayenge)
```

---

## Progress tracker

| Phase | Kya | Status |
|-------|-----|--------|
| 0 | Setup — Firebase project, tools | ⬜ tum karoge (neeche steps) |
| 1 | Data model + migration script | 🟡 script ready, run pending |
| 2 | Auth + security rules + data layer | ⬜ |
| 3 | Frontend — daily screens | ⬜ |
| 4 | Frontend — analytics | ⬜ |
| 5 | Cloud Functions + PWA + push | ⬜ |
| 6 | Full testing + pilot | ⬜ |
| 7 | Cutover | ⬜ |

---

## PHASE 0 — Tumhe ye karna hai (~1 ghanta)

### 1. Firebase project banao

1. Jao **https://console.firebase.google.com/**
2. **"Create a project"** (ya "Add project")
3. Project name: `paris-crm` → Continue
4. Google Analytics: **abhi off kar do** (baad mein on kar sakte ho) → Create project
5. Project ban jaane par → **Continue**

### 2. Firestore database on karo

1. Left menu → **Build → Firestore Database**
2. **"Create database"**
3. Mode: **"Start in production mode"** (rules hum baad mein set karenge)
4. Location: **`asia-south1 (Mumbai)`** — ⚠️ ye baad mein badal nahi sakte, dhyan se
5. Enable

### 3. Authentication on karo

1. Left menu → **Build → Authentication**
2. **"Get started"**
3. **Sign-in method** tab → **Email/Password** → Enable → Save

### 4. Billing (Blaze plan) on karo

1. Left menu (bottom) → **Upgrade** ya gear icon → **Usage and billing → Details & settings → Modify plan**
2. **Blaze (Pay as you go)** choose
3. Card add karo
4. **Budget alert set karo: $25/month** (safety — kabhi itna nahi aayega, ~$5-15 aayega)
> Free tier (20k writes, 50k reads, 1GB storage roz) Blaze pe bhi free rehta hai. Sirf usse upar charge.

### 5. Hosting init (abhi sirf enable)

1. Left menu → **Build → Hosting → Get started** → steps skip kar sakte ho abhi, bas enable ho jaaye

### 6. Web app register karo + config lo

1. Project **Overview** (home) → **`</>`** (Web) icon pe click
2. App nickname: `paris-crm-web` → **Register app**
3. Ek `firebaseConfig` object dikhega — **usko copy karke mujhe bhej do** (ya `docs/firebase-config.txt` mein save karo). Ye aisa dikhta hai:
   ```js
   const firebaseConfig = {
     apiKey: "AIza...",
     authDomain: "paris-crm.firebaseapp.com",
     projectId: "paris-crm",
     ...
   };
   ```
   > Ye keys **public** hoti hain (client mein jaati hain) — chinta nahi. Asli security "rules" karti hain.

### 7. Service account key lo (migration script ke liye)

1. Project Settings (gear icon) → **Service accounts** tab
2. **"Generate new private key"** → ek JSON file download hogi
3. Us file ko rename karo `serviceAccountKey.json` aur `firestore-crm/migration/` folder mein rakho
   > ⚠️ Ye file **SECRET** hai — GitHub pe kabhi nahi. `.gitignore` mein already hai.

### 8. Tools install (apne computer par)

Terminal / Command Prompt kholo:

```bash
# Node.js check (chahiye v18+)
node --version
```
Agar `node` nahi mila → https://nodejs.org se LTS install karo, terminal restart karo.

```bash
# Firebase CLI install
npm install -g firebase-tools

# Login
firebase login
```

---

## Phase 0 ho gaya? → Mujhe ye do:

1. `firebaseConfig` object (step 6)
2. Confirm: Firestore Mumbai region, Auth email/password on, Blaze on
3. `serviceAccountKey.json` migration folder mein rakh diya (confirm)
4. Sheet-copy taiyaar — prod sheet ko **File → Make a copy** karo, naam `Paris CRM MIGRATION COPY`

Phir hum **Phase 1** — migration script chalayenge.
