# ARCHIVED — legacy Express + React web app (superseded in v3.0)

> **Do not deploy this.** It was replaced by the Firebase Android app in `mobile/`
> (v3.0). It is kept here only for reference and history. Nothing in the live
> product, the tests, or the CI workflows depends on it.

## What is in here

| Path | What it was |
|---|---|
| `backend/` | Express 4 + JWT + bcrypt API. Stores data in a JSON file (`backend/data.json`, git-ignored), optional Google Cloud Storage backup. |
| `frontend/` | Vite + React web client that calls `API_URL/auth/login`. |
| `Dockerfile`, `.dockerignore`, `Procfile` | Container / Heroku-style start for the two above. Paths are relative to *this* folder. |
| `package.json` | Root scripts that drove `backend/` and `frontend/`. |
| `root-snapshots/` | Six stray files that had been committed to the repository root as upload copies. Not referenced by any build. See the table below. |

### The six root snapshots

| Original root name | Now | Notes |
|---|---|---|
| `app` | `root-snapshots/app.jsx` | Older copy of the web UI. Credential hint redacted. |
| `app. jsx` | **deleted** | Byte-identical to `app` (sha `be933f4`). Added by commit `5c006e9` ("Create app.jsx"). History keeps it. |
| `app reactnative` | `root-snapshots/app-reactnative.js` | React Native client pointing at a Railway URL. Credential hint redacted. |
| `server` | `root-snapshots/server.js` | Older SQLite variant of the API. Hardcoded default JWT secret and seeded admin removed. |
| `package ` | `root-snapshots/package.sqlite-backend.json` | Manifest of the SQLite variant (`sqlite3` dependency). |
| `setup guide ` | `root-snapshots/setup-guide.md` | Old setup guide. Default-credential examples redacted. |

The original, unredacted files are in git history at the base commit
`0f362d9` (for example `git show 0f362d9:server`). Do not run the redacted
snapshots; they are documentation and reference only.

## Hardening applied when archiving

* `backend/server.js` refuses to start unless `JWT_SECRET` is set to at least 32
  characters. The check runs before any `require`, and there is **no default
  secret**.
* On the first run (no data file), the admin account comes **only** from
  `ADMIN_USERNAME` and `ADMIN_PASSWORD` (≥ 12 characters). If either is missing,
  the server exits. **No default account of any kind is ever created.**
* The frontend login hint that printed the default username and password has been removed.
* `archive/legacy-express-web/test/legacy-hardening.test.js` enforces these
  rules (see below).

## Evidence about a live deployment (checked 2026-10-15)

* The repository has GitHub **deployment records** for two Railway environments,
  `pure-prosperity / production` and `proactive-integrity / production`. Both were
  created 2026-02-11 by `railway-app[bot]` for commit `5c006e9`. **The most
  recent status for both is `failure`.**
* The repository has **no** Railway, Render, Fly, or Heroku configuration file in
  its history. `DEPLOY.md` and the `setup guide` both describe those platforms.
* What could not be checked from the sandbox: whether a Railway service is still
  running, what URL it uses, and what data it holds. The Railway account is not
  reachable from here, and nothing was changed there.

**Action for the owner:** log in to Railway, confirm whether the two projects
(`f49c2a8f…` and `f9457028…`) still exist and run anything. If they do, stop or
delete them, and rotate any credentials they used. Keep any data they hold
until it has been reviewed. This is a human decision; no hosted service was
modified.

## If someone ever revives this code

1. Use a new, isolated host. Do not reuse the old project.
2. Set `JWT_SECRET` (≥ 32 random characters) and, on first run, `ADMIN_USERNAME`
   and `ADMIN_PASSWORD`.
3. Do not share data with the Firebase project `jkss-fund`. The two systems do not
   share identities, and the legacy store is not migrated by any tool here.
4. Run `npm ci` inside `backend/` before `node server.js`.
