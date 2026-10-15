// tools/provision/lib/credentials.js
// Local credentials file (usernames + temporary passwords) handling.
//
//   * Written with mode 0600 inside a 0700 directory — readable only by the
//     admin's OS user.
//   * NEVER overwrites an existing password (a rerun cannot silently change a
//     student's password; resets are an explicit `reset-password` action that
//     appends to `passwordResets`).
//   * Atomic writes (temp file + rename) so a killed process cannot truncate
//     the list of passwords.
//   * The file is excluded from Git by tools/provision/.gitignore and the
//     repository .gitignore; the tool refuses to write it inside a tracked
//     path pattern (i.e. it prints a warning if the target would be committed).
'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_FILE = path.join(__dirname, '..', 'credentials.json');

function ensureSecureDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(dir, 0o700); } catch (e) { /* best effort (e.g. Windows) */ }
}

function readCredentials(file = DEFAULT_FILE) {
  if (!fs.existsSync(file)) return null;
  const raw = fs.readFileSync(file, 'utf8');
  if (!raw.trim()) return null;
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object') throw new Error('Malformed credentials file: ' + file);
  if (!Array.isArray(parsed.students)) parsed.students = [];
  if (!Array.isArray(parsed.passwordResets)) parsed.passwordResets = [];
  return parsed;
}

function emptyCredentials({ project = null, domain = null, dryRun = false } = {}) {
  return {
    _comment: 'JKSS-FUND student login credentials. CONTAINS PLAINTEXT PASSWORDS — ' +
      'distribute each password to its student, then store this file in a password ' +
      'manager and delete it. Never commit it (tools/provision/.gitignore).',
    project,
    domain,
    generatedAt: new Date().toISOString(),
    dryRun,
    students: [],
    passwordResets: [],
  };
}

function writeCredentials(file, data) {
  const abs = path.resolve(file);
  ensureSecureDir(path.dirname(abs));
  const tmp = abs + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, abs);
  try { fs.chmodSync(abs, 0o600); } catch (e) { /* best effort */ }
  return abs;
}

function findStudent(data, username) {
  if (!data) return null;
  const key = String(username || '').toLowerCase();
  return data.students.find((s) => String(s.username || '').toLowerCase() === key) || null;
}

// Record a newly created account. If the username is already recorded, the
// EXISTING password is kept (never overwritten) and `keptExistingPassword` is
// reported so callers can log it.
function upsertStudent(data, entry) {
  const existing = findStudent(data, entry.username);
  if (existing) {
    const merged = Object.assign(existing, {
      name: entry.name != null ? entry.name : existing.name,
      identifier: entry.identifier || existing.identifier,
      status: entry.status || existing.status,
      updatedAt: new Date().toISOString(),
    });
    merged.keptExistingPassword = true;
    return { record: merged, keptExistingPassword: true };
  }
  const record = Object.assign({
    createdAt: new Date().toISOString(),
  }, entry);
  data.students.push(record);
  return { record, keptExistingPassword: false };
}

function recordPasswordReset(data, { username, identifier, password, by = 'admin (local tool)' }) {
  const at = new Date().toISOString();
  const student = findStudent(data, username);
  if (student) {
    student.password = password;
    student.passwordResetAt = at;
    student.status = 'password-reset';
  } else {
    data.students.push({
      username, identifier, password, status: 'password-reset', createdAt: at,
    });
  }
  data.passwordResets.push({ username, identifier, password, at, by });
  return data;
}

function modeOf(file) {
  try { return (fs.statSync(file).mode & 0o777).toString(8).padStart(3, '0'); }
  catch (e) { return null; }
}

module.exports = {
  DEFAULT_FILE,
  readCredentials,
  emptyCredentials,
  writeCredentials,
  upsertStudent,
  recordPasswordReset,
  findStudent,
  ensureSecureDir,
  modeOf,
};
