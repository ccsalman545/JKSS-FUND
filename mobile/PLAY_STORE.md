# Google Play Store Release Guide (JKSS Fund)

This app is built with **Expo + React Native Firebase**. Follow these steps to ship it
on the Play Store as an **Android App Bundle (AAB)**.

## 1. Generate an upload keystore

Run this once on your machine (keep the passwords safe):

```bash
keytool -genkeypair -v \
  -keystore upload-keystore.jks \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -alias upload
```

Place `upload-keystore.jks` next to this file and fill in `credentials.json`
(`keystorePassword` / `keyPassword`). EAS uses it to sign the build.

> Tip: EAS can also generate and manage the keystore for you with `eas credentials`.
> For Play App Signing, Google keeps the real release key — you only ever hand over the
> **upload** key.

## 2. Build the AAB

```bash
cd mobile
npm install
npx expo install expo@~51.0.28
eas login
eas build -p android --profile production-aab   # produces app-release.aab
```

## 3. Upload to Play Console

1. Create an app at https://play.google.com/console.
2. **Play App Signing**: enroll (recommended). Upload your `upload-keystore.jks` public cert
   when prompted (`keytool -exportcert -alias upload -keystore upload-keystore.jks -file upload_cert.pem`).
3. **Release → Production → Create new release** → upload the `.aab`.
4. Complete the **store listing** (title, short/long description, graphics, screenshots).
5. **Policy** → add a **Privacy Policy** URL (required). See `PRIVACY_POLICY.md`.
6. Answer the **Data safety** form (the app uses email/name for accounts + Firestore).
7. Send for review.

## 4. Firebase setup (required before first run)

See `../firebase/README.md`. In short:
- Create a Firebase project, add an **Android app** (`com.jkssfund.app`).
- Enable **Authentication** → Google + Email/Password.
- Create a **Cloud Firestore** database and deploy `../firebase/firestore.rules`.
- Download `google-services.json` and overwrite `mobile/google-services.json`.
- Set the first admin's `role` to `admin` in Firestore (see firebase/README.md).

## 5. Pre-launch checklist

- [ ] `mobile/google-services.json` replaced with the real Firebase config
- [ ] Firebase Auth (Google + Email/Password) enabled
- [ ] Firestore rules deployed
- [ ] First admin role set to `admin` in Firestore
- [ ] AAB built and uploaded to Play Console
- [ ] Privacy policy + data-safety form completed
- [ ] Tested on a physical device: Google login, job add, balance, withdrawal
