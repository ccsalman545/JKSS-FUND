# Deploying JKSS Fund (v3.0)

> **There is no server to run or host.** The product is the Firebase-backed
> Android app in `mobile/`: Cloud Firestore for data, Firebase Authentication
> for logins, and `firebase/firestore.rules` for access control. The pre-Firebase
> Express + JSON system has been **archived** under `archive/legacy-express-web/`
> (it is superseded and is not part of this release). See "Legacy web app + API"
> at the bottom, including the security items to check if you still host it.

A "deploy" of v3.0 is three independent, reversible things. The ordered
walkthrough with rollbacks is **`docs/USERNAME_LOGIN.md` §8**; this file is the
short version.

| # | What | Where | Writes to production? |
|---|------|-------|----------------------|
| 1 | **App build** (APK / Play Store AAB) | `mobile/` via Expo EAS | no |
| 2 | **Firestore rules** | `firebase/` | **not needed for v3.0** — `firestore.rules` did not change |
| 3 | **Student accounts + profiles** (username/password) | `tools/provision/` (local, one-time) | yes — only with `--apply --confirm-project jkss-fund` |

---

## 1. Build the Android app

```bash
cd mobile
npm install
eas build -p android --profile preview     # APK for testing
eas build -p android --profile production  # AAB for Play Store
```

Requirements:

- `mobile/google-services.json` — the Firebase config for project `jkss-fund`
  (app id `com.jkssfund.app`). Already in the repo.
- For a store build: place `upload-keystore.jks` next to `mobile/credentials.json`
  and fill in the placeholder passwords there (see `mobile/PLAY_STORE.md`).

The login screen needs no Google configuration any more: students sign in with an
admin-assigned **username + password**, and the admin signs in with the existing
email + password. See `docs/USERNAME_LOGIN.md` §2.

## 2. Firestore rules — a gated later step (not part of merging)

Merging this PR does **not** change the live database. `firebase/firestore.rules` is
unchanged here, but the live project has whatever ruleset is published today, which is
recorded in runbook §8 step 3.

The deploy also turns on the held-account gate (SECURITY_REVIEW §3.2a). Real-email accounts are
denied all financial access unless the owner has created an authorization document for them, so
that decision is part of the gated step. The gate also requires every username account to be
email-verified and every username profile to have `role: 'student'` (SECURITY_REVIEW §3.2a,
runbook §8 step 7). Both are checked read-only before the deploy.

The audited rules are deployed **only** at `docs/USERNAME_LOGIN.md` §8 step 7, after the
admin profile is verified (step 5) and the `txnSeq` backfill is done (step 6). Before any
deploy, run the emulator suite and confirm it passes:

```bash
cd firebase
npm ci
firebase emulators:exec --project jkss-fund-local --only firestore "node test/rules.test.js"
# expect the last line: 121 passed, 0 failed
```

Then, and only at that gate:

```bash
firebase deploy --only firestore --project jkss-fund
```

## 3. Provision the students (once, locally)

Full runbook: `docs/USERNAME_LOGIN.md` §4–§6 (dry-run first, read the report,
then apply; the tool never resets an existing password).

```bash
node tools/provision/provision.js plan  --project jkss-fund --credentials <admin-sdk.json>
node tools/provision/provision.js apply --project jkss-fund --confirm-project jkss-fund      --credentials <admin-sdk.json> --apply
```

The generated `tools/provision/credentials.json` holds one temporary password per
student: mode `0600`, git-ignored, distribute privately (never by mass email),
then move it into a password manager and delete it.

## Backup / restore

- **Before any migration** the provisioning tool writes a local JSON backup of
  every document it is about to touch (`tools/provision/backups/`, git-ignored).
  That is the restore source if a migration needs to be undone.
- **Cloud Firestore managed export/import** (Console → Firestore → Import/Export)
  requires the Blaze plan. On Spark, use the tool's backups plus periodic manual
  exports of what the app writes (e.g. reports), and keep the admin's own
  copy of `google-services.json` and the keystore somewhere safe.
- Restore = re-import the backed-up documents (the tool prints the file it wrote
  and every document path it changed).

---

## Legacy web app + API (archived — not part of v3.0)

The pre-Firebase system now lives in `archive/legacy-express-web/`: the Express +
JWT API (`backend/`), the Vite web UI (`frontend/`), `Dockerfile`, `Procfile`,
and six stray root snapshots (`root-snapshots/`). The mobile app never calls
them and they share no data with Firebase. Its README is
`archive/legacy-express-web/README.md`, which also records the deployment evidence.

**Status of the code in the repository (done in v3.0):**
- it no longer seeds `admin` / `admin123`; the first run needs `ADMIN_USERNAME`
  and `ADMIN_PASSWORD` (≥ 12 characters) or it exits;
- it refuses to start unless `JWT_SECRET` is set (≥ 32 characters); there is no
  default secret;
- `archive/legacy-express-web/test/legacy-hardening.test.js` enforces both.

**If a copy built from the OLD code is still hosted (Railway / Render / Fly.io),
that copy is unchanged by this commit and still has the defaults.** Check it
before anything else:

- it **seeds a default admin `admin` / `admin123`** — change the password or
  delete the account;
- its `JWT_SECRET` may be the hardcoded default — rotate it and set a real one;
- student passwords there are bcrypt hashes inside `backend/data.json` — treat
  that file (and any GCS copy of it) as sensitive data;
- v3.0 does not maintain or migrate it: Firebase is the single source of truth.

Nothing in this repository has changed any hosted service. The owner must decide
whether to stop or delete it (see the archive README).
