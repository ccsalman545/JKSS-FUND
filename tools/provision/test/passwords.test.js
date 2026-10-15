// tools/provision/test/passwords.test.js
// Pure-Node tests for temporary-password generation and the local credentials
// file (permissions, atomicity, never-overwrite-a-password).
// Run:  node test/passwords.test.js   (from tools/provision)
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { generateTemporaryPassword, TEMP_PASSWORD_LENGTH, ALPHABETS } = require('../lib/passwords');
const creds = require('../lib/credentials');
const identity = require('../../../mobile/src/identity');

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

console.log('passwords.js + credentials.js — CSPRNG temp passwords, 0600 file');

/* ---------------------------- password quality --------------------------- */
check('length is 16 by default and configurable (>= 8)', () => {
  eq(generateTemporaryPassword().length, TEMP_PASSWORD_LENGTH);
  eq(generateTemporaryPassword({ length: 24 }).length, 24);
  let threw = false;
  try { generateTemporaryPassword({ length: 6 }); } catch (e) { threw = true; }
  eq(threw, true, 'a too-short temp password must be refused');
});
check('every password has lower + upper + digit + symbol', () => {
  for (let i = 0; i < 500; i++) {
    const pw = generateTemporaryPassword();
    ok(/[a-z]/.test(pw), 'no lowercase: ' + pw);
    ok(/[A-Z]/.test(pw), 'no uppercase: ' + pw);
    ok(/[0-9]/.test(pw), 'no digit: ' + pw);
    ok(/[!@#$%^&*\-_=+?]/.test(pw), 'no symbol: ' + pw);
  }
});
check('unambiguous alphabet only (no O/0/I/l/1 to mis-read)', () => {
  for (let i = 0; i < 500; i++) {
    const pw = generateTemporaryPassword();
    ok(!/[O0Il1]/.test(pw), 'ambiguous character in ' + pw);
    Array.from(pw).forEach((ch) => ok(ALPHABETS.ALL.includes(ch), 'character outside the alphabet: ' + ch));
  }
});
check('no repeats across 20,000 generations (not a PRNG seed loop)', () => {
  const seen = new Set();
  for (let i = 0; i < 20000; i++) {
    const pw = generateTemporaryPassword();
    if (seen.has(pw)) throw new Error('collision: ' + pw);
    seen.add(pw);
  }
  eq(seen.size, 20000);
});
check('two students never share a password (independent randomness)', () => {
  const roster = ['Thangal', 'Shafi', 'Aboobacker', 'Salman'];
  const pws = roster.map(() => generateTemporaryPassword());
  eq(new Set(pws).size, roster.length);
});
check('generated passwords satisfy the app-side policy even against the name', () => {
  const names = ['Thangal', 'Muhsin Chelakkulam', 'Adil Jr'];
  for (let i = 0; i < 500; i++) {
    const pw = generateTemporaryPassword();
    names.forEach((n) => {
      const v = identity.validatePasswordPolicy(pw, { name: n, username: identity.slugifyName(n) });
      ok(v.ok, 'generated password rejected by policy (' + v.reason + '): ' + pw);
    });
  }
});
check('NOT name-based and NOT Math.random-based', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'passwords.js'), 'utf8');
  ok(src.includes("require('crypto')"), 'must use the crypto module');
  ok(src.includes('crypto.randomInt'), 'must use crypto.randomInt');
  eq(/Math\.random\s*\(/.test(src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')), false,
    'Math.random() must never generate a password');
  for (let i = 0; i < 200; i++) {
    ok(!/thangal|shafi|salman|muhsin|adil/i.test(generateTemporaryPassword()));
  }
});

/* --------------------------- credentials file ---------------------------- */
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'jkss-provision-test-'));
const file = path.join(tmpRoot, 'nested', 'credentials.json');

check('writeCredentials: creates the file with mode 0600 inside a 0700 dir', () => {
  const data = creds.emptyCredentials({ project: 'test', domain: identity.STUDENT_EMAIL_DOMAIN });
  creds.upsertStudent(data, { index: 1, name: 'Thangal', username: 'thangal', identifier: identity.identifierFor('thangal'), password: 'Ab3!xyzQ7', status: 'created' });
  const written = creds.writeCredentials(file, data);
  eq(written, file);
  eq(creds.modeOf(file), '600');
  eq((fs.statSync(path.dirname(file)).mode & 0o777).toString(8), '700');
  eq(fs.readFileSync(file, 'utf8').includes('"password": "Ab3!xyzQ7"'), true);
});
check('readCredentials: round trip', () => {
  const data = creds.readCredentials(file);
  eq(data.students.length, 1);
  eq(data.students[0].username, 'thangal');
  eq(data.domain, identity.STUDENT_EMAIL_DOMAIN);
});
check('upsertStudent: NEVER overwrites an existing password', () => {
  const data = creds.readCredentials(file);
  const res = creds.upsertStudent(data, { username: 'thangal', name: 'Thangal', identifier: identity.identifierFor('thangal'), password: 'NEWPASSWORD1!', status: 'exists' });
  eq(res.keptExistingPassword, true);
  creds.writeCredentials(file, data);
  const after = creds.readCredentials(file);
  eq(after.students.length, 1, 'no duplicate record');
  eq(after.students[0].password, 'Ab3!xyzQ7', 'the original password must be preserved');
});
check('upsertStudent: adds genuinely new students', () => {
  const data = creds.readCredentials(file);
  creds.upsertStudent(data, { index: 2, name: 'Shafi', username: 'shafi', identifier: identity.identifierFor('shafi'), password: 'Zz9!qq44', status: 'created' });
  creds.writeCredentials(file, data);
  eq(creds.readCredentials(file).students.length, 2);
});
check('recordPasswordReset: appends to the audit trail and updates the password', () => {
  const data = creds.readCredentials(file);
  creds.recordPasswordReset(data, { username: 'thangal', identifier: identity.identifierFor('thangal'), password: 'Reset99!x' });
  creds.writeCredentials(file, data);
  const after = creds.readCredentials(file);
  eq(after.passwordResets.length, 1);
  eq(after.passwordResets[0].username, 'thangal');
  eq(after.students.find((s) => s.username === 'thangal').password, 'Reset99!x');
  ok(after.students.find((s) => s.username === 'thangal').passwordResetAt);
});
check('writeCredentials: atomic (no .tmp left behind, no partial file)', () => {
  const dir = path.dirname(file);
  eq(fs.readdirSync(dir).filter((f) => f.includes('.tmp-')).length, 0);
  JSON.parse(fs.readFileSync(file, 'utf8')); // must always parse
});
check('the shipped .gitignore keeps credentials and keys out of Git', () => {
  const gi = fs.readFileSync(path.join(__dirname, '..', '.gitignore'), 'utf8');
  ok(gi.includes('credentials.json'), 'credentials must be ignored');
  ok(/(\*service-account\*|\*firebase-adminsdk\*)/.test(gi), 'service-account keys must be ignored');
  ok(gi.includes('backups/'), 'pre-migration backups must be ignored');
  ok(gi.includes('reports/'), 'live reports must be ignored');
});
check('the repository root .gitignore repeats the same protections', () => {
  const gi = fs.readFileSync(path.join(__dirname, '..', '..', '..', '.gitignore'), 'utf8');
  ok(gi.includes('tools/provision/credentials'), 'root ignore must cover the credentials file');
  ok(/service-account/.test(gi), 'root ignore must cover service-account keys');
});


/* ------------------- the opt-in shared initial password ------------------- */
const sharedPw = require('../lib/shared-password');
const { spawnSync } = require('child_process');
const sharedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jkss-shared-'));
const ROSTER_STUDENTS = [
  { name: 'Sayyid Zain', username: 'sayyid.zain' },
  { name: 'Muhsin Chelakkulam', username: 'muhsin.chelakkulam' },
  { name: 'Adil', username: 'adil' },
];
const GOOD = 'Kozhikode2026!';
function secretFile(name, content, mode = 0o600) {
  const f = path.join(sharedDir, name);
  fs.writeFileSync(f, content, { mode });
  fs.chmodSync(f, mode);
  return f;
}
function throwsMatching(fn, re) {
  try { fn(); } catch (e) {
    if (!re.test(e.message)) throw new Error('wrong reason: ' + e.message);
    if (e.message.includes(GOOD) || /Sayyid2026|Muhsin2026Secure/.test(e.message)) throw new Error('message echoes a password');
    return;
  }
  throw new Error('expected a refusal');
}

check('shared password: a good, roster-safe password is accepted', () => {
  ok(sharedPw.validateSharedPassword(GOOD, { students: ROSTER_STUDENTS }).ok);
});
check('shared password: the length rules (12 to 128) are enforced', () => {
  ok(!sharedPw.validateSharedPassword('Abc12345678', { students: [] }).ok, '11 characters is too short');
  ok(sharedPw.validateSharedPassword('Abcdefghij12', { students: [] }).ok, '12 characters is the minimum');
  ok(!sharedPw.validateSharedPassword('A1b' + 'c'.repeat(126), { students: [] }).ok, '129 characters is too long');
});
check('shared password: printable ASCII only, no spaces or control characters', () => {
  ok(!sharedPw.validateSharedPassword('Kozhikode 2026!', { students: [] }).ok, 'space');
  ok(!sharedPw.validateSharedPassword('Kozhikode2026\u00e9!', { students: [] }).ok, 'non-ASCII');
  ok(!sharedPw.validateSharedPassword('Kozhikode2026\t!', { students: [] }).ok, 'tab');
});
check('shared password: the app policy applies (letter AND digit, no common word)', () => {
  ok(!sharedPw.validateSharedPassword('Kozhikodeonly!!', { students: [] }).ok, 'no digit');
  ok(!sharedPw.validateSharedPassword('1234567890123', { students: [] }).ok, 'no letter');
});
check('shared password: at least 6 different characters', () => {
  ok(!sharedPw.validateSharedPassword('Aaaaaaaaaaaa1', { students: [] }).ok, 'low variety');
});
check('shared password: must not contain any roster username, name, or name token (4+ letters)', () => {
  ok(!sharedPw.validateSharedPassword('Sayyid9Mango!', { students: ROSTER_STUDENTS }).ok, 'name');
  ok(!sharedPw.validateSharedPassword('Muhsin2026Secure', { students: ROSTER_STUDENTS }).ok, 'name token');
  ok(!sharedPw.validateSharedPassword('Chelakkulam7x!', { students: ROSTER_STUDENTS }).ok, 'second name token');
  ok(!sharedPw.validateSharedPassword('Zain2026-trust', { students: ROSTER_STUDENTS }).ok, 'zain token');
  ok(sharedPw.validateSharedPassword('Kozhikode2026!', { students: ROSTER_STUDENTS }).ok, 'an unrelated word is fine');
});
check('shared password: the REAL roster rejects a password built from any student name', () => {
  const roster = planLibForPw().buildRoster(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'roster.json'), 'utf8')));
  ok(!sharedPw.validateSharedPassword('Sayyid2026!Mango', { students: roster }).ok, 'Sayyid Zain');
  ok(!sharedPw.validateSharedPassword('Midlaj2026!Kozh', { students: roster }).ok, 'Midlaj');
  ok(sharedPw.validateSharedPassword(GOOD, { students: roster }).ok, 'the example is accepted against the real roster');
});
check('shared file: a valid 0600 file is read (one trailing newline removed)', () => {
  const f = secretFile('ok.txt', GOOD + '\n');
  const r = sharedPw.readSharedPasswordFile(f, { students: ROSTER_STUDENTS });
  eq(r.password, GOOD);
  eq(r.length, GOOD.length);
});
check('shared file: CRLF line endings and a 0400 file are accepted', () => {
  const f = secretFile('crlf.txt', GOOD + '\r\n', 0o400);
  eq(sharedPw.readSharedPasswordFile(f, { students: ROSTER_STUDENTS }).password, GOOD);
});
check('shared file: a missing file is refused', () => {
  throwsMatching(() => sharedPw.readSharedPasswordFile(path.join(sharedDir, 'nope.txt'), {}), /not found/);
});
check('shared file: a group- or other-readable file is refused (0644, 0640, 0604)', () => {
  for (const mode of [0o644, 0o640, 0o604]) {
    const f = secretFile('mode' + mode + '.txt', GOOD + '\n', mode);
    throwsMatching(() => sharedPw.readSharedPasswordFile(f, {}), /group\/other/);
  }
});
check('shared file: a symbolic link is refused', () => {
  const real = secretFile('real.txt', GOOD + '\n');
  const link = path.join(sharedDir, 'link.txt');
  fs.symlinkSync(real, link);
  throwsMatching(() => sharedPw.readSharedPasswordFile(link, {}), /symbolic link/);
});
check('shared file: a directory is refused', () => {
  throwsMatching(() => sharedPw.readSharedPasswordFile(sharedDir, {}), /regular file/);
});
check('shared file: empty, two-line and oversized files are refused', () => {
  throwsMatching(() => sharedPw.readSharedPasswordFile(secretFile('e.txt', '\n'), {}), /empty/);
  throwsMatching(() => sharedPw.readSharedPasswordFile(secretFile('two.txt', GOOD + '\nagain\n'), {}), /exactly one line/);
  throwsMatching(() => sharedPw.readSharedPasswordFile(secretFile('big.txt', 'A'.repeat(2000) + '1\n'), {}), /too large/);
});
check('shared file: the policy is applied to the file content (a name is refused, the reason is generic)', () => {
  throwsMatching(() => sharedPw.readSharedPasswordFile(secretFile('name.txt', 'Muhsin2026Secure\n'),
    { students: ROSTER_STUDENTS }), /must not contain/);
});
check('shared file: a file INSIDE the repository must be git-ignored (checked with git)', () => {
  const repo = fs.mkdtempSync(path.join(sharedDir, 'repo-'));
  spawnSync('git', ['init', '-q'], { cwd: repo });
  fs.writeFileSync(path.join(repo, '.gitignore'), 'secret-pass.txt\n');
  const open = path.join(repo, 'plain-pass.txt');
  fs.writeFileSync(open, GOOD + '\n', { mode: 0o600 });
  throwsMatching(() => sharedPw.readSharedPasswordFile(open, { repoRoot: repo }), /NOT git-ignored/);
  const ignored = path.join(repo, 'secret-pass.txt');
  fs.writeFileSync(ignored, GOOD + '\n', { mode: 0o600 });
  eq(sharedPw.readSharedPasswordFile(ignored, { repoRoot: repo }).password, GOOD, 'ignored file is accepted');
});
check('shared file: git-ignore protection exists in both .gitignore files (defence in depth)', () => {
  const root = fs.readFileSync(path.join(__dirname, '..', '..', '..', '.gitignore'), 'utf8');
  const local = fs.readFileSync(path.join(__dirname, '..', '.gitignore'), 'utf8');
  ok(root.includes('tools/provision/shared-initial-password'), 'root .gitignore');
  ok(local.includes('shared-initial-password'), 'tools/provision/.gitignore');
});
check('shared file: the module never exposes the password through its error messages', () => {
  throwsMatching(() => sharedPw.readSharedPasswordFile(secretFile('bad.txt', 'Sayyid2026!\n'), { students: ROSTER_STUDENTS }), /must not contain|at least/);
});

/* ---------------- test-only relaxation (lib/shared-password.js testMode) ---------------- */
check('test mode: a 6-character password is accepted ONLY in test mode', () => {
  ok(!sharedPw.validateSharedPassword('Adil42', { students: ROSTER_STUDENTS }).ok, 'secure mode refuses 6 characters');
  ok(sharedPw.validateSharedPassword('Adil42', { students: ROSTER_STUDENTS, testMode: true }).ok, 'test mode accepts 6');
  ok(!sharedPw.validateSharedPassword('Adil4', { students: [], testMode: true }).ok, 'test mode still refuses 5');
});
check('test mode: the roster name/username check is skipped, nothing else is', () => {
  ok(sharedPw.validateSharedPassword('Sayyid9', { students: ROSTER_STUDENTS, testMode: true }).ok, 'roster name allowed in test mode');
  ok(!sharedPw.validateSharedPassword('Sayyid9', { students: ROSTER_STUDENTS }).ok, 'roster name refused in secure mode');
  ok(!sharedPw.validateSharedPassword('abcdef', { testMode: true }).ok, 'letter AND digit still required');
  ok(!sharedPw.validateSharedPassword('ab 12cd', { testMode: true }).ok, 'no spaces in test mode either');
  ok(!sharedPw.validateSharedPassword('Ab1Ab1', { testMode: true }).ok, 'the 6-distinct-character rule still applies');
  ok(!sharedPw.validateSharedPassword('Ab1' + 'c'.repeat(126), { testMode: true }).ok, 'the 128 maximum still applies');
});
check('test mode: readSharedPasswordFile applies the same file rules (mode, one line) and reports testMode', () => {
  const f = secretFile('tm-ok.txt', 'Adil42\n');
  const r = sharedPw.readSharedPasswordFile(f, { students: ROSTER_STUDENTS, testMode: true });
  eq(r.password, 'Adil42'); eq(r.testMode, true);
  throwsMatching(() => sharedPw.readSharedPasswordFile(secretFile('tm-644.txt', 'Adil42\n', 0o644), { testMode: true }), /group\/other/);
  throwsMatching(() => sharedPw.readSharedPasswordFile(secretFile('tm-two.txt', 'Adil42\nx\n'), { testMode: true }), /exactly one line/);
  eq(sharedPw.readSharedPasswordFile(secretFile('sec.txt', GOOD + '\n'), { students: ROSTER_STUDENTS }).testMode, false, 'secure default reports testMode false');
});
function planLibForPw() { return require('../lib/plan'); }

fs.rmSync(tmpRoot, { recursive: true, force: true });
fs.rmSync(sharedDir, { recursive: true, force: true });

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
