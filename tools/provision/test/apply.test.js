'use strict';
// Decision D-1, end to end through the real `apply` code path.
// The Firebase layer is stubbed in-process (no network, no emulator, no
// credentials). We run `main()` with `apply --apply` and record every write
// the tool would make. A held legacy profile must receive NO Auth account, NO
// pre-authorized profile, and NO txnSeq backfill.
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

const LIVE = {
  authUsers: [],
  profiles: [
    { id: LEGACY_HELD, role: 'student', full_name: 'Anwar', balancePaise: 500, balance: 5 },
    { id: ELIGIBLE, role: 'student', full_name: 'Bilal', balancePaise: 0, balance: 0 },
    { id: FORMER, role: 'student', full_name: 'Zaid', balancePaise: 0, balance: 0 },
  ],
  jobs: [],
};

async function runApply(roster) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jkss-apply-'));
  const rosterFile = path.join(tmp, 'roster.json');
  fs.writeFileSync(rosterFile, JSON.stringify(roster));
  const writes = { authCreated: [], profilesCreated: [], backfillIds: null };

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
  const out = process.stdout.write;
  try {
    fb.initAdmin = () => ({ app: { delete: async () => {} }, auth: {}, db: {}, emulator: false });
    fb.discoverLive = async () => LIVE;
    fb.isEmulatorMode = () => false;
    fb.createAuthUser = async ({ identifier }) => { writes.authCreated.push(identifier); return { created: true }; };
    fb.createProfile = async ({ identifier }) => { writes.profilesCreated.push(identifier); return { created: true }; };
    fb.backfillTxnSeq = async ({ ids }) => { writes.backfillIds = ids.slice(); return ids.map((id) => ({ id, set: true })); };

    const project = 'jkss-fund-apply-stub';
    process.argv = ['node', 'provision.js', 'apply', '--apply', '--project', project,
      '--confirm-project', project, '--roster', rosterFile,
      '--credentials-file', path.join(tmp, 'credentials.json'), '--quiet'];
    console.log = () => {};
    process.stdout.write = () => true;
    const code = await provision.main();
    return { code, writes };
  } finally {
    console.log = log;
    process.stdout.write = out;
    process.argv = argv;
    Object.assign(fb, originals);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

const ROSTER = { students: [{ name: 'Anwar' }, { name: 'Bilal' }] };

(async () => {
  const cases = [];
  const t = (name, fn) => cases.push({ name, fn });

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
