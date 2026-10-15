// tools/provision/lib/shared-password.js
// OPT-IN owner-supplied SHARED INITIAL password for newly created student
// accounts (`apply --shared-password-file <path>`).
//
// Default behaviour is unchanged: every new account gets its own random
// password (lib/passwords.js). The shared mode exists only because the owner
// has to hand the same starting password to a group of students. Its rules:
//
//   * read from a LOCAL file that the owner creates (one line, nothing else);
//     the password is never a command-line argument and never printed/logged;
//   * the file must be a regular file (not a symlink), owned by the current
//     OS user, with NO group or other permission bits (0600 or 0400);
//   * a file inside the repository must be git-ignored (`git check-ignore`);
//   * printable ASCII, no spaces, 12–128 characters and at least 6 different
//     characters (stricter than the app's 6-character minimum, because one
//     password guards many accounts);
//   * must satisfy mobile/src/identity.js → validatePasswordPolicy() for EVERY
//     roster student, so it can never contain a student's username or name,
//     including any single name token of 4+ characters;
//   * it is used ONLY for accounts that do not exist yet. Existing accounts are
//     never touched by apply; resetting them stays the separate, explicit
//     `reset-password --apply` command with random passwords.
//
// Error messages in this module never include the password.
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const identity = require('../../../mobile/src/identity.js');

const SHARED_MIN_LENGTH = 12;
const SHARED_MAX_LENGTH = 128;
const MAX_FILE_BYTES = 1024;

function nameTokens(name) {
  return String(name || '').toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 4);
}

// Returns { ok: true } or { ok: false, reason } — `reason` never echoes the password.
function validateSharedPassword(password, { students = [] } = {}) {
  if (typeof password !== 'string') return { ok: false, reason: 'password must be text' };
  if (password.length < SHARED_MIN_LENGTH) {
    return { ok: false, reason: 'password must be at least ' + SHARED_MIN_LENGTH + ' characters' };
  }
  if (password.length > SHARED_MAX_LENGTH) {
    return { ok: false, reason: 'password must be at most ' + SHARED_MAX_LENGTH + ' characters' };
  }
  if (!/^[\x21-\x7e]+$/.test(password)) {
    return { ok: false, reason: 'password must use printable ASCII letters, digits and symbols only (no spaces)' };
  }
  const policy = identity.validatePasswordPolicy(password);
  if (!policy.ok) return { ok: false, reason: 'password does not meet the app policy: ' + policy.reason };
  if (new Set(password).size < 6) return { ok: false, reason: 'password must use at least 6 different characters' };

  for (const s of students) {
    const pieces = [s.username, s.name].concat(nameTokens(s.name));
    for (const piece of pieces) {
      if (!piece) continue;
      const r = identity.validatePasswordPolicy(password, { username: piece, name: piece });
      if (!r.ok) {
        return { ok: false, reason: 'password must not contain any student username or name (checked against the roster)' };
      }
    }
  }
  return { ok: true };
}

function isInside(child, parent) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

// Is `file` git-ignored? Returns true/false; a git error is treated as "not verified".
function isGitIgnored(file, repoRoot) {
  const res = spawnSync('git', ['check-ignore', '-q', '--', file], { cwd: repoRoot, encoding: 'utf8' });
  if (res.error) return false;
  return res.status === 0;
}

// Reads and validates the shared-password file. Throws an Error with a
// human-readable reason on any problem. On success returns
// { password, file, length } — the caller must not print `password`.
function readSharedPasswordFile(file, { students = [], repoRoot = null } = {}) {
  if (!file || typeof file !== 'string') throw new Error('--shared-password-file needs a path');
  const abs = path.resolve(file.startsWith('~/') ? path.join(require('os').homedir(), file.slice(2)) : file);

  let st;
  try {
    st = fs.lstatSync(abs);
  } catch (e) {
    throw new Error('shared password file not found: ' + abs);
  }
  if (st.isSymbolicLink()) throw new Error('shared password file must not be a symbolic link: ' + abs);
  if (!st.isFile()) throw new Error('shared password file must be a regular file: ' + abs);
  if (typeof process.getuid === 'function' && st.uid !== process.getuid()) {
    throw new Error('shared password file must be owned by the current user: ' + abs);
  }
  if ((st.mode & 0o077) !== 0) {
    throw new Error('shared password file is readable by group/other (mode ' +
      (st.mode & 0o777).toString(8).padStart(3, '0') + '); run: chmod 600 ' + JSON.stringify(abs));
  }
  if (st.size > MAX_FILE_BYTES) throw new Error('shared password file is too large (expected one line)');
  if (repoRoot && isInside(abs, path.resolve(repoRoot)) && !isGitIgnored(abs, repoRoot)) {
    throw new Error('shared password file is inside the repository and is NOT git-ignored; move it outside the repo (recommended) or add it to .gitignore');
  }

  let raw = fs.readFileSync(abs, 'utf8');
  if (raw.endsWith('\r\n')) raw = raw.slice(0, -2);
  else if (raw.endsWith('\n')) raw = raw.slice(0, -1);
  if (raw.length === 0) throw new Error('shared password file is empty');
  if (/[\r\n]/.test(raw)) throw new Error('shared password file must contain exactly one line');

  const check = validateSharedPassword(raw, { students });
  if (!check.ok) throw new Error('shared password rejected: ' + check.reason);
  return { password: raw, file: abs, length: raw.length };
}

module.exports = {
  readSharedPasswordFile,
  validateSharedPassword,
  SHARED_MIN_LENGTH,
  SHARED_MAX_LENGTH,
  _internals: { nameTokens, isInside },
};
