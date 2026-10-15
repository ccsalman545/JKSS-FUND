# JKSS-FUND (AiCoN FundMe) v3.0 — Firebase Edition

A **feature-rich, deployable Android app** for transparent hostel fund management, built
with **React Native (Expo) + Firebase**. **Students sign in with a username and password
their admin assigns** (no student email address is required, collected, or invented); the
**admin** keeps signing in with the existing Firebase Email/Password account. The admin
adds jobs, and the app automatically splits each
payment **10% → committee fund / 90% → split among students (paise-exact)**. All amounts
are in **Indian Rupees (₹)**.

> **v3.0 — username logins for students.** Every student gets a stable username
> (`thangal`, `muhsin.chelakkulam`, …) mapped deterministically to a synthetic Firebase
> identifier (`<username>@students.jkss-fund.invalid`, an RFC 2606 non-deliverable domain),
> provisioned by a one-time local tool ([`tools/provision`](./tools/provision)) that is
> dry-run by default, generates **CSPRNG temporary passwords** (one per student, stored in
> a git-ignored 0600 credentials file), never resets a password on a rerun, and never
> creates a duplicate profile. Google Sign-In was **removed** (it was never configured —
> `oauth_client: []` — and it required a Google account). The Firestore rules and the
> paise-exact accounting are **unchanged**. Start with
> **[`docs/USERNAME_LOGIN.md`](./docs/USERNAME_LOGIN.md)** (mapping, provisioning runbook,
> password reset without email, migration plan, deployment checklist).

> **v3.2 — Security & accounting hardening (final).** Least-privilege Firestore rules
> written strictly within the verified rules language (no `filter`/lambda — see the
> language notes), integer-paise accounting (no float drift), atomic job/withdrawal/
> reversal transactions with explicit final balances, original-allocation job
> **tombstone** reversals, and an automated test suite that runs the production rules
> engine in CI on every push. See **[`SECURITY_REVIEW.md`](./SECURITY_REVIEW.md)** for
> the vulnerability findings, the schema changes, the exact test/deploy commands, the
> `app.json`/`.firebaserc` configuration verification, the v3.0 username-login
> addendum, and an honest "safe for testing vs ready for real funds" assessment.

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
│       ├── identity.js     # username ↔ internal identifier mapping (single source of truth)
│       ├── config.js       # App config (identifier domain, help copy)
│       ├── context/        # Auth + Theme
│       ├── components/ui.js
│       └── screens/        # Login, Dashboards, Students, Jobs, Reports, Profile…
├── tools/provision/        # One-time LOCAL provisioning tool (dry-run by default)
│   ├── provision.js        #   plan / apply / verify-identifier / reset-password / migrate-identity
│   ├── roster.json         #   the 24 names (no emails!)
│   └── test/               #   pure-Node suites + the Auth/Firestore emulator E2E suite
├── docs/USERNAME_LOGIN.md  # login model, runbook, migration plan, deployment checklist
├── firebase/               # Firebase console config (deploy with firebase-tools)
│   ├── firestore.rules     # Access control
│   ├── firestore.indexes.json
│   ├── firebase.json
│   ├── .firebaserc
│   └── README.md           # Firebase project setup
└── archive/
    └── legacy-express-web/ # ARCHIVED (v3.0): old Express/JWT API, Vite web UI, Dockerfile,
                            # Procfile, and the six stray root snapshots. Not deployed; not built.
                            # Read archive/legacy-express-web/README.md before touching anything.
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

- 🔐 **Student username/password sign-in** (admin-assigned, no student email needed) +
  admin **email/password** (Firebase Auth); a signed-in account with no admin-authorized
  profile sees only the "awaiting authorization" screen
- 🗝️ **Change password** in-app for students and the admin (policy-checked), and an
  admin-side reset flow for forgotten passwords (no email recovery exists — by design)
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
1. Create a Firebase project; enable **Email/Password** auth (Google sign-in is not used).
2. Create a **Cloud Firestore** database.
3. Add an **Android app** (`com.jkssfund.app`); download `google-services.json` → overwrite
   `mobile/google-services.json`.
4. **Deploying the rules is optional and review-gated** — it is not needed for
   username login. Run the emulator suite first, and only then
   `cd firebase && firebase deploy --only firestore` (which deploys rules +
   indexes to the real project). Nothing in v3.0 requires it.
5. Create the **first admin**: add an Auth user in the console, then set that user's
   Firestore `users/{email}` doc `role` to `admin`.
6. **Create the student logins once** with the local provisioning tool — see
   **[`docs/USERNAME_LOGIN.md`](./docs/USERNAME_LOGIN.md)** §4 (dry run → `--apply` →
   distribute the temporary passwords). Students never need an email address.

---

## 🔧 2. Student logins (username → identifier)

There is nothing to configure in a cloud console for student logins:

* the username → identifier mapping is a pure function in
  [`mobile/src/identity.js`](./mobile/src/identity.js), shared by the app, the test suites
  and the provisioning tool (a test fails if they ever disagree);
* the identifier is `<username>@students.jkss-fund.invalid` — an RFC 2606 reserved,
  non-deliverable domain, so no real email address is ever created;
* provisioning is local and dry-run-first: `cd tools/provision && node provision.js`.
  Google OAuth client IDs are **no longer part of this app** (removed in v3.0 — no code
  depended on them; `mobile/google-services.json` never contained an OAuth client).

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

# Firestore security rules (needs Java 21+; local emulator, no production access):
cd firebase
npm ci
firebase emulators:exec --project jkss-fund-local --only firestore "node test/rules.test.js"

# Username login + provisioning (Node 18+, no Java needed):
cd mobile           && npm test
cd tools/provision  && npm test

# Provisioning + login end-to-end (needs Java 21+; Auth + Firestore emulators):
cd firebase
firebase emulators:exec --project jkss-fund-e2e --only firestore,auth \
  "node ../tools/provision/test/emulator.test.js"
```

---

## ✅ Pre-launch checklist
- [x] `mobile/google-services.json` replaced with real Firebase config (project `jkss-fund`)
- [ ] Firebase Auth **Email/Password** enabled
- [ ] **Security rules test suite executed and green** (`firebase emulators:exec --only firestore "node test/rules.test.js"`)
- [ ] Legacy data migrated (see `SECURITY_REVIEW.md` §6.2) if the fund already has data
- [ ] Firestore rules + indexes deployed **if you want the hardened rules live**
      (`cd firebase && firebase deploy --only firestore`) — review the
      `SECURITY_REVIEW.md` §10 console steps first; v3.0 itself needs no rules
      deploy
- [ ] First admin `role` set to `admin` in Firestore (with `balancePaise: 0`)
- [ ] Student accounts provisioned (`node tools/provision/provision.js apply … --apply`) and
      temporary passwords distributed privately
- [ ] Identifier format verified in a non-production project
      (`node tools/provision/provision.js verify-identifier …`)
- [ ] AAB built and uploaded to Play Console (or APK for sideload)
- [ ] Tested on a device: **student username login**, student password change, job add,
      student balance, withdrawal, job reversal, admin email login

---

**Ready for the Play Store. 🎉**

Other docs: **[`DEPLOY.md`](./DEPLOY.md)** (app build + provisioning + what to do
about the superseded Express web app), **[`docs/USERNAME_LOGIN.md`](./docs/USERNAME_LOGIN.md)**
(the complete login/provisioning/migration runbook),
**[`SECURITY_REVIEW.md`](./SECURITY_REVIEW.md)** (findings, tests, console steps),
**[`tools/provision/README.md`](./tools/provision/README.md)**,
**[`mobile/PLAY_STORE.md`](./mobile/PLAY_STORE.md)**,
**[`PRIVACY_POLICY.md`](./PRIVACY_POLICY.md)**.
