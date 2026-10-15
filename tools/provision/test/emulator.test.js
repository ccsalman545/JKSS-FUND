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
//   * dry runs write nothing,
//   * `apply` creates 23 unique student accounts with unique random passwords,
//   * the admin Auth account + password and BOTH admin documents are preserved
//     (only the missing txnSeq field is added),
//   * existing balances, roles and ledger records are untouched,
//   * a rerun changes nothing and never resets a password,
//   * sign-in works with a correct password and is rejected with a wrong one,
//   * an account WITHOUT a pre-authorized profile cannot reach a profile,
//   * plaintext passwords never reach Firestore,
//   * password reset and legacy identity migration work and are idempotent.
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
  await check('offline `plan` needs no credentials and writes nothing', () => {
    const r = run(['plan', '--roster', ROSTER]).expectCode(0);
    ok(r.stdout.includes('Internal identifier'), 'mapping table missing');
    ok(r.stdout.includes('offline'), 'should be flagged offline');
    return authEmails().then((emails) => eq(emails.length, 2, 'offline plan must not create Auth users'));
  });

  /* ------------------------- 2. live plan (emulator) -------------------- */
  await check('`plan --project` reports 23 creatable + 1 held (legacy) + both admin docs preserved', () => {
    const r = run(['plan', '--project', PROJECT, '--roster', ROSTER, '--out', OUT]).expectCode(0);
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
    for (const username of ['thangal', 'muhsin.chelakkulam', 'adil.jr']) {
      const res = await signInWithPassword({ identifier: identity.identifierFor(username), password: createdPasswords.get(username) });
      ok(res.ok, 'password reset detected for ' + username + ' (' + res.code + ')');
    }
  });

  /* ------------------------------ 6. login ------------------------------ */
  await check('VALID password signs in (student)', async () => {
    const res = await signInWithPassword({ identifier: identity.identifierFor('thangal'), password: createdPasswords.get('thangal') });
    ok(res.ok, 'sign-in failed: ' + res.code);
    ok(res.idToken, 'no idToken returned');
  });
  await check('INVALID password is rejected (student)', async () => {
    const res = await signInWithPassword({ identifier: identity.identifierFor('thangal'), password: createdPasswords.get('thangal') + 'x' });
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
    const r = run(['plan', '--project', PROJECT, '--roster', ROSTER, '--out', OUT]).expectCode(0);
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
    const res = spawnSync(process.execPath, [CLI, 'apply', '--project', 'jkss-fund-test', '--apply'], {
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

  fs.rmSync(TMP, { recursive: true, force: true });
  await app.delete();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
