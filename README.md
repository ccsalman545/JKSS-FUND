# JKSS-FUND (AiCoN FundMe) v2.0

A **feature-rich, deployable hostel fund management app** for Android (React Native / Expo) with
**Google Sign-In**, automatic money splitting (10% committee / 90% split equally among students),
push notifications, charts, dark mode, and biometric lock.

All amounts are in **Indian Rupees (₹)**.

---

## 📂 Project structure

```
JKSS-FUND/
├── backend/                 # Node.js + Express + SQLite API
│   ├── package.json
│   └── server.js            # Auth, Google Sign-In, jobs, balances, reports, push
├── mobile/                  # Expo (React Native) Android app
│   ├── App.js               # Root navigator + biometric gate
│   ├── app.json             # Expo / EAS config (icons, scheme, permissions)
│   ├── eas.json             # EAS Build profiles (APK)
│   ├── package.json
│   ├── assets/              # splash / icon / adaptive-icon
│   └── src/
│       ├── api.js           # API client
│       ├── config.js        # ⚙️ API_URL + Google client IDs (EDIT THESE)
│       ├── theme.js         # Light / dark palettes
│       ├── context/         # Auth + Theme providers
│       ├── components/ui.js # Reusable UI
│       ├── utils/format.js  # INR / date formatting
│       └── screens/         # Login, Dashboard, Students, Jobs, Reports, Profile…
└── (legacy files: app, app reactnative, server, package, setup guide)
```

> The loose legacy files at the repo root are the original prototypes. The buildable,
> production version lives in `backend/` and `mobile/`.

---

## ✨ Features

**Auth & security**
- 🔐 Google Sign-In (native, ID-token verified on the server)
- 🔑 Email/password login (students + admin), bcrypt-hashed
- 📱 Biometric app lock (fingerprint / face) on supported devices
- 🔒 Tokens stored in `expo-secure-store`

**Admin**
- Add / remove students (up to 24)
- Add / delete jobs — **auto 10%/90% split**, balances updated instantly
- Real-time dashboard (students, distributed total, committee fund, jobs)
- Charts: collection trend (line) + committee/student split (pie)
- Monthly / yearly reports with per-job breakdown
- Push notification sent to every student when a job is added

**Student**
- Live balance + committee fund
- Withdraw with reason, full transaction history
- Earnings vs withdrawals summary

**UX**
- 🌗 Light / Dark mode toggle
- 📊 Charts (react-native-chart-kit)
- 🔔 Expo push notifications
- Pull-to-refresh, modals, smooth navigation

---

## 🚀 1. Backend

```bash
cd backend
npm install
# optional: create a .env with JWT_SECRET and GOOGLE_CLIENT_ID (see below)
node server.js
# → http://localhost:3000  (health: /api/health)
```

Default admin: `admin` / `admin123` (change it from the Profile screen).

**Environment variables (optional but recommended):**
```
JWT_SECRET=some-long-random-string
GOOGLE_CLIENT_ID=YOUR_GOOGLE_WEB_CLIENT_ID.apps.googleusercontent.com
PORT=3000
DB_PATH=./hostel_fund.db
```
`GOOGLE_CLIENT_ID` is the **Web client ID** used to verify Google ID tokens.

### Deploy the backend (any of these)
- **Railway / Render / Fly.io / Heroku** — push the `backend/` folder, set the env vars above,
  make sure the URL is **HTTPS**. The mobile app needs an HTTPS `API_URL`.
- The DB is a single SQLite file (`hostel_fund.db`) — back it up regularly.

---

## 🔧 2. Google Sign-In setup (required for the APK)

1. Go to **https://console.cloud.google.com/apis/credentials**.
2. **OAuth consent screen** → configure (external is fine for testing).
3. Create two OAuth **client IDs**:
   - **Web application** → copy its Client ID → put in `mobile/src/config.js`
     (`GOOGLE_WEB_CLIENT_ID`) and in the backend env (`GOOGLE_CLIENT_ID`).
   - **Android** → package name `com.jkssfund.app` + your signing **SHA-1**
     (for a local `expo run:android` debug key, or the SHA-1 EAS shows after the first build) →
     copy its Client ID into `mobile/src/config.js` (`GOOGLE_ANDROID_CLIENT_ID`).
4. (For dev only) you can also use the Expo proxy, but for a shipped APK the Android client is required.

> Without these IDs the app still builds and runs; only the Google button will fail until configured.

---

## 📱 3. Build the Android APK (EAS)

```bash
cd mobile
npm install
npx expo install expo@~51.0.28   # aligns Expo SDK + native deps

# one-time
npm install -g eas-cli
eas login

# edit src/config.js → set API_URL to your deployed HTTPS backend
# then:
eas build -p android --profile production   # produces a signed .apk
# or for internal testing:
eas build -p android --profile preview
```

The build runs on Expo's servers (no Android SDK needed on your machine). When it finishes,
download the `.apk` and install it on any Android device
(*Settings → Install unknown apps* may be required).

### Run locally (Expo Go / dev build) for testing
```bash
npx expo start
# point API_URL in src/config.js at your LAN IP, e.g. http://192.168.1.20:3000/api
```
Google Sign-In requires a dev build (`npx expo run:android`), not Expo Go.

---

## 🧪 How the money logic works

Adding a job of ₹1000 with 10 students:
- Committee fund: **+₹100** (10%)
- Student pool: **₹900** → **₹90 each** (90% ÷ students)
- Every student gets an *earning* transaction; admin/student dashboards update live.
- Deleting a job **reverses** the splits automatically.

---

## ✅ Pre-launch checklist
- [ ] Backend deployed on HTTPS and reachable
- [ ] `mobile/src/config.js` → `API_URL` points to the backend
- [ ] Google Web + Android OAuth clients created and IDs set
- [ ] Default admin password changed
- [ ] `JWT_SECRET` set to a random value
- [ ] APK built via EAS and installed on a test device
- [ ] Tested: Google login, job add, student balance, withdrawal, push

---

**Your hostel fund app is ready to ship! 🎉**
