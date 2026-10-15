// src/config.js
// Central configuration. Update these before building your release.
import Constants from 'expo-constants';

// Google OAuth client IDs (create at https://console.cloud.google.com/apis/credentials)
// - Web client ID is used by @react-native-google-signin to obtain the ID token.
// - Android client ID is required for the native Google Sign-In button on the device.
export const GOOGLE_WEB_CLIENT_ID =
  Constants.expoConfig?.extra?.googleWebClientId ||
  'YOUR_GOOGLE_WEB_CLIENT_ID.apps.googleusercontent.com';

export const GOOGLE_ANDROID_CLIENT_ID =
  'YOUR_GOOGLE_ANDROID_CLIENT_ID.apps.googleusercontent.com';

// True only when REAL OAuth client IDs have been configured (above). The app
// works fully with email/password auth without them; the Google button is
// hidden until they are set. (The shipped google-services.json currently has
// oauth_client: [] — an Android OAuth client for com.jkssfund.app must be
// added in the Google Cloud console first.)
export const GOOGLE_SIGNIN_CONFIGURED =
  !GOOGLE_WEB_CLIENT_ID.includes('YOUR_')
  && !GOOGLE_ANDROID_CLIENT_ID.includes('YOUR_');

// Firebase native config (project id / api keys) is read from google-services.json
// (Android) and GoogleService-Info.plist (iOS) at build time — nothing to set here.
// Just make sure mobile/google-services.json is filled in from the Firebase console.

export const APP_NAME = 'JKSS Fund';
export const COMMITTEE_SHARE_PCT = 10;
export const STUDENT_SHARE_PCT = 90;
export const MAX_STUDENTS = 24;
