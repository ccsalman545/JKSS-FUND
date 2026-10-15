#!/usr/bin/env node
// tools/provision/provision.js
// ============================================================================
// JKSS-FUND v3.0 — ONE-TIME LOCAL STUDENT ACCOUNT PROVISIONING TOOL
// ============================================================================
//
// Creates the 24 student logins (username + unique random temporary password)
// in Firebase Authentication, pre-authorizes their Firestore profiles, and
// writes the username/password list to a local 0600 file that is git-ignored.
//
// SAFETY MODEL
// ------------
//   * `plan` (the default, and the behaviour of every command without
//     `--apply`) NEVER writes anything.
//   * `--apply` is required for every write. Live (non-emulator) projects
//     additionally require `--confirm-project <projectId>`.
//   * Reruns are idempotent: existing Auth accounts and profiles are reported
//     and SKIPPED — no password is ever reset, no balance/role/ledger field is
//     ever overwritten.
//   * Only `txnSeq: 0` is added, and only where the field is missing.
//   * Ambiguous roster mappings are reported for manual review, never guessed.
//   * Passwords are generated with the CSPRNG, one per student, and exist only
//     in the Admin SDK request + the local credentials file (never in
//     Firestore, never in source control, never in a log by default).
//
// USAGE
//   node provision.js                    # dry-run roster plan (no credentials needed)
//   node provision.js plan --project X   # dry-run plan against a project/emulator
//   node provision.js apply --apply --project X --credentials key.json --confirm-project X
//   node provision.js verify-identifier --project jkss-fund-prelaunch --credentials key.json
//   node provision.js reset-password --username thangal --apply --project X --credentials key.json
//   node provision.js migrate-identity --legacy old@mail.com --username thangal --apply ...
//   node provision.js help
//
// See tools/provision/README.md and docs/USERNAME_LOGIN.md.
'use strict';

const fs = require('fs');
const path = require('path');

const identity = require('../../mobile/src/identity');
const creds = require('./lib/credentials');
const fb = require('./lib/firebase');
const planLib = require('./lib/plan');
const { generateTemporaryPassword } = require('./lib/passwords');
const report = require('./lib/report');

const HERE = __dirname;
const DEFAULT_ROSTER = path.join(HERE, 'roster.json');
const PRODUCTION_PROJECT = 'jkss-fund'; // never allow silent writes here

/* ------------------------------------------------------------------- args -- */

const KNOWN_FLAGS = {
  '--roster': 'value',
  '--project': 'value',
  '--credentials': 'value',
  '--credentials-file': 'value',
  '--confirm-project': 'value',
  '--api-key': 'value',
  '--out': 'value',
  '--legacy': 'value',
  '--username': 'value',
  '--name': 'value',
  '--apply': 'bool',
  '--json': 'bool',
  '--show-passwords': 'bool',
  '--allow-production-check': 'bool',
  '--keep': 'bool',
  '--quiet': 'bool',
  '--help': 'bool',
};

function parseArgs(argv) {
  const args = { command: null, flags: {}, _: [] };
  const list = argv.slice(2);
  for (let i = 0; i < list.length; i++) {
    const token = list[i];
    if (!token.startsWith('--')) {
      if (!args.command) args.command = token;
      else args._.push(token);
      continue;
    }
    const eq = token.indexOf('=');
    const key = eq === -1 ? token : token.slice(0, eq);
    const kind = KNOWN_FLAGS[key];
    if (!kind) throw new Error('Unknown option "' + key + '" (run `node provision.js help`)');
    if (kind === 'bool') {
      args.flags[key] = eq === -1 ? true : token.slice(eq + 1) !== 'false';
    } else {
      const value = eq === -1 ? list[++i] : token.slice(eq + 1);
      if (value == null || value.startsWith('--')) throw new Error(key + ' needs a value');
      args.flags[key] = value;
    }
  }
  if (!args.command) args.command = 'plan';
  return args;
}

function usage() {
  return [
    'JKSS-FUND student account provisioning (v3.0)',
    '',
    'Commands (every command is a DRY RUN unless --apply is passed):',
    '  plan                                    roster → username → identifier plan (default)',
    '  apply                                   create the Auth accounts + pre-authorized profiles',
    '  verify-identifier                       preflight: prove Firebase Auth accepts the identifier format',
    '  reset-password --username <u>            give one student a new random temporary password',
    '  migrate-identity --legacy <id> --username <u>',
    '                                          re-key ONE legacy (real-email) identity to a username',
    '',
    'Options:',
    '  --roster <file>            roster JSON (default tools/provision/roster.json)',
    '  --project <id>             Firebase project id (required for anything live)',
    '  --credentials <file>       service-account JSON (or GOOGLE_APPLICATION_CREDENTIALS)',
    '  --confirm-project <id>     required to write to a LIVE project (typo guard)',
    '  --apply                    actually write (otherwise: dry run)',
    '  --credentials-file <file>  where to write the local username/password list',
    '  --out <dir>                where to write the JSON report',
    '  --json                     print the full JSON plan to stdout',
    '  --show-passwords           print newly generated passwords (they are in the credentials file too)',
    '  --api-key <key>            Web API key for verify-identifier (default: mobile/google-services.json)',
    '  --keep                     verify-identifier: keep the throwaway account (default: delete it)',
    '',
    'Emulator mode: set FIREBASE_AUTH_EMULATOR_HOST / FIRESTORE_EMULATOR_HOST and',
    'no credentials are needed (used by the integration tests).',
  ].join('\n');
}

/* ------------------------------------------------------------------ utils -- */

function loadRoster(file) {
  const abs = path.resolve(file || DEFAULT_ROSTER);
  if (!fs.existsSync(abs)) throw new Error('Roster file not found: ' + abs);
  const json = JSON.parse(fs.readFileSync(abs, 'utf8'));
  const roster = planLib.buildRoster(json);
  if (json.domain && json.domain !== identity.STUDENT_EMAIL_DOMAIN) {
    throw new Error(
      'roster.json declares domain "' + json.domain + '" but the app builds identifiers with "' +
      identity.STUDENT_EMAIL_DOMAIN + '". They must match exactly (see docs/USERNAME_LOGIN.md).'
    );
  }
  return { roster, file: abs, raw: json };
}

function writeReport({ plan, outDir }) {
  const dir = path.resolve(outDir || path.join(HERE, 'reports'));
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(dir, 'plan-' + stamp + '.json');
  fs.writeFileSync(file, JSON.stringify(plan, null, 2) + '\n', { mode: 0o600 });
  return file;
}

// Typos-guard for LIVE writes: emulator runs need no confirmation, a real
// project must be named twice (--project X --confirm-project X). Checked
// BEFORE any credentials/IO so a mistake fails fast and writes nothing.
function requireLiveGate({ flags }) {
  if (fb.isEmulatorMode()) return;
  const project = flags['--project'];
  if (flags['--confirm-project'] !== project) {
    throw new Error(
      'Refusing to write to the LIVE project "' + project + '".\n' +
      'Re-run with: --apply --project ' + project + ' --confirm-project ' + project
    );
  }
}

function credentialsPath(flags) {
  return flags['--credentials-file'] || creds.DEFAULT_FILE;
}

async function loadLive({ flags, roster }) {
  if (!flags['--project']) {
    return { live: { authUsers: [], profiles: [], jobs: [], scope: 'offline (no --project given)' }, handle: null };
  }
  const handle = fb.initAdmin({
    projectId: flags['--project'],
    credentialsPath: flags['--credentials'],
    quiet: !!flags['--quiet'] || !!flags['--json'],
  });
  const live = await fb.discoverLive({ auth: handle.auth, db: handle.db, scope: handle.emulator ? 'emulators' : 'live project' });
  return { live, handle };
}

/* -------------------------------------------------------------- commands -- */

async function cmdPlan(flags) {
  const { roster } = loadRoster(flags['--roster']);
  const { live, handle } = await loadLive({ flags, roster });
  const plan = planLib.buildPlan({
    roster,
    live,
    projectId: flags['--project'] || null,
    domain: identity.STUDENT_EMAIL_DOMAIN,
  });

  if (flags['--json']) {
    process.stdout.write(JSON.stringify(plan, null, 2) + '\n');
  } else {
    console.log(report.renderMappingTable(plan.students));
    console.log('');
    console.log(report.renderPlan(plan));
  }
  const reportFile = writeReport({ plan, outDir: flags['--out'] });
  if (!flags['--json']) console.log('\nJSON report: ' + reportFile);
  if (handle) await handle.app.delete();
  return 0;
}

async function cmdApply(flags) {
  const dryRun = !flags['--apply'];
  const { roster, file: rosterFile } = loadRoster(flags['--roster']);
  if (!flags['--project']) throw new Error('apply needs --project <firebase-project-id>');

  if (!dryRun) requireLiveGate({ flags });
  const { live, handle } = await loadLive({ flags, roster });

  const plan = planLib.buildPlan({
    roster,
    live,
    projectId: flags['--project'],
    domain: identity.STUDENT_EMAIL_DOMAIN,
  });

  if (!flags['--json']) {
    console.log(report.renderMappingTable(plan.students));
    console.log('');
    console.log(report.renderPlan(plan));
    console.log('');
  }

  const held = plan.students.filter((s) => !s.createAllowed);
  const actionable = plan.students.filter((s) => s.createAllowed);

  const result = {
    dryRun,
    project: flags['--project'],
    created: { auth: 0, profiles: 0 },
    skipped: { auth: 0, profiles: 0, held: held.length },
    backfills: { applied: 0, skipped: 0 },
    errors: [],
  };
  const passwordsShown = [];
  const credFile = credentialsPath(flags);
  const data = (dryRun ? creds.emptyCredentials({ project: flags['--project'], domain: identity.STUDENT_EMAIL_DOMAIN, dryRun: true }) : null)
    || creds.readCredentials(credFile)
    || creds.emptyCredentials({ project: flags['--project'], domain: identity.STUDENT_EMAIL_DOMAIN });

  if (held.length && !flags['--json']) {
    console.log('!! ' + held.length + ' student(s) are HELD BACK and will NOT be created (' +
      held.map((s) => s.name + ': ' + s.status).join(', ') + ').');
    held.forEach((s) => (s.notes || []).forEach((n) => console.log('   ' + s.name + ': ' + n)));
    console.log('   roster: ' + rosterFile + '\n');
  }

  for (const st of actionable) {
    try {
      // ---- 1. Auth account --------------------------------------------------
      let authResult = { created: false, skipped: 'dry-run' };
      let password = null;
      if (!dryRun) {
        const recorded = creds.findStudent(data, st.username);
        if (st.auth) {
          authResult = { created: false, skipped: 'auth-account-exists' };
        } else {
          password = generateTemporaryPassword();
          authResult = await fb.createAuthUser({
            auth: handle.auth,
            identifier: st.identifier,
            password,
            fullName: st.name,
          });
          if (!authResult.created) password = null; // raced/exists: never record a wrong password
        }
      }
      if (authResult.created) result.created.auth += 1;
      else result.skipped.auth += 1;

      // ---- 2. Pre-authorized profile ---------------------------------------
      let profileResult = { created: false, skipped: 'dry-run' };
      if (!dryRun) {
        profileResult = await fb.createProfile({
          db: handle.db,
          identifier: st.identifier,
          fullName: st.name,
        });
      }
      if (profileResult.created) result.created.profiles += 1;
      else result.skipped.profiles += 1;

      // ---- 3. Record the credential (never overwrite an existing password) --
      if (!dryRun) {
        const record = {
          index: st.index,
          name: st.name,
          username: st.username,
          identifier: st.identifier,
          status: authResult.created ? 'created' : 'exists',
        };
        if (password) record.password = password;
        const upserted = creds.upsertStudent(data, record);
        if (upserted.keptExistingPassword && !password && !authResult.created) {
          record.status = 'exists';
        }
        if (password) passwordsShown.push({ username: st.username, password });
      }
    } catch (e) {
      result.errors.push({ student: st.name, username: st.username, error: String(e.message || e) });
    }
  }

  // ---- 4. txnSeq:0 backfill (only where missing) --------------------------
  if (!dryRun && plan.txnSeqBackfill.length) {
    const done = await fb.backfillTxnSeq({ db: handle.db, ids: plan.txnSeqBackfill.map((p) => p.id) });
    done.forEach((d) => { if (d.set) result.backfills.applied += 1; else result.backfills.skipped += 1; });
  } else {
    result.backfills.skipped = plan.txnSeqBackfill.length;
  }

  // ---- 5. Credentials + reports -------------------------------------------
  let writtenCredentials = null;
  if (!dryRun && passwordsShown.length) {
    data.project = data.project || flags['--project'];
    data.domain = identity.STUDENT_EMAIL_DOMAIN;
    data.generatedAt = new Date().toISOString();
    writtenCredentials = creds.writeCredentials(credFile, data);
  }

  plan.applyResult = result;
  const reportFile = writeReport({ plan, outDir: flags['--out'] });

  if (flags['--json']) {
    process.stdout.write(JSON.stringify({ plan, result, credentialsFile: writtenCredentials }, null, 2) + '\n');
  } else {
    console.log(report.renderApplyResult({
      project: flags['--project'],
      created: result.created,
      skipped: result.skipped,
      backfills: result.backfills,
      credentialsFile: writtenCredentials,
      dryRun,
      passwordsShown: flags['--show-passwords'] ? passwordsShown : null,
    }));
    if (writtenCredentials && !flags['--show-passwords']) {
      console.log('\nPasswords were written ONLY to the credentials file above (mode 0600).');
      console.log('Re-run with --show-passwords to print them, then delete the file.');
    }
    if (result.errors.length) {
      console.log('\n!! ERRORS (' + result.errors.length + ') — nothing was rolled back for later entries:');
      result.errors.forEach((e) => console.log('   ' + e.student + ': ' + e.error));
    }
    console.log('\nJSON report: ' + reportFile);
  }
  await handle.app.delete();
  return result.errors.length ? 1 : 0;
}

// Proves — in a NON-PRODUCTION project (or the Auth emulator) — that Firebase
// Authentication accepts the synthetic identifier format and the password, and
// that a wrong password is rejected. Creates one throwaway account and deletes
// it again unless --keep is passed.
async function cmdVerifyIdentifier(flags) {
  const project = flags['--project'];
  if (!project) throw new Error('verify-identifier needs --project <TEST-project-id>');
  const cfg = fb.readProjectConfig();
  if (project === PRODUCTION_PROJECT && !flags['--allow-production-check']) {
    throw new Error(
      'verify-identifier must run against a NON-PRODUCTION project (or the Auth emulator).\n' +
      'Create a throwaway project (e.g. jkss-fund-prelaunch), or set FIREBASE_AUTH_EMULATOR_HOST.\n' +
      '(Override only knowingly: --allow-production-check.)'
    );
  }

  const handle = fb.initAdmin({ projectId: project, credentialsPath: flags['--credentials'], quiet: !!flags['--json'] });
  const apiKey = flags['--api-key'] || cfg.apiKey;
  if (!handle.emulator && !apiKey) {
    throw new Error('No Web API key: pass --api-key (Firebase console → Project settings → Web API key)');
  }

  const username = '__preflight.' + Date.now().toString(36);
  const identifier = identity.identifierFor(username);
  const password = generateTemporaryPassword();
  const checks = [];
  const results = { project, mode: handle.emulator ? 'auth emulator' : 'live project', identifier, checks };

  try {
    const created = await fb.createAuthUser({ auth: handle.auth, identifier, password, fullName: 'Preflight' });
    checks.push({ name: 'Admin SDK createUser accepts the identifier', ok: !!(created.uid || created.created), detail: created.skipped || 'created' });

    const good = await fb.signInWithPassword({ identifier, password, apiKey });
    checks.push({ name: 'signInWithPassword(identifier, correct password)', ok: good.ok, detail: good.code || 'signed in' });

    const bad = await fb.signInWithPassword({ identifier, password: password + 'x', apiKey });
    checks.push({ name: 'signInWithPassword(identifier, wrong password) is rejected', ok: bad.ok === false, detail: bad.code || 'unexpectedly signed in' });

    const wrongDomain = await fb.signInWithPassword({ identifier: 'x@example.com', password, apiKey });
    checks.push({ name: 'unknown identifier is rejected', ok: wrongDomain.ok === false, detail: wrongDomain.code || 'unexpectedly signed in' });

    if (!flags['--keep'] && created.uid) {
      await fb.deleteAuthUser({ auth: handle.auth, uid: created.uid });
      checks.push({ name: 'throwaway account deleted again', ok: true, detail: 'deleted' });
    } else {
      checks.push({ name: 'throwaway account deleted again', ok: false, detail: 'left in place (--keep or unknown uid)' });
    }
  } catch (e) {
    checks.push({ name: 'preflight aborted', ok: false, detail: String(e.message || e) });
  }

  results.ok = checks.every((c) => c.ok);
  if (flags['--json']) process.stdout.write(JSON.stringify(results, null, 2) + '\n');
  else {
    console.log('IDENTIFIER PREFLIGHT — project ' + project + ' (' + results.mode + ')');
    console.log('identifier under test: ' + identifier);
    checks.forEach((c) => console.log('  ' + (c.ok ? 'PASS' : 'FAIL') + '  ' + c.name + '   [' + c.detail + ']'));
    console.log('\n' + (results.ok ? 'IDENTIFIER FORMAT VERIFIED in a non-production environment.' :
      'PREFLIGHT FAILED — do NOT bulk-create accounts with this identifier format.'));
  }
  await handle.app.delete();
  return results.ok ? 0 : 1;
}

async function cmdResetPassword(flags) {
  const username = flags['--username'];
  if (!username) throw new Error('reset-password needs --username <assigned username>');
  if (!flags['--project']) throw new Error('reset-password needs --project <firebase-project-id>');
  const u = identity.normalizeUsername(username);
  const identifier = identity.identifierFor(u);
  const dryRun = !flags['--apply'];

  if (!dryRun) requireLiveGate({ flags });
  const handle = fb.initAdmin({ projectId: flags['--project'], credentialsPath: flags['--credentials'], quiet: !!flags['--json'] });

  if (dryRun) {
    console.log('DRY RUN — would set a NEW random temporary password for:');
    console.log('  username:   ' + u);
    console.log('  identifier: ' + identifier);
    console.log('  (no email is sent; the password is stored in the local credentials file)');
    console.log('\nRe-run with --apply to perform the reset.');
    await handle.app.delete();
    return 0;
  }

  const password = generateTemporaryPassword();
  const res = await fb.resetStudentPassword({ auth: handle.auth, identifier, password });
  const file = credentialsPath(flags);
  const data = creds.readCredentials(file) || creds.emptyCredentials({ project: flags['--project'], domain: identity.STUDENT_EMAIL_DOMAIN });
  data.project = data.project || flags['--project'];
  data.domain = identity.STUDENT_EMAIL_DOMAIN;
  creds.recordPasswordReset(data, { username: u, identifier, password });
  const written = creds.writeCredentials(file, data);

  const verified = await fb.signInWithPassword({
    identifier,
    password,
    apiKey: flags['--api-key'] || fb.readProjectConfig().apiKey,
  }).catch((e) => ({ ok: false, code: String(e.message || e) }));

  console.log('RESET COMPLETE for ' + u + ' (uid ' + res.uid + ')');
  console.log('new temporary password written to: ' + written + ' (mode 0600, git-ignored)');
  console.log('sign-in check with the new password: ' + (verified.ok ? 'PASS' : 'FAIL (' + verified.code + ')'));
  if (flags['--show-passwords']) console.log('new password: ' + password);
  await handle.app.delete();
  return verified.ok ? 0 : 1;
}

// Re-key ONE legacy (real-email) identity onto an assigned username identifier.
// Defaults to a dry run; requires --apply and a backup directory.
async function cmdMigrateIdentity(flags) {
  const legacy = flags['--legacy'];
  const username = flags['--username'];
  const dryRun = !flags['--apply'];
  if (!legacy || !username) throw new Error('migrate-identity needs --legacy <existing doc id> --username <assigned username>');
  if (!flags['--project']) throw new Error('migrate-identity needs --project <firebase-project-id>');
  const legacyId = String(legacy).trim().toLowerCase();
  const u = identity.normalizeUsername(username);
  const identifier = identity.identifierFor(u);

  if (!dryRun) requireLiveGate({ flags });
  const handle = fb.initAdmin({ projectId: flags['--project'], credentialsPath: flags['--credentials'], quiet: !!flags['--json'] });

  const legacyRef = handle.db.collection('users').doc(legacyId);
  const legacySnap = await legacyRef.get();
  if (!legacySnap.exists) throw new Error('Legacy profile not found: users/' + legacyId);
  const legacyData = legacySnap.data() || {};
  const txns = await legacyRef.collection('transactions').get();
  const targetSnap = await handle.db.collection('users').doc(identifier).get();
  const balancePaise = Number.isInteger(legacyData.balancePaise)
    ? legacyData.balancePaise
    : Math.round(Number(legacyData.balance || 0) * 100);

  console.log('IDENTITY MIGRATION ' + (dryRun ? '(DRY RUN)' : '(APPLY)'));
  console.log('  legacy profile : users/' + legacyId + '   (' + (legacyData.full_name || '?') + ')');
  console.log('  → new identity : users/' + identifier + '  (username ' + u + ')');
  console.log('  balance moved  : ' + balancePaise + ' paise');
  console.log('  ledger entries : ' + txns.size + ' (copied verbatim, same document IDs)');
  console.log('  legacy doc     : zeroed + tombstoned (removedAt) + migratedTo — never deleted');
  console.log('  target exists  : ' + (targetSnap.exists ? 'YES (refusing to overwrite)' : 'no'));

  if (targetSnap.exists) {
    console.log('\nRefusing: users/' + identifier + ' already exists. Migrate manually after review.');
    await handle.app.delete();
    return 1;
  }
  if (dryRun) {
    console.log('\nRe-run with --apply (and --confirm-project for a live project) to perform it.');
    await handle.app.delete();
    return 0;
  }

  const backupDir = flags['--out'] ? path.join(flags['--out'], 'backups') : path.join(HERE, 'backups');
  const backupFile = await fb.exportIdentityBackup({ db: handle.db, ids: [legacyId, identifier], dir: backupDir });
  console.log('  backup written : ' + backupFile);

  const password = generateTemporaryPassword();
  const created = await fb.createAuthUser({ auth: handle.auth, identifier, password, fullName: legacyData.full_name || u });
  const { copied } = await fb.copyLedger({ db: handle.db, fromId: legacyId, toId: identifier });

  const batch = handle.db.batch();
  batch.set(handle.db.collection('users').doc(identifier), {
    email: identifier,
    role: legacyData.role || 'student',
    full_name: legacyData.full_name || u,
    avatar: legacyData.avatar || '',
    balancePaise,
    balance: balancePaise / 100,
    txnSeq: Number.isInteger(legacyData.txnSeq) ? legacyData.txnSeq : 0,
    migratedFrom: legacyId,
    createdAt: legacyData.createdAt || new Date(),
  });
  batch.set(handle.db.collection('users').doc(identifier).collection('transactions').doc('transfer_migration'), {
    type: 'transfer',
    studentId: identifier,
    amountPaise: balancePaise,
    amount: balancePaise / 100,
    description: 'Balance transferred from legacy identity ' + legacyId,
    createdAt: new Date(),
  });
  batch.update(legacyRef, {
    balancePaise: 0,
    balance: 0,
    removedAt: new Date(),
    migratedTo: identifier,
    migratedAt: new Date(),
  });
  batch.set(legacyRef.collection('transactions').doc('adjustment_migration'), {
    type: 'adjustment',
    studentId: legacyId,
    amountPaise: -balancePaise,
    amount: -balancePaise / 100,
    description: 'Balance transferred to ' + identifier + ' (username ' + u + ')',
    createdAt: new Date(),
  });
  await batch.commit();

  const file = credentialsPath(flags);
  const data = creds.readCredentials(file) || creds.emptyCredentials({ project: flags['--project'], domain: identity.STUDENT_EMAIL_DOMAIN });
  data.project = data.project || flags['--project'];
  data.domain = identity.STUDENT_EMAIL_DOMAIN;
  creds.upsertStudent(data, {
    name: legacyData.full_name || u,
    username: u,
    identifier,
    password,
    status: 'migrated-from:' + legacyId,
  });
  const written = creds.writeCredentials(file, data);

  console.log('MIGRATION COMPLETE');
  console.log('  auth account   : ' + (created.created ? 'created' : 'already existed (password untouched)'));
  console.log('  ledger copied  : ' + copied + ' of ' + txns.size + ' entries');
  console.log('  credentials    : ' + written);
  console.log('  LEGACY LIEN: jobs created before this migration allocate to users/' + legacyId +
    '.\n  If such a job is later reversed, reconcile it — see docs/USERNAME_LOGIN.md → "Legacy lien".');
  await handle.app.delete();
  return 0;
}

/* ------------------------------------------------------------------- main -- */

async function main() {
  const args = parseArgs(process.argv);
  const flags = args.flags;
  if (flags['--help'] || args.command === 'help') {
    console.log(usage());
    return 0;
  }
  switch (args.command) {
    case 'plan': return cmdPlan(flags);
    case 'apply': return cmdApply(flags);
    case 'verify-identifier': return cmdVerifyIdentifier(flags);
    case 'reset-password': return cmdResetPassword(flags);
    case 'migrate-identity': return cmdMigrateIdentity(flags);
    default:
      console.error('Unknown command "' + args.command + '"\n');
      console.log(usage());
      return 2;
  }
}

if (require.main === module) {
  main()
    .then((code) => process.exit(code || 0))
    .catch((e) => {
      console.error('\nERROR: ' + (e && e.message ? e.message : e));
      process.exit(1);
    });
}

module.exports = { parseArgs, main, KNOWN_FLAGS };
