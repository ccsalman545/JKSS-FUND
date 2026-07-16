# Firebase Setup (replaces the old Express backend)

The app no longer uses a custom server. All auth, data, and rules live in Firebase.

## 1. Create the project
1. Go to https://console.firebase.google.com → **Add project**.
2. **Build → Authentication → Get started** → enable:
   - **Google** (configure the OAuth consent screen + web client)
   - **Email/Password** (for the admin account)
3. **Build → Firestore Database → Create database** (start in production mode).

## 2. Android app
1. **Project settings → Your apps → Android**, package name `com.jkssfund.app`.
2. Download `google-services.json` and overwrite `../mobile/google-services.json`.
   (iOS: add `GoogleService-Info.plist` to the iOS target.)

## 3. Deploy rules + indexes
```bash
cd firebase
npm install -g firebase-tools
firebase login
firebase use --add            # link YOUR_FIREBASE_PROJECT_ID
firebase deploy --only firestore
```

## 4. Create the first admin
Firebase client SDK can't create *other* users, so the admin is created manually:

1. **Authentication → Users → Add user** with an email + password (this is your admin login).
2. In **Firestore**, create a document:
   - Collection: `users`, Document ID: `<the admin email, lowercased>`
   - Fields: `email` = that email, `role` = `admin`, `full_name` = "Administrator",
     `avatar` = "", `balance` = 0
3. (Optional) Also run `firebase firestore:write users/<email> '{role:"admin",...}'`.

> Every other user (students) just signs in with Google — their `users/{email}` doc
> is created automatically on first sign-in. Admins can pre-register students from the
> app (Add Student) using the student's Google email.

## 5. Local emulators (optional, for development)
```bash
firebase emulators:start
```
Then point the app at the emulator (see comment in `mobile/src/api.js`).

## Data model
- `users/{email}` → `{ email, role, full_name, avatar, balance, createdAt }`
- `jobs/{autoId}` → `{ name, amount, date, committeeShare, studentShare, perStudent, createdBy, createdAt }`
- `transactions/{autoId}` → `{ studentId, type, amount, jobId, description, createdAt }`
- `meta/committee` → `{ balance }`
