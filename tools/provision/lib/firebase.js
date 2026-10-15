// tools/provision/lib/firebase.js
// Firebase Admin SDK access for the provisioning tool.
//
// The Admin SDK is used **outside the mobile app** (a local, admin-only tool) —
// the app itself never holds service-account credentials. Credentials are read
// from `--credentials <path>` or the standard `GOOGLE_APPLICATION_CREDENTIALS`
// environment variable and are never copied into the repository.
//
// Emulator mode: when FIREBASE_AUTH_EMULATOR_HOST / FIRESTORE_EMULATOR_HOST
// are set, the SDK talks to the local emulators and no real credentials are
// required (used by the CI integration suite and by `verify-identifier`).
'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const GOOGLE_SERVICES_JSON = path.join(REPO_ROOT, 'mobile', 'google-services.json');

function loadAdminSdk() {
  try {
    return require('firebase-admin');
  } catch (e) {
    throw new Error(
      'The Firebase Admin SDK is not installed. Run:\n' +
      '  cd tools/provision && npm install\n' +
      '(and see tools/provision/README.md for the credential setup)'
    );
  }
}

function emulatorHosts() {
  return {
    auth: process.env.FIREBASE_AUTH_EMULATOR_HOST || null,
    firestore: process.env.FIRESTORE_EMULATOR_HOST || null,
  };
}

function isEmulatorMode() {
  const h = emulatorHosts();
  return !!(h.auth || h.firestore);
}

// Reads the public client configuration shipped with the app: the Firebase
// project id and the *client* Web API key (safe to ship in an app; used here
// only to call the Identity Toolkit REST sign-in endpoint for verification).
function readProjectConfig(file = GOOGLE_SERVICES_JSON) {
  if (!fs.existsSync(file)) return { projectId: null, apiKey: null, packageName: null, file: null };
  const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
  const client = (cfg.client && cfg.client[0]) || {};
  const apiKeys = client.api_key || [];
  return {
    projectId: (cfg.project_info && cfg.project_info.project_id) || null,
    apiKey: apiKeys.length ? apiKeys[0].current_key : null,
    packageName: (client.client_info && client.client_info.android_client_info
      && client.client_info.android_client_info.package_name) || null,
    file,
  };
}

function initAdmin({ projectId, credentialsPath = null, quiet = false } = {}) {
  const admin = loadAdminSdk();
  if (!projectId) throw new Error('--project <firebase-project-id> is required');

  const emulator = isEmulatorMode();
  let credential = null;
  let credentialSource = 'emulator (no credentials needed)';

  if (!emulator) {
    const file = credentialsPath || process.env.GOOGLE_APPLICATION_CREDENTIALS || null;
    if (!file) {
      throw new Error(
        'No Admin SDK credentials. Either run against the local emulators\n' +
        '  (set FIREBASE_AUTH_EMULATOR_HOST + FIRESTORE_EMULATOR_HOST), or pass\n' +
        '  --credentials /path/to/service-account.json, or export\n' +
        '  GOOGLE_APPLICATION_CREDENTIALS. See tools/provision/README.md.'
      );
    }
    const abs = path.resolve(file);
    if (!fs.existsSync(abs)) throw new Error('Credentials file not found: ' + abs);
    const json = JSON.parse(fs.readFileSync(abs, 'utf8'));
    if (json.project_id && json.project_id !== projectId) {
      throw new Error(
        'Service-account project mismatch: the credentials file belongs to "' +
        json.project_id + '" but --project is "' + projectId + '". Refusing to continue.'
      );
    }
    credential = admin.credential.cert(json);
    credentialSource = abs;
  }

  const app = admin.apps.length && admin.apps[0]
    ? admin.apps[0]
    : admin.initializeApp(Object.assign({ projectId }, credential ? { credential } : {}));

  if (!quiet) {
    console.error('[provision] project: ' + projectId);
    console.error('[provision] mode: ' + (emulator ? 'EMULATORS (' + JSON.stringify(emulatorHosts()) + ')' : 'LIVE Firebase'));
    console.error('[provision] credentials: ' + credentialSource);
  }

  return { admin, app, auth: app.auth(), db: app.firestore(), emulator };
}

/* ------------------------------------------------------------- discovery -- */

async function listAllAuthUsers(auth) {
  const users = [];
  let pageToken;
  do {
    const res = await auth.listUsers(1000, pageToken);
    res.users.forEach((u) => users.push(u));
    pageToken = res.pageToken;
  } while (pageToken);
  return users.map((u) => ({
    uid: u.uid,
    email: u.email || null,
    displayName: u.displayName || null,
    disabled: !!u.disabled,
    emailVerified: !!u.emailVerified,
    providers: (u.providerData || []).map((p) => p.providerId),
    hasPassword: !!(u.passwordHash || (u.providerData || []).some((p) => p.providerId === 'password') ||
      (u.providerData || []).length === 0), // emulator does not always return passwordHash
    createdAt: u.metadata && u.metadata.creationTime ? u.metadata.creationTime : null,
  }));
}

async function listAllProfiles(db) {
  const snap = await db.collection('users').get();
  const out = [];
  for (const doc of snap.docs) {
    const data = doc.data() || {};
    let txnCount = null;
    try {
      const txns = await doc.ref.collection('transactions').get();
      txnCount = txns.size;
    } catch (e) { txnCount = null; }
    out.push(Object.assign({ id: doc.id, txnCount }, data));
  }
  return out;
}

async function listJobs(db) {
  const snap = await db.collection('jobs').get();
  return snap.docs.map((d) => Object.assign({ id: d.id }, d.data() || {}));
}

async function discoverLive({ auth, db, scope = 'live' }) {
  const [authUsers, profiles, jobs] = await Promise.all([
    listAllAuthUsers(auth),
    listAllProfiles(db),
    listJobs(db).catch(() => []),
  ]);
  return { authUsers, profiles, jobs, scope };
}

/* ------------------------------------------------------------ write paths -- */

// Create a student Auth account. Idempotent: an existing account is reported,
// never modified (so a rerun can NEVER reset a password).
async function createAuthUser({ auth, identifier, password, fullName }) {
  try {
    const user = await auth.createUser({
      email: identifier,
      emailVerified: true, // no verification mail for a synthetic identifier
      password,
      displayName: fullName,
      disabled: false,
    });
    return { created: true, uid: user.uid, email: user.email };
  } catch (e) {
    if (e && (e.code === 'auth/email-already-exists' || /already exists/i.test(e.message || ''))) {
      const existing = await auth.getUserByEmail(identifier);
      return {
        created: false,
        skipped: 'auth-account-exists',
        uid: existing.uid,
        email: existing.email,
        hasPassword: !!(existing.passwordHash || (existing.providerData || []).length === 0),
        providers: (existing.providerData || []).map((p) => p.providerId),
      };
    }
    throw e;
  }
}

// Pre-authorized profile — the SAME shape the app writes (rules-compatible).
async function createProfile({ db, identifier, fullName }) {
  const ref = db.collection('users').doc(identifier);
  const snap = await ref.get();
  if (snap.exists) {
    const d = snap.data() || {};
    return {
      created: false,
      skipped: 'profile-exists',
      role: d.role || 'student',
      balancePaise: d.balancePaise,
      txnSeq: d.txnSeq,
    };
  }
  await ref.set({
    email: identifier,
    role: 'student',
    full_name: fullName,
    avatar: '',
    balancePaise: 0,
    balance: 0,
    txnSeq: 0,
    createdAt: new Date(),
  });
  return { created: true };
}

// v3.5.2 protocol: every user document needs an integer txnSeq for verified
// withdrawal/credit/reversal batches. Backfill ONLY the missing field, never
// touching a balance (and only when the caller is applying).
async function backfillTxnSeq({ db, ids }) {
  const done = [];
  for (const id of ids) {
    const ref = db.collection('users').doc(id);
    const snap = await ref.get();
    if (!snap.exists) { done.push({ id, skipped: 'missing' }); continue; }
    const d = snap.data() || {};
    if (Number.isInteger(d.txnSeq)) { done.push({ id, skipped: 'already-set' }); continue; }
    await ref.update({ txnSeq: 0 });
    done.push({ id, set: true });
  }
  return done;
}

async function resetStudentPassword({ auth, identifier, password }) {
  const user = await auth.getUserByEmail(identifier);
  await auth.updateUser(user.uid, { password });
  return { uid: user.uid, email: user.email };
}

async function deleteAuthUser({ auth, uid }) {
  await auth.deleteUser(uid);
}

/* ------------------------------------------- ledger copy (identity move) -- */

// Copy a student's ledger verbatim (same document IDs, same fields) and export
// a local backup of everything the migration will touch.
async function exportIdentityBackup({ db, ids, dir }) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, 'jkss-identity-backup-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json');
  const payload = { createdAt: new Date().toISOString(), users: {} };
  for (const id of ids) {
    const ref = db.collection('users').doc(id);
    const snap = await ref.get();
    const txns = await ref.collection('transactions').get();
    payload.users[id] = {
      profile: snap.exists ? snap.data() : null,
      transactions: txns.docs.map((d) => ({ id: d.id, data: d.data() })),
    };
  }
  fs.writeFileSync(file, JSON.stringify(payload, null, 2) + '\n', { mode: 0o600 });
  fs.chmodSync(file, 0o600);
  return file;
}

async function copyLedger({ db, fromId, toId }) {
  const src = db.collection('users').doc(fromId).collection('transactions');
  const dest = db.collection('users').doc(toId).collection('transactions');
  const snap = await src.get();
  let copied = 0;
  for (const doc of snap.docs) {
    const existing = await dest.doc(doc.id).get();
    if (existing.exists) continue; // idempotent rerun
    await dest.doc(doc.id).set(doc.data());
    copied += 1;
  }
  return { total: snap.size, copied };
}

/* --------------------------------------------------- identifier preflight -- */

// Identity Toolkit REST sign-in — the exact endpoint the Firebase client SDKs
// use, so this verifies that Firebase Authentication ACCEPTS the identifier
// format and the password, end to end.
async function signInWithPassword({ identifier, password, apiKey, timeoutMs = 20000 }) {
  const host = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  const base = host
    ? 'http://' + host + '/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword'
    : 'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword';
  const key = host ? (apiKey || 'emulator-key') : apiKey;
  if (!key) throw new Error('No Web API key available (pass --api-key or use google-services.json)');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(base + '?key=' + encodeURIComponent(key), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: identifier, password, returnSecureToken: true }),
      signal: controller.signal,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const code = (body && body.error && body.error.message) || ('HTTP ' + res.status);
      return { ok: false, code };
    }
    return { ok: true, localId: body.localId, idToken: body.idToken, email: body.email };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  REPO_ROOT,
  GOOGLE_SERVICES_JSON,
  loadAdminSdk,
  emulatorHosts,
  isEmulatorMode,
  readProjectConfig,
  initAdmin,
  listAllAuthUsers,
  listAllProfiles,
  listJobs,
  discoverLive,
  createAuthUser,
  createProfile,
  backfillTxnSeq,
  resetStudentPassword,
  deleteAuthUser,
  exportIdentityBackup,
  copyLedger,
  signInWithPassword,
};
