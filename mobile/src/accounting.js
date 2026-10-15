// src/accounting.js
// Pure money math for JKSS-FUND (v3.1 — paise-exact).
//
// No Firebase imports: this module is plain, testable logic. It is written
// CommonJS-style on purpose so the exact same code runs in Node unit tests
// (mobile/test) while Metro/Babel interop lets api.js import it with
// `import { ... } from './accounting'`.
//
// MONEY MODEL
// -----------
// - All money is INTEGER PAISE (1 rupee = 100 paise). No floats anywhere in
//   the calculation path.
// - splitShares: committee = floor(amountPaise * pct / 100) whole paise
//   (10%), students get amountPaise - committee (the 90% pool). The two
//   always sum EXACTLY to amountPaise — no paise is created or lost.
// - allocateLargestRemainder: base = floor(pool / n); the first
//   r = pool - base*n students (already sorted by doc id) receive base+1,
//   the rest base. The allocations always sum EXACTLY to pool.

const PAISE_PER_RUPEE = 100;

/** Rupees (number) → integer paise, half-up to the nearest paisa. */
function toPaise(rupees) {
  const n = Number(rupees);
  if (!isFinite(n)) return NaN;
  // Math.round on n*100 is exact for all rupee values the app handles
  // (|n| < 2^53/100), including the 0.01 step the UI uses.
  return Math.round(n * PAISE_PER_RUPEE);
}

/** Integer paise → rupees (number, for display only). */
function paiseToRupees(p) {
  return Number(p) / PAISE_PER_RUPEE;
}

/**
 * Read a balance in integer paise from a new or legacy document.
 * `balancePaise` (int) is authoritative; legacy docs only have the rupee
 * float `balance`.
 */
function paiseOf(doc) {
  if (doc && Number.isInteger(doc.balancePaise)) return doc.balancePaise;
  if (doc && doc.balance != null) return Math.round(Number(doc.balance) * PAISE_PER_RUPEE);
  return 0;
}

/**
 * Split an amount into committee + student shares.
 * @returns {{amountPaise:number, committeeSharePaise:number, studentSharePaise:number}}
 */
function splitShares(amountPaise, committeePct = 10) {
  const amount = Number(amountPaise);
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error('amountPaise must be a positive integer');
  }
  const committeeSharePaise = Math.floor((amount * committeePct) / 100);
  const studentSharePaise = amount - committeeSharePaise;
  return { amountPaise: amount, committeeSharePaise, studentSharePaise };
}

/**
 * Largest-remainder allocation of a paise pool over an ordered student list.
 * @param {number} poolPaise - integer paise to distribute (>= 0)
 * @param {Array<{id:string}>} students - already sorted by doc id
 * @returns {Object<string,number>} MAP {email: amountPaise} — the on-disk
 *   format the Firestore rules address via `allocations.get(email)`;
 *   the first r = pool - base*n students receive base+1, the rest base.
 *   The values always sum EXACTLY to pool.
 */
function allocateLargestRemainder(poolPaise, students) {
  const pool = Number(poolPaise);
  if (!Number.isInteger(pool) || pool < 0) {
    throw new Error('poolPaise must be a non-negative integer');
  }
  const list = students || [];
  const n = list.length;
  if (n === 0) return {};
  const base = Math.floor(pool / n);
  const remainder = pool - base * n; // 0 <= remainder < n
  const out = {};
  list.forEach((s, i) => {
    out[s.id] = base + (i < remainder ? 1 : 0);
  });
  return out;
}

/**
 * Invariant guard: allocation values must sum EXACTLY to the pool and all
 * keys/values must be well-formed. Throws on violation (defensive — the
 * allocation above cannot violate this, but any future caller can).
 * @param {Object<string,number>} allocations - map {email: paise}
 */
function assertAllocationsExact(allocations, poolPaise) {
  const pool = Math.trunc(Number(poolPaise));
  const entries = Object.entries(allocations || {});
  const total = entries.reduce((s, [, p]) => s + Number(p), 0);
  if (total !== pool) {
    throw new Error(
      `Allocation integrity violation: allocated ${total} paise but pool is ${pool} paise`
    );
  }
  entries.forEach(([email, p]) => {
    if (!email || !Number.isInteger(p) || p < 0) {
      throw new Error(`Allocation integrity violation for "${email}"`);
    }
  });
}

module.exports = {
  PAISE_PER_RUPEE,
  toPaise,
  paiseToRupees,
  paiseOf,
  splitShares,
  allocateLargestRemainder,
  assertAllocationsExact,
};
