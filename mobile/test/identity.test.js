// test/identity.test.js
// Real Node execution of mobile/src/identity.js — the username <-> internal
// Firebase identifier mapping that the login form, the security model and the
// provisioning tool all depend on.
// Run:  node test/identity.test.js
'use strict';

const identity = require('../src/identity');

const {
  STUDENT_EMAIL_DOMAIN, USERNAME_MIN_LENGTH, USERNAME_MAX_LENGTH,
  PASSWORD_MIN_LENGTH, slugifyName, normalizeUsername, isValidUsername,
  assertUsername, identifierFor, isStudentIdentifier, usernameFromIdentifier,
  isEmailShaped, resolveLogin, displayUsername, assignUsernames,
  validatePasswordPolicy,
} = identity;

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
function assertThrows(fn, re, msg) {
  try {
    fn();
  } catch (e) {
    if (re && !re.test(String(e.message))) {
      throw new Error((msg || 'throw message') + ': got "' + e.message + '"');
    }
    return;
  }
  throw new Error((msg || 'expected throw') + ': no error thrown');
}
function ok(v, msg) { if (!v) throw new Error(msg || 'expected truthy'); }

console.log('identity.js — username ↔ internal identifier mapping');

/* ----------------------------- the domain ---------------------------- */
check('domain is an RFC 2606 reserved, non-routable TLD', () => {
  ok(STUDENT_EMAIL_DOMAIN.endsWith('.invalid'), 'must end in the reserved .invalid TLD');
  ok(!/@/.test(STUDENT_EMAIL_DOMAIN), 'domain must not contain @');
});

/* --------------------------- slugifyName ----------------------------- */
check('slugify: plain single name', () => eq(slugifyName('Thangal'), 'thangal'));
check('slugify: two names -> dotted', () => eq(slugifyName('Muhsin Chelakkulam'), 'muhsin.chelakkulam'));
check('slugify: suffix part (Adil Jr)', () => eq(slugifyName('Adil Jr'), 'adil.jr'));
check('slugify: caseless', () => eq(slugifyName('SALAHUDHEEN'), 'salahudheen'));
check('slugify: surrounding + repeated whitespace', () => eq(slugifyName('  Muhsin   Payyoli  '), 'muhsin.payyoli'));
check('slugify: hyphens become separators', () => eq(slugifyName('Abdul-Rahman'), 'abdul.rahman'));
check('slugify: apostrophes vanish (no split)', () => eq(slugifyName("D'Souza"), 'dsouza'));
check('slugify: unicode diacritics degrade to ASCII', () => eq(slugifyName('Ālī Husain'), 'ali.husain'));
check('slugify: no leading/trailing separators', () => {
  eq(slugifyName('  ...Ali...  '), 'ali');
  eq(slugifyName('-Ali-'), 'ali');
});
check('slugify: empty/odd input -> empty string', () => {
  eq(slugifyName(''), '');
  eq(slugifyName(null), '');
  eq(slugifyName(undefined), '');
  eq(slugifyName('!!!'), '');
});

/* ------------------------ normalizeUsername -------------------------- */
check('normalize: trims + lowercases', () => eq(normalizeUsername('  Thangal '), 'thangal'));
check('normalize: strips a leading @ (handle form)', () => eq(normalizeUsername('@Midlaj'), 'midlaj'));
check('normalize: spaces typed by a user become separators', () => {
  eq(normalizeUsername('Muhsin Chelakkulam'), 'muhsin.chelakkulam');
});
check('normalize: collapses doubled separators', () => eq(normalizeUsername('a..b'), 'a.b'));
check('normalize: NEVER silently drops invalid characters', () => {
  eq(normalizeUsername('thangal!'), 'thangal!'); // stays invalid on purpose
  eq(normalizeUsername('a<b>c'), 'a<b>c');
  eq(normalizeUsername('thangal@x'), 'thangal@x');
});
check('normalize: does not escape the local part (no @ survives validation)', () => {
  eq(isValidUsername(normalizeUsername('thangal@evil.tld')), false);
});
check('normalize: is idempotent', () => {
  ['thangal', 'Muhsin Chelakkulam', '@Adil Jr', 'a..b', 'Abdul-Rahman'].forEach((x) => {
    const once = normalizeUsername(x);
    eq(normalizeUsername(once), once, 'not idempotent for ' + x);
  });
});

/* ------------------------- username validity ------------------------- */
check('valid usernames', () => {
  ['thangal', 'muhsin.chelakkulam', 'adil.jr', 'salahudheen', 'abc', 'user.1', 'a'.repeat(48)]
    .forEach((u) => ok(isValidUsername(u), u + ' should be valid'));
});
check('invalid usernames (charset / shape)', () => {
  ['', 'a', 'ab', '.abc', 'abc.', '-abc', 'abc-', '_abc', 'a..b', 'thangal!', 'thangal@x',
   'Thangal', 'thangal ', 'thangal\u00a0', 'a b', 'x'.repeat(49)]
    .forEach((u) => eq(isValidUsername(u), false, u + ' should be invalid'));
});
check('assertUsername throws a helpful message on junk', () => {
  assertThrows(() => assertUsername('thangal!'), /letters, numbers, dots/);
  assertThrows(() => assertUsername('   '), /Enter a username/);
});
check('assertUsername returns the canonical form', () => eq(assertUsername(' @Thangal  '), 'thangal'));

/* --------------------------- identifierFor --------------------------- */
check('identifierFor: exact shape', () => {
  eq(identifierFor('thangal'), 'thangal@' + STUDENT_EMAIL_DOMAIN);
  eq(identifierFor('Muhsin Chelakkulam'), 'muhsin.chelakkulam@' + STUDENT_EMAIL_DOMAIN);
});
check('identifierFor: normalizes before mapping (case/space insensitive)', () => {
  eq(identifierFor(' THANGAL '), identifierFor('thangal'));
});
check('identifierFor: rejects anything that is not a valid username', () => {
  assertThrows(() => identifierFor('thangal@evil.tld'), /letters, numbers, dots/);
  assertThrows(() => identifierFor('a b!'), /letters, numbers, dots/);
});
check('identifierFor: the mapped identifier is email-shaped (Firebase requirement)', () => {
  ['thangal', 'muhsin.chelakkulam', 'adil.jr'].forEach((u) => ok(isEmailShaped(identifierFor(u))));
});
check('identifierFor: injective on valid usernames', () => {
  const seen = new Map();
  const samples = [];
  for (let i = 0; i < 2000; i++) samples.push('u' + i + '.' + (i % 7));
  samples.push('thangal', 'thangal.2', 'thangal.3', 'thangal.a', 'a.b', 'abc', 'thangal-2');
  samples.forEach((u) => {
    const id = identifierFor(u);
    if (seen.has(id) && seen.get(id) !== u) throw new Error('collision: ' + id);
    seen.set(id, u);
  });
});
check('identifierFor: never produces a routable/real address', () => {
  ok(!/gmail\.com|\.com$|\.in$|\.org$|\.net$/.test(identifierFor('thangal')));
});

/* ------------------- identifier -> username (reverse) ---------------- */
check('usernameFromIdentifier: round trip', () => {
  ['thangal', 'muhsin.chelakkulam', 'adil.jr', 'swabeeh'].forEach((u) => {
    eq(usernameFromIdentifier(identifierFor(u)), u);
  });
});
check('usernameFromIdentifier: real emails and junk -> null', () => {
  [null, undefined, '', 'thrikkakarajkss@gmail.com', 'a@b.invalid', 'thangal@students.other.invalid']
    .forEach((x) => eq(usernameFromIdentifier(x), null, String(x)));
});
check('isStudentIdentifier: distinguishes synthetic from real', () => {
  eq(isStudentIdentifier(identifierFor('thangal')), true);
  eq(isStudentIdentifier('thrikkakarajkss@gmail.com'), false);
  eq(isStudentIdentifier('x@' + STUDENT_EMAIL_DOMAIN), false); // 'x' is too short
});
check('displayUsername: handle for both identity kinds', () => {
  eq(displayUsername(identifierFor('muhsin.payyoli')), 'muhsin.payyoli');
  eq(displayUsername('admin@jkss.in'), 'admin');
});

/* ---------------------------- resolveLogin --------------------------- */
check('resolveLogin: assigned username -> synthetic identifier', () => {
  const r = resolveLogin('Thangal');
  eq(r.kind, 'username');
  eq(r.username, 'thangal');
  eq(r.identifier, identifierFor('thangal'));
});
check('resolveLogin: two-word name typed in full still resolves', () => {
  eq(resolveLogin('Muhsin Payyoli').identifier, identifierFor('muhsin.payyoli'));
});
check('resolveLogin: @handle form is a username, not an email', () => {
  const r = resolveLogin('  @Adil.Jr ');
  eq(r.kind, 'username');
  eq(r.username, 'adil.jr');
  eq(r.identifier, identifierFor('adil.jr'));
});
check('resolveLogin: admin email stays a real email (unchanged password/account)', () => {
  const r = resolveLogin('  ThrikkakaraJKSS@Gmail.com ');
  eq(r.kind, 'email');
  eq(r.identifier, 'thrikkakarajkss@gmail.com');
});
check('resolveLogin: malformed email rejected', () => {
  assertThrows(() => resolveLogin('admin@'), /valid email/i);
  assertThrows(() => resolveLogin('a@b@c'), /valid email/i);
  assertThrows(() => resolveLogin('admin@gmail'), /valid email/i);
});
check('resolveLogin: invalid username characters rejected before any auth call', () => {
  assertThrows(() => resolveLogin('thangal!'), /letters, numbers, dots/i);
  assertThrows(() => resolveLogin('thangal;drop'), /letters, numbers, dots/i);
  assertThrows(() => resolveLogin('тхангал'), /letters, numbers, dots/i);
});
check('resolveLogin: any email-shaped input takes the email path (admin / legacy login)', () => {
  // An arbitrary real-looking email is NOT turned into a synthetic identifier;
  // it is passed to Firebase Auth as-is. Only a pre-authorized profile can use
  // it, so this cannot be used to reach another fund identity.
  const r = resolveLogin('someone@evil.tld');
  eq(r.kind, 'email');
  eq(r.identifier, 'someone@evil.tld');
  eq(isStudentIdentifier(r.identifier), false);
});
check('resolveLogin: empty input rejected', () => {
  assertThrows(() => resolveLogin(''), /Enter your username/);
  assertThrows(() => resolveLogin('   '), /Enter your username/);
  assertThrows(() => resolveLogin(null), /Enter your username/);
});
check('resolveLogin: an identifier pasted into the username box is treated as an email', () => {
  const r = resolveLogin(identifierFor('thangal'));
  eq(r.kind, 'email');
  eq(r.identifier, identifierFor('thangal'));
});

/* ------------------- roster assignment + collisions ------------------ */
const ROSTER = [
  'Thangal', 'Shafi', 'Aboobacker', 'Salman', 'Hamid', 'Muhsin Chelakkulam',
  'Midlaj', 'Haneen', 'Swalih', 'Adil', 'Muhsin Payyoli', 'Salahudheen',
  'Irfan', 'Thalhath', 'Sinan', 'Thajudheen', 'Suhail', 'Anwar', 'Swabeeh',
  'Muneeb', 'Bilal', 'Sidheeq', 'Aflah', 'Adil Jr',
];

check('roster: 24 names -> 24 unique valid usernames', () => {
  const rows = assignUsernames(ROSTER);
  eq(rows.length, 24);
  eq(new Set(rows.map((r) => r.username)).size, 24);
  eq(new Set(rows.map((r) => r.identifier)).size, 24);
  rows.forEach((r) => ok(isValidUsername(r.username), 'invalid username ' + r.username));
});
check('roster: exact expected mapping (stable, reviewable)', () => {
  const expected = [
    'thangal', 'shafi', 'aboobacker', 'salman', 'hamid', 'muhsin.chelakkulam',
    'midlaj', 'haneen', 'swalih', 'adil', 'muhsin.payyoli', 'salahudheen',
    'irfan', 'thalhath', 'sinan', 'thajudheen', 'suhail', 'anwar', 'swabeeh',
    'muneeb', 'bilal', 'sidheeq', 'aflah', 'adil.jr',
  ];
  eq(assignUsernames(ROSTER).map((r) => r.username).join(','), expected.join(','));
});
check('roster: order preserved (index + name round trip)', () => {
  const rows = assignUsernames(ROSTER);
  rows.forEach((r, i) => { eq(r.index, i); eq(r.name, ROSTER[i]); });
});
check('roster: deterministic across runs', () => {
  eq(JSON.stringify(assignUsernames(ROSTER)), JSON.stringify(assignUsernames(ROSTER.slice())));
});
check('roster: whitespace/case edits in the roster file do not change usernames', () => {
  const tweaked = ROSTER.map((n) => ' ' + n.toUpperCase() + '  ');
  eq(
    assignUsernames(tweaked).map((r) => r.username).join(','),
    assignUsernames(ROSTER).map((r) => r.username).join(',')
  );
});
check('duplicate name: first keeps the slug, later ones get .2 / .3', () => {
  const rows = assignUsernames(['Salman', 'Salman', 'Salman']);
  eq(rows.map((r) => r.username).join(','), 'salman,salman.2,salman.3');
  eq(rows.map((r) => r.source).join(','), 'derived,derived+collision,derived+collision');
});
check('duplicate name: resolution is deterministic (not random)', () => {
  const a = assignUsernames(['Adil', 'Adil']).map((r) => r.username).join(',');
  const b = assignUsernames(['Adil', 'Adil']).map((r) => r.username).join(',');
  eq(a, 'adil,adil.2');
  eq(a, b);
});
check('collision with a literal suffixed name is still resolved uniquely', () => {
  // "Adil" (x2) then a literal "Adil 2": adil, adil.2, then base adil.2 taken
  // -> adil.2.2. Deterministic and collision-free.
  const rows = assignUsernames(['Adil', 'Adil', 'Adil 2']);
  eq(rows.map((r) => r.username).join(','), 'adil,adil.2,adil.2.2');
  eq(new Set(rows.map((r) => r.username)).size, 3);
});
check('collision where the plain name is NOT first: still deterministic + unique', () => {
  const rows = assignUsernames(['Muhsin Chelakkulam', 'Muhsin', 'Muhsin']);
  eq(rows.map((r) => r.username).join(','), 'muhsin.chelakkulam,muhsin,muhsin.2');
});
check('a derived name can never steal an explicitly assigned username', () => {
  const rows = assignUsernames([
    { name: 'Some New Guy', username: 'adil' }, // explicit reservation
    'Adil',                                     // derived base is taken
  ]);
  eq(rows.map((r) => r.username).join(','), 'adil,adil.2');
  ok(rows.some((r) => r.source === 'assigned'));
});
check('duplicate *explicit* usernames are a hard error (no silent guessing)', () => {
  assertThrows(() => assignUsernames([
    { name: 'A', username: 'adil' },
    { name: 'B', username: 'Adil' },
  ]), /Duplicate explicit username/);
});
check('a name that cannot produce a username is an error, not a made-up one', () => {
  assertThrows(() => assignUsernames(['', 'Thangal']), /no usable name/);
  assertThrows(() => assignUsernames(['!!!']), /Cannot derive a username/);
});
check('object entries without a username behave like string entries', () => {
  const rows = assignUsernames([{ name: 'Adil' }, { name: 'Adil Jr' }]);
  eq(rows.map((r) => r.username).join(','), 'adil,adil.jr');
});

/* ------------------------ password policy --------------------------- */
check('password policy: length floor is Firebase-compatible', () => eq(PASSWORD_MIN_LENGTH, 6));
check('password policy: accepts a reasonable user password', () => {
  eq(validatePasswordPolicy('fund2026x', { username: 'thangal', name: 'Thangal' }).ok, true);
});
check('password policy: rejects too-short / all-letters / all-digits', () => {
  eq(validatePasswordPolicy('abc12').ok, false);
  eq(validatePasswordPolicy('abcdefg').ok, false);
  eq(validatePasswordPolicy('123456').ok, false);
});
check('password policy: rejects passwords containing the username', () => {
  eq(validatePasswordPolicy('thangal1', { username: 'thangal' }).ok, false);
  eq(validatePasswordPolicy('Thangal2026', { username: 'thangal' }).ok, false);
  eq(validatePasswordPolicy('xx-thangal-99', { username: 'thangal' }).ok, false);
  eq(validatePasswordPolicy('muhsinchelakkulam9', { username: 'muhsin.chelakkulam' }).ok, false);
});
check('password policy: rejects passwords containing the display name', () => {
  eq(validatePasswordPolicy('Salman2026', { name: 'Salman' }).ok, false);
  eq(validatePasswordPolicy('m01-muneeb-88', { name: 'Muneeb' }).ok, false);
});
check('password policy: a short username (<4 chars) does not over-reject', () => {
  eq(validatePasswordPolicy('cool9alias', { username: 'abc' }).ok, true);
});
check('password policy: rejects the classic top-of-list passwords', () => {
  ['password', '123456', 'qwerty', 'admin'].forEach((p) => {
    eq(validatePasswordPolicy(p).ok, false, p);
  });
});

/* ------------------------- fuzz / invariants ------------------------ */
check('fuzz: 20k random strings never produce an identifier outside the domain', () => {
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ._-@!#$%^&*()/\\';
  for (let i = 0; i < 20000; i++) {
    let s = '';
    const len = Math.floor(Math.random() * 20);
    for (let j = 0; j < len; j++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
    const u = normalizeUsername(s);
    if (!isValidUsername(u)) continue;
    const id = identifierFor(u);
    ok(isStudentIdentifier(id), 'identifier escaped the domain: ' + id);
    eq(usernameFromIdentifier(id), u);
    ok(id.indexOf('@') === id.lastIndexOf('@'), 'multiple @ in ' + id);
  }
});
check('fuzz: identifierFor/usernameFromIdentifier round-trip on generated names', () => {
  const firsts = ['Abdul', 'Muhammad', 'Ali', 'Sinan', 'Adil', 'Suhail', 'Muhsin', 'Rasheed'];
  const lasts = ['Chelakkulam', 'Payyoli', 'Jr', 'Khan', 'Haji', 'P', ''];
  for (const f of firsts) {
    for (const l of lasts) {
      const name = (f + ' ' + l).trim();
      const u = slugifyName(name);
      if (!isValidUsername(u)) continue;
      eq(usernameFromIdentifier(identifierFor(u)), u, name);
    }
  }
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
