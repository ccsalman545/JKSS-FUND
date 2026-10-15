// tools/provision/lib/passwords.js
// Cryptographically random temporary passwords for student accounts.
//
// Rules honored here (see docs/USERNAME_LOGIN.md):
//   * NEVER a name-based/predictable password (no "sayyid123"),
//   * the DEFAULT is a unique random password per account. The only shared
//     password is the OPT-IN owner-supplied initial password read from a local
//     file by `apply --shared-password-file` (lib/shared-password.js). It is
//     never generated here, and `reset-password` always uses this generator,
//   * generated with Node's CSPRNG (crypto.randomInt — unbiased rejection
//     sampling), not Math.random,
//   * unambiguous alphabet (no O/0, I/l/1) because these are dictated to
//     students over the phone / written on paper,
//   * always satisfies mobile/src/identity.js → validatePasswordPolicy().
'use strict';

const crypto = require('crypto');

const LOWER = 'abcdefghijkmnopqrstuvwxyz'; // no 'l'
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';  // no 'I', 'O'
const DIGITS = '23456789';                 // no '0', '1'
const SYMBOLS = '!@#$%^&*-_=+?';
const ALL = LOWER + UPPER + DIGITS + SYMBOLS;

const TEMP_PASSWORD_LENGTH = 16;

function randomInt(max) {
  if (!Number.isInteger(max) || max <= 0) throw new Error('randomInt(max) needs a positive integer');
  return crypto.randomInt(max); // Node >= 14.10: unbiased, CSPRNG-backed
}

function pick(alphabet) {
  return alphabet[randomInt(alphabet.length)];
}

function shuffle(list) {
  const arr = list.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

// A 16-character password guaranteed to contain lower, upper, digit and symbol
// classes, drawn from the unambiguous alphabet above.
function generateTemporaryPassword({ length = TEMP_PASSWORD_LENGTH } = {}) {
  if (!Number.isInteger(length) || length < 8) {
    throw new Error('Temporary passwords must be at least 8 characters');
  }
  const chars = [pick(LOWER), pick(UPPER), pick(DIGITS), pick(SYMBOLS)];
  while (chars.length < length) chars.push(pick(ALL));
  return shuffle(chars).join('');
}

module.exports = {
  generateTemporaryPassword,
  TEMP_PASSWORD_LENGTH,
  ALPHABETS: { LOWER, UPPER, DIGITS, SYMBOLS, ALL },
  _internals: { randomInt, shuffle, pick },
};
