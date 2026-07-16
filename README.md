# JKSS-FUND (AiCoN FundMe) v3.0 — Firebase Edition

A **feature-rich, deployable Android app** for transparent hostel fund management, built
with **React Native (Expo) + Firebase**. Students sign in with **Google**, the admin adds
jobs, and the app automatically splits each payment **10% → committee fund / 90% → split
equally among students**. All amounts are in **Indian Rupees (₹)**.

The custom Express/SQLite backend has been **replaced by Firebase** (Authentication +
Cloud Firestore + Security Rules), so there is **no server to run or host**.

---

## 🏗️ Architecture

```
JKSS-FUND/
├── mobile/                 # Expo (React Native) Android app
│   ├── App.js              # Navigation + biometric lock
│   ├── app.json            # Expo/EAS config + @react-native-firebase plugin
│   ├── eas.json            # Build profiles (APK + Play Store AAB)
│   ├── google-services.json# ⚠️ REPLACE with your real Firebase config
│   ├── credentials.json    # Signing keystore scaffold (Play Store)
│   ├── PLAY_STORE.md       # Release walkthrough
│   ├── assets/             # splash / icon
│   └── src/
│       ├── firebase.js     # Native Firebase modules
│       ├── api.js          # Firestore data layer (real-time)
│       ├── config.js       # Google client IDs (EDIT)
│       ├── context/        # Auth + Theme
│       ├── components/ui.js
│       └── screens/        # Login, Dashboards, Students, Jobs, Reports, Profile…
└── firebase/               # Firebase console config (deploy with firebase-tools)
    ├── firestore.rules     # Access control
    ├── firestore.indexes.json
    ├── firebase.json
    ├── .firebaserc
    └── README.md           # Firebase project setup
```

**Why `google-services.json`?** The native Firebase SDK reads it to initialize on Android,
so the build needs a (real) copy even though we use Firestore real-time instead of FCM.

---

## ✨ Features

- 🔐 **Google Sign-In** (native) + admin **email/password** (Firebase Auth)
- 📡 **Real-time** balances, jobs & transactions via Firestore listeners (updates the
  instant the admin adds a job — no polling, no push server needed)
- 🔢 Automatic **10% / 90%** fund split, atomic per job
- 📊 **Charts** (collection trend + committee/student split)
- 🌗 Light/Dark mode, 📱 biometric app lock
- 👤 Admin: students, jobs, delete/reverse, monthly/yearly reports
- 💸 Student: live balance, withdraw, full history

---

## 🚀 1. Firebase (one-time)

See **`firebase/README.md`**. In short:
1. Create a Firebase project; enable **Google** + **Email/Password** auth.
2. Create a **Cloud Firestore** database.
3. Add an **Android app** (`com.jkssfund.app`); download `google-services.json` → overwrite
   `mobile/google-services.json`.
4. `cd firebase && firebase deploy --only firestore` (deploys rules + indexes).
5. Create the **first admin**: add an Auth user in the console, then set that user's
   Firestore `users/{email}` doc `role` to `admin`.

---

## 🔧 2. Google OAuth clients

In Google Cloud Console → **Credentials**, create:
- **Web client ID** → put in `mobile/src/config.js` (`GOOGLE_WEB_CLIENT_ID`).
- **Android client ID** (package `com.jkssfund.app` + your SHA-1) → `GOOGLE_ANDROID_CLIENT_ID`.

> Students sign in with Google. Admins sign in with the email/password account you created.

---

## 📱 3. Build the APK / AAB

```bash
cd mobile
npm install
npx expo install expo@~51.0.28      # align Expo SDK + native deps
eas login

# APK (sideload / internal testing):
eas build -p android --profile preview

# Play Store bundle (AAB):
eas build -p android --profile production-aab
```

See **`mobile/PLAY_STORE.md`** for the full release + signing guide
(`keytool` upload keystore, Play App Signing, privacy policy, data-safety form).

---

## 🧪 How the money logic works

Adding a job of ₹1000 with 10 students (atomic Firestore batch):
- Committee fund **+₹100** (10%)
- Student pool **₹900** → **₹90 each** (90% ÷ students)
- Each student gets an *earning* transaction; dashboards update **live**.
- Deleting a job **reverses** the splits automatically.

---

## ✅ Pre-launch checklist
- [ ] `mobile/google-services.json` replaced with real Firebase config
- [ ] Firebase Auth (Google + Email/Password) enabled
- [ ] Firestore rules + indexes deployed
- [ ] First admin `role` set to `admin` in Firestore
- [ ] Google Web + Android OAuth client IDs set in `mobile/src/config.js`
- [ ] AAB built and uploaded to Play Console (or APK for sideload)
- [ ] Tested on a device: Google login, job add, student balance, withdrawal

---

**Ready for the Play Store. 🎉**
