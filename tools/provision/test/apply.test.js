'use strict';
// Decision D-1, end to end through the real `apply` code path, plus the opt-in
// shared initial password and the unrostered-identity hard stop.
// The Firebase layer is stubbed in-process (no network, no emulator, no
// credentials). We run `main()` and record every write the tool would make.
// A held legacy profile must receive NO Auth account, NO pre-authorized profile,
// and NO txnSeq backfill.
//
// Run: node test/apply.test.js

const fs = require('fs');
const os = require('os');
const path = require('path');

const fb = require('../lib/firebase');
const provision = require('../provision');

let pass = 0;
let fail = 0;
function ok(v, msg) { if (!v) throw new Error(msg || 'expected truthy'); }
function eq(a, b, msg) {
  if (a !== b) throw new Error((msg || 'eq') + ': ' + JSON.stringify(a) + ' !== ' + JSON.stringify(b));
}

const LEGACY_HELD = 'legacy.anwar@gmail.com';   // legacy identity of held roster student Anwar
const ELIGIBLE = 'bilal@students.jkss-fund.invalid'; // eligible student's own profile, no txnSeq
const FORMER = 'former@gmail.com';              // unmatched former profile, no txnSeq
const ANWAR_ID = 'anwar@students.jkss-fund.invalid';
const BILAL_ID = 'bilal@students.jkss-fund.invalid';
const THANGAL_ID = 'thangal@students.jkss-fund.invalid'; // NOT on the roster (removed)
const SHARED = 'Kozhikode2026!';                 // a valid, roster-safe example

const LIVE = {
  authUsers: [],
  profiles: [
    { id: LEGACY_HELD, role: 'student', full_name: 'Anwar', balancePaise: 500, balance: 5 },
    { id: ELIGIBLE, role: 'student', full_name: 'Bilal', balancePaise: 0, balance: 0 },
    { id: FORMER, role: 'student', full_name: 'Zaid', balancePaise: 0, balance: 0 },
  ],
  jobs: [],
};

// Runs `apply` (or a dry run) against the stub. Returns what was written.
// opts.secret = { content, mode } writes an owner password file in the temp dir.
async function runApply(roster, opts = {}) {
  const { live = LIVE, extra = [], apply = true, secret = null } = opts;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jkss-apply-'));
  const rosterFile = path.join(tmp, 'roster.json');
  fs.writeFileSync(rosterFile, JSON.stringify(roster));
  const writes = {
    authCreated: [], authPasswords: {}, profilesCreated: [], backfillIds: null,
    credentialsText: null, error: null, out: '',
  };

  let secretFile = null;
  if (secret) {
    secretFile = path.join(tmp, 'shared-initial-password.txt');
    fs.writeFileSync(secretFile, secret.content, { mode: 0o600 });
    fs.chmodSync(secretFile, secret.mode == null ? 0o600 : secret.mode);
  }

  const originals = {
    initAdmin: fb.initAdmin,
    discoverLive: fb.discoverLive,
    createAuthUser: fb.createAuthUser,
    createProfile: fb.createProfile,
    backfillTxnSeq: fb.backfillTxnSeq,
    isEmulatorMode: fb.isEmulatorMode,
  };
  const argv = process.argv;
  const log = console.log;
  const errLog = console.error;
  const out = process.stdout.write;
  const captured = [];
  let code = null;
  try {
    fb.initAdmin = () => ({ app: { delete: async () => {} }, auth: {}, db: {}, emulator: false });
    fb.discoverLive = async () => live;
    fb.isEmulatorMode = () => false;
    fb.createAuthUser = async ({ identifier, password }) => {
      writes.authCreated.push(identifier);
      writes.authPasswords[identifier] = password;
      return { created: true };
    };
    fb.createProfile = async ({ identifier }) => { writes.profilesCreated.push(identifier); return { created: true }; };
    fb.backfillTxnSeq = async ({ ids }) => { writes.backfillIds = ids.slice(); return ids.map((id) => ({ id, set: true })); };

    const project = 'jkss-fund-apply-stub';
    const args = ['node', 'provision.js', 'apply'];
    if (apply) args.push('--apply');
    args.push('--project', project, '--confirm-project', project, '--roster', rosterFile,
      '--credentials-file', path.join(tmp, 'credentials.json'), '--out', path.join(tmp, 'reports'), '--quiet');
    if (secretFile) args.push('--shared-password-file', secretFile);
    process.argv = args.concat(extra);
    console.log = (...a) => captured.push(a.join(' '));
    console.error = (...a) => captured.push(a.join(' '));
    process.stdout.write = (c) => { captured.push(String(c)); return true; };
    try {
      code = await provision.main();
    } catch (e) {
      code = 1;
      writes.error = String(e && e.message || e);
    }
    writes.out = captured.join('\n') + (writes.error ? '\n' + writes.error : '');
    const credPath = path.join(tmp, 'credentials.json');
    if (fs.existsSync(credPath)) writes.credentialsText = fs.readFileSync(credPath, 'utf8');
  } finally {
    console.log = log;
    console.error = errLog;
    process.stdout.write = out;
    process.argv = argv;
    Object.assign(fb, originals);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  writes.code = code;
  return { code, writes };
}

// Nothing reached Firebase: no Auth account, no profile, no backfill.
function noWrites(writes, msg) {
  eq(writes.authCreated.length, 0, (msg || '') + ' — no Auth account may be created');
  eq(writes.profilesCreated.length, 0, (msg || '') + ' — no profile may be created');
  eq(writes.backfillIds, null, (msg || '') + ' — no backfill may run');
}

const ROSTER = { students: [{ name: 'Anwar' }, { name: 'Bilal' }] };

(async () => {
  const cases = [];
  const t = (name, fn) => cases.push({ name, fn });

  /* ----------------------- D-1 (unchanged from before) -------------------- */
  t('D-1 apply: the held legacy profile is backfilled NEVER (txnSeq stays absent)', async () => {
    const { code, writes } = await runApply(ROSTER);
    eq(code, 0, 'apply exit code');
    ok(writes.backfillIds, 'backfill should have run for eligible profiles');
    ok(!writes.backfillIds.includes(LEGACY_HELD), 'frozen legacy profile must not be in the backfill: ' + writes.backfillIds.join(','));
  });

  t('D-1 apply: the held student gets no Auth account and no pre-authorized profile', async () => {
    const { writes } = await runApply(ROSTER);
    ok(!writes.authCreated.includes(ANWAR_ID), 'held student must not get an Auth account');
    ok(!writes.profilesCreated.includes(ANWAR_ID), 'held student must not get a pre-authorized profile');
    ok(!writes.profilesCreated.includes(LEGACY_HELD), 'legacy profile must not be (re)written');
  });

  t('D-1 apply: the eligible student and the unmatched former profile are still backfilled', async () => {
    const { writes } = await runApply(ROSTER);
    ok(writes.backfillIds.includes(ELIGIBLE), 'eligible student profile must be backfilled');
    ok(writes.backfillIds.includes(FORMER), 'unmatched former profile keeps the normal backfill');
    ok(writes.authCreated.includes(BILAL_ID), 'eligible student gets an Auth account as before');
  });

  t('D-1 apply: a roster hold on a student with a legacy profile freezes it through apply too', async () => {
    const roster = { students: [{ name: 'Anwar', hold: true, holdReason: 'under review' }, { name: 'Bilal' }] };
    const { writes } = await runApply(roster);
    ok(!writes.backfillIds.includes(LEGACY_HELD), 'held legacy profile must not be backfilled');
    ok(!writes.backfillIds.includes(ANWAR_ID), 'held student identifier must not be backfilled');
  });

  /* ------------------------- default random passwords --------------------- */
  t('default apply: each NEW account gets its own random password (16 chars, all distinct)', async () => {
    const roster = { students: [{ name: 'Bilal' }, { name: 'Aflah' }] };
    const { writes } = await runApply(roster);
    const pws = Object.values(writes.authPasswords);
    eq(pws.length, 2, 'two new accounts');
    pws.forEach((p) => eq(p.length, 16, 'random length'));
    eq(new Set(pws).size, 2, 'passwords must differ');
    ok(!/\bshared\b/i.test(writes.out), 'no shared-mode wording in the default run');
    ok(writes.credentialsText && writes.credentialsText.includes('"password"'), 'random mode records passwords in the credentials file');
  });

  /* ---------------------------- shared mode ------------------------------- */
  t('shared mode: every NEW account is created with the owner password; nothing is printed', async () => {
    const { code, writes } = await runApply(ROSTER, { secret: { content: SHARED + '\n' } });
    eq(code, 0, 'exit code');
    eq(writes.authPasswords[BILAL_ID], SHARED, 'the shared password must be used for the new account');
    ok(!writes.out.includes(SHARED), 'the shared password must never be printed or logged');
    ok(!writes.credentialsText.includes(SHARED), 'the shared password must not be stored in the credentials file');
    ok(!/"password"/.test(writes.credentialsText), 'shared-mode credentials records carry no password field');
    ok(writes.credentialsText.includes('owner-shared-initial'), 'the record states the password source');
    ok(/owner shared initial password/.test(writes.out), 'the report states the password mode');
  });

  t('shared mode: an existing Auth account is NEVER given the shared password (no reset on rerun)', async () => {
    const live = Object.assign({}, LIVE, {
      authUsers: [{ uid: 'u-bilal', email: BILAL_ID, hasPassword: true, providers: ['password'], disabled: false }],
    });
    const { code, writes } = await runApply(ROSTER, { live, secret: { content: SHARED + '\n' } });
    eq(code, 0, 'exit code');
    ok(!(BILAL_ID in writes.authPasswords), 'existing account must not be created or re-passworded');
    eq(writes.authCreated.length, 0, 'nothing new to create');
    eq(writes.credentialsText, null, 'nothing new → the credentials file is not rewritten');
  });

  t('shared mode DRY RUN: validates the file, writes nothing, prints no password', async () => {
    const { code, writes } = await runApply(ROSTER, { apply: false, secret: { content: SHARED + '\n' } });
    eq(code, 0, 'exit code');
    noWrites(writes, 'dry run');
    ok(/DRY RUN/.test(writes.out), 'must say DRY RUN');
    ok(/owner shared initial password/.test(writes.out), 'mode line');
    ok(!writes.out.includes(SHARED), 'never printed');
  });

  const BAD = [
    ['a file readable by others (0644) is refused', { content: SHARED + '\n', mode: 0o644 }, /group\/other/],
    ['a group-readable file (0640) is refused', { content: SHARED + '\n', mode: 0o640 }, /group\/other/],
    ['an empty file is refused', { content: '\n' }, /empty/],
    ['two lines are refused', { content: SHARED + '\nsecond\n' }, /exactly one line/],
    ['a password under 12 characters is refused', { content: 'short1A\n' }, /at least 12/],
    ['a password with a student name is refused', { content: 'Bilal2026Secure\n' }, /must not contain/],
    ['a password with a space is refused', { content: 'Kozhikode 2026!\n' }, /printable ASCII/],
  ];
  for (const [label, secret, re] of BAD) {
    t('shared mode: ' + label + ' — nothing is written', async () => {
      const { code, writes } = await runApply(ROSTER, { secret });
      eq(code, 1, 'must refuse');
      ok(re.test(writes.error || ''), 'reason: ' + writes.error);
      noWrites(writes, label);
      const rejected = secret.content.trim();
      if (rejected) ok(!writes.out.includes(rejected), 'the rejected text must not be echoed');
    });
  }

  t('shared mode: a missing file is refused before anything is written', async () => {
    const missing = path.join(os.tmpdir(), 'jkss-no-such-file-' + process.pid);
    const { code, writes } = await runApply(ROSTER, { extra: ['--shared-password-file', missing] });
    eq(code, 1, 'must refuse');
    ok(/not found/.test(writes.error || ''), 'reason: ' + writes.error);
    noWrites(writes, 'missing file');
  });

  /* ---------------------- unrostered identities --------------------------- */
  const LIVE_WITH_ORPHAN = Object.assign({}, LIVE, {
    authUsers: [{ uid: 'u-thangal', email: THANGAL_ID, hasPassword: true, providers: ['password'], disabled: false }],
    profiles: LIVE.profiles.concat([
      { id: THANGAL_ID, role: 'student', full_name: 'Thangal', balancePaise: 4200, balance: 42 },
    ]),
  });

  t('unrostered: apply REFUSES to write while a synthetic identity is not on the roster', async () => {
    const { code, writes } = await runApply(ROSTER, { live: LIVE_WITH_ORPHAN });
    eq(code, 1, 'must refuse');
    ok(/not on the roster/.test(writes.error || ''), 'reason: ' + writes.error);
    noWrites(writes, 'unrostered');
  });

  t('unrostered: with --allow-unrostered the orphan is still NEVER backfilled, written or deleted', async () => {
    const { code, writes } = await runApply(ROSTER, { live: LIVE_WITH_ORPHAN, extra: ['--allow-unrostered'] });
    eq(code, 0, 'exit code');
    ok(writes.backfillIds && !writes.backfillIds.includes(THANGAL_ID), 'orphan must not be backfilled');
    ok(!writes.authCreated.includes(THANGAL_ID) && !writes.profilesCreated.includes(THANGAL_ID), 'orphan must not be written');
    ok(writes.authCreated.includes(BILAL_ID), 'roster students are still provisioned');
  });

  t('unrostered: a dry run only reports it (exit 0, nothing written)', async () => {
    const { code, writes } = await runApply(ROSTER, { live: LIVE_WITH_ORPHAN, apply: false });
    eq(code, 0, 'a dry run must not fail on it');
    noWrites(writes, 'dry run with orphan');
    ok(/NOT on the roster/.test(writes.out), 'the dry run must list it');
  });

  for (const c of cases) {
    try {
      await c.fn();
      pass++;
      console.log('  PASS  ' + c.name);
    } catch (e) {
      fail++;
      console.log('  FAIL  ' + c.name + '  →  ' + (e && e.message));
    }
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail === 0 ? 0 : 1);
})();
