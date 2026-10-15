# Deploying JKSS Fund (v3.0)

> **There is no server to run or host.** The product is the Firebase-backed
> Android app in `mobile/`: Cloud Firestore for data, Firebase Authentication
> for logins, and `firebase/firestore.rules` for access control. The pre-Firebase
> Express + JSON system (`backend/`, `frontend/`, `Dockerfile`, `Procfile`) is
> **superseded** and is not part of this release — see "Legacy web app + API" at
> the bottom, including the security items to check if you still host it.

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

## 2. Firestore rules — no deploy required

`firebase/firestore.rules` was **not modified by v3.0**, so there is nothing to
deploy. A student's Firebase Authentication email *is* their internal identifier,
which is exactly what the rules already key on (see `docs/USERNAME_LOGIN.md` §2).

If you ever do change and redeploy the rules, always run the emulator suite first
and never deploy a failing suite:

```bash
cd firebase
npm ci
firebase emulators:exec --project jkss-fund-local --only firestore "node test/rules.test.js"
# expect the last line: 89 passed, 0 failed
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

## Legacy web app + API (superseded — not part of v3.0)

`backend/server.js` (Express + JWT + `backend/data.json`, optional Google Cloud
Storage backup), `frontend/` (the Vite web UI that calls it), `Dockerfile` and
`Procfile` belong to the pre-Firebase system. The mobile app never calls them and
they share no data with Firebase.

**If that service is still deployed somewhere (Render / Railway / Fly.io), check
these before anything else:**

- it **seeds a default admin `admin` / `admin123`** on first start — change the
  password or delete the account;
- `JWT_SECRET` falls back to a hardcoded default when unset — always set it;
- student passwords there are bcrypt hashes inside `backend/data.json` — treat
  that file (and any GCS copy of it) as sensitive data;
- v3.0 does not maintain or migrate it: Firebase is the single source of truth.

The old instructions, kept only for that legacy service: create a GCS bucket
(e.g. `jkss-fund-data`), give a service account `Storage Object Admin` on it, and
set `GCS_BUCKET` + `GCS_KEY_JSON` (or `GOOGLE_APPLICATION_CREDENTIALS`) and
optionally `GCS_OBJECT` on the host; the app logs "Google Cloud Storage backup
enabled" at startup. Local backup/restore there is just copying
`backend/data.json`.

> **Recommendation:** leave it off (or archive those paths in a separate change).
> Removing tracked files is a repository decision, so v3.0 left them in place.
