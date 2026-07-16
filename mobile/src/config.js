// src/config.js
// Central configuration. Update these before building your APK.
import Constants from 'expo-constants';

// Backend API base URL (must be HTTPS for Google Sign-In & push in production).
export const API_URL =
  Constants.expoConfig?.extra?.apiUrl || 'https://your-backend-url.com/api';

// Google OAuth client IDs (create at https://console.cloud.google.com/apis/credentials)
// - Web client ID is used to verify the ID token on the backend.
// - Android client ID is used by the native Google Sign-In button.
export const GOOGLE_WEB_CLIENT_ID =
  Constants.expoConfig?.extra?.googleWebClientId ||
  'YOUR_GOOGLE_WEB_CLIENT_ID.apps.googleusercontent.com';

export const GOOGLE_ANDROID_CLIENT_ID =
  'YOUR_GOOGLE_ANDROID_CLIENT_ID.apps.googleusercontent.com';

export const APP_NAME = 'JKSS Fund';
export const COMMITTEE_SHARE_PCT = 10;
export const STUDENT_SHARE_PCT = 90;
export const MAX_STUDENTS = 24;
