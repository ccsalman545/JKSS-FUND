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
>
> **Latest CI evidence (branch `arena/883804d8-jkss-fund`, commit `c69…`):**
>
> | Run | Job | Result |
> |---|---|---|
> | [38717587168](https://github.com/ccsalman545/JKSS-FUND/actions/runs/38717587168) | Rules unit tests (Firestore emulator) | **89 passed, 0 failed** |
> | [38717587168](https://github.com/ccsalman545/JKSS-FUND/actions/runs/38717587168) | Accounting + identity + api orchestration | **green** (63 + 31 + 37, plus 36 + 15 provisioning) |
> | [38717587462](https://github.com/ccsalman545/JKSS-FUND/actions/runs/38717587462) | Node suites (identity · plan · accounting · data layer) | **green** |
> | [38717587462](https://github.com/ccsalman545/JKSS-FUND/actions/runs/38717587462) | Provisioning + login E2E (Auth + Firestore emulators) | **31 passed, 0 failed** |
>
> The rules suite **cannot run in this sandbox** (no Java, and no emulator JAR
> may be downloaded here) — CI is the environment where it executes, exactly as
> the earlier security work documented. Each workflow fails unless its output
> ends with `N passed, 0 failed`.

---

## 1. What changed (and what deliberately did not)

| | v3.x (before) | v3.0 (now) |
|---|---|---|
| Student login | Google Sign-In (removed) or email/password with a **real email** | **Assigned username + password** — no student email address is needed, stored, or invented |
| Firebase Auth credential | Google ID token *(or* real email/password *)* | Firebase **Email/Password** with a synthetic `<username>@students.jkss-fund.invalid` identifier |
| Admin login | Email/password | **Unchanged** — same account, same password |
| Student profiles | `users/{real-email}` pre-authorized by the admin | `users/{synthetic-identifier}` pre-authorized by the admin **or** created by the local provisioning tool |
| Firestore rules | v3.5.2 least-privilege ruleset | The v3.0 login did not change them: the rules key everything on the token's email, and the synthetic identifier *is* that email. The later student gate **did** change them (verified email, pre-authorized `role: 'student'` profile, identifier or explicit authorization; SECURITY_REVIEW §3.2a) |
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
   │  username:  sayyid.zain    │  ───►  │  email:  sayyid.zain@students.jkss-fund.invalid│
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
| 1 | Sayyid Zain | `sayyid.zain` | `sayyid.zain@students.jkss-fund.invalid` |
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

# 0) Pure-offline roster plan — no credentials, no network, nothing written to
#    Firebase (the only side effect is a local, 0600, git-ignored report file
#    under tools/provision/reports/):
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
* `EXISTING PROFILES NOT IN THE ROSTER (left completely untouched)` and
  `NOT on roster (left untouched)` for synthetic student identities — `apply`
  refuses to write while any exist (see §4.6),
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
   **fresh 16-character CSPRNG password** for that student — or, only if you
   pass `--shared-password-file`, the owner's shared initial password for the
   accounts that do not exist yet (§4.6).
2. Creates the pre-authorized profile `users/{identifier}` in the exact shape
   the app and the rules use (`email, role: 'student', full_name, avatar,
   balancePaise: 0, balance: 0, txnSeq: 0, createdAt`).
3. Adds `txnSeq: 0` to user documents **missing** the field (balances, roles,
   ledgers and both admin documents otherwise untouched).
4. Writes the credentials file (below) and a JSON report.

What it never does: reset a password (including with the shared password file),
overwrite a profile, touch a balance, a ledger entry, a job, the committee
document, the admin Auth account, an unmatched profile, a synthetic identity that
is NOT on the roster, or run a second time destructively (**reruns are idempotent**
— they report `auth-exists (password NOT touched)` / `profile-exists`).

### 4.4 The credentials file (temporary passwords)

* Path: `tools/provision/credentials.json` (override with `--credentials-file`),
  written **mode 0600** inside a 0700 directory, atomically (temp file + rename).
* Git-ignored at two levels (`tools/provision/.gitignore` **and** the repo-root
  `.gitignore`); a test asserts both protections exist.
* Format: `{ project, domain, students: [{ index, name, username, identifier,
  password, status }], passwordResets: [ … ] }` — **plaintext passwords, on
  purpose**, because they must be handed to students. In shared-password mode
  (§4.6) the records carry `passwordSource: "owner-shared-initial"` and **no
  password field**. It is the only place a
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

### 4.6 Optional: an owner-supplied SHARED initial password (opt-in)

The default is unchanged: **every new account gets its own random password.**
Use the shared mode only if you deliberately want the accounts that are created
in this run to start with **one** password that you choose. It is opt-in: it is
used only when you pass `--shared-password-file`.

**Trade-offs (read before you choose it).** Anyone who learns the shared password
can sign in to every account that still uses it. Each student must change it
after the first sign-in. **The app does not enforce that change.** It shows the
advice "Change the temporary password after your first sign-in" (LoginScreen),
and nothing blocks a student who keeps using the shared password. Enforcing it
would need a profile flag plus a Firestore rules change, and neither exists.

**Exact local setup** (do this on your own computer, not in the repository):

```bash
# 1. A private folder OUTSIDE the repository
mkdir -p ~/jkss-secrets && chmod 700 ~/jkss-secrets

# 2. Create the one-line file owner-only from the start (umask 077), typing the
#    password at the prompt so it is not echoed or kept in shell history
(umask 077; read -rs -p 'Shared initial password: ' SHARED_PW; \
  printf '%s\n' "$SHARED_PW" > ~/jkss-secrets/shared-initial-password.txt; \
  unset SHARED_PW; echo)

# 3. Confirm the permissions: must show -rw------- (owner read/write only)
ls -l ~/jkss-secrets/shared-initial-password.txt
```

The tool checks the file before it contacts Firebase, and refuses to continue
unless **all** of these hold:

* a regular file (not a symbolic link), owned by your user, with **no** group or
  other permission bits (`chmod 600` fixes it);
* exactly **one line** (a single trailing newline is allowed);
* if the file is inside the repository, it must be git-ignored (keep it outside);
* 12 to 128 printable ASCII characters, no spaces, at least 6 different
  characters, at least one letter and one digit (the app's policy);
* it must not contain any roster student's **username or name**, nor any name
  part of 4 or more letters (for example `sayyid`, `muhsin`).

The password is never printed, logged or written to the credentials file or the
JSON report. The credentials file records only `passwordSource: owner-shared-initial`
for each new account.

**Safe dry run first** (writes nothing; it reads the project in read-only mode
and reports what would happen with the shared password):

```bash
cd tools/provision
npm install
node provision.js apply --project jkss-fund \
  --credentials ~/jkss-fund-admin.json \
  --shared-password-file ~/jkss-secrets/shared-initial-password.txt
# expect: "DRY RUN — nothing was written." and
#         "password mode ... owner shared initial password for NEW accounts"
# If the file is refused, the tool stops BEFORE it connects to Firebase.
```

Then, only after the plan is reviewed and approved, the write (the live project
needs the id twice):

```bash
node provision.js apply --project jkss-fund --confirm-project jkss-fund \
  --credentials ~/jkss-fund-admin.json \
  --shared-password-file ~/jkss-secrets/shared-initial-password.txt --apply
```

**What the shared mode does not do:**

* It never changes an existing account's password. A rerun with the file creates
  only the accounts that do not exist yet. Accounts created earlier keep their
  current passwords (in a mixed state, the older ones keep theirs).
* It is not a reset. To change an existing account, use `reset-password`
  (one student at a time, always a **random** password, §6). Do not use the
  shared file for that.

**Synthetic identities that are not on the roster.** If the project has a
student login or profile whose identifier is **not** on `roster.json` (for
example a student removed from the roster), the dry run prints a `!!`
warning that names it, and the plan shows the count on the line
`NOT on roster (left untouched)`. `--apply` then **refuses to write** and changes
nothing. Only if you have confirmed that each one is intentional, add
`--allow-unrostered`. Those records are still left untouched (no backfill, no
write, no deletion). Decide with the owner before using that flag on production.

**Test-mode shared password (emulators only — never production).** A short
password (at least 6 characters, may contain a roster name) is sometimes needed to
exercise the login flow in the emulator. It is available ONLY through an explicit
flag, and the tool refuses it unless **all** of these are true:

* both the Firebase **Auth** and the **Firestore** emulators are active
  (`FIREBASE_AUTH_EMULATOR_HOST` and `FIRESTORE_EMULATOR_HOST` are set, and each
  answers on a loopback address; the tool probes both before it reads the file);
* the project id is **not** `jkss-fund` (refused even when the flag is supplied, in
  any letter case) and it names a test project (contains `test`, `e2e` or `emulator`);
* the flag is `--test-mode-shared-password` (it is rejected for any command other
  than `apply`).

Without the flag, production validation is unchanged (12+ characters, no roster
names, and so on). Test mode relaxes only the length floor (to Firebase Auth's
6) and the roster-name check; the file rules (0600, one line, outside git, no
symlink) and the character rules still apply. The password is never printed,
logged, stored in Firestore or committed; a TEST MODE banner is printed, and the
credentials file records `passwordSource: owner-shared-initial` only.

The exact command, against the local emulators started with
`firebase emulators:start --project jkss-fund-e2e --only auth,firestore` (Auth on
9099, Firestore on 8080, as in `firebase/firebase.json`):

```bash
cd tools/provision
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
node provision.js apply --project jkss-fund-e2e \
  --shared-password-file ~/jkss-secrets/test-shared-password.txt \
  --test-mode-shared-password --apply
```

The automated version is section 12 of the emulator suite, which CI runs
(`firebase emulators:exec --project jkss-fund-e2e --only firestore,auth
"node ../tools/provision/test/emulator.test.js"`). It sets
`SHARED_TEST_PASSWORD_FILE` to a local file when you supply one; otherwise it
generates a throwaway short password for that run. It covers the refusals
(production project, missing emulators, failed verification, secure mode without
the flag), a dry run, account creation, username and password sign-in, the
no-password-in-storage checks, and a rerun with a different password that must
never change an existing account. Test mode is never used against the live
project, and it is not an approved production step.

**After the apply:** hand the shared password to each student privately, and ask
them to change it. Then delete the password file, or keep it only in your
password manager. Your next step is the change itself; the app will not check it.

---

## 5. Students: first sign-in and changing the password

1. The student opens the app and types the **username** (`sayyid.zain`,
   `muhsin.chelakkulam`, …) and the temporary password.
2. The app maps the username to the identifier and signs in with Firebase
   Email/Password. On success it reads `users/{identifier}` — the profile the
   admin pre-authorized. **No profile → the "Awaiting admin authorization"
   screen; the dashboard, balances, ledger and every write stay closed.**
3. The student opens **Profile → Change temporary password**, enters the
   temporary password and chooses a new one. The app enforces: ≥ 6 characters,
   at least one letter and one number, not derived from their own
   username/name, and different from the current password.
   **This change is advised, not required.** The app does not enforce a first-login
   password change: nothing blocks the student from continuing to use the temporary
   password. If the password is the owner's shared initial password (§4.6), the admin
   must ask each student to make the change. The tool cannot check it.
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
node provision.js reset-password --username sayyid.zain --project jkss-fund

# then:
node provision.js reset-password --username sayyid.zain --project jkss-fund \
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
   (`sayyid.zain@students.jkss-fund.invalid`).
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

### 7.2 Decision: students with a real-email profile stay ON HOLD (Option B)

**Decision (owner, 2026-10-15): Option B — hold back.** Every student whose
existing profile is matched (§7.1) stays on the hold list. Until the owner has
reviewed that student's identity, balance, ledger and active historical jobs,
the tool:

* does **not** create their account or profile (no duplicate identity);
* does **not** reset or print any password for them;
* does **not** migrate or modify any of their records.

**Students whose mapping is verified stay eligible** for normal provisioning:
their plan status is `create` or `exists`, with no legacy match, no ambiguity
and no roster hold. `apply` creates only those students and reports the held
ones.

**Enforcement by the rules (the access gate).** After the gated deploy (§8 step 7), a
real-email account on hold cannot read or change any financial data: no profile read,
no ledger read, no withdrawal, no committee read. This holds even if the app is edited.
Until that deploy, the live database still uses its current rules, so a held account
keeps the access it has today. The gate is described in `SECURITY_REVIEW.md` §3.2a.

**Frozen profiles (decision D-1, decided 2026-10-15).** A profile is **frozen** when
it is any of these:

* the legacy identity of a roster student (matched in §7.1), held or not;
* keyed by the identifier of a student who is not being created (a roster hold);
* a candidate in an ambiguous review (a blocking match).

A frozen profile is **never** given `txnSeq: 0` by the backfill, even when it lacks the
field. The planner lists it under `FROZEN` with its reason. `apply` checks the backfill
list before any write (`backfillTargets`), and it refuses to run if a frozen id appears
there. Eligible students' own profiles and unmatched former profiles keep the normal
backfill. Covered by `tools/provision/test/plan.test.js` (D-1 checks) and
`tools/provision/test/apply.test.js` (the real `apply` path, with Firebase stubbed).

**Residual risk.** The freeze is enforced by the tool. The rules gate (above) separately stops a held account from changing its own record, but only once the gated deploy has happened.

**How the hold list works (two mechanisms, both enforced in `apply`):**

| Mechanism | How it is set | What it does |
|---|---|---|
| **Automatic** (from the planner) | A matched existing profile (§7.1) | The student is `HELD BACK` (`migration-review` or `link-legacy`). No flag is needed. |
| **Explicit** (a recorded decision) | `"hold": true, "holdReason": "…"` on the student in `roster.json` | The student is `held`. The reason is mandatory. The hold blocks creation even when no legacy profile exists. |

`apply` skips every held student, the credentials file never receives a
password for one, and the plan prints the hold reason. Remove an explicit hold
only after the review checklist below is complete.

**Review checklist (before lifting any hold):** for each held student,
1. **Identity** — confirm by hand that the legacy document (`users/<real email>`) belongs to this student.
2. **Balance** — the plan's `balancePaise` matches the fund's own records.
3. **Ledger** — the plan's `txnCount` matches the history; no duplicated entries.
4. **Active historical jobs** — list the live jobs whose `allocations` use the legacy id (the plan shows `liveActiveJobs`). If any of them could be reversed later, plan the legacy-lien reconciliation in §7.4.
5. **Record the decision** — update the `holdReason` or remove the hold in `roster.json`, commit it, and re-plan.
6. **Only then**, and only per student with the owner's approval, use Option A (§7.3) with its backup.

**Options for the held students (for reference):**

| Option | Status | What it means |
|---|---|---|
| **B. Hold back** | **In force** | Nothing is created, changed or migrated for the student. (See above.) |
| **A. Re-key with backup** | Not started; needs review | `migrate-identity` (§7.3) copies the profile and whole ledger to the username identity, moves the balance with a ledger entry, and tombstones the old document (never deletes it). |
| **C. Stay on the real email** | Available only with an owner-approved authorization | After the rules gate is deployed (§8 step 7), the account works only when a `legacyAuthorizations/<email>` document with `authorized: true` exists. The owner creates it in the console. No data moves. Record the link with `legacyIdentifier`. |
| **D. Fresh identity via `ignoreLegacy`** | **Not chosen; not recommended** | Creates a second profile beside the legacy one. That is the duplicate and orphan risk this plan exists to prevent. It needs explicit approval per student. |

> Step 6 of §8 backfills `txnSeq: 0` only on profiles that are not frozen. Held legacy
> documents are frozen (decision D-1, below). Read §8 before running `apply`.
>
> Naming note: an earlier draft of this runbook used the letter **B** for the
> `ignoreLegacy` route. The letter B now means *hold back*, which is the decision
> above. The `ignoreLegacy` route is labelled **D** so the two can't be confused.

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

## 8. Deployment order (the only approved sequence)

This is the one order that governs the release. `SECURITY_REVIEW.md` §5, §6 and §10
and the other docs point here. **Each step is a separate gate.** Do not start a step
until the previous gate's evidence is written down in the release log.

The release log is a dated note kept **outside the repository** (for example
`~/jkss-release-log.md`). Record in it: the merge commit SHA, each command run with
its output summary, the live ruleset baseline, the admin-profile check, every
approval, and every rollback.

| # | Step | Touches production? | Gate to proceed |
|---|---|---|---|
| 1 | Merge the reviewed code | No | CI green on the PR head |
| 2 | Verify the identifier format in a non-production project | No (test project only) | all four `verify-identifier` checks PASS |
| 3 | Run the production `plan` (read-only) and review the full report | **Read only** | report reviewed, live ruleset recorded |
| 4 | Keep legacy-held students on hold (Option B) | No | held list confirmed and recorded in `roster.json` |
| 5 | Verify the admin profiles | **Read only** | both admin docs as expected (otherwise stop) |
| 6 | `txnSeq: 0` backfill + eligible-student provisioning | **Yes — writes** | written approval; the FROZEN list reviewed |
| 7 | Deploy the audited Firestore rules (includes the held-account gate) | **Yes — production rules** | every prerequisite ticked; the authorization decision made; written approval; rollback baseline saved |
| 8 | Build the APK and run a controlled smoke test | Yes, controlled | APK built from the merge commit; smoke checklist passed |

Non-negotiable throughout: no student account is created, no password is reset,
no legacy record is migrated, and no billing or Spark-plan change is made, except
where a step below explicitly allows it after approval.

### Step 1 — merge the reviewed code

* The owner merges the PR after CI passes: `gh pr merge <N> --merge`. Nothing in
  this order merges code.
* Record the merge commit SHA. Every later step refers to that SHA.
* Check that `firebase/firestore.rules` in the merge commit is the file the
  `Firestore rules` CI job tested. Merging does **not** change the live database,
  because the rules are not deployed by merging.

### Step 2 — verify the identifier format (non-production only)

```bash
node tools/provision/provision.js verify-identifier --project <TEST-PROJECT> \
  --credentials <TEST-ADMIN.json> --api-key <TEST-WEB-API-KEY>
```

* Use a separate Firebase project with Email/Password enabled. The tool refuses
  to run against `jkss-fund`.
* Expected: all four checks `PASS`, and the throwaway account it creates is
  deleted afterwards (unless `--keep` was given).
* Any failure: stop. Do not provision. Never send a password-reset email to a
  synthetic identifier.

### Step 3 — the production `plan` (read-only)

```bash
cd tools/provision
node provision.js plan --project jkss-fund --credentials <ADMIN.json> --out ./reports
```

No `--apply` is passed. This only reads Auth users, `users/*` documents and jobs. Its
only local side effect is a `0600`, git-ignored report file under `reports/`.

Review the **complete** report, not only the summary:

1. Each of the 24 students: status, username, identifier, legacy match (score,
   reasons, balance, `txnCount`), hold and notes.
2. `needs MANUAL REVIEW` (must be 0, or each entry explicitly resolved) and the
   weak name-only matches (warnings only, never auto-linked).
3. The `txnSeq:0` backfill list, and the **FROZEN** list. Frozen profiles are held
   legacy documents (and the documents of students on a roster hold, and any
   ambiguous candidates). They are excluded from the backfill and listed with their
   reasons. Confirm that every frozen id is one you expect.
4. The admin-profile section: both admin documents, both preserved.
5. Unmatched profiles (former students): listed, never touched.
6. `liveJobs` and `liveActiveJobs`: how many jobs use legacy-keyed allocations
   (feeds the legacy lien in §7.4).
7. **The live ruleset.** Open Firebase console → Firestore → Rules and read it
   (read-only). Record its release timestamp and copy its text into the release
   log. This is the rollback baseline. The repository cannot see what is live.
8. **Every real-email profile** (matched or unmatched). After the gated deploy, each one is
   denied all financial access unless an owner-created authorization document exists
   (step 7, SECURITY_REVIEW §3.2a). Record the list in the release log.

Gate: the report is saved outside Git and the owner has signed off on it.

### Step 4 — keep legacy-held students on hold (Option B)

* Every student whose plan status is `migration-review`, `link-legacy` or
  `needs-review` stays on hold. Under Option B nothing is created, reset or
  migrated for them (§7.2).
* Record each hold explicitly in `roster.json`: `"hold": true` plus a
  `holdReason`. This is a repository change, reviewed through a PR, not a
  production change.
* Re-run `plan`. The `students on ROSTER HOLD` count must equal the number of held
  students.
* A hold is lifted only through the per-student review checklist in §7.2, as a
  separate recorded change. It is never lifted as part of this order.
* After the gated deploy (step 7) the rules deny held accounts: they cannot read or change
  any balance or ledger. Do not create a `legacyAuthorizations` document for a held account
  unless its §7.2 review has concluded and the owner has approved it in writing.
* Verified students (status `create` or `exists`, no legacy match, no hold) remain
  eligible for step 6.

### Step 5 — verify the admin profiles (read-only)

Check all four, and write the results in the release log:

1. Firebase Auth has the account `thrikkakarajkss@gmail.com` (Email/Password).
   Its password is not changed, reset or deleted.
2. `users/thrikkakarajkss@gmail.com` exists with `role` = `admin` and `email` =
   `thrikkakarajkss@gmail.com`. **This is the document the rules check.** `isAdmin()`
   reads `users/<signed-in email>`. Without it, the admin is locked out as soon as
   the rules are live.
3. `users/thrikkakarajkss` exists and is recorded **unchanged**: copy its full field
   set and last-update time into the release log. Do not edit, move or delete it.
4. The plan's admin section lists both documents.

**If check 2 is missing: stop.** Do not deploy the rules. Creating the document is a
production write, so it needs explicit approval. The procedure is SECURITY_REVIEW
§10.1. In summary: create a new document whose ID is the auth email, copy the old
document's fields, set `role: admin`, add `txnSeq: 0` only if it is absent, keep the
balances exactly as they are, and leave the old document untouched.

### Step 6 — `txnSeq: 0` backfill and eligible-student provisioning (approval required)

**Decision D-1 (decided and implemented):** `apply` backfills `txnSeq: 0` only on
profiles that are **not frozen**. Frozen profiles are held legacy documents, documents
of students on a roster hold, and ambiguous candidates. A held record stays exactly as
it is until it is reviewed. The tool checks this before any write (`backfillTargets`),
and refuses to run if a frozen id reaches the backfill list.

**Residual risk:** this protection is in the tool. The rules gate (step 7) separately
stops a held account from changing its own record, but only once the gated deploy has
happened. Until step 7 is done, the live rules are not gated, so a held account keeps its
current access.

Run only after written approval:

```bash
node provision.js apply --project jkss-fund --confirm-project jkss-fund \
  --credentials <ADMIN.json> --apply
```

What it does: creates the Auth account and pre-authorized profile for eligible
students only; adds `txnSeq: 0` only where it is missing; never resets an existing
password; writes new temporary passwords only to the credentials file (`0600`,
git-ignored). It changes no balance, role, ledger record or admin document.

After it finishes:

* Hand each temporary password to its student privately, then delete the file
  (§4.4).
* Re-run `plan`. Expect `students to CREATE 0`, the `txnSeq:0 backfills required`
  list empty, the FROZEN list unchanged, and the held count unchanged.
* Re-run `apply --apply`. Expect `created 0` (the run is idempotent).

Rollback: the report lists every record this step created. Removing any of them
requires approval, and each one is deleted by its id. `txnSeq: 0` is additive and is
the rules' starting counter, so it is left in place. No money moved in this step.

### Step 7 — deploy the audited Firestore rules (approval required)

**All prerequisites must be ticked. Any unticked item stops the step:**

- [ ] The `Firestore rules` CI job on the merge commit is green, and its rules suite reports
      121 passed, 0 failed. Sections 14 and 15 of `firebase/test/rules.test.js` cover the held-account
      gate and the pre-authorization gate (SECURITY_REVIEW §3.2a).
- [ ] Every username account in Auth is **email-verified**, and every username profile has
      `role: 'student'`. The gate denies both an unverified account and a profile with no role.
      Check read-only: `firebase auth:export` to a file **outside the repository**, read the
      `emailVerified` and role data, then delete the file (it contains password hashes). Any
      account that fails this check is fixed by the owner before the deploy, not by the rules.
- [ ] The owner has decided which real-email accounts keep access after the deploy. The default is
      **none**: every real-email account without an authorization document is denied from the moment
      the deploy completes. For each account the owner keeps, create `legacyAuthorizations/<email>`
      = `{ email, authorized: true }` in the console **before** the deploy. Each one is a separate,
      approved production write.
- [ ] The merge commit from step 1 is the one being deployed, and its `Firestore rules`
      CI job (rules unit tests) is green. Deploy from a clean checkout of that commit,
      never from a dirty tree.
- [ ] Step 5 passed: `users/thrikkakarajkss@gmail.com` exists with `role: admin`.
- [ ] Step 6 complete: the plan's backfill list is empty. Frozen held documents are
      listed under FROZEN and are not on the backfill list (decision D-1).
- [ ] Every user document has an integer `balancePaise` (checked in the console).
      The withdrawal path requires it.
- [ ] The console Indexes tab was reviewed, and any change in `firestore.indexes.json`
      is approved.
- [ ] The live ruleset baseline from step 3 is saved in the release log.
- [ ] Written owner approval for this production rules change.

Deploy (from the merge commit):

```bash
cd firebase
firebase deploy --only firestore --project jkss-fund
```

This deploys the rules and the indexes. Verify immediately: the console Rules tab
shows the new release, and the Indexes tab shows no new index required. Then run
step 8, starting with the admin sign-in.

Rollback: in the console's Rules tab, republish the baseline release from the
release history. If that is unavailable, redeploy the saved baseline file. Do not
roll back by editing data.

**A rollback re-opens held accounts.** The previous rules do not gate them. Roll back only
with written owner approval, and record that approval in the release log.

### Step 8 — build the APK and run a controlled smoke test

Build (owner's EAS account; this repository creates no credentials):

```bash
cd mobile && npm ci && eas build -p android --profile preview
```

Before installing, check that the build is from the merge commit, that the package is
`com.jkssfund.app`, and that `google-services.json` is for `jkss-fund`.

Smoke test, production, with a **consenting** roster student and amounts agreed in
advance:

1. Admin signs in with email and password. The dashboard opens and the student list
   loads.
2. Negative checks: a wrong password and an unknown username both show the same
   generic message. A student with no profile sees the "not pre-authorized" screen.
3. Student signs in with username and the temporary password. The dashboard opens.
   The student changes the password, then signs out and back in with the new one.
4. Admin adds a small agreed job. The committee and the student split match the
   expected paise amounts.
5. The student sees the split, and the balance updates live.
6. Admin reverses the test job. Balances return to their starting values exactly.
7. Held students still have no account and no profile change, compared with the
   step 3 snapshot. If the owner approves and that student consents, one held account signs
   in and sees "Account not enabled" with no balance. Do not use anyone else's account.
8. No password-reset or verification email was sent to any synthetic identifier.

Record each result in the release log. Any failure: stop, and roll back under step 7.

### Step 9 — nothing else

No billing change, no Cloud Functions, no Hosting, no Spark-plan change. The rules
change only at step 7, and the held students change only through §7.2.

---

## 9. Test evidence

| Suite | Where | What it proves |
|---|---|---|
| `mobile/test/identity.test.js` | local + CI | **63 passed, 0 failed** — normalization, collisions, identifier mapping, password policy, 20k-input fuzz |
| `mobile/test/accounting.test.js` | local + CI | **31 passed, 0 failed** — paise math unchanged (the money invariants) |
| `mobile/test/api.mock.test.js` | local + CI | **38 passed, 0 failed** — username login (real `auth/*` error codes), no-enumeration error text, authorization gate, ledger identity, all transaction flows |
| `tools/provision/test/plan.test.js` | local + CI | **55 passed, 0 failed** — the approved 24-name roster (Sayyid Zain replaces Thangal), synthetic identities NOT on the roster reported and frozen (never backfilled) — includes the D-1 frozen-profile checks; roster-hold validation and enforcement (incl. the explicit hold on a legacy-matched student),  roster → username, collision rules, ambiguity/weak-match handling, held-back students, admin preservation, safety gates, CLI parsing, **docs↔code mapping drift**, and **docs↔CLI drift** (every command/flag printed in these docs must exist in the tool) |
| `tools/provision/test/apply.test.js` | local + CI | **39 passed, 0 failed** — D-1 through the real `apply` path (Firebase stubbed): a held legacy profile gets no Auth account, no profile and no `txnSeq`; eligible and former profiles are still backfilled; a roster hold freezes too; shared mode (new accounts only, existing accounts never re-passworded, nothing printed or stored, dry run writes nothing); bad, missing, insecure or malformed password files refused with nothing written; an unrostered identity blocks writes unless `--allow-unrostered`, and is then left untouched; TEST MODE (`--test-mode-shared-password`) refused for `jkss-fund`, without both emulators, or when the emulator probe fails, accepted only against loopback emulators, with real local probe servers |
| `tools/provision/test/passwords.test.js` | local + CI | **36 passed, 0 failed** (incl. test-mode relaxation: 6 characters and a roster name only with the test flag, every other rule unchanged) — CSPRNG passwords (20k uniqueness), unambiguous alphabet, policy compliance, 0600 credentials file, never-overwrite; shared-password rules (length, ASCII, policy, roster names/tokens, 0600/0400 only, no symlink, one line, git-ignore inside the repo) |
| `firebase/test/rules.test.js` | CI (`Firestore rules`, emulator) | **121 scenarios** in the production rules engine (section 14: 22 held-account gate scenarios; section 15: 10 pre-authorization gate scenarios; the 111-scenario run `38729530740` succeeded on `cd63dbe`). The 121 count is confirmed only by the CI run on the verification-gate commit. Before the gate: 89 passed (14 new synthetic-identifier scenarios: pre-authorization, unauthorized-account lockout, withdrawals/credits/reversals with synthetic ids, no rules loosening) |
| `tools/provision/test/emulator.test.js` | CI (`provisioning-e2e`, Auth+Firestore emulators) | **45 checks** (37 before the shared-password work, plus 8 in §11, which starts from an emptied emulator project: refused bad-permission and malformed files, a dry run, 24 shared-password accounts that sign in, no password in the credentials file or Firestore, a rerun with another password changes nothing, an explicit random reset, and an unrostered identity blocking writes; §12 adds 9 checks for TEST MODE: refused for the production project, without emulators, and when verification fails; secure mode still refuses a short password; a dry run; 24 accounts with the test password that sign in; no password in the credentials file or Firestore; a rerun with another password changes nothing. The CI run on the pushed commit confirms the result) — a dry run creates no Auth user and touches no document, 23 accounts created idempotently, admin account+password and both admin docs preserved, balances/ledgers byte-identical, no plaintext password in Firestore, valid/invalid password sign-in, unauthorized student has no profile, reset-password, identity migration with backup, safety gates |

Exact commands (also in `SECURITY_REVIEW.md` §5):

```bash
# Node suites (no Java needed)
cd mobile            && node test/identity.test.js && node test/accounting.test.js && node test/api.mock.test.js
cd tools/provision   && node test/plan.test.js && node test/apply.test.js && node test/passwords.test.js

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
