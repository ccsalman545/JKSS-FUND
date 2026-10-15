// test/accounting.test.js
// Real Node execution of mobile/src/accounting.js — the financial core.
// Run:  node test/accounting.test.js
'use strict';

const {
  toPaise, paiseToRupees, paiseOf, splitShares,
  allocateLargestRemainder, assertAllocationsExact,
} = require('../src/accounting');

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
  if (a !== b) throw new Error((msg || 'eq') + ': ' + a + ' !== ' + b);
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

console.log('accounting.js — pure paise math');

/* ------------------------------ toPaise ------------------------------ */
check('toPaise: whole rupees', () => eq(toPaise(123), 12300));
check('toPaise: paise step', () => eq(toPaise(123.45), 12345));
check('toPaise: single paisa', () => eq(toPaise(0.01), 1));
check('toPaise: float drift 0.1+0.2', () => eq(toPaise(0.1 + 0.2), 30));
check('toPaise: float drift 19.99/100*100', () => eq(toPaise(Math.round(1999 / 100 * 100) / 100), 1999));
check('toPaise: large amount', () => eq(toPaise(999999.99), 99999999));
check('toPaise: zero', () => eq(toPaise(0), 0));
check('toPaise: numeric string', () => eq(toPaise('75.50'), 7550));
check('toPaise: non-numeric → NaN', () => eq(Number.isNaN(toPaise('abc')), true));

/* --------------------------- paiseToRupees --------------------------- */
check('paiseToRupees: round trip', () => {
  for (const p of [0, 1, 7, 99, 100, 12345, 99999999]) {
    eq(Math.round(paiseToRupees(p) * 100), p);
  }
});

/* ------------------------------- paiseOf ----------------------------- */
check('paiseOf: new doc (balancePaise int)', () => eq(paiseOf({ balancePaise: 4242, balance: 42.42 }), 4242));
check('paiseOf: legacy doc (rupee float only)', () => eq(paiseOf({ balance: 19.99 }), 1999));
check('paiseOf: legacy float drift', () => eq(paiseOf({ balance: 0.1 + 0.2 }), 30));
check('paiseOf: empty/missing', () => {
  eq(paiseOf(null), 0);
  eq(paiseOf({}), 0);
});

/* ----------------------------- splitShares --------------------------- */
check('splitShares: ₹1000 → 100/900 exact', () => {
  const s = splitShares(100000);
  eq(s.committeeSharePaise, 10000);
  eq(s.studentSharePaise, 90000);
  eq(s.committeeSharePaise + s.studentSharePaise, s.amountPaise);
});
check('splitShares: 99999 paise → committee floored', () => {
  const s = splitShares(99999);
  eq(s.committeeSharePaise, 9999); // floor(9999.9)
  eq(s.studentSharePaise, 90000);
  eq(s.committeeSharePaise + s.studentSharePaise, 99999);
});
check('splitShares: ₹1.11 → 11 / 100', () => {
  const s = splitShares(111);
  eq(s.committeeSharePaise, 11);
  eq(s.studentSharePaise, 100);
});
check('splitShares: single paisa → committee 0, students 1', () => {
  const s = splitShares(1);
  eq(s.committeeSharePaise, 0);
  eq(s.studentSharePaise, 1);
});
check('splitShares: rejects zero/negative/non-int', () => {
  assertThrows(() => splitShares(0), /positive integer/);
  assertThrows(() => splitShares(-5), /positive integer/);
  assertThrows(() => splitShares(10.5), /positive integer/);
});
check('splitShares: invariants over 200k random amounts', () => {
  for (let i = 0; i < 200000; i++) {
    const amt = 1 + Math.floor(Math.random() * 10000000); // up to ₹1,00,000
    const s = splitShares(amt);
    if (s.committeeSharePaise + s.studentSharePaise !== s.amountPaise) {
      throw new Error('sum mismatch at ' + amt);
    }
    if (s.committeeSharePaise !== Math.floor(amt / 10)) {
      throw new Error('committee formula at ' + amt);
    }
  }
});

/* ------------------------ allocateLargestRemainder ------------------- */
const ids = (n) => Array.from({ length: n }, (_, i) => ({ id: 's' + String(i).padStart(2, '0') + '@jkss.in' }));

check('allocate: pool 10 over 4 → [3,3,2,2]', () => {
  const a = allocateLargestRemainder(10, ids(4));
  eq(Object.values(a).join(','), '3,3,2,2');
});
check('allocate: pool 5 over 3 → [2,2,1]', () => {
  const a = allocateLargestRemainder(5, ids(3));
  eq(Object.values(a).join(','), '2,2,1');
});
check('allocate: exact division', () => {
  const a = allocateLargestRemainder(90000, ids(3));
  eq(Object.values(a).join(','), '30000,30000,30000');
});
check('allocate: pool smaller than n (zero-paise allowed)', () => {
  const a = allocateLargestRemainder(1, ids(5));
  eq(Object.values(a).join(','), '1,0,0,0,0');
  eq(Object.values(a).reduce((s, x) => s + x, 0), 1);
});
check('allocate: pool 0', () => {
  const a = allocateLargestRemainder(0, ids(3));
  eq(Object.values(a).join(','), '0,0,0');
});
check('allocate: empty roster', () => eq(Object.keys(allocateLargestRemainder(100, [])).length, 0));
check('allocate: keys are the student emails in roster order', () => {
  const st = ids(6);
  const a = allocateLargestRemainder(7, st);
  Object.keys(a).forEach((email, i) => {
    eq(email, st[i].id);
  });
});
check('allocate: map {email: paise} shape (integer values)', () => {
  const a = allocateLargestRemainder(7, ids(3));
  Object.entries(a).forEach(([email, p]) => {
    if (typeof email !== 'string' || !Number.isInteger(p) || p < 0) throw new Error('bad entry');
  });
});
check('allocate: deterministic for same input', () => {
  const a1 = allocateLargestRemainder(12345, ids(7));
  const a2 = allocateLargestRemainder(12345, ids(7));
  eq(JSON.stringify(a1), JSON.stringify(a2));
});
check('allocate: invariants over 100k random (pool, roster)', () => {
  for (let i = 0; i < 100000; i++) {
    const n = 1 + Math.floor(Math.random() * 24); // MAX_STUDENTS = 24
    const pool = Math.floor(Math.random() * 10000000);
    const a = allocateLargestRemainder(pool, ids(n));
    assertAllocationsExact(a, pool); // throws on sum/shape violation
    const base = Math.floor(pool / n);
    const r = pool - base * n;
    const big = Object.values(a).filter((x) => x === base + 1).length;
    if (big !== r) throw new Error('largest-remainder count wrong (pool=' + pool + ', n=' + n + ')');
  }
});
check('allocate: no rounding drift across many jobs (fuzz)', () => {
  // Simulate 1,000 sequential jobs; the fund's total student liability must
  // equal the sum of all pools (no paise created or lost anywhere).
  let totalPool = 0;
  let totalAllocated = 0;
  const st = ids(13);
  for (let i = 0; i < 1000; i++) {
    const amt = 1 + Math.floor(Math.random() * 5000000);
    const { studentSharePaise } = splitShares(amt);
    const a = allocateLargestRemainder(studentSharePaise, st);
    assertAllocationsExact(a, studentSharePaise);
    totalPool += studentSharePaise;
    totalAllocated += Object.values(a).reduce((s, x) => s + x, 0);
  }
  eq(totalAllocated, totalPool);
});

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
