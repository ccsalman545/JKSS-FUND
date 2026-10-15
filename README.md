# JKSS-FUND (AiCoN FundMe) v3.1 — Firebase Edition

A **feature-rich, deployable Android app** for transparent hostel fund management, built
with **React Native (Expo) + Firebase**. Students sign in with **Google**, the admin adds
jobs, and the app automatically splits each payment **10% → committee fund / 90% → split
among students (paise-exact)**. All amounts are in **Indian Rupees (₹)**.

> **v3.1 — Security & accounting hardening.** Least-privilege Firestore rules,
> integer-paise accounting (no float drift), atomic job/withdrawal/reversal
> transactions, original-allocation job reversals, and an automated test suite.
> See **[`SECURITY_REVIEW.md`](./SECURITY_REVIEW.md)** for the vulnerability
> findings, the schema changes, the exact test/deploy commands, and an honest
> "safe for testing vs ready for real funds" assessment.

The custom Express/SQLite backend has been **replaced by Firebase** (Authentication +
Cloud Firestore + Security Rules), so there is **no server to run or host**.

---

## 🏗️ Architecture

```
JKSS-FUND/
├── mobile/                 # Expo (React Native) Android app
│   ├── App.js              # Navigation + biometric lock
│   ├── app.json            # Expo/EAS config + @react-native-firebase plugin
│   ├── eas.json            # Build profiles (APK + Play Store AAB)
│   ├── google-services.json# Firebase config (jkss-fund project — filled)
│   ├── credentials.json    # Signing keystore scaffold (Play Store)
│   ├── PLAY_STORE.md       # Release walkthrough
│   ├── assets/             # splash / icon
│   └── src/
│       ├── firebase.js     # Native Firebase modules
│       ├── api.js          # Firestore data layer (real-time)
│       ├── config.js       # Google client IDs (EDIT)
│       ├── context/        # Auth + Theme
│       ├── components/ui.js
│       └── screens/        # Login, Dashboards, Students, Jobs, Reports, Profile…
└── firebase/               # Firebase console config (deploy with firebase-tools)
    ├── firestore.rules     # Access control
    ├── firestore.indexes.json
    ├── firebase.json
    ├── .firebaserc
    └── README.md           # Firebase project setup
```

**Why `google-services.json`?** The native Firebase SDK reads it to initialize on Android,
so the build needs a (real) copy even though we use Firestore real-time instead of FCM.

> **About Firebase's Android Gradle instructions** (Google Services Gradle plugin +
> Firebase BoM in `build.gradle.kts`): this repo is an **Expo** project, so that step is
> done for you automatically — the `@react-native-firebase/app` config plugin
> (`app.json` → `plugins`) adds the `com.google.gms.google-services` Gradle plugin at
> prebuild time, and the Firebase SDKs come from npm (`@react-native-firebase/*` in
> `mobile/package.json`) instead of Gradle BoM dependencies. No manual Gradle edits are
> needed for `eas build` or `expo run:android`; those instructions only apply to
> non-Expo (native) Android projects.

---

## ✨ Features

- 🔐 **Google Sign-In** (native) + admin **email/password** (Firebase Auth)
- 📡 **Real-time** balances, jobs & transactions via Firestore listeners (updates the
  instant the admin adds a job — no polling, no push server needed)
- 🔢 Automatic **10% / 90%** fund split, atomic per job
- 📊 **Charts** (collection trend + donut distribution + job breakdown)
- 🌗 Light/Dark mode, 📱 biometric app lock
- 👤 Admin: students (search), jobs (live split preview), delete/reverse, monthly/yearly reports
- 💸 Student: live balance (hide/show), quick-amount withdraw, filterable history grouped by month

## 🎨 UI/UX — "Aurora M3" design system (Material 3)

The entire UI is built on a **Material 3** tonal design language with a
fintech identity (v3.2):

- **M3 color roles** — primary / secondary / surface tonal scale + semantic roles,
  each theme tuned for WCAG-contrast text (light + dark)
- **M3 shape scale** — 8 / 12 / 16 / 28 radii, fully-rounded (pill) buttons & chips
- **M3 state layers** — pressed overlays + Android ripples on every interactive
- **M3 NavigationBar** — full-width bottom bar with animated 64×32 tonal indicator pill
- **M3 filled text fields**, tonal buttons, elevated cards, 28-radius dialogs
- **Cinematic motion** — spring bottom sheets, per-screen fade/slide entrances on
  tab focus, staggered splash, animated tab indicator (core RN `Animated`)
- **Readability** — 16px inputs, 15px+ body, strong weight hierarchy, M3 onSurface
  contrast, generous line heights
- Gradient hero cards, glassy chips, split progress bars, filter chips,
  month-grouped ledgers, empty states, inline validation, cross-platform
  password-change flow (no iOS-only `Alert.prompt`)
- New brand assets: indigo→violet app icon, adaptive icon, full-bleed splash
  (`mobile/assets/`)

Built with core React Native `Animated` + `react-native-linear-gradient` (added to
`mobile/package.json` — a plain `npm install` picks it up). Design tokens live in
`mobile/src/theme.js`; the component library in `mobile/src/components/ui.js`.

---

## 🚀 1. Firebase (one-time)

See **`firebase/README.md`**. In short:
1. Create a Firebase project; enable **Google** + **Email/Password** auth.
2. Create a **Cloud Firestore** database.
3. Add an **Android app** (`com.jkssfund.app`); download `google-services.json` → overwrite
   `mobile/google-services.json`.
4. `cd firebase && firebase deploy --only firestore` (deploys rules + indexes).
5. Create the **first admin**: add an Auth user in the console, then set that user's
   Firestore `users/{email}` doc `role` to `admin`.

---

## 🔧 2. Google OAuth clients

In Google Cloud Console → **Credentials**, create:
- **Web client ID** → put in `mobile/src/config.js` (`GOOGLE_WEB_CLIENT_ID`).
- **Android client ID** (package `com.jkssfund.app` + your SHA-1) → `GOOGLE_ANDROID_CLIENT_ID`.

> Students sign in with Google. Admins sign in with the email/password account you created.

---

## 📱 3. Build the APK / AAB

```bash
cd mobile
npm install
npx expo install expo@~51.0.28      # align Expo SDK + native deps
eas login

# APK (sideload / internal testing):
eas build -p android --profile preview

# Play Store bundle (AAB):
eas build -p android --profile production-aab
```

See **`mobile/PLAY_STORE.md`** for the full release + signing guide
(`keytool` upload keystore, Play App Signing, privacy policy, data-safety form).

---

## 🧪 How the money logic works

All money math is done in **integer paise** (1 ₹ = 100 paise) — no floats — so
splits are exact to the last paisa and never create or lose money.

Adding a job of ₹1000 with 10 students (one atomic Firestore transaction):
- Committee fund **+₹100** (`floor(100000 / 10)` paise = 10%)
- Student pool **₹900** → **₹90 each** (90% − committee, largest-remainder split)
- Each student gets an *earning* transaction; dashboards update **live**.
- If the pool doesn't divide evenly, the first `r` students get one extra paisa
  (largest-remainder), so the distributed total **always equals the pool exactly**.
- Deleting a job **reverses the original stored allocations** (never a
  recalculation against the current roster). Jobs without an allocation
  history refuse to be auto-deleted and are flagged for manual reconciliation.
- Student removal is a **tombstone** (`removedAt`), not a hard delete — balances
  and the full ledger are preserved.
- Withdrawals run in a Firestore **transaction** (concurrency-safe, idempotent).

### Run the tests
```bash
# Accounting core + app orchestration (Node 18+, no Firebase needed):
cd mobile
node test/accounting.test.js
node test/api.mock.test.js

# Firestore security rules (needs Java 11+; local emulator, no production access):
cd firebase
npm install
firebase emulators:exec --only firestore "node test/rules.test.js"
```

---

## ✅ Pre-launch checklist
- [x] `mobile/google-services.json` replaced with real Firebase config (project `jkss-fund`)
- [ ] Firebase Auth (Google + Email/Password) enabled
- [ ] **Security rules test suite executed and green** (`firebase emulators:exec --only firestore "node test/rules.test.js"`)
- [ ] Legacy data migrated (see `SECURITY_REVIEW.md` §6.2) if the fund already has data
- [ ] Firestore rules + indexes deployed (`firebase deploy --only firestore`)
- [ ] First admin `role` set to `admin` in Firestore (with `balancePaise: 0`)
- [ ] Google Web + Android OAuth client IDs set in `mobile/src/config.js`
- [ ] AAB built and uploaded to Play Console (or APK for sideload)
- [ ] Tested on a device: Google login, job add, student balance, withdrawal, job reversal

---

**Ready for the Play Store. 🎉**
