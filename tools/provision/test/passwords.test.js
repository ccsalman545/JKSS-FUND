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

fs.rmSync(tmpRoot, { recursive: true, force: true });

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
