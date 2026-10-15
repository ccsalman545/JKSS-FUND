# JKSS-FUND provisioning tool (`tools/provision`)

One-time, **local**, admin-only tool that creates the student logins for
JKSS-FUND v3.0:

* `username` (assigned from the roster) → synthetic Firebase identifier
  `<username>@students.jkss-fund.invalid` (`mobile/src/identity.js`),
* a unique, cryptographically random **temporary password** per student,
* the pre-authorized `users/{identifier}` Firestore profile,
* a local **credentials file (mode 0600, git-ignored)** with
  `username + password` per student.

The mobile app never contains Admin SDK credentials — this tool is the only
place the Admin SDK is used, and it runs on the admin's own machine.

> **Dry-run by default.** Nothing is written without `--apply`, and a *live*
> (non-emulator) project must additionally be named twice:
> `--project X --confirm-project X`.

---

## 1. Install

```bash
cd tools/provision
npm install          # only dependency: firebase-admin
```

## 2. Getting the service-account key (Admin SDK credentials)

**Console (recommended for a one-off run):**

1. Firebase console → ⚙️ **Project settings** → **Service accounts**.
2. **Generate new private key** → *Generate key* → download the JSON
   (`jkss-fund-firebase-adminsdk-xxxx.json`).
3. Store it **outside the repository** (e.g. `~/secrets/jkss-fund-admin.json`,
   `chmod 600`). Never commit it — `*firebase-adminsdk*.json` and
   `*service-account*.json` are git-ignored as a backstop.
4. Pass it with `--credentials ~/secrets/jkss-fund-admin.json` (or
   `export GOOGLE_APPLICATION_CREDENTIALS=…`).

**Alternative without a key file:** `gcloud auth application-default login`
(Application Default Credentials) with an account that has Owner/Editor on the
project.

**No credentials at all (safe rehearsal):** run against the emulators —

```bash
cd firebase && npx firebase-tools emulators:start --only firestore,auth
# in another shell:
export FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099
export FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
cd tools/provision && node provision.js apply --project jkss-fund-e2e --apply
```

### Manual Firebase Console alternative (if you cannot use the Admin SDK)

The tool prints the authoritative identifier for every student
(`node provision.js` — offline, no credentials needed). In the console:

1. **Authentication → Users → Add user** for each student:
   email = the printed identifier, password = a password you generate (16+
   random characters, unique per student — never a name-based or shared one).
   Mark the email as verified / skip verification (no mail exists).
2. **Firestore → `users` → Add document** with the identifier as the
   **document ID** and exactly these fields:
   `email` (string, the identifier), `role` = `student`, `full_name` (string),
   `avatar` = `""`, `balancePaise` = 0, `balance` = 0, `txnSeq` = 0.
3. Write each password down privately and hand it to that student.
4. Existing documents missing `txnSeq`: add `txnSeq: 0` (nothing else).

That is 24 × 2 manual operations; the tool exists to make it a single reviewed
command with a dry-run, idempotent reruns and a credentials file.

## 3. Commands

```bash
node provision.js                        # dry run, offline: the 24 mappings
                                         # (only a local 0600 report file is written)
node provision.js plan  --project X …    # read-only plan against the project
node provision.js apply --project X --confirm-project X --apply
node provision.js verify-identifier --project <TEST-project> [--api-key K]
node provision.js reset-password --username thangal --project X --apply
node provision.js migrate-identity --legacy old@mail.com --username salman --apply …
node provision.js help
```

Every command is a **dry run** without `--apply`. See
[`../../docs/USERNAME_LOGIN.md`](../../docs/USERNAME_LOGIN.md) for the full
runbook, the migration options, and the manual deployment checklist.

## 4. What it will never do

* Reset or overwrite an existing password (reruns are idempotent; resets are an
  explicit `reset-password`).
* Overwrite a profile, a balance, a role, a transaction, a job or the committee
  document. The only field it adds is `txnSeq: 0`, and only where it is missing.
* Create a second profile for a student who already has one (such students are
  held back and reported for review).
* Touch either admin profile, or the admin Auth account/password.
* Store a password in Firestore or in Git.
* Run against production by accident (the typo guard) or `verify-identifier`
  against the production project id at all.

## 5. Files

| Path | Committed? | Notes |
|---|---|---|
| `roster.json` | yes | Names only — **never add student emails**; optional `username`, `legacyIdentifier`, `ignoreLegacy`, and `hold` + `holdReason` (an explicit hold: the student is never created until the hold is removed) |
| `credentials.json` | **no** (git-ignored) | Generated passwords, mode 0600 — distribute, then delete/park in a password manager |
| `reports/*.json` | **no** (git-ignored) | Plan/apply reports (contain live ids/balances) |
| `backups/*.json` | **no** (git-ignored) | Pre-migration document+ledger backups |
| `test/plan.test.js`, `test/passwords.test.js` | yes | Pure-Node suites (`npm test`) |
| `test/emulator.test.js` | yes | Full E2E against the Auth+Firestore emulators (`npm run test:emulator` via `firebase emulators:exec`) |
