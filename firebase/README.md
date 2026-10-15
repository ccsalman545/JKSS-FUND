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

## 3. Deploy rules + indexes (gated: the last step)

> Do not run this until `docs/USERNAME_LOGIN.md` §8 steps 5 and 6 are complete (admin-profile
> check, `txnSeq` backfill). It is step 7 of that order.
`firebase/.firebaserc` defaults to `jkss-fund` — the real project (verified
against `mobile/google-services.json`). Emulator runs in CI always pass
`--project jkss-fund-local` explicitly (a valid lowercase id that can never
collide with production; the emulator is local-only).

```bash
cd firebase
npm install -g firebase-tools
firebase login
firebase use --add            # select your project (default is already jkss-fund)
firebase deploy --only firestore --project jkss-fund
```
This deploys `firestore.rules` (the v3.2 least-privilege ruleset) and
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

### Student identifiers (v3.0)

Students do not use email addresses. The app maps an admin-assigned username to
a synthetic **email-shaped** identifier for Firebase Authentication:
`<username>@students.jkss-fund.invalid` (RFC 2606 `.invalid` — never registrable,
never deliverable). The same string is the `users/{identifier}` document ID, the
owner of `users/{identifier}/transactions/*`, and the key inside
`jobs/{job}.allocations`. **The rules are unchanged** — they key on the token's
email, which is this identifier. See `../docs/USERNAME_LOGIN.md`.

## 5. Test the security rules (run before deploying)
The full rules test suite (`test/rules.test.js`) runs the rules in the real
Firestore emulator (the production rules engine). One-time setup on a machine
with Node 18+ and Java **21+** (current firebase-tools requires it):

```bash
cd firebase
npm ci                         # @firebase/rules-unit-testing + firebase
npm i -g firebase-tools
firebase emulators:exec --project jkss-fund-local --only firestore "node test/rules.test.js"
```

The command starts a throwaway local emulator (project `jkss-fund-local`),
loads `firestore.rules`, runs 89 authorized/unauthorized scenarios (including
the v3.0 synthetic student identifiers), and prints a pass/fail summary. It
never touches your production project.

The **provisioning + username-login end-to-end suite** uses the Auth and
Firestore emulators (still nothing real):

```bash
cd ../tools/provision && npm ci
cd ../firebase
firebase emulators:exec --project jkss-fund-e2e --only firestore,auth \
  "node ../tools/provision/test/emulator.test.js"
```

The same suite runs automatically in **GitHub Actions** on every push
(`.github/workflows/firestore-rules.yml`); the job's output is published as a
`rules-output` annotation, so failures are readable without raw-log access.

> **Language note:** the classic rules language has no `filter`/`map`/lambda
> over collections, no `indexOf`/`startsWith`, no `sum()`, no bare `round`
> (use `math.round`), and no `number` type. The v3.2 ruleset is written
> strictly within what the engine compiles (exact-path cross-references,
> `map.get(k, default)`, `list.hasAny/hasOnly/removeAll`, `get`/`getAfter`)
> — which is why job `allocations` is a map keyed by email and the batch's
> job reference travels in the committee write (`lastJobId`/`reversedJobId`).

## 6. Local emulators (optional, for development)
```bash
firebase emulators:start
```
Then point the app at the emulator (see comment in `../mobile/src/firebase.js`).

## Data model (v3.2 — paise-exact accounting)
Money is stored as **integer paise** (`balancePaise`, `amountPaise`,
`committeeSharePaise`, `studentSharePaise`). The rupee floats (`balance`,
`amount`, …) are display mirrors only and are never used for calculations.
All balance writes are **explicit final values** (never `FieldValue.increment`)
— the rules compute each delta against the live document, which is what makes
stale/duplicate batches impossible.

- `users/{email}` → `{ email, role: "student"|"admin", full_name, avatar,
  balancePaise, balance, removedAt? (tombstone), createdAt }`
  - **Removal is a tombstone** (`removedAt`), never a hard delete — the fund's
    liability and the audit trail survive, and historical job reversals always
    have a document to debit.
- `users/{email}/transactions/{txnId}` → `{ type: "earning"|"withdrawal"|"reversal",
  studentId, amountPaise, amount, jobId?, description?, idempotencyKey?, createdAt }`
  - Per-student ledger subcollection. Immutable (no update/delete by anyone).
  - Canonical IDs (required by the rules): earnings `earn_{jobId}_{email}`,
    reversals `rev_{jobId}_{email}`, withdrawals caller-chosen (idempotency
    key) — deterministic IDs mean retries can never double-post.
- `jobs/{jobId}` → `{ name, date, amountPaise, committeeSharePaise,
  studentSharePaise, studentCount, status: "active"|"archived"|"reversed",
  allocations: { email: amountPaise }, reversedAt?, perStudent, amount,
  committeeShare, studentShare, createdBy, createdAt }`
  - `allocations` is a **map keyed by email** holding the **original**
    per-student split (a number = paise). Reversing a job replays *these*
    amounts (never a recalculation against the current roster).
  - **Reversal is a tombstone** (`status: "reversed"` + `reversedAt`), never a
    delete — the allocation history stays auditable and double-reversal is
    impossible.
  - Committee share = `floor(amountPaise / 10)`; students get the remainder via
    largest-remainder allocation, so every split sums exactly (no paise created
    or lost). The rules verify every allocation value is `base` or `base+1`
    (base = pool / studentCount).
- `meta/committee` → `{ balancePaise, balance, lastJobId?, reversedJobId? }` —
  created at zero on first use; only job credit/reversal batches may change it.
  `lastJobId`/`reversedJobId` name the job in the batch — the rules (which
  cannot iterate unknown paths) use this to tie the whole batch together.
- `transactions/{txnId}` (top-level, **legacy pre-v3.1**) → read-only for admins
  (audit); all writes denied.

### Atomic batch protocol (what the app sends / the rules verify)
- **Withdrawal (self, exactly 2 writes):** `users/{me}` update (balance fields
  only, final ≥ 0) + `users/{me}/transactions/{any}` set (withdrawal, amount
  == live delta).
- **Job credit (admin):** `jobs/{id}` set + per non-zero allocation
  `users/{e}` update + `users/{e}/transactions/earn_{id}_{e}` set +
  `meta/committee` update (`lastJobId = id`, final balance via
  `getAfter` = old + committee share).
- **Job reversal (admin):** `jobs/{id}` update → `status: "reversed"` +
  `reversedAt` + per **original** allocation `users/{e}` update +
  `users/{e}/transactions/rev_{id}_{e}` set + `meta/committee` update
  (`reversedJobId = id`, final balance = old − committee share).
