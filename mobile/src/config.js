// src/config.js
// Central configuration.
//
// v3.0 LOGIN MODEL
// ----------------
//   * Students sign in with the USERNAME the admin assigned them plus a
//     password. Firebase Email/Password needs an email-shaped identifier, so
//     `src/identity.js` maps the username to a synthetic identifier
//     (`<username>@students.jkss-fund.invalid`, an RFC 2606 non-deliverable
//     domain). That mapping is the single source of truth — shared with the
//     local provisioning tool (tools/provision) and the test suites.
//   * The ADMIN signs in with the existing Firebase Email/Password account
//     (the login field accepts an email, which is passed straight to Firebase).
//
// There is no Google Sign-In any more: it was never configured for this
// project (google-services.json ships with `oauth_client: []`) and it required
// students to have a Google account, which the fund does not want. The Google
// client-ID placeholders and the `@react-native-google-signin` dependency were
// removed together with the button — see README §1.
//
// Firebase native config (project id / api keys) is read from google-services.json
// (Android) at build time — nothing to set here. Just make sure
// mobile/google-services.json is filled in from the Firebase console.

import { STUDENT_EMAIL_DOMAIN } from './identity';

// Kept in one place: the app, the provisioning tool and docs/USERNAME_LOGIN.md
// all use this exact domain (a test asserts they cannot drift).
export { STUDENT_EMAIL_DOMAIN };
export const STUDENT_IDENTIFIER_LABEL = '<username>@' + STUDENT_EMAIL_DOMAIN;

// Student-facing copy for the login form and the profile screen.
export const LOGIN_HINT_STUDENT = 'Students: the username your admin gave you';
export const LOGIN_HINT_ADMIN = 'Admin: your email address and password';
export const FORGOT_PASSWORD_HELP =
  'Forgotten your password? Ask the admin — there is no email recovery for ' +
  'student accounts. The admin resets it and gives you a new temporary password.';

export const APP_NAME = 'JKSS Fund';
export const COMMITTEE_SHARE_PCT = 10;
export const STUDENT_SHARE_PCT = 90;
export const MAX_STUDENTS = 24;
