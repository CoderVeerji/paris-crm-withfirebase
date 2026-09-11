# Paris CRM — React app (Firestore)

Purane Apps Script web app ka replacement. React + Vite + Firebase.

## Chalao (local dev)

```bash
cd firestore-crm/app
npm install
npm run dev
```

Browser khud khulega `http://localhost:5173`.

**Login:** koi bhi user ka email (Users sheet se) + temp password `Paris@2026`.
Pehli baar login pe naya password maangega.

## Structure

```
src/
  firebase.js        Firebase init (config + offline cache on)
  auth.jsx           AuthProvider — current user + uska users/{uid} doc (role)
  App.jsx            Shell: sidebar menu (role-gated) + screen switch
  styles.css         Poora design system (navy theme, mobile-first)
  lib/leads.js       Leads data-access — HAMESHA paginated + role-scoped
  screens/
    Login.jsx        Login + forced password reset
    Leads.jsx        Paginated leads list (cards, filter chips, search)
```

## Build + deploy

```bash
npm run build                       # -> dist/
cd ..
firebase deploy --only hosting      # -> https://paris-crm.web.app
```

## Abhi kya ban chuka

- [x] Login + first-login password reset
- [x] App shell — sidebar, role-based menu, mobile drawer
- [x] Leads list — pagination ("Aur dikhayein"), filter chips, search, status badges
- [ ] Dashboard, Call History, MECA, Analytics, Data Health, Users, Settings, Form/Stage Builder
- [ ] Lead detail + action modals (call log, stage change, assign)
- [ ] PWA + FCM push
