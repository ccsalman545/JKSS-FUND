# JKSS-FUND v3.0 — Username & Password Login for Students

Everything a human needs to run, review, and roll out the student username
login: how the identity mapping works, the roster, the one-time provisioning
runbook, the temporary-password rules, how a forgotten password is reset
without email, the migration plan for existing students/ledgers, and the manual
deployment checklist.

> **Nothing in this document has been executed against production.** The tool
> is dry-run by default, the migration steps are plans, and the two CI jobs
> (`Firestore rules`, `Username login (v3.0)`) run everything that *can* be run
> automatically against emulators, not against the `jkss-fund` project.

---

## 1. What changed (and what deliberately did not)

| | v3.x (before) | v3.0 (now) |
|---|---|---|
| Student login | Google Sign-In (never configured — `google-services.json` ships with `oauth_client: []`) or email/password with a **real email** | **Assigned username + password** — no student email address is needed, stored, or invented |
| Firebase Auth credential | Google ID token *(or* real email/password *)* | Firebase **Email/Password** with a synthetic `<username>@students.jkss-fund.invalid` identifier |
| Admin login | Email/password | **Unchanged** — same account, same password |
| Student profiles | `users/{real-email}` pre-authorized by the admin | `users/{synthetic-identifier}` pre-authorized by the admin **or** created by the local provisioning tool |
| Firestore rules | v3.5.2 least-privilege ruleset | **Unchanged, byte-for-byte.** The rules key everything on the token's email; the synthetic identifier *is* that email, so no rule needed to change |
| Accounting | Integer paise, atomic batches, tombstones | **Unchanged** — no balance, ledger, job, or committee semantics were touched |
| Admin documents | two docs (`users/thrikkakarajkss`, `users/thrikkakarajkss@gmail.com`) | **Both preserved** — the tool never matches, rewrites, or deletes an admin profile (it only adds a missing `txnSeq: 0`) |

New/changed files:

| File | Change |
|---|---|
| `mobile/src/identity.js` | **New.** The single source of truth for slugify → username → identifier, collision resolution, roster assignment, login-input resolution and the password policy |
| `mobile/src/api.js` | `login()` resolves a username to its identifier (an email passes through); `addStudent()` pre-authorizes by username; profile/dashboard shapes expose the `@handle` |
| `mobile/src/context/AuthContext.js` | Google Sign-In removed; `login(usernameOrEmail, password)`; the "awaiting authorization" state is kept for accounts with no profile |
| `mobile/src/screens/LoginScreen.js` | Username/password form (email still accepted for the admin), built-in help panel |
| `mobile/src/screens/NotAuthorizedScreen.js` | **New.** What a signed-in-but-unauthorized account sees (no dashboard, no balances) |
| `mobile/src/screens/ProfileScreen.js` | **Change password for students too** (policy-checked) + "forgotten password" guidance |
| `mobile/src/screens/StudentsScreen.js` | "Add student" now takes a **username** (the identifier is shown live) |
| `mobile/src/config.js` | Google OAuth placeholders removed; identifier domain + help copy exported |
| `mobile/package.json`, `mobile/app.json` | `@react-native-google-signin/google-signin` and `extra.googleWebClientId` removed (no code depended on them any more) |
| `tools/provision/**` | **New.** The one-time local provisioning tool (dry-run by default) |
| `mobile/test/identity.test.js`, `tools/provision/test/*` | **New** suites; `mobile/test/api.mock.test.js` and `firebase/test/rules.test.js` extended |

---

## 2. The login model

```
        what the student types              what Firebase Authentication stores
   ┌────────────────────────────┐        ┌────────────────────────────────────────────────┐
   │  username:  thangal        │  ───►  │  email:    thangal@students.jkss-fund.invalid  │
   │  password:  <temporary>    │        │  password: <the same password>                 │
   └────────────────────────────┘        └────────────────────────────────────────────────┘
                                                          │
                             the SAME string is the users/{id} document id, the owner of
                             users/{id}/transactions/*, and the key inside every
                             jobs/{job}.allocations map — one identity, everywhere.
```

* **Admins** type their email; it is passed to Firebase untouched. The existing
  account and password are not modified by anything in this work.
* **Students** type their username. `identity.resolveLogin()` maps it
  deterministically to the synthetic identifier — no lookup table, no network
  call, no stored mapping.
* `*@students.jkss-fund.invalid` uses the **RFC 2606 reserved `.invalid` TLD**,
  which can never be registered or delivered to. That is why no reset email can
  ever leak to a stranger, and why we are not "inventing a real email address".
* Firebase's **email-enumeration protection** (on by default for new projects)
  plus our own error mapping means a failed sign-in never reveals whether a
  username exists: `Wrong username or password. Check the username your admin gave you.`

**Why not a Firestore username→identifier lookup collection?** It would need an
*unauthenticated read* rule, i.e. a real loosening of the security rules, and it
would make login depend on a network round-trip before authentication. A pure
function keeps `firestore.rules` untouched.

---

## 3. Roster → username → identifier

### 3.1 Roster → username → identifier

| # | Name | Username | Internal identifier |
|---|------|----------|---------------------|
| 1 | Thangal | `thangal` | `thangal@students.jkss-fund.invalid` |
| 2 | Shafi | `shafi` | `shafi@students.jkss-fund.invalid` |
| 3 | Aboobacker | `aboobacker` | `aboobacker@students.jkss-fund.invalid` |
| 4 | Salman | `salman` | `salman@students.jkss-fund.invalid` |
| 5 | Hamid | `hamid` | `hamid@students.jkss-fund.invalid` |
| 6 | Muhsin Chelakkulam | `muhsin.chelakkulam` | `muhsin.chelakkulam@students.jkss-fund.invalid` |
| 7 | Midlaj | `midlaj` | `midlaj@students.jkss-fund.invalid` |
| 8 | Haneen | `haneen` | `haneen@students.jkss-fund.invalid` |
| 9 | Swalih | `swalih` | `swalih@students.jkss-fund.invalid` |
| 10 | Adil | `adil` | `adil@students.jkss-fund.invalid` |
| 11 | Muhsin Payyoli | `muhsin.payyoli` | `muhsin.payyoli@students.jkss-fund.invalid` |
| 12 | Salahudheen | `salahudheen` | `salahudheen@students.jkss-fund.invalid` |
| 13 | Irfan | `irfan` | `irfan@students.jkss-fund.invalid` |
| 14 | Thalhath | `thalhath` | `thalhath@students.jkss-fund.invalid` |
| 15 | Sinan | `sinan` | `sinan@students.jkss-fund.invalid` |
| 16 | Thajudheen | `thajudheen` | `thajudheen@students.jkss-fund.invalid` |
| 17 | Suhail | `suhail` | `suhail@students.jkss-fund.invalid` |
| 18 | Anwar | `anwar` | `anwar@students.jkss-fund.invalid` |
| 19 | Swabeeh | `swabeeh` | `swabeeh@students.jkss-fund.invalid` |
| 20 | Muneeb | `muneeb` | `muneeb@students.jkss-fund.invalid` |
| 21 | Bilal | `bilal` | `bilal@students.jkss-fund.invalid` |
| 22 | Sidheeq | `sidheeq` | `sidheeq@students.jkss-fund.invalid` |
| 23 | Aflah | `aflah` | `aflah@students.jkss-fund.invalid` |
| 24 | Adil Jr | `adil.jr` | `adil.jr@students.jkss-fund.invalid` |

This table is generated by the same code the app and the tool use
(`identity.assignUsernames`), and `tools/provision/test/plan.test.js` fails if
the table and the code ever disagree (**no mapping drift**).

### 3.2 Collision handling (deterministic, never random)

A username is the slugified name: lowercase, diacritics stripped, apostrophes
removed, every other run of non-alphanumerics collapsed to a single `.`, then
validated against `[a-z0-9]` with `.`/`-`/`_` separators only (`3`–`48` chars).

Collisions are resolved by **roster order** — the first entry keeps the plain
slug and each later duplicate gets the smallest free `.N` suffix starting at 2:

| Roster | Result |
|---|---|
| `Adil`, `Adil` | `adil`, `adil.2` |
| `Adil`, `Adil`, `Adil` | `adil`, `adil.2`, `adil.3` |
| `Adil`, `Adil`, `Adil 2` | `adil`, `adil.2`, `adil.2.2` |
| `Muhsin Chelakkulam`, `Muhsin`, `Muhsin` | `muhsin.chelakkulam`, `muhsin`, `muhsin.2` |
| `{name: "Adil", username: "adil"}` then `Adil` | `adil`, `adil.2` (explicit names always win) |

An **explicit duplicate** (`"username": "adil"` twice) is a hard error rather
than a silent rename, and a name that cannot produce a valid username is an
error too — the tool never invents a handle for a person. The shipped roster has
no collisions (the two Muhsins and the two Adils are distinguished by their
second name), which is the *desired* outcome: usernames are stable and
guessable-by-their-owner.

### 3.3 Renaming / changing the domain

* Changing a username changes the Auth account, the profile document and every
  ledger entry's owner — **treat a username as permanent**. To rename someone,
  use `migrate-identity` (it moves the ledger) or ask the admin to add a new
  profile and migrate.
* The domain is a constant in `mobile/src/identity.js`
  (`STUDENT_EMAIL_DOMAIN`) and a copy lives in `tools/provision/roster.json` and
  `mobile/src/config.js`. The tool **refuses to run** if they disagree, and the
  app test suite asserts they match. Do not change it after accounts exist: the
  identifier is the account's email.

---

## 4. Provisioning the 24 student accounts (one-time, local)

### 4.1 Prerequisites

* Node.js 18+ (checked: the CI runs Node 20).
* The Firebase **Admin SDK** credentials for the project, used **outside the
  mobile app** in every option below. Three supported ways:
  1. `--credentials /path/to/service-account.json` (recommended for a one-off run),
  2. `export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json`,
  3. Application Default Credentials from `gcloud auth application-default login`.
* Installing the tool's dependency: `cd tools/provision && npm install` (the
  only dependency is `firebase-admin`).
* **Local emulators instead of a real project** (what CI does — no credentials
  at all): `export FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099` and
  `export FIRESTORE_EMULATOR_HOST=127.0.0.1:8080` while
  `firebase emulators:start --only firestore,auth` runs.

**If safe Admin SDK authentication is not available**, see
`tools/provision/README.md` → *"Getting the service-account key"* for the exact
console clicks, **and** the *manual Firebase Console alternative* (create each
Auth user and each `users/{identifier}` document by hand — 24 × 2 operations;
the tool prints the identifier table so nothing has to be computed by hand).

### 4.2 Always dry-run first

```bash
cd tools/provision
npm install

# 0) Pure-offline roster plan — no credentials, no network, writes nothing:
node provision.js

# 1) Real plan against the project (READ-ONLY: lists Auth users + users/* docs,
#    matches them to the roster, reports what WOULD be created):
node provision.js plan --project jkss-fund --credentials ~/jkss-fund-admin.json
```

The plan prints, and writes as JSON (mode 0600) to `tools/provision/reports/`:

* the full 24-row username/identifier table,
* `Auth accounts to CREATE` / `profiles to CREATE`,
* `admin profiles PRESERVED` (both admin documents),
* `students needing MANUAL REVIEW (blocking)` — nothing is created for these,
* `students held for MIGRATION` — an existing real-email profile was matched,
* `WARNING — POSSIBLE (unconfirmed) LEGACY PROFILES`,
* `EXISTING PROFILES NOT IN THE ROSTER (left completely untouched)`,
* `txnSeq:0 BACKFILL` — every user doc missing the field, by name,
* per-student actions (including `MIGRATION-REVIEW` markers).

### 4.3 Apply (writes) — only after reading the plan

```bash
# The LIVE project needs the id twice: a typo cannot write to the wrong project.
node provision.js apply --project jkss-fund --confirm-project jkss-fund \
  --credentials ~/jkss-fund-admin.json --apply
```

What `--apply` does, and **only** that:

1. Creates a Firebase Auth user per creatable student:
   `email = <username>@students.jkss-fund.invalid`, `emailVerified = true`
   (no verification mail is ever sent), `displayName = full name`, and a
   **fresh 16-character CSPRNG password** for that student.
2. Creates the pre-authorized profile `users/{identifier}` in the exact shape
   the app and the rules use (`email, role: 'student', full_name, avatar,
   balancePaise: 0, balance: 0, txnSeq: 0, createdAt`).
3. Adds `txnSeq: 0` to user documents **missing** the field (balances, roles,
   ledgers and both admin documents otherwise untouched).
4. Writes the credentials file (below) and a JSON report.

What it never does: reset a password, overwrite a profile, touch a balance, a
ledger entry, a job, the committee document, the admin Auth account, an
unmatched profile, or run a second time destructively (**reruns are idempotent**
— they report `auth-exists (password NOT touched)` / `profile-exists`).

### 4.4 The credentials file (temporary passwords)

* Path: `tools/provision/credentials.json` (override with `--credentials-file`),
  written **mode 0600** inside a 0700 directory, atomically (temp file + rename).
* Git-ignored at two levels (`tools/provision/.gitignore` **and** the repo-root
  `.gitignore`); a test asserts both protections exist.
* Format: `{ project, domain, students: [{ index, name, username, identifier,
  password, status }], passwordResets: [ … ] }` — **plaintext passwords, on
  purpose**, because they must be handed to students. It is the only place a
  password is ever written; Firestore never sees one (an E2E test scans every
  document for the generated passwords).
* Distribute each password to its student privately. Then move the file into a
  password manager (or delete it). `--show-passwords` prints them instead of the
  file if you prefer to write them on paper.
* Reruns never overwrite a recorded password; a deliberate reset appends to
  `passwordResets` (audit trail).

### 4.5 Prove the identifier format first (`verify-identifier`)

```bash
# Against a throwaway project (recommended) …
node provision.js verify-identifier --project jkss-fund-prelaunch \
  --credentials ~/prelaunch-admin.json --api-key <web-api-key>

# … or against the Auth emulator (what CI does; no account is created anywhere real)
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 node provision.js verify-identifier --project jkss-fund-e2e
```

It creates ONE throwaway account with the real identifier format, signs in
through the Identity Toolkit endpoint the SDKs use, checks that a wrong password
and an unknown identifier are rejected, then **deletes the throwaway account**.
The tool refuses to run this against `jkss-fund` (production).

---

## 5. Students: first sign-in and changing the password

1. The student opens the app and types the **username** (`thangal`,
   `muhsin.chelakkulam`, …) and the temporary password.
2. The app maps the username to the identifier and signs in with Firebase
   Email/Password. On success it reads `users/{identifier}` — the profile the
   admin pre-authorized. **No profile → the "Awaiting admin authorization"
   screen; the dashboard, balances, ledger and every write stay closed.**
3. The student opens **Profile → Change temporary password**, enters the
   temporary password and chooses a new one. The app enforces: ≥ 6 characters,
   at least one letter and one number, not derived from their own
   username/name, and different from the current password.
4. The student is added to every future 90% split from the moment their profile
   exists (the job allocation uses the roster of `users` documents).

---

## 6. Forgotten passwords (there is no email recovery)

Nothing sends mail to `*@students.jkss-fund.invalid` — the domain cannot receive
it, and an email-based reset would be useless. **The admin resets the password.**

### Preferred: the local tool (Admin SDK, never emails)

```bash
cd tools/provision
# dry run first (shows what would happen):
node provision.js reset-password --username thangal --project jkss-fund

# then:
node provision.js reset-password --username thangal --project jkss-fund \
  --credentials ~/jkss-fund-admin.json --apply
```

It generates a **new random temporary password**, updates only the Auth user's
password (`updateUser` — the account, uid, profile, balance and ledger are
untouched), verifies that the new password signs in, writes the password to the
credentials file and appends a `passwordResets` entry.

### Fallback: the Firebase Console (no Admin SDK on the machine)

The Console's **"Reset password"** button *emails* the user, so it does nothing
here. Use instead:

1. Console → **Authentication → Users** → find the student's identifier
   (`thangal@students.jkss-fund.invalid`).
2. **Delete account**, then **Add user** with the *same* identifier and a new
   temporary password (the identifier is the account's email — typing it wrongly
   would create an unusable account).
3. Hand the new password to the student.

This is safe because **the Firestore profile and the whole ledger are keyed by
the identifier, not by the Auth uid**: recreating the account re-attaches to the
same `users/{identifier}` document, the same balance and the same transaction
history. Do not change the identifier when re-creating.

---

## 7. Migration plan for existing students and transactions

**Do not run any of this without reviewing the plan report first.** The tool
holds back every student for whom an existing profile exists, so it is
impossible to create a *second* profile (the classic cause of duplicate
profiles and orphaned balances).

### 7.1 What the planner does automatically

1. Reads every Firebase Auth user and every `users/*` document (read-only).
2. Scores each existing student profile against each roster name:
   `full_name` exact → email local part / display name → first-name-only (weak).
3. Matches only when the best score is **unique and uncontested** (score ≥ 0.9).
   Everything else is reported:
   * `needs-review` (blocking) — two profiles match one student, or one profile
     matches two students,
   * `weakMatches` (warning) — first-name-only candidates,
   * `unmatchedProfiles` — profiles that are not in the roster (a former
     student): **left exactly as they are**.
4. **Admin profiles are never candidates** and are never modified (except the
   additive `txnSeq: 0` when missing).
5. A student with a matched existing profile is **held back**: their new
   username account is *not* created until you decide.

### 7.2 Your three options (per held student)

| Option | When it is right | What you do |
|---|---|---|
| **A. Re-key (recommended)** | The profile holds a balance/ledger, or you want one identity from now on | `migrate-identity` below — copies the profile + the whole ledger to the username identity, transfers the balance with a `transfer` ledger entry, zeroes and **tombstones** the old document (never deletes it), and writes a timestamped JSON backup first |
| **B. Fresh identity, old profile left alone** | The old profile is empty/orphaned and you accept that past jobs still allocate to it | Add `"ignoreLegacy": true` to that student in `roster.json` (an explicit, recorded human decision), re-plan, then `apply` |
| **C. Leave the student on their real email for now** | The student already signs in with an email they still control and you want no data movement | Do nothing: the login form accepts an email, so a legacy profile keeps working. Add a `"legacyIdentifier"` in `roster.json` so the planner links them in future reports |

### 7.3 Option A — the exact command

```bash
cd tools/provision
# 1) see exactly what would move (no writes):
node provision.js migrate-identity --legacy old.student@gmail.com \
  --username salman --project jkss-fund --out ./reports

# 2) do it (live project: id twice + --apply):
node provision.js migrate-identity --legacy old.student@gmail.com \
  --username salman --project jkss-fund --confirm-project jkss-fund \
  --credentials ~/jkss-fund-admin.json --out ./reports --apply
```

It refuses if the target `users/{identifier}` already exists, writes a backup of
**both** documents and their ledgers to `reports/backups/…json` (mode 0600)
before writing anything, copies every ledger document **verbatim with the same
document ids**, sets `migratedFrom` on the new profile, and sets
`balancePaise: 0`, `removedAt`, `migratedTo`, `migratedAt` plus an
`adjustment_migration` ledger entry on the old one. The migration is auditable
and repeatable-by-hand from the backup.

### 7.4 The legacy lien (read this before reversing an old job)

Jobs created **before** a migration store `allocations` keyed by the *old*
identifier. Reversing such a job debits the old (now tombstoned, zero-balance)
document, which is allowed to go negative — a tombstoned student is the fund's
standing liability. The migrated student's new document is therefore **not**
debited by that reversal, so after reversing a pre-migration job you must
reconcile that student's new document by the same amount (the reversal report
lists the affected old identifiers; the amount is the job's original allocation
for them). New jobs allocate to the new identity and need no reconciliation.

The planner reports `liveJobs`/`liveActiveJobs` so you know how many
pre-migration jobs exist before you migrate. If that number is large, prefer
Option C until the ledger can be reconciled deliberately.

### 7.5 Zero-duplicate check (do this after any migration)

1. Re-run `node provision.js plan --project jkss-fund …` → every roster student
   should read `exists` (or `migration-review` if you have not migrated yet),
   `toCreate 0`, `needsReview 0`.
2. `node provision.js apply … --apply` a second time → `Auth accounts created 0`,
   `profiles created 0`, `passwords reset 0`.
3. In the console, confirm there is exactly one **active** (not `removedAt`)
   profile per student, both admin documents are unchanged, and the committee
   balance plus the sum of all student balances is unchanged from before the
   migration.

---

## 8. Manual deployment checklist

Ordered, with the rollback for each step. **Steps 1–3 are the only writes to the
real project, and each one is reversible.**

1. **Merge/review the code** — CI green on the branch
   (`Firestore rules` + `Username login (v3.0)` jobs). No production change yet.
2. **Verify the identifier format in a non-production environment**

   ```bash
   node tools/provision/provision.js verify-identifier --project <test-project> \
     --credentials <test-admin.json> --api-key <web-api-key>
   ```

   Expected: all four checks `PASS` (or run it against the Auth emulator).
3. **Provision the roster** (dry run, read the report, then apply)

   ```bash
   node tools/provision/provision.js plan  --project jkss-fund --credentials <admin.json>
   node tools/provision/provision.js apply --project jkss-fund --confirm-project jkss-fund \
        --credentials <admin.json> --apply
   ```

   Rollback: the created accounts/profiles are the ones the tool just made (they
   are listed in the report with `created` status); no existing document was
   modified except additive `txnSeq: 0` fields.
4. **Distribute the temporary passwords** (credentials file, one per student,
   privately). Keep the file out of Git; move it to a password manager
   afterwards.
5. **Build the app** (`cd mobile && npm install && eas build -p android
   --profile preview`) and update the installed app. The old build's Google
   button will fail — it was hidden unless OAuth clients existed, which they
   never did, so nothing regresses on the device.
6. **Migrate held students** (once, deliberately) — §7.2/§7.3, with the backup.
7. **Smoke-test on a device with a real account** (not the admin's own):
   student signs in with a username → dashboard opens → admin adds a job →
   the student sees the split → the student changes their password →
   signs out and back in with the new one → admin reverses the test job.
8. **Console housekeeping** — check *Authentication → Settings → User actions*
   (no verification/reset mail is sent by the app), and confirm the two admin
   documents + the admin Auth account are untouched.
9. **Nothing else**: no rules deploy, no billing change, no Cloud Functions, no
   Hosting. (`firebase deploy` is **not** part of this release: `firestore.rules`
   did not change.)

---

## 9. Test evidence

| Suite | Where | What it proves |
|---|---|---|
| `mobile/test/identity.test.js` | local + CI (`node-suites`) | Normalization, collisions, identifier mapping, password policy, 20k-input fuzz |
| `mobile/test/accounting.test.js` | local + CI | Paise math unchanged (the money invariants) |
| `mobile/test/api.mock.test.js` | local + CI | Username login (real Auth error codes), authorization gate, ledger identity, all transaction flows |
| `tools/provision/test/plan.test.js` | local + CI | Roster → username, collision rules, ambiguity/weak-match handling, held-back students, admin preservation, safety gates, CLI parsing, **docs↔code mapping drift** |
| `tools/provision/test/passwords.test.js` | local + CI | CSPRNG passwords (20k uniqueness), unambiguous alphabet, policy compliance, 0600 credentials file, never-overwrite |
| `firebase/test/rules.test.js` | CI (`Firestore rules`, emulator) | 89 scenarios in the production rules engine, incl. 14 new synthetic-identifier scenarios: pre-authorization, unauthorized-account lockout, withdrawals/credits/reversals with synthetic ids, no rules loosening |
| `tools/provision/test/emulator.test.js` | CI (`provisioning-e2e`, Auth+Firestore emulators) | End-to-end: dry-run writes nothing, 23 accounts created idempotently, admin account+password and both admin docs preserved, balances/ledgers untouched, no plaintext password in Firestore, valid/invalid password sign-in, unauthorized student has no profile, reset-password, identity migration with backup, safety gates |

Exact commands (also in `SECURITY_REVIEW.md` §5):

```bash
# Node suites (no Java needed)
cd mobile            && node test/identity.test.js && node test/accounting.test.js && node test/api.mock.test.js
cd tools/provision   && node test/plan.test.js && node test/passwords.test.js

# Emulator suites (Java 21+; nothing touches the real project)
cd firebase
npm ci
firebase emulators:exec --project jkss-fund-local --only firestore "node test/rules.test.js"
firebase emulators:exec --project jkss-fund-e2e  --only firestore,auth \
  "node ../tools/provision/test/emulator.test.js"
```

---

## 10. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `auth/invalid-credential` / *Wrong username or password* | The username was typed with a valid shape but does not exist, or the password is wrong. Check the spelling against §3.1; the admin can reset the password (§6) |
| *Usernames use letters, numbers, dots…* | The typed value is not a valid username shape (e.g. a stray `!`). `Muhsin Chelakkulam` may be typed in full — spaces are treated as separators |
| Student signs in but sees **Awaiting admin authorization** | No `users/{identifier}` document. Add the student (Students → Add student) or run the provisioning tool for that username |
| `tools/provision` says *No Admin SDK credentials* | Set `--credentials`, `GOOGLE_APPLICATION_CREDENTIALS`, or use the emulators (§4.1) |
| `Refusing to write to the LIVE project` | Pass `--confirm-project <same-project-id>` (typo guard) |
| Tool refuses to run: *roster.json declares domain … must match* | `roster.json → domain` and `mobile/src/identity.js → STUDENT_EMAIL_DOMAIN` disagree — fix before running |
| A student's account exists but the planner holds them (`MIGRATION-REVIEW`) | They have a legacy real-email profile with money/ledger — decide via §7.2 |
| Withdrawals fail with *profile is missing the withdrawal counter (txnSeq)* | Run `apply` once (it adds `txnSeq: 0` where missing) or set `txnSeq: 0` on that document in the console |
