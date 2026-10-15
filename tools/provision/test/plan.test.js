// tools/provision/test/plan.test.js
// Pure-Node tests for the provisioning planner (no Firebase, no credentials):
// roster → username → identifier, legacy-profile matching, ambiguity handling,
// safety gates and the CLI argument parser.
// Run:  node test/plan.test.js   (from tools/provision)
'use strict';

const fs = require('fs');
const path = require('path');

const planLib = require('../lib/plan');
const identity = require('../../../mobile/src/identity');
const report = require('../lib/report');
const { parseArgs, KNOWN_FLAGS, COMMANDS, usage } = require('../provision');

let pass = 0;
let fail = 0;
function check(name, fn) {
  try {
    fn();
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
function assertThrows(fn, re, msg) {
  try { fn(); } catch (e) {
    if (re && !re.test(String(e.message))) throw new Error((msg || 'throw') + ': got "' + e.message + '"');
    return;
  }
  throw new Error((msg || 'expected throw') + ': no error thrown');
}

const ROSTER_FILE = path.join(__dirname, '..', 'roster.json');
const ROSTER_JSON = JSON.parse(fs.readFileSync(ROSTER_FILE, 'utf8'));
const roster = planLib.buildRoster(ROSTER_JSON);

console.log('provison/lib/plan.js — roster mapping, matching, safety gates');

/* ------------------------------- roster ---------------------------------- */
check('roster.json: 24 students, names only (no emails anywhere)', () => {
  eq(roster.length, 24);
  ROSTER_JSON.students.forEach((s, i) => {
    ok(s.name, 'name missing at ' + i);
    eq(/@/.test(JSON.stringify(s)), false, 'roster entry contains an email');
  });
});
check('roster.json declares the same domain the app builds identifiers with', () => {
  eq(ROSTER_JSON.domain, identity.STUDENT_EMAIL_DOMAIN);
});
check('roster: usernames + identifiers are unique and valid', () => {
  eq(new Set(roster.map((r) => r.username)).size, 24);
  eq(new Set(roster.map((r) => r.syntheticIdentifier)).size, 24);
  roster.forEach((r) => {
    ok(identity.isValidUsername(r.username), r.username);
    eq(identity.isStudentIdentifier(r.syntheticIdentifier), true);
    eq(identity.usernameFromIdentifier(r.syntheticIdentifier), r.username);
  });
});
check('roster: no collisions in the shipped roster (but the rule is still applied)', () => {
  eq(roster.filter((r) => r.collided).length, 0);
  eq(roster.every((r) => r.usernameSource === 'derived'), true);
});
check('roster: explicit username overrides win', () => {
  const r = planLib.buildRoster({ students: [{ name: 'Muhsin Chelakkulam', username: 'muhsin.c' }] });
  eq(r[0].username, 'muhsin.c');
  eq(r[0].usernameSource, 'assigned');
  eq(r[0].identifier, 'muhsin.c@' + identity.STUDENT_EMAIL_DOMAIN);
});
check('roster: duplicate names resolve deterministically', () => {
  const r = planLib.buildRoster({ students: [{ name: 'Adil' }, { name: 'Adil' }] });
  eq(r.map((x) => x.username).join(','), 'adil,adil.2');
});
check('roster: explicit legacyIdentifier is validated', () => {
  assertThrows(
    () => planLib.buildRoster({ students: [{ name: 'Anwar', legacyIdentifier: 'not-an-email' }] }),
    /malformed legacyIdentifier/
  );
  const r = planLib.buildRoster({ students: [{ name: 'Anwar', legacyIdentifier: 'Old.Student@Gmail.com' }] });
  eq(r[0].legacyIdentifier, 'old.student@gmail.com');
  eq(r[0].username, 'anwar');
  eq(r[0].identifier, r[0].syntheticIdentifier, 'the login identity stays the synthetic identifier');
  eq(r[0].identifier, 'anwar@' + identity.STUDENT_EMAIL_DOMAIN);
});
check('roster: empty/invalid roster files are rejected', () => {
  assertThrows(() => planLib.buildRoster({}), /non-empty "students"/);
  assertThrows(() => planLib.buildRoster({ students: [null] }), /not an object/);
});

/* --------------------------- matching engine ----------------------------- */
const AUTH = [
  { uid: 'u-admin', email: 'thrikkakarajkss@gmail.com', displayName: 'Admin', providers: ['password'], hasPassword: true },
  { uid: 'u-old', email: 'old.student@gmail.com', displayName: 'Salman', providers: ['password'], hasPassword: true },
];
const PROFILES = [
  { id: 'thrikkakarajkss', role: 'admin', full_name: 'Thrikkakara JKSS', balancePaise: 0, txnSeq: 0, txnCount: 0 },
  { id: 'thrikkakarajkss@gmail.com', role: 'admin', full_name: 'Admin', balancePaise: 0, balance: 0, txnCount: 0 },
  { id: 'old.student@gmail.com', role: 'student', full_name: 'Salman', balancePaise: 12345, balance: 123.45, txnSeq: 3, txnCount: 5 },
  { id: 'mystery1@gmail.com', role: 'student', full_name: 'Muhsin', balancePaise: 100, balance: 1, txnCount: 1 },
  { id: 'former@gmail.com', role: 'student', full_name: 'Zaid', balancePaise: 0, balance: 0, txnCount: 0 },
];
const JOBS = [{ id: 'j1', status: 'active', allocations: { 'old.student@gmail.com': 12345 } }];
const live = { authUsers: AUTH, profiles: PROFILES, jobs: JOBS, scope: 'live project' };

check('scorePair: exact name match is the top auto-link tier', () => {
  const s = roster.find((r) => r.name === 'Salman');
  const p = PROFILES[2];
  const m = planLib.scorePair(s, p);
  eq(m.score, planLib.SCORE.exactName);
});
check('scorePair: email local part == name is a strong match', () => {
  const s = roster.find((r) => r.name === 'Thangal');
  const m = planLib.scorePair(s, { id: 'thangal@gmail.com', full_name: '' });
  eq(m.score, planLib.SCORE.identifierLocal);
});
check('scorePair: shared first name alone is only a weak signal', () => {
  const s = roster.find((r) => r.name === 'Muhsin Chelakkulam');
  const m = planLib.scorePair(s, { id: 'mystery1@gmail.com', full_name: 'Muhsin' });
  eq(m.score, planLib.SCORE.firstToken);
  ok(m.score < planLib.MATCH_THRESHOLD, 'weak matches must never auto-link');
});
check('scorePair: a profile already keyed by the assigned identifier is recognised', () => {
  const s = roster.find((r) => r.name === 'Midlaj');
  const m = planLib.scorePair(s, { id: s.syntheticIdentifier, full_name: 'X' });
  eq(m.score, planLib.SCORE.synthetic);
});
check('scorePair: an explicit roster legacyIdentifier is a manual match', () => {
  const r = planLib.buildRoster({ students: [{ name: 'Salman', legacyIdentifier: 'odd.id@jkss.in' }] });
  const m = planLib.scorePair(r[0], { id: 'odd.id@jkss.in', full_name: 'Nobody' });
  eq(m.score, planLib.SCORE.manual);
  eq(m.reasons[0].startsWith('manual'), true);
});
check('admin profiles can never be matched to a roster student', () => {
  const res = planLib.matchProfiles(roster, live);
  const adminMatched = [...res.assignments.keys()].filter((id) => id.includes('thrikkakarajkss'));
  eq(adminMatched.length, 0);
  eq(res.profiles.some((p) => p.role === 'admin'), false);
});
check('matching: unique exact match assigns; weak-only lands in weakMatches', () => {
  const res = planLib.matchProfiles(roster, live);
  eq([...res.assignments.keys()].join(','), 'old.student@gmail.com');
  eq(res.weak.map((w) => w.profileId).join(','), 'mystery1@gmail.com');
  eq(res.unmatched.map((p) => p.id).join(','), 'former@gmail.com');
  eq(res.blocking.length, 0);
});
check('matching: two equally-good profiles for one student => blocking review', () => {
  const twoMuhsins = [
    { id: 'm1@gmail.com', role: 'student', full_name: 'Muhsin Chelakkulam', txnCount: 1 },
    { id: 'm2@gmail.com', role: 'student', full_name: 'Muhsin Chelakkulam', txnCount: 2 },
  ];
  const res = planLib.matchProfiles(roster, { profiles: twoMuhsins, authUsers: [] });
  eq(res.blocking.length, 1);
  ok(/multiple existing profiles/.test(res.blocking[0].reason));
  eq(res.blocking[0].candidates.length, 2);
});
check('matching: one profile matching two students => blocking review (no guessing)', () => {
  const ambiguousName = [
    { id: 'chela@jkss.in', role: 'student', full_name: 'Muhsin', txnCount: 1 },
  ];
  const twoRoster = planLib.buildRoster({ students: [{ name: 'Muhsin' }, { name: 'Muhsin' }] });
  const res = planLib.matchProfiles(twoRoster, { profiles: ambiguousName, authUsers: [] });
  eq(res.blocking.length, 1, 'one entry per contested profile (not one per student)');
  ok(/matches several roster students/.test(res.blocking[0].reason), res.blocking[0].reason);
  eq(res.blocking[0].students.join(','), 'Muhsin,Muhsin');
  eq(res.blocking[0].usernames.join(','), 'muhsin,muhsin.2');
});

/* ------------------------------- the plan -------------------------------- */
const plan = planLib.buildPlan({ roster, live, projectId: 'jkss-fund-test' });

check('plan: 23 students creatable, legacy student HELD (never duplicated)', () => {
  eq(plan.summary.rosterSize, 24);
  eq(plan.summary.toCreate, 23);
  eq(plan.summary.heldForMigration, 1);
  const salman = plan.students.find((s) => s.name === 'Salman');
  eq(salman.createAllowed, false);
  eq(salman.status, 'migration-review');
  eq(salman.legacyProfileId, 'old.student@gmail.com');
  eq(salman.legacyMatch.balancePaise, 12345);
  eq(salman.legacyMatch.txnCount, 5);
  ok(salman.actions.join(' ').includes('HELD BACK'));
});
check('plan: legacy profile with zero balance/ledger is still held (link-legacy)', () => {
  const emptyLegacy = planLib.buildPlan({
    roster,
    live: {
      authUsers: [],
      profiles: [{ id: 'empty@jkss.in', role: 'student', full_name: 'Anwar', balancePaise: 0, txnSeq: 0, txnCount: 0 }],
      jobs: [],
    },
  });
  const anwar = emptyLegacy.students.find((s) => s.name === 'Anwar');
  eq(anwar.status, 'link-legacy');
  eq(anwar.createAllowed, false);
});
check('plan: explicit ignoreLegacy releases the hold and records the decision', () => {
  const r = planLib.buildRoster({ students: [{ name: 'Anwar', ignoreLegacy: true }] });
  const p = planLib.buildPlan({
    roster: r,
    live: { authUsers: [], profiles: [{ id: 'empty@jkss.in', role: 'student', full_name: 'Anwar', txnCount: 0 }], jobs: [] },
  });
  eq(p.students[0].createAllowed, true);
  ok(String(p.students[0].reviewed).includes('ignoreLegacy'));
});
check('roster hold: the hold flag and its reason are validated', () => {
  assertThrows(() => planLib.buildRoster({ students: [{ name: 'Anwar', hold: true }] }), /holdReason/);
  assertThrows(() => planLib.buildRoster({ students: [{ name: 'Anwar', hold: true, holdReason: '   ' }] }), /holdReason/);
  assertThrows(() => planLib.buildRoster({ students: [{ name: 'Anwar', hold: 'yes', holdReason: 'x' }] }), /true or false/);
  const ok1 = planLib.buildRoster({ students: [{ name: 'Anwar', hold: true, holdReason: '  legacy review  ' }] });
  eq(ok1[0].hold, true);
  eq(ok1[0].holdReason, 'legacy review', 'reason is trimmed');
  eq(planLib.buildRoster({ students: [{ name: 'Bilal' }] })[0].hold, false, 'default is not held');
});
check('roster hold: a held student is never creatable, even with NO existing profile', () => {
  const r = planLib.buildRoster({ students: [{ name: 'Anwar', hold: true, holdReason: 'awaiting review' }, { name: 'Bilal' }] });
  const p = planLib.buildPlan({ roster: r, live: { authUsers: [], profiles: [], jobs: [] } });
  const held = p.students.find((s) => s.name === 'Anwar');
  const free = p.students.find((s) => s.name === 'Bilal');
  eq(held.createAllowed, false);
  eq(held.status, 'held');
  eq(held.hold.reason, 'awaiting review');
  ok(held.actions.join(' ').includes('HELD — roster hold'), 'plan must say why');
  eq(free.createAllowed, true, 'verified, un-held students stay eligible');
  eq(free.status, 'create');
  eq(p.summary.toCreate, 1);
  eq(p.summary.rosterHold, 1);
  eq(p.summary.heldForMigration, 0, 'a roster hold is not a legacy hold');
});
check('roster hold: on a legacy-matched student the migration detail is kept', () => {
  const r = planLib.buildRoster({ students: [{ name: 'Salman', hold: true, holdReason: 'Review legacy balance' }] });
  const p = planLib.buildPlan({ roster: r, live });
  const s = p.students[0];
  eq(s.createAllowed, false);
  eq(s.status, 'migration-review');
  eq(s.legacyProfileId, 'old.student@gmail.com');
  eq(s.legacyMatch.balancePaise, 12345);
  eq(s.hold.reason, 'Review legacy balance');
  eq(p.summary.heldForMigration, 1);
  eq(p.summary.rosterHold, 1);
});
check('roster hold: the committed roster.json holds nobody by default', () => {
  eq(roster.filter((r) => r.hold).length, 0, 'the hold list is populated from the review, not guessed');
});
check('plan: both admin documents are reported and preserved', () => {
  eq(plan.summary.adminProfiles, 2);
  eq(plan.adminProfiles.map((p) => p.id).join(','), 'thrikkakarajkss,thrikkakarajkss@gmail.com');
  eq(plan.adminProfiles.filter((p) => p.txnSeq == null).length, 1);
});
check('plan: txnSeq backfill targets exactly the docs missing the field', () => {
  const ids = plan.txnSeqBackfill.map((p) => p.id).sort();
  eq(ids.join(','), 'former@gmail.com,mystery1@gmail.com,thrikkakarajkss@gmail.com');
});
check('plan: existing profiles keyed by the assigned identifier => status exists, no create', () => {
  const target = roster.find((r) => r.name === 'Midlaj');
  const p = planLib.buildPlan({
    roster,
    live: {
      authUsers: [{ uid: 'u9', email: target.syntheticIdentifier, providers: ['password'], hasPassword: true }],
      profiles: [{ id: target.syntheticIdentifier, role: 'student', full_name: 'Midlaj', balancePaise: 500, balance: 5, txnSeq: 2, txnCount: 2 }],
      jobs: [],
    },
  });
  const m = p.students.find((s) => s.name === 'Midlaj');
  eq(m.status, 'exists');
  eq(m.actions.includes('create-auth-user'), false);
  eq(m.actions.includes('create-profile'), false);
  eq(m.profile.balancePaise, 500);
});
check('plan: offline plan (no credentials) still produces all 24 mappings', () => {
  const p = planLib.buildPlan({ roster });
  eq(p.summary.rosterSize, 24);
  eq(p.summary.toCreate, 24);
  eq(p.summary.needsReview, 0);
  ok(/offline/.test(p.scope));
});
check('plan: deterministic (same input → identical plan modulo timestamp)', () => {
  const a = planLib.buildPlan({ roster, live, projectId: 'x' });
  const b = planLib.buildPlan({ roster, live, projectId: 'x' });
  delete a.generatedAt;
  delete b.generatedAt;
  eq(JSON.stringify(a), JSON.stringify(b));
});
check('plan: unmatched (former) profiles are listed, never touched', () => {
  eq(plan.unmatchedProfiles.map((p) => p.id).join(','), 'former@gmail.com');
  eq(plan.students.some((s) => s.name === 'Zaid'), false);
});

/* -------------------------------- reports -------------------------------- */
check('report: mapping table contains every roster row and both identifiers', () => {
  const table = report.renderMappingTable(plan.students);
  eq(table.split('\n').filter((l) => /^\s*\d+\s+/.test(l)).length, 24);
  plan.students.forEach((s) => {
    ok(table.includes(s.name), s.name);
    ok(table.includes(s.identifier), s.identifier);
  });
});
check('report: plan text surfaces held students, warnings and admin docs', () => {
  const text = report.renderPlan(plan);
  ok(text.includes('ADMIN PROFILES (never touched by this tool)'));
  ok(text.includes('held for MIGRATION'));
  ok(text.includes('WARNING'), 'weak matches must be surfaced as a warning');
  ok(text.includes('[HELD]'), 'held students must be visibly marked');
  ok(text.includes('salman@' + identity.STUDENT_EMAIL_DOMAIN));
});
check('report: a blocking ambiguity is rendered as MANUAL REVIEW REQUIRED', () => {
  const twoProfiles = [
    { id: 'm1@gmail.com', role: 'student', full_name: 'Salman', balancePaise: 10, txnCount: 1 },
    { id: 'm2@gmail.com', role: 'student', full_name: 'Salman', balancePaise: 20, txnCount: 2 },
  ];
  const p = planLib.buildPlan({ roster, live: { profiles: twoProfiles, authUsers: [], jobs: [] } });
  eq(p.summary.needsReview, 1);
  const text = report.renderPlan(p);
  ok(text.includes('MANUAL REVIEW REQUIRED'));
  ok(text.includes('multiple existing profiles match this student equally well'));
  const salman = p.students.find((s) => s.name === 'Salman');
  eq(salman.createAllowed, false);
});

/* --------------------------- the shipped roster --------------------------- */
check('docs/USERNAME_LOGIN.md mapping table matches the code (no drift)', () => {
  const doc = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'docs', 'USERNAME_LOGIN.md'), 'utf8');
  const parts = doc.split('### 3.1 Roster → username → identifier');
  ok(parts.length > 1, 'mapping section missing from docs/USERNAME_LOGIN.md');
  const table = parts[1].split('\n###')[0];
  roster.forEach((r) => {
    const line = table.split('\n').find((l) => l.split('|').map((c) => c.trim()).includes(r.name));
    ok(line, 'row missing for ' + r.name);
    ok(line.split('|').map((c) => c.trim()).includes('`' + r.username + '`'), r.name + ' → username drift: ' + line);
    ok(line.split('|').map((c) => c.trim()).includes('`' + r.identifier + '`'), r.name + ' → identifier drift: ' + line);
  });
});

/* ------------------------------ CLI parsing ------------------------------ */
check('parseArgs: defaults to the dry-run plan command', () => {
  const a = parseArgs(['node', 'provision.js']);
  eq(a.command, 'plan');
  eq(!!a.flags['--apply'], false);
});
check('parseArgs: commands + flags', () => {
  const a = parseArgs(['node', 'provision.js', 'apply', '--project', 'jkss-fund-test', '--apply', '--json']);
  eq(a.command, 'apply');
  eq(a.flags['--project'], 'jkss-fund-test');
  eq(a.flags['--apply'], true);
  eq(a.flags['--json'], true);
});
check('parseArgs: --key=value form', () => {
  const a = parseArgs(['node', 'x', 'plan', '--roster=my.json']);
  eq(a.flags['--roster'], 'my.json');
});
check('parseArgs: unknown flags are a hard error (a typo cannot silently dry-run)', () => {
  assertThrows(() => parseArgs(['node', 'x', 'apply', '--aply']), /Unknown option/);
  assertThrows(() => parseArgs(['node', 'x', 'apply', '--confirm']), /Unknown option/);
});
check('parseArgs: a flags that needs a value fails without one', () => {
  assertThrows(() => parseArgs(['node', 'x', 'plan', '--project']), /needs a value/);
  assertThrows(() => parseArgs(['node', 'x', 'plan', '--project', '--json']), /needs a value/);
});
check('known flags cover every command documented in the tool usage text', () => {
  ['--roster', '--project', '--credentials', '--apply', '--confirm-project', '--username', '--legacy']
    .forEach((f) => ok(KNOWN_FLAGS[f], 'missing flag ' + f));
});

/* --------------------- docs ↔ CLI (every documented command runs) ------- */
// The docs are the runbook an admin follows at the keyboard: if a command or a
// flag in them stopped existing, the failure would only show up mid-deployment.
// Every `provision.js <cmd>` invocation and every `--flag` on a provision.js
// line is checked against the real parser.
const DOC_FILES = [
  ['docs', 'USERNAME_LOGIN.md'],
  ['tools', 'provision', 'README.md'],
  ['README.md'],
  ['DEPLOY.md'],
  ['SECURITY_REVIEW.md'],
  ['firebase', 'README.md'],
  ['mobile', 'PLAY_STORE.md'],
];
const MANUAL_USE_RE = /provision\.js\s+(--?[\w-]+)?/g;

function provisionFileLines() {
  const out = [];
  DOC_FILES.forEach((parts) => {
    const file = path.join(__dirname, '..', '..', '..', ...parts);
    if (!fs.existsSync(file)) return;
    // join shell line-continuations so a flag on the next line still counts
    const text = fs.readFileSync(file, 'utf8').replace(/\\\n\s*/g, ' ');
    text.split('\n').forEach((line) => {
      if (line.includes('provision.js')) out.push({ file: parts.join('/'), line });
    });
  });
  return out;
}

check('docs: every provision.js command in the docs exists in the CLI', () => {
  const lines = provisionFileLines();
  ok(lines.length > 5, 'expected the docs to document provision.js (found ' + lines.length + ' lines)');
  lines.forEach(({ file, line }) => {
    let m;
    MANUAL_USE_RE.lastIndex = 0;
    while ((m = MANUAL_USE_RE.exec(line))) {
      const token = m[1];
      if (!token || token.startsWith('-')) continue; // bare `provision.js` = default plan
      ok(COMMANDS.includes(token),
        file + ': unknown command "' + token + '" (commands: ' + COMMANDS.join(', ') + ')');
    }
  });
});

check('docs: every --flag next to provision.js in the docs exists in the CLI', () => {
  const offenders = [];
  provisionFileLines().forEach(({ file, line }) => {
    const flags = line.match(/--[a-z][a-z0-9-]*/g) || [];
    flags.forEach((f) => {
      if (!KNOWN_FLAGS[f]) offenders.push(file + ': ' + f + '   [' + line.trim() + ']');
    });
  });
  eq(offenders.length, 0, 'documented flags the CLI does not know:\n    ' + offenders.join('\n    '));
});

check('docs: the usage text lists every option it accepts', () => {
  const text = usage();
  Object.keys(KNOWN_FLAGS).forEach((f) => {
    ok(text.includes(f), 'usage() does not mention ' + f);
  });
  COMMANDS.filter((c) => c !== 'plan').forEach((c) => {
    ok(text.includes(c), 'usage() does not mention the command ' + c);
  });
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
