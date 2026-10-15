// tools/provision/lib/test-mode.js
// TEST-ONLY gate for `apply --test-mode-shared-password`.
//
// That flag lets the owner's shared initial password skip two checks: the
// 12-character minimum (it keeps Firebase Auth's own 6-character floor) and the
// roster username/name check. Everything else stays in force. The flag is
// honoured ONLY when ALL of these hold, and each refusal happens before the
// password file is read or any project is contacted:
//
//   1. the project id is not the production project (case-insensitive), and
//      it names a test project (contains "test", "e2e" or "emulator");
//   2. BOTH the Firebase Auth emulator (FIREBASE_AUTH_EMULATOR_HOST) and the
//      Firestore emulator (FIRESTORE_EMULATOR_HOST) are configured, and both
//      point at a loopback host (localhost, 127.0.0.1 or [::1]);
//   3. both emulators actually answer: an HTTP probe must get the Firestore
//      health response and an Identity Toolkit JSON error from the Auth emulator.
//
// The probe creates nothing and sends no real credentials. The module never
// reads, prints or stores a password.
'use strict';

const PRODUCTION_PROJECT = 'jkss-fund';
const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]', '::1'];
const PROBE_TIMEOUT_MS = 4000;

function hostOf(hostPort) {
  const s = String(hostPort || '').trim();
  if (s.startsWith('[')) return s.slice(0, s.indexOf(']') + 1); // [::1]:9099
  return s.split(':')[0];
}

async function fetchWithTimeout(url, opts = {}, timeoutMs = PROBE_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, Object.assign({}, opts, { signal: controller.signal }));
  } finally {
    clearTimeout(timer);
  }
}

// Real network probe. Returns { ok, auth, firestore, reason }.
async function probeEmulators({ authHost, firestoreHost, timeoutMs = PROBE_TIMEOUT_MS }) {
  let firestore = false;
  let auth = false;
  const reasons = [];
  try {
    const r = await fetchWithTimeout('http://' + firestoreHost + '/', {}, timeoutMs);
    firestore = r.status === 200;
    if (!firestore) reasons.push('firestore emulator answered HTTP ' + r.status);
  } catch (e) {
    reasons.push('firestore emulator not reachable at ' + firestoreHost);
  }
  try {
    // An unknown probe account must be answered by the Identity Toolkit emulator
    // with a JSON error. Nothing is created and no real password is involved.
    const r = await fetchWithTimeout(
      'http://' + authHost + '/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=emulator-key',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'emulator-probe@students.jkss-fund.invalid', password: 'probe-only-not-a-password', returnSecureToken: true }),
      },
      timeoutMs
    );
    const body = await r.json().catch(() => ({}));
    auth = !!(body && body.error && body.error.message);
    if (!auth) reasons.push('auth emulator did not answer as the Identity Toolkit emulator at ' + authHost);
  } catch (e) {
    reasons.push('auth emulator not reachable at ' + authHost);
  }
  return { ok: auth && firestore, auth, firestore, reason: reasons.join('; ') || null };
}

// Throws (refuses) unless every condition above holds. Resolves with the
// verified details. `probe` is injectable for tests.
async function assertTestModeAllowed({ project, env = process.env, probe = (o) => module.exports.probeEmulators(o) } = {}) {
  const name = String(project || '').trim();
  if (!name) throw new Error('TEST MODE refused: --project is required');
  if (name.toLowerCase() === PRODUCTION_PROJECT) {
    throw new Error('TEST MODE refused: "' + name + '" is the PRODUCTION project. The test-only shared password option never runs against it.');
  }
  if (!/(test|e2e|emulator)/i.test(name)) {
    throw new Error('TEST MODE refused: "' + name + '" is not a test project id (it must contain "test", "e2e" or "emulator").');
  }
  const authHostPort = env.FIREBASE_AUTH_EMULATOR_HOST;
  const firestoreHostPort = env.FIRESTORE_EMULATOR_HOST;
  if (!authHostPort || !firestoreHostPort) {
    throw new Error('TEST MODE refused: BOTH emulators must be active. Set FIREBASE_AUTH_EMULATOR_HOST and FIRESTORE_EMULATOR_HOST (see docs/USERNAME_LOGIN.md §4.6).');
  }
  for (const hp of [authHostPort, firestoreHostPort]) {
    if (!LOOPBACK_HOSTS.includes(hostOf(hp))) {
      throw new Error('TEST MODE refused: emulator host "' + hp + '" is not a loopback address (localhost / 127.0.0.1).');
    }
  }
  const result = await probe({ authHost: authHostPort, firestoreHost: firestoreHostPort });
  if (!result || !result.ok) {
    throw new Error('TEST MODE refused: emulator verification failed' + (result && result.reason ? ' (' + result.reason + ')' : '') + '.');
  }
  return { project: name, authHost: authHostPort, firestoreHost: firestoreHostPort };
}

module.exports = {
  assertTestModeAllowed,
  probeEmulators,
  PRODUCTION_PROJECT,
  _internals: { hostOf },
};
