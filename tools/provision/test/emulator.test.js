// tools/provision/test/emulator.test.js
// ============================================================================
// END-TO-END PROVISIONING TEST against the Firebase **Auth + Firestore
// EMULATORS** (a non-production environment — no production project, no real
// credentials, no real accounts).
// ============================================================================
//
// It runs the REAL CLI (tools/provision/provision.js) as a child process
// against a production-shaped seed (two admin documents, a legacy real-email
// student with a balance + ledger, a former student, a job) and asserts:
//
//   * dry runs write nothing to the project,
//   * `apply` creates 23 unique student accounts with unique random passwords,
//   * the admin Auth account + password and BOTH admin documents are preserved
//     (only the missing txnSeq field is added),
//   * existing balances, roles and ledger records are untouched,
//   * a rerun changes nothing and never resets a password,
//   * sign-in works with a correct password and is rejected with a wrong one,
//   * an account WITHOUT a pre-authorized profile cannot reach a profile,
//   * plaintext passwords never reach Firestore,
//   * password reset and legacy identity migration work and are idempotent,
//   * (section 11, last) the opt-in shared initial password works and is safe:
//     bad files are refused, nothing is printed or stored, reruns never change an
//     existing password, and an unrostered synthetic identity blocks writes.
//
// Run (via firebase-tools, which provides Java + the emulators):
//   cd firebase
//   firebase emulators:exec --project jkss-fund-e2e --only firestore,auth \
//     "node ../tools/provision/test/emulator.test.js"
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';

const PROJECT = process.env.GCLOUD_PROJECT || process.env.FIREBASE_PROJECT || 'jkss-fund-e2e';
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const CLI = path.join(REPO_ROOT, 'tools', 'provision', 'provision.js');
const ROSTER = path.join(REPO_ROOT, 'tools', 'provision', 'roster.json');
const identity = require(path.join(REPO_ROOT, 'mobile', 'src', 'identity.js'));
const { readCredentials, modeOf } = require('../lib/credentials');
const { signInWithPassword } = require('../lib/firebase');
const planLib = require('../lib/plan');
const sharedPwLib = require(path.join(REPO_ROOT, 'tools', 'provision', 'lib', 'shared-password.js'));

const admin = require('firebase-admin');
const app = admin.initializeApp({ projectId: PROJECT });
const auth = app.auth();
const db = app.firestore();

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'jkss-e2e-'));
const OUT = path.join(TMP, 'reports');
const CRED_FILE = path.join(TMP, 'credentials.json');

const ADMIN_EMAIL = 'thrikkakarajkss@gmail.com';
const ADMIN_PASSWORD = 'AdminPass123!';
const LEGACY_ID = 'old.student@gmail.com';
const LEGACY_PASSWORD = 'LegacyPass1!';
const LEGACY_TXNS = ['earn_j1_' + LEGACY_ID, 'earn_j2_' + LEGACY_ID, 'w_' + LEGACY_ID + '_1', 'w_' + LEGACY_ID + '_2', 'rev_j9_' + LEGACY_ID];

let pass = 0;
let fail = 0;
// Read ONE document through the Firestore emulator REST API as a signed-in
// account, using its real ID token from the Auth emulator. The emulator
// evaluates firebase/firestore.rules for that token, so this is the end-to-end
// proof of the student gate. Returns the HTTP status: 200 = the rules allowed
// the read, 403 = the rules denied it.
async function restGet(idToken, docPath) {
  const url = 'http://' + process.env.FIRESTORE_EMULATOR_HOST + '/v1/projects/' + PROJECT +
    '/databases/(default)/documents/' + docPath;
  const res = await fetch(url, { headers: { Authorization: 'Bearer ' + idToken } });
  return res.status;
}
// '@' is a legal path character, so keep it literal (no %40 for the emulator to decode).
const enc = (id) => encodeURI(id);

// A fresh random shared-style password that satisfies the tool's own rules
// (generated at run time: it is never written into the repository).
function freshSharedPassword() {
  const sp = require(path.join(REPO_ROOT, 'tools', 'provision', 'lib', 'shared-password.js'));
  const roster = planLib.buildRoster(JSON.parse(fs.readFileSync(ROSTER, 'utf8')));
  for (;;) {
    const pw = require('crypto').randomBytes(12).toString('base64url').slice(0, 14) + 'A7';
    if (sp.validateSharedPassword(pw, { students: roster }).ok) return pw;
  }
}
// Empties the Auth and Firestore EMULATOR project (documented emulator reset
// endpoints; never a real project). Used only for the last section.
async function clearEmulatorProject() {
  const a = await fetch('http://' + process.env.FIREBASE_AUTH_EMULATOR_HOST + '/emulator/v1/projects/' + PROJECT + '/accounts', { method: 'DELETE' });
  const f = await fetch('http://' + process.env.FIRESTORE_EMULATOR_HOST + '/emulator/v1/projects/' + PROJECT + '/databases/(default)/documents', { method: 'DELETE' });
  if (!a.ok || !f.ok) throw new Error('could not clear the emulator (auth ' + a.status + ', firestore ' + f.status + ')');
}

async function check(name, fn) {
  try {
    await fn();
    pass++;
    console.log('  PASS  ' + name);
  } catch (e) {
    fail++;
    console.log('  FAIL  ' + name + '  →  ' + (e && e.message));
  }
}
function eq(a, b, msg) {
  if (a !== b) throw new Error((msg || 'eq') + ': ' + JSON.stringify(a) + ' !== ' + JSON.stringify(b));
}
function ok(v, msg) { if (!v) throw new Error(msg || 'expected truthy'); }
function deepEq(a, b, msg) {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error((msg || 'deepEq') + ':\n  ' + JSON.stringify(a) + '\n  ' + JSON.stringify(b));
  }
}

function run(args, { expect = 0 } = {}) {
  const res = spawnSync(process.execPath, [CLI].concat(args), {
    cwd: REPO_ROOT,
    env: Object.assign({}, process.env, {
      FIREBASE_AUTH_EMULATOR_HOST: process.env.FIREBASE_AUTH_EMULATOR_HOST,
      FIRESTORE_EMULATOR_HOST: process.env.FIRESTORE_EMULATOR_HOST,
    }),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const out = res.stdout || '';
  const err = res.stderr || '';
  return {
    code: res.status,
    stdout: out,
    stderr: err,
    json() {
      const start = out.indexOf('{');
      if (start === -1) throw new Error('no JSON in stdout:\n' + out + '\n' + err);
      return JSON.parse(out.slice(start));
    },
    expectCode(expected = expect) {
      if (res.status !== expected) {
        throw new Error('expected exit ' + expected + ', got ' + res.status + '\nstdout:\n' + out + '\nstderr:\n' + err);
      }
      return this;
    },
  };
}

async function snapshotUsers() {
  const snap = await db.collection('users').get();
  const out = {};
  for (const d of snap.docs) {
    const txns = await d.ref.collection('transactions').get();
    out[d.id] = { data: d.data(), txns: txns.docs.map((t) => ({ id: t.id, data: t.data() })).sort((a, b) => a.id.localeCompare(b.id)) };
  }
  return out;
}
async function authEmails() {
  const list = await auth.listUsers(1000);
  return list.users.map((u) => u.email).sort();
}
async function countUsers() {
  const snap = await db.collection('users').get();
  return snap.size;
}

(async () => {
  console.log('tools/provision — end-to-end provisioning against the Firebase emulators');
  console.log('project: ' + PROJECT + '   auth: ' + process.env.FIREBASE_AUTH_EMULATOR_HOST +
    '   firestore: ' + process.env.FIRESTORE_EMULATOR_HOST);

  /* ------------------------------ seed ---------------------------------- */
  await auth.createUser({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD, emailVerified: true, displayName: 'Admin' });
  await auth.createUser({ email: LEGACY_ID, password: LEGACY_PASSWORD, emailVerified: true, displayName: 'Salman' });

  await db.collection('users').doc('thrikkakarajkss').set({
    email: ADMIN_EMAIL, role: 'admin', full_name: 'Thrikkakara JKSS', avatar: '', balancePaise: 0, balance: 0, txnSeq: 0,
  });
  await db.collection('users').doc(ADMIN_EMAIL).set({
    email: ADMIN_EMAIL, role: 'admin', full_name: 'Admin', avatar: '', balancePaise: 0, balance: 0,
  });
  await db.collection('users').doc(LEGACY_ID).set({
    email: LEGACY_ID, role: 'student', full_name: 'Salman', avatar: '', balancePaise: 12345, balance: 123.45, txnSeq: 3,
  });
  for (let i = 0; i < LEGACY_TXNS.length; i++) {
    await db.collection('users').doc(LEGACY_ID).collection('transactions').doc(LEGACY_TXNS[i]).set({
      type: i % 2 ? 'withdrawal' : 'earning', studentId: LEGACY_ID, amountPaise: 100 + i, amount: (100 + i) / 100,
    });
  }
  await db.collection('users').doc('former@gmail.com').set({
    email: 'former@gmail.com', role: 'student', full_name: 'Zaid', avatar: '', balancePaise: 250, balance: 2.5, txnSeq: 0,
  });
  await db.collection('jobs').doc('j1').set({
    name: 'Legacy job', date: '2026-01-01', status: 'active',
    amountPaise: 100000, committeeSharePaise: 10000, studentSharePaise: 90000, studentCount: 2,
    allocations: { [LEGACY_ID]: 87755, 'former@gmail.com': 2245 },
  });
  await db.collection('meta').doc('committee').set({ balancePaise: 1000, balance: 10 });

  const seed = await snapshotUsers();

  /* --------------------------- 1. offline plan -------------------------- */
  let planOffline;
  await check('offline `plan` needs no credentials and creates no Auth user', () => {
    const r = run(['plan', '--roster', ROSTER]).expectCode(0);
    ok(r.stdout.includes('Internal identifier'), 'mapping table missing');
    ok(r.stdout.includes('offline'), 'should be flagged offline');
    return authEmails().then((emails) => eq(emails.length, 2, 'offline plan must not create Auth users'));
  });

  /* ------------------------- 2. live plan (emulator) -------------------- */
  await check('`plan --project` reports 23 creatable + 1 held (legacy) + both admin docs preserved', () => {
    const r = run(['plan', '--project', PROJECT, '--roster', ROSTER, '--out', OUT, '--json']).expectCode(0);
    planOffline = r.json();
    eq(planOffline.scope, 'emulators');
    eq(planOffline.summary.rosterSize, 24);
    eq(planOffline.summary.toCreate, 23);
    eq(planOffline.summary.heldForMigration, 1);
    eq(planOffline.summary.needsReview, 0);
    eq(planOffline.summary.adminProfiles, 2);
    eq(planOffline.summary.unmatchedProfiles.length, 1);
    eq(planOffline.summary.unmatchedProfiles[0].id, 'former@gmail.com');
    const salman = planOffline.students.find((s) => s.name === 'Salman');
    eq(salman.createAllowed, false);
    eq(salman.legacyProfileId, LEGACY_ID);
    eq(salman.legacyMatch.balancePaise, 12345);
    eq(salman.legacyMatch.txnCount, LEGACY_TXNS.length);
    const midlaj = planOffline.students.find((s) => s.name === 'Midlaj');
    eq(midlaj.identifier, identity.identifierFor('midlaj'));
    return null;
  });
  await check('plan wrote a JSON report file and still created nothing', async () => {
    const files = fs.readdirSync(OUT).filter((f) => f.endsWith('.json'));
    eq(files.length, 1);
    eq(await countUsers(), 4, 'Firestore must be untouched');
    eq(fs.existsSync(CRED_FILE), false, 'no credentials file on a plan run');
  });

  /* --------------------------- 3. dry-run apply ------------------------- */
  await check('`apply` WITHOUT --apply is a dry run (no Auth users, no creds file)', async () => {
    const r = run(['apply', '--project', PROJECT, '--roster', ROSTER, '--out', OUT, '--credentials-file', CRED_FILE]).expectCode(0);
    ok(/DRY RUN/.test(r.stdout), 'must say DRY RUN');
    eq((await authEmails()).length, 2);
    eq(await countUsers(), 4);
    eq(fs.existsSync(CRED_FILE), false);
  });

  /* ----------------------------- 4. apply ------------------------------- */
  let applied = null;
  const createdPasswords = new Map();
  await check('`apply --apply` creates 23 Auth accounts + 23 pre-authorized profiles', async () => {
    const r = run(['apply', '--project', PROJECT, '--roster', ROSTER, '--out', OUT, '--credentials-file', CRED_FILE, '--apply']).expectCode(0);
    ok(/APPLY COMPLETE/.test(r.stdout));
    const emails = await authEmails();
    eq(emails.length, 25, 'admin + legacy + 23 students');
    eq(emails.filter((e) => identity.isStudentIdentifier(e)).length, 23);
    eq(await countUsers(), 27);
    const creds = readCredentials(CRED_FILE);
    applied = creds;
    eq(creds.students.length, 23);
    creds.students.forEach((s) => {
      ok(s.password && s.password.length >= 16, 'weak password for ' + s.username);
      eq(identity.identifierFor(s.username), s.identifier);
      ok(identity.validatePasswordPolicy(s.password, { username: s.username, name: s.name }).ok, 'policy: ' + s.username);
      createdPasswords.set(s.username, s.password);
    });
    eq(new Set(creds.students.map((s) => s.password)).size, 23, 'passwords must all differ');
  });
  await check('credentials file is 0600 and contains no Firestore copy', async () => {
    eq(modeOf(CRED_FILE), '600');
    const all = JSON.stringify(await snapshotUsers());
    createdPasswords.forEach((pw, username) => {
      if (all.includes(pw)) throw new Error('plaintext password for ' + username + ' found in Firestore');
    });
  });
  await check('created profile documents match the app/rules shape exactly', async () => {
    const ALLOWED = ['email', 'role', 'full_name', 'avatar', 'balancePaise', 'balance', 'txnSeq', 'createdAt'];
    const snap = await db.collection('users').doc(identity.identifierFor('midlaj')).get();
    ok(snap.exists);
    const d = snap.data();
    eq(Object.keys(d).sort().join(','), ALLOWED.sort().join(','));
    eq(d.email, identity.identifierFor('midlaj'));
    eq(d.role, 'student');
    eq(d.full_name, 'Midlaj');
    eq(d.balancePaise, 0);
    eq(d.balance, 0);
    eq(d.txnSeq, 0);
  });
  await check('both admin documents preserved; only the missing txnSeq:0 was added', async () => {
    const before = seed['thrikkakarajkss'];
    const after = (await snapshotUsers())['thrikkakarajkss'];
    deepEq(after.data, before.data, 'legacy-id admin doc must be untouched');
    const adminAfter = (await snapshotUsers())[ADMIN_EMAIL];
    const adminBefore = seed[ADMIN_EMAIL];
    eq(adminAfter.data.txnSeq, 0, 'txnSeq:0 must be added where missing');
    const strip = (o) => { const c = Object.assign({}, o); delete c.txnSeq; return c; };
    deepEq(strip(adminAfter.data), strip(adminBefore.data), 'no other admin field may change');
    eq(adminAfter.data.role, 'admin');
    eq((adminAfter.data.balancePaise || 0), 0);
  });
  await check('legacy student profile + ledger untouched by apply', async () => {
    const after = (await snapshotUsers())[LEGACY_ID];
    deepEq(after.data, seed[LEGACY_ID].data, 'legacy student doc must be byte-identical');
    deepEq(after.txns, seed[LEGACY_ID].txns, 'legacy ledger must be byte-identical');
    eq(after.data.balancePaise, 12345);
    eq(after.data.txnSeq, 3);
  });
  await check('unmatched (former) student untouched', async () => {
    const after = (await snapshotUsers())['former@gmail.com'];
    deepEq(after.data, seed['former@gmail.com'].data);
  });
  await check('job + committee documents untouched', async () => {
    const j = await db.collection('jobs').doc('j1').get();
    eq(j.data().allocations[LEGACY_ID], 87755);
    eq(j.data().status, 'active');
    const c = await db.collection('meta').doc('committee').get();
    eq(c.data().balancePaise, 1000);
  });

  /* --------------------------- 5. rerun safety -------------------------- */
  const credBytes = fs.readFileSync(CRED_FILE, 'utf8');
  await check('rerunning `apply --apply` is idempotent (no new users, no password resets)', async () => {
    const r = run(['apply', '--project', PROJECT, '--roster', ROSTER, '--out', OUT, '--credentials-file', CRED_FILE, '--apply']).expectCode(0);
    ok(/APPLY COMPLETE/.test(r.stdout));
    eq((await authEmails()).length, 25, 'no duplicate accounts');
    eq(await countUsers(), 27, 'no duplicate profiles');
    eq(fs.readFileSync(CRED_FILE, 'utf8'), credBytes, 'credentials file must be untouched');
  });
  await check('after the rerun the ORIGINAL passwords still work (never reset)', async () => {
    for (const username of ['sayyid.zain', 'muhsin.chelakkulam', 'adil.jr']) {
      const res = await signInWithPassword({ identifier: identity.identifierFor(username), password: createdPasswords.get(username) });
      ok(res.ok, 'password reset detected for ' + username + ' (' + res.code + ')');
    }
  });

  /* ------------------------------ 6. login ------------------------------ */
  await check('VALID password signs in (student)', async () => {
    const res = await signInWithPassword({ identifier: identity.identifierFor('sayyid.zain'), password: createdPasswords.get('sayyid.zain') });
    ok(res.ok, 'sign-in failed: ' + res.code);
    ok(res.idToken, 'no idToken returned');
  });
  await check('INVALID password is rejected (student)', async () => {
    const res = await signInWithPassword({ identifier: identity.identifierFor('sayyid.zain'), password: createdPasswords.get('sayyid.zain') + 'x' });
    eq(res.ok, false, 'a wrong password must never sign in');
  });
  await check('an unknown username is rejected', async () => {
    const res = await signInWithPassword({ identifier: identity.identifierFor('nosuchstudent'), password: 'Whatever1!' });
    eq(res.ok, false);
  });
  await check('the EXISTING admin account + password are preserved', async () => {
    const res = await signInWithPassword({ identifier: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    ok(res.ok, 'admin sign-in broken: ' + res.code);
  });
  await check('an account WITHOUT a pre-authorized profile has no profile (unauthorized student)', async () => {
    await auth.createUser({ email: identity.identifierFor('unauthorized'), password: 'Rogue123!x', emailVerified: true });
    const res = await signInWithPassword({ identifier: identity.identifierFor('unauthorized'), password: 'Rogue123!x' });
    ok(res.ok, 'the account itself can sign in (documents the gate)');
    const snap = await db.collection('users').doc(identity.identifierFor('unauthorized')).get();
    eq(snap.exists, false, 'NO profile may exist for an account the admin never authorized');
  });

  /* ------------------- 6b. the student gate, through the rules ------------ */
  // Every check below uses a real ID token minted by the Auth emulator and
  // the rules in firebase/firestore.rules (loaded by `firebase emulators:exec`).
  await check('rules: a pre-authorized, verified username student reads its own profile and the committee', async () => {
    const id = identity.identifierFor('sayyid.zain');
    const res = await signInWithPassword({ identifier: id, password: createdPasswords.get('sayyid.zain') });
    ok(res.ok, 'sign-in failed: ' + res.code);
    eq(await restGet(res.idToken, 'users/' + enc(id)), 200, 'own profile must be readable');
    eq(await restGet(res.idToken, 'meta/committee'), 200, 'committee must be readable');
  });
  await check('rules: that username student is DENIED another student profile', async () => {
    const res = await signInWithPassword({ identifier: identity.identifierFor('sayyid.zain'), password: createdPasswords.get('sayyid.zain') });
    ok(res.ok, 'sign-in failed: ' + res.code);
    eq(await restGet(res.idToken, 'users/' + enc(identity.identifierFor('shafi'))), 403, 'another profile');
  });
  await check('rules: an UNPROVISIONED account (no profile) is denied the committee and profiles', async () => {
    const id = identity.identifierFor('unauthorized');
    const res = await signInWithPassword({ identifier: id, password: 'Rogue123!x' });
    ok(res.ok, 'sign-in failed: ' + res.code);
    eq(await restGet(res.idToken, 'meta/committee'), 403, 'committee');
    eq(await restGet(res.idToken, 'users/' + enc(id)), 403, 'own (missing) profile');
  });
  await check('rules: a pre-authorized profile with an UNVERIFIED email is denied (squatter)', async () => {
    // The admin pre-authorizes a student; someone then self-registers the same
    // address WITHOUT verifying it. The profile exists, but the token says
    // email_verified: false, so the gate must still refuse.
    const id = identity.identifierFor('squatter');
    const password = 'Squat123!x';
    await db.collection('users').doc(id).set({
      email: id, role: 'student', full_name: 'Squatter', avatar: '',
      balancePaise: 0, balance: 0, txnSeq: 0, createdAt: Date.now(),
    });
    try {
      const user = await auth.createUser({ email: id, password, emailVerified: false });
      const res = await signInWithPassword({ identifier: id, password });
      ok(res.ok, 'sign-in failed: ' + res.code);
      eq(await restGet(res.idToken, 'meta/committee'), 403, 'committee');
      eq(await restGet(res.idToken, 'users/' + enc(id)), 403, 'own profile');
      await auth.deleteUser(user.uid);
    } finally {
      // Remove the squatter fixture so later plan/apply checks see the real roster only.
      await db.collection('users').doc(id).delete();
    }
  });
  await check('rules: a HELD legacy account (profile, no authorization) is denied its own profile and the committee', async () => {
    const res = await signInWithPassword({ identifier: LEGACY_ID, password: LEGACY_PASSWORD });
    ok(res.ok, 'sign-in failed: ' + res.code);
    eq(await restGet(res.idToken, 'users/' + enc(LEGACY_ID)), 403, 'held own profile');
    eq(await restGet(res.idToken, 'meta/committee'), 403, 'held committee');
  });
  await check('rules: the ADMIN keeps its access (own profile, committee, roster)', async () => {
    const res = await signInWithPassword({ identifier: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    ok(res.ok, 'admin sign-in failed: ' + res.code);
    eq(await restGet(res.idToken, 'users/' + enc(ADMIN_EMAIL)), 200, 'admin own profile');
    eq(await restGet(res.idToken, 'meta/committee'), 200, 'committee');
    eq(await restGet(res.idToken, 'users'), 200, 'roster');
  });

  /* -------------------------- 7. verify-identifier ---------------------- */
  await check('verify-identifier passes against the non-production environment', () => {
    const r = run(['verify-identifier', '--project', PROJECT]).expectCode(0);
    ok(/IDENTIFIER FORMAT VERIFIED/.test(r.stdout), r.stdout);
    return null;
  });
  await check('verify-identifier leaves no throwaway account behind', async () => {
    const emails = await authEmails();
    eq(emails.filter((e) => e.includes('__preflight')).length, 0);
  });
  await check('verify-identifier REFUSES the production project id', () => {
    const r = run(['verify-identifier', '--project', 'jkss-fund']);
    ok(r.code !== 0, 'must refuse production');
    ok(/NON-PRODUCTION/.test(r.stderr + r.stdout));
    return null;
  });

  /* --------------------------- 8. reset-password ------------------------ */
  await check('reset-password without --apply changes nothing', async () => {
    const r = run(['reset-password', '--username', 'shafi', '--project', PROJECT]).expectCode(0);
    ok(/DRY RUN/.test(r.stdout));
    const res = await signInWithPassword({ identifier: identity.identifierFor('shafi'), password: createdPasswords.get('shafi') });
    ok(res.ok, 'the old password must still work');
  });
  await check('reset-password --apply issues a NEW random password (old one dies)', async () => {
    const r = run(['reset-password', '--username', 'shafi', '--project', PROJECT, '--credentials-file', CRED_FILE, '--apply']).expectCode(0);
    ok(/RESET COMPLETE/.test(r.stdout));
    const creds = readCredentials(CRED_FILE);
    const shafi = creds.students.find((s) => s.username === 'shafi');
    ok(shafi.password !== createdPasswords.get('shafi'), 'password must change');
    eq(creds.passwordResets.length, 1);
    const good = await signInWithPassword({ identifier: identity.identifierFor('shafi'), password: shafi.password });
    ok(good.ok, 'new password rejected: ' + good.code);
    const old = await signInWithPassword({ identifier: identity.identifierFor('shafi'), password: createdPasswords.get('shafi') });
    eq(old.ok, false, 'the old password must stop working');
    createdPasswords.set('shafi', shafi.password);
  });

  /* ------------------------- 9. migrate-identity ------------------------ */
  await check('migrate-identity dry run changes nothing', async () => {
    const r = run(['migrate-identity', '--legacy', LEGACY_ID, '--username', 'salman', '--project', PROJECT, '--out', OUT]).expectCode(0);
    ok(/DRY RUN/.test(r.stdout));
    eq((await snapshotUsers())[LEGACY_ID].data.balancePaise, 12345);
    const target = await db.collection('users').doc(identity.identifierFor('salman')).get();
    eq(target.exists, false);
  });
  await check('migrate-identity --apply moves the balance + ledger and tombstones the legacy doc', async () => {
    const r = run(['migrate-identity', '--legacy', LEGACY_ID, '--username', 'salman', '--project', PROJECT, '--credentials-file', CRED_FILE, '--out', OUT, '--apply']).expectCode(0);
    ok(/MIGRATION COMPLETE/.test(r.stdout));
    const users = await snapshotUsers();
    const legacy = users[LEGACY_ID];
    const target = users[identity.identifierFor('salman')];
    eq(legacy.data.balancePaise, 0, 'legacy balance must be moved out');
    ok(legacy.data.removedAt, 'legacy doc must be tombstoned (never deleted)');
    eq(legacy.data.migratedTo, identity.identifierFor('salman'));
    eq(legacy.txns.length, LEGACY_TXNS.length + 1, 'adjustment entry appended to the legacy ledger');
    eq(target.data.balancePaise, 12345);
    eq(target.data.txnSeq, 3);
    eq(target.data.migratedFrom, LEGACY_ID);
    eq(target.data.role, 'student');
    eq(target.txns.length, LEGACY_TXNS.length + 1, 'ledger copied verbatim + transfer entry');
    LEGACY_TXNS.forEach((id) => ok(target.txns.some((t) => t.id === id), 'ledger entry ' + id + ' lost'));
    const backups = fs.readdirSync(path.join(OUT, 'backups'));
    eq(backups.length, 1, 'a pre-migration backup must be written');
    const backup = JSON.parse(fs.readFileSync(path.join(OUT, 'backups', backups[0]), 'utf8'));
    ok(backup.users[LEGACY_ID].profile.balancePaise === 12345, 'backup must hold the pre-migration balance');
    eq(backup.users[LEGACY_ID].transactions.length, LEGACY_TXNS.length);
  });
  await check('after migration the new username signs in (password from the credentials file)', async () => {
    const creds = readCredentials(CRED_FILE);
    const salman = creds.students.find((s) => s.username === 'salman');
    ok(salman && salman.password, 'no credentials recorded for salman');
    const res = await signInWithPassword({ identifier: identity.identifierFor('salman'), password: salman.password });
    ok(res.ok, 'migrated login failed: ' + res.code);
    const oldLogin = await signInWithPassword({ identifier: LEGACY_ID, password: LEGACY_PASSWORD });
    ok(oldLogin.ok, 'the legacy Auth account itself was not deleted (fine, no profile gate exists for it)');
    const snap = await db.collection('users').doc(LEGACY_ID).get();
    ok(snap.data().removedAt, 'legacy profile is tombstoned');
  });
  await check('re-running migrate-identity refuses to overwrite the migrated identity', async () => {
    const r = run(['migrate-identity', '--legacy', LEGACY_ID, '--username', 'salman', '--project', PROJECT, '--apply', '--out', OUT]);
    eq(r.code, 1, 'must refuse');
    ok(/Refusing/.test(r.stdout), r.stdout);
    const target = await db.collection('users').doc(identity.identifierFor('salman')).get();
    eq(target.data().balancePaise, 12345, 'nothing may be overwritten');
  });
  await check('a re-plan no longer holds Salman (he now has his own profile) and creates no duplicate', async () => {
    const r = run(['plan', '--project', PROJECT, '--roster', ROSTER, '--out', OUT, '--json']).expectCode(0);
    const p = r.json();
    const salman = p.students.find((s) => s.name === 'Salman');
    eq(salman.status, 'exists');
    eq(salman.createAllowed, true);
    eq(salman.actions.includes('create-profile'), false);
    eq(p.summary.heldForMigration, 0);
    eq(await countUsers(), 28, 'one migrated profile added, legacy doc kept');
  });

  /* ------------------------- 10. safety gates --------------------------- */
  await check('a LIVE project write without --confirm-project is refused', () => {
    // Emulator hosts disabled => "live" mode => the typo guard must fire
    const res = spawnSync(process.execPath, [CLI, 'apply', '--project', 'jkss-fund', '--roster', ROSTER, '--apply'], {
      cwd: REPO_ROOT,
      env: Object.assign({}, process.env, { FIREBASE_AUTH_EMULATOR_HOST: '', FIRESTORE_EMULATOR_HOST: '' }),
      encoding: 'utf8',
    });
    eq(res.status, 1, 'must refuse');
    ok(/confirm-project/.test(res.stderr + res.stdout));
    return null;
  });
  await check('apply without credentials (live mode) explains the Admin SDK setup', () => {
    // The typo gate is checked FIRST (so a mistake writes nothing); past it,
    // the missing Admin SDK credentials are explained in full.
    const res = spawnSync(process.execPath, [CLI, 'apply', '--project', 'jkss-fund-test',
      '--confirm-project', 'jkss-fund-test', '--apply'], {
      cwd: REPO_ROOT,
      env: Object.assign({}, process.env, {
        FIREBASE_AUTH_EMULATOR_HOST: '', FIRESTORE_EMULATOR_HOST: '', GOOGLE_APPLICATION_CREDENTIALS: '',
      }),
      encoding: 'utf8',
    });
    eq(res.status, 1);
    ok(/No Admin SDK credentials/.test(res.stderr + res.stdout), res.stderr);
    return null;
  });
  await check('unknown flags / unknown commands are rejected', () => {
    const a = spawnSync(process.execPath, [CLI, 'apply', '--aply'], { encoding: 'utf8' });
    eq(a.status, 1);
    ok(/Unknown option/.test(a.stderr));
    const b = spawnSync(process.execPath, [CLI, 'frobnicate'], { encoding: 'utf8' });
    eq(b.status, 2);
    return null;
  });

  /* ------------- 11. opt-in shared initial password (empty project) ----- */
  // Starts from an EMPTY emulator project (sections 1–10 are finished), so the
  // shared mode is tested on its own: 24 new accounts, no legacy profile.
  await clearEmulatorProject();
  eq((await auth.listUsers(1000)).users.length, 0, 'emulator must be empty before section 11');
  const SHARED_CREDS = path.join(TMP, 'shared-credentials.json');
  const SHARED_FILE = path.join(TMP, 'shared-initial-password.txt');
  const BAD_FILE = path.join(TMP, 'bad-shared.txt');
  const OTHER_FILE = path.join(TMP, 'other-shared.txt');
  const SHARED_PW = freshSharedPassword();
  const sharedArgs = (file, extra = []) => ['apply', '--project', PROJECT, '--roster', ROSTER, '--out', OUT,
    '--credentials-file', SHARED_CREDS, '--shared-password-file', file].concat(extra);
  const writeSecret = (file, text) => { fs.writeFileSync(file, text, { mode: 0o600 }); fs.chmodSync(file, 0o600); };
  const signIn = (username, password) => signInWithPassword({ identifier: identity.identifierFor(username), password });

  await check('shared mode: a file readable by others is REFUSED and nothing is written', async () => {
    writeSecret(SHARED_FILE, SHARED_PW + '\n');
    fs.chmodSync(SHARED_FILE, 0o644);
    const r = run(sharedArgs(SHARED_FILE, ['--apply']));
    eq(r.code, 1, 'must refuse');
    ok(/group\/other|chmod 600/.test(r.stderr + r.stdout), 'reason: ' + r.stderr);
    ok(!(r.stdout + r.stderr).includes(SHARED_PW), 'the password must never be printed');
    eq((await auth.listUsers(1000)).users.length, 0, 'no Auth account may be created');
    eq(fs.existsSync(SHARED_CREDS), false, 'no credentials file may be written');
    fs.chmodSync(SHARED_FILE, 0o600);
  });
  await check('shared mode: malformed files are REFUSED (too short, two lines, contains a student name)', async () => {
    const cases = [['short1A', /at least 12/], [SHARED_PW + '\nextra', /exactly one line/], ['Muhsin2026Secure', /must not contain/]];
    for (const [content, re] of cases) {
      writeSecret(BAD_FILE, content + '\n');
      const r = run(sharedArgs(BAD_FILE, ['--apply']));
      eq(r.code, 1, 'must refuse: ' + re);
      ok(re.test(r.stderr + r.stdout), 'reason for ' + re + ': ' + r.stderr);
      ok(!(r.stdout + r.stderr).includes(content), 'the rejected text must never be echoed');
    }
    eq((await auth.listUsers(1000)).users.length, 0, 'still no Auth account');
  });
  await check('shared mode: a DRY RUN validates the file and writes nothing', async () => {
    writeSecret(SHARED_FILE, SHARED_PW + '\n');
    const r = run(sharedArgs(SHARED_FILE)).expectCode(0);
    ok(/DRY RUN/.test(r.stdout), 'must say DRY RUN');
    ok(/owner shared initial password/.test(r.stdout), 'password mode must be shown');
    ok(!(r.stdout + r.stderr).includes(SHARED_PW), 'never printed');
    eq((await auth.listUsers(1000)).users.length, 0, 'a dry run creates nothing');
    eq(await countUsers(), 0, 'a dry run creates no profile');
    eq(fs.existsSync(SHARED_CREDS), false);
  });
  await check('shared mode --apply creates 24 accounts with the SHARED password (sign-in works)', async () => {
    const r = run(sharedArgs(SHARED_FILE, ['--apply'])).expectCode(0);
    ok(/APPLY COMPLETE/.test(r.stdout));
    ok(!(r.stdout + r.stderr).includes(SHARED_PW), 'never printed');
    const emails = (await auth.listUsers(1000)).users.map((u) => u.email);
    eq(emails.length, 24, 'one Auth account per roster student');
    ok(emails.includes(identity.identifierFor('sayyid.zain')), 'Sayyid Zain has an account');
    ok(!emails.includes(identity.identifierFor('thangal')), 'Thangal has no account');
    eq(await countUsers(), 24, 'one pre-authorized profile per student');
    for (const username of ['sayyid.zain', 'adil.jr', 'salman']) {
      const res = await signIn(username, SHARED_PW);
      ok(res.ok, 'shared password must sign in ' + username + ': ' + res.code);
    }
    const wrong = await signIn('adil.jr', SHARED_PW + 'x');
    eq(wrong.ok, false, 'a wrong password is rejected');
  });
  await check('shared mode credentials: 0600, 24 usernames, NO password anywhere in the file or Firestore', async () => {
    eq(modeOf(SHARED_CREDS), '600');
    const text = fs.readFileSync(SHARED_CREDS, 'utf8');
    ok(!text.includes(SHARED_PW), 'the shared password must not be in the credentials file');
    const creds = readCredentials(SHARED_CREDS);
    eq(creds.students.length, 24);
    creds.students.forEach((st) => {
      ok(!('password' in st), 'no password field for ' + st.username);
      eq(st.passwordSource, 'owner-shared-initial', 'source for ' + st.username);
    });
    const docs = JSON.stringify((await db.collection('users').get()).docs.map((d) => d.data()));
    ok(!docs.includes(SHARED_PW), 'the shared password must never reach Firestore');
  });
  await check('shared mode RERUN with a DIFFERENT password changes NO existing account (no reset)', async () => {
    const OTHER = freshSharedPassword();
    ok(OTHER !== SHARED_PW);
    writeSecret(OTHER_FILE, OTHER + '\n');
    const before = fs.readFileSync(SHARED_CREDS, 'utf8');
    run(sharedArgs(OTHER_FILE, ['--apply'])).expectCode(0);
    eq((await auth.listUsers(1000)).users.length, 24, 'no duplicate accounts');
    eq(fs.readFileSync(SHARED_CREDS, 'utf8'), before, 'the credentials file must be untouched');
    ok((await signIn('adil.jr', SHARED_PW)).ok, 'the ORIGINAL shared password still works (never reset)');
    eq((await signIn('adil.jr', OTHER)).ok, false, 'the new file password must NOT have been applied');
  });
  await check('reset-password (explicit) gives ONE student a NEW RANDOM password; the shared one stops working', async () => {
    const r = run(['reset-password', '--username', 'adil.jr', '--project', PROJECT, '--credentials-file', SHARED_CREDS, '--apply']).expectCode(0);
    ok(/RESET COMPLETE/.test(r.stdout));
    ok(!(r.stdout + r.stderr).includes(SHARED_PW), 'never printed');
    const adil = readCredentials(SHARED_CREDS).students.find((st) => st.username === 'adil.jr');
    ok(adil.password && adil.password !== SHARED_PW, 'reset must produce a new password');
    ok((await signIn('adil.jr', adil.password)).ok, 'the new random password signs in');
    eq((await signIn('adil.jr', SHARED_PW)).ok, false, 'the shared password must stop working for that student only');
    ok((await signIn('sayyid.zain', SHARED_PW)).ok, 'other students keep the shared password');
  });
  await check('an UNROSTERED synthetic login blocks apply (nothing written) until --allow-unrostered; it is left untouched', async () => {
    const ORPHAN = identity.identifierFor('thangal');
    await auth.createUser({ email: ORPHAN, password: 'Orphan123!x', emailVerified: true });
    await db.collection('users').doc(ORPHAN).set({
      email: ORPHAN, role: 'student', full_name: 'Thangal', avatar: '', balancePaise: 4200, balance: 42,
    }); // txnSeq deliberately absent: it must stay absent (frozen)
    const before = (await auth.listUsers(1000)).users.length;
    const r = run(sharedArgs(SHARED_FILE, ['--apply']));
    eq(r.code, 1, 'must refuse');
    ok(/not on the roster/.test(r.stderr + r.stdout), 'reason: ' + r.stderr);
    eq((await auth.listUsers(1000)).users.length, before, 'nothing may be written');
    const bal = (await db.collection('users').doc(ORPHAN).get()).data();
    eq(bal.balancePaise, 4200, 'the orphan balance is untouched');
    ok(!('txnSeq' in bal), 'the orphan must not be backfilled');
    run(sharedArgs(SHARED_FILE, ['--apply', '--allow-unrostered'])).expectCode(0);
    eq((await auth.listUsers(1000)).users.length, before, 'still no new account (all 24 exist)');
    const after = (await db.collection('users').doc(ORPHAN).get()).data();
    eq(after.balancePaise, 4200, 'the orphan balance is still untouched with --allow-unrostered');
    ok(!('txnSeq' in after), 'the orphan is still not backfilled with --allow-unrostered');
  });

  /* ----- 12. TEST MODE: short shared password, emulators only (empty project) ----- */
  // The owner's protected local password file can be supplied with
  // SHARED_TEST_PASSWORD_FILE. The tool reads it; this test never prints it. When
  // the variable is not set, a fresh short password is generated for this run.
  await clearEmulatorProject();
  const TM_CREDS = path.join(TMP, 'tm-credentials.json');
  const TM_GENERATED = path.join(TMP, 'tm-shared-password.txt');
  const TM_OTHER = path.join(TMP, 'tm-other-password.txt');
  const crypto = require('crypto');
  const digitPair = () => { const a = crypto.randomInt(10); return String(a) + String((a + 1 + crypto.randomInt(9)) % 10); };
  const TM_FILE = process.env.SHARED_TEST_PASSWORD_FILE || TM_GENERATED;
  let TM_PW = null;
  await check('test mode: the password file is present and passes TEST MODE file rules (value not shown)', () => {
    if (!process.env.SHARED_TEST_PASSWORD_FILE) {
      fs.writeFileSync(TM_GENERATED, 'Adil' + digitPair() + '\n', { mode: 0o600 });
      fs.chmodSync(TM_GENERATED, 0o600);
    }
    // Validates the same way the tool does; a thrown message never contains the password.
    TM_PW = sharedPwLib.readSharedPasswordFile(TM_FILE, { students: planLib.buildRoster(JSON.parse(fs.readFileSync(ROSTER, 'utf8'))), testMode: true }).password;
    ok(TM_PW.length >= 6, 'test password too short for the Firebase Auth floor');
  });
  const tmArgs = (project, file, extra = []) => ['apply', '--project', project, '--roster', ROSTER, '--out', OUT,
    '--credentials-file', TM_CREDS, '--shared-password-file', file, '--test-mode-shared-password'].concat(extra);
  const runEnv = (args, env) => {
    const res = spawnSync(process.execPath, [CLI].concat(args), {
      cwd: REPO_ROOT, env: Object.assign({}, process.env, env), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    });
    return { code: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
  };
  const signInTM = (username, password) => signInWithPassword({ identifier: identity.identifierFor(username), password });

  await check('test mode is REFUSED for the production project even with both emulators active (dry run and --apply)', async () => {
    for (const extra of [[], ['--apply']]) {
      const r = run(tmArgs('jkss-fund', TM_FILE, extra));
      eq(r.code, 1, 'must refuse');
      ok(/PRODUCTION/.test(r.stderr + r.stdout), 'reason: ' + r.stderr);
      ok(!(r.stdout + r.stderr).includes(TM_PW), 'never printed');
    }
    eq((await auth.listUsers(1000)).users.length, 0, 'nothing written anywhere');
    eq(fs.existsSync(TM_CREDS), false, 'no credentials file');
  });
  await check('test mode is REFUSED when the emulators are not configured', async () => {
    const r = runEnv(tmArgs(PROJECT, TM_FILE), { FIREBASE_AUTH_EMULATOR_HOST: '', FIRESTORE_EMULATOR_HOST: '' });
    eq(r.code, 1, 'must refuse');
    ok(/BOTH emulators/.test(r.stderr + r.stdout), 'reason: ' + r.stderr);
  });
  await check('test mode is REFUSED when emulator verification fails (auth emulator not answering)', async () => {
    const r = runEnv(tmArgs(PROJECT, TM_FILE), { FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:1' });
    eq(r.code, 1, 'must refuse');
    ok(/verification failed/.test(r.stderr + r.stdout), 'reason: ' + r.stderr);
    ok(!(r.stdout + r.stderr).includes(TM_PW), 'never printed');
  });
  await check('WITHOUT the test flag the short password is still refused (secure mode unchanged)', async () => {
    const r = run(['apply', '--project', PROJECT, '--roster', ROSTER, '--out', OUT, '--credentials-file', TM_CREDS,
      '--shared-password-file', TM_FILE, '--apply']);
    eq(r.code, 1, 'must refuse');
    ok(/at least 12/.test(r.stderr + r.stdout), 'reason: ' + r.stderr);
    eq((await auth.listUsers(1000)).users.length, 0, 'nothing written');
  });
  await check('TEST MODE dry run: validates, says TEST MODE, writes nothing, never prints the password', async () => {
    const r = run(tmArgs(PROJECT, TM_FILE)).expectCode(0);
    ok(/DRY RUN/.test(r.stdout), 'must say DRY RUN');
    ok(/TEST MODE/.test(r.stdout), 'must say TEST MODE');
    ok(!(r.stdout + r.stderr).includes(TM_PW), 'never printed');
    eq((await auth.listUsers(1000)).users.length, 0, 'a dry run creates nothing');
    eq(await countUsers(), 0, 'no profile');
  });
  await check('TEST MODE --apply creates 24 accounts with the test password; username/password login works', async () => {
    const r = run(tmArgs(PROJECT, TM_FILE, ['--apply'])).expectCode(0);
    ok(/APPLY COMPLETE/.test(r.stdout));
    ok(!(r.stdout + r.stderr).includes(TM_PW), 'never printed');
    eq((await auth.listUsers(1000)).users.length, 24, 'one Auth account per roster student');
    eq(await countUsers(), 24, 'one profile per student');
    for (const username of ['adil.jr', 'sayyid.zain']) {
      const res = await signInTM(username, TM_PW);
      ok(res.ok, 'test password must sign in ' + username + ': ' + res.code);
    }
    eq((await signInTM('adil.jr', TM_PW + 'x')).ok, false, 'a wrong password is rejected');
  });
  await check('TEST MODE credentials: 0600, no password recorded, nothing in Firestore', async () => {
    eq(modeOf(TM_CREDS), '600');
    const text = fs.readFileSync(TM_CREDS, 'utf8');
    ok(!text.includes(TM_PW), 'the password must not be in the credentials file');
    const creds = readCredentials(TM_CREDS);
    eq(creds.students.length, 24);
    creds.students.forEach((st) => { ok(!('password' in st), 'no password for ' + st.username); eq(st.passwordSource, 'owner-shared-initial'); });
    const docs = JSON.stringify((await db.collection('users').get()).docs.map((d) => d.data()));
    ok(!docs.includes(TM_PW), 'the password must never reach Firestore');
  });
  await check('TEST MODE RERUN with a DIFFERENT password never overwrites an existing password', async () => {
    fs.writeFileSync(TM_OTHER, 'Other' + digitPair() + '\n', { mode: 0o600 });
    fs.chmodSync(TM_OTHER, 0o600);
    const OTHER = sharedPwLib.readSharedPasswordFile(TM_OTHER, { testMode: true }).password;
    const before = fs.readFileSync(TM_CREDS, 'utf8');
    run(tmArgs(PROJECT, TM_OTHER, ['--apply'])).expectCode(0);
    eq((await auth.listUsers(1000)).users.length, 24, 'no duplicate accounts');
    eq(fs.readFileSync(TM_CREDS, 'utf8'), before, 'the credentials file must be untouched');
    ok((await signInTM('adil.jr', TM_PW)).ok, 'the ORIGINAL test password still works (never overwritten)');
    eq((await signInTM('adil.jr', OTHER)).ok, false, 'the rerun password must NOT have been applied');
  });

  fs.rmSync(TMP, { recursive: true, force: true });
  await app.delete();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
