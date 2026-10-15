# Deploying JKSS Fund

## Run locally
```bash
npm run install:all
npm run build
npm start
# open http://localhost:3000  (admin: admin / admin123)
```

## Deploy to a cloud host (Render / Railway / Fly.io)
1. Push this repo to GitHub.
2. Create a new Web Service from the repo.
   - Build command: `npm run build`
   - Start command: `npm start`
3. Set environment variables:
   - `JWT_SECRET` — a long random string
   - `PORT` — usually provided by the platform
   - (optional) `DATA_FILE` — path for the data file (default `backend/data.json`)

> Free tiers have an ephemeral filesystem. Enable Google Cloud backup (below) so data
> survives redeploys/restarts.

## Automatic Google Cloud backup
Data is saved to `data.json` and, when configured, automatically uploaded to a Google
Cloud Storage bucket after every change (debounced). On startup, if the local file is
missing, it is restored from the bucket.

1. Create a GCS bucket (e.g. `jkss-fund-data`).
2. Create a service account with `Storage Object Admin` on that bucket; download its JSON key.
3. Set env vars on your host:
   - `GCS_BUCKET=jkss-fund-data`
   - `GCS_KEY_JSON` = the full contents of the service-account JSON (single line), **or**
   - `GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json`
   - (optional) `GCS_OBJECT=jkss-fund/data.json`
4. Redeploy. Logs will show `Google Cloud Storage backup enabled`.

## Install as an app (PWA)
The web app ships a manifest + service worker, so on a phone you can "Add to Home
Screen" / "Install" and use it like an app. For a native Android APK, use the
`mobile/` Expo project with EAS (see README).

## Backup / restore manually
- Local backup: copy `backend/data.json`.
- Restore: replace `backend/data.json` with your backup and restart.
