# Firebase Setup (replaces the old Express backend)

The app no longer uses a custom server. All auth, data, and rules live in Firebase.

## 1. Create the project
1. Go to https://console.firebase.google.com → **Add project**.
2. **Build → Authentication → Get started** → enable:
   - **Google** (configure the OAuth consent screen + web client)
   - **Email/Password** (for the admin account)
3. **Build → Firestore Database → Create database** (start in production mode).

## 2. Android app
1. **Project settings → Your apps → Android**, package name `com.jkssfund.app`.
2. Download `google-services.json` and overwrite `../mobile/google-services.json`.
   (iOS: add `GoogleService-Info.plist` to the iOS target.)
   > ✅ Done — `mobile/google-services.json` holds the real config for the
   > **`jkss-fund`** Firebase project.

> **Gradle note (Firebase console "Add Firebase SDK" instructions):** the guide
> tells you to add the `com.google.gms.google-services` Gradle plugin and the
> Firebase BoM (`com.google.firebase:firebase-bom`) to your `build.gradle.kts`
> files. In this Expo project that is **handled automatically**: the
> `@react-native-firebase/app` config plugin listed under `app.json` → `plugins`
> registers the Google Services Gradle plugin during prebuild, and the Firebase
> SDKs are installed from npm (`@react-native-firebase/app`, `/auth`, `/firestore`
> in `mobile/package.json`) rather than as Gradle BoM dependencies. Only run the
> manual Gradle steps if you leave Expo and build a raw native Android app.

## 3. Deploy rules + indexes
`firebase/.firebaserc` defaults to `jkss-fund-local` — a valid **local
placeholder** used by the emulators. For deploying to the real project, link
and select it first:
```bash
cd firebase
npm install -g firebase-tools
firebase login
firebase use --add            # pick your real project (e.g. jkss-fund)
firebase deploy --only firestore --project <your-real-project-id>
```
This deploys `firestore.rules` (the v3.1 least-privilege ruleset) and
`firestore.indexes.json`. **Deploying rules is a production change — do it only
when you are ready for the new rules to go live** (see the migration notes in
`../SECURITY_REVIEW.md`).

## 4. Create the first admin
The client SDK cannot create *other* users, and the rules allow role `admin`
only when an admin creates the profile — so the very first admin is created
manually:

1. **Authentication → Users → Add user** with an email + password (this is your admin login).
2. In **Firestore**, create a document (before the admin first signs in):
   - Collection: `users`, Document ID: `<the admin email, lowercased>`
   - Fields:
     - `email` = that email (string)
     - `role` = `admin`
     - `full_name` = `"Administrator"`
     - `avatar` = `""`
     - `balancePaise` = `0` (number)
     - `balance` = `0` (number)
3. The app also bootstraps the committee document automatically on first use
   (`meta/committee` at zero) — nothing to create manually.

> Every other user (students) just signs in with Google — their `users/{email}` doc
> is created automatically on first sign-in (always role `student`, zero
> balance). Admins can pre-register students from the app (**Add Student**) using
> the student's Google email. To add another admin, an existing admin (or the
> console, which bypasses rules) must create `users/<new-admin-email>` with
> `role: "admin"` — existing roles can never be edited by the app or the client.

## 5. Test the security rules (run before deploying)
The full rules test suite (`test/rules.test.js`) runs the rules in the real
Firestore emulator (the production rules engine). One-time setup on a machine
with Node 18+ and Java 11+:

```bash
cd firebase
npm install                    # @firebase/rules-unit-testing + firebase
npm i -g firebase-tools
firebase emulators:exec --only firestore "node test/rules.test.js"
```

The command starts a throwaway local emulator (project `jkss-fund-local`),
loads `firestore.rules`, runs ~40 authorized/unauthorized scenarios, and prints
a pass/fail summary. It never touches your production project.

## 6. Local emulators (optional, for development)
```bash
firebase emulators:start
```
Then point the app at the emulator (see comment in `../mobile/src/firebase.js`).

## Data model (v3.1 — paise-exact accounting)
Money is stored as **integer paise** (`balancePaise`, `amountPaise`,
`committeeSharePaise`, `studentSharePaise`). The rupee floats (`balance`,
`amount`, …) are display mirrors only and are never used for calculations.

- `users/{email}` → `{ email, role: "student"|"admin", full_name, avatar,
  balancePaise, balance, removedAt? (tombstone), createdAt }`
  - **Removal is a tombstone** (`removedAt`), never a hard delete — the fund's
    liability and the audit trail survive, and historical job reversals always
    have a document to debit.
- `users/{email}/transactions/{txnId}` → `{ type: "earning"|"withdrawal"|"reversal",
  studentId, amountPaise, amount, jobId?, description?, idempotencyKey?, createdAt }`
  - Per-student ledger subcollection. Immutable (no update/delete by anyone).
  - Deterministic IDs: earnings `{jobId}:{index}`, reversals `rev_{jobId}_{index}`,
    withdrawals `w_…` (idempotency key) — retries cannot double-post.
- `jobs/{jobId}` → `{ name, date, amountPaise, committeeSharePaise,
  studentSharePaise, studentCount, allocations: [{ email, index, amountPaise }],
  perStudent, amount, committeeShare, studentShare, createdBy, createdAt,
  status? }`
  - `allocations` is the **original** per-student split. Deleting a job replays
    *these* amounts (never a recalculation against the current roster).
  - Committee share = `floor(amountPaise / 10)`; students get the remainder via
    largest-remainder allocation, so every split sums exactly (no paise created
    or lost).
- `meta/committee` → `{ balancePaise, balance }` — created at zero on first use;
  only job credit/reversal batches may change it.
- `transactions/{txnId}` (top-level, **legacy pre-v3.1**) → read-only for admins
  (audit); all writes denied.
