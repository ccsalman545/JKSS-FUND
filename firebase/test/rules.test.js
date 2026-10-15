// test/rules.test.js
// Firestore SECURITY RULES test suite for JKSS-FUND v3.5 (+ v3.0 username logins).
//
// The rules are UNCHANGED by the v3.0 username/password work: a student's
// Firestore identity is still `users/{auth-email}`, and a student's auth email
// is now the synthetic identifier `<username>@students.jkss-fund.invalid`
// (see mobile/src/identity.js + docs/USERNAME_LOGIN.md). Section 13 adds
// scenarios that run the real engine with those identifiers, proving that:
//   * pre-authorization is still the only way a student gets a profile,
//   * an unauthorized synthetic account can read/write nothing,
//   * withdrawals/credits/reversals work with synthetic identifiers,
//   * nothing was loosened to make the new login work.
// Section 14 proves the held-account gate: a real-email account with no
// legacyAuthorizations document (a legacy student on hold) reads and writes
// no financial data through any path, while admin reconciliation and the
// username path are unaffected.
//
// Runs the DEPLOYED rules (firebase/firestore.rules) inside the real
// Firestore emulator (production rules engine) via the official
// @firebase/rules-unit-testing library. This is NOT a simulation: every
// assertSucceeds/assertFails is evaluated by the same engine that runs in
// production.
//
// Run (starts a throwaway local emulator, never touches production):
//   cd firebase
//   npm ci
//   firebase emulators:exec --project jkss-fund-local --only firestore "node test/rules.test.js"
//
// (Equivalent: `firebase emulators:start --only firestore` in one terminal,
//  then `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node test/rules.test.js`.)
'use strict';

const fs = require('fs');
const path = require('path');
const {
  initializeTestEnvironment, assertSucceeds, assertFails,
} = require('@firebase/rules-unit-testing');
const {
  doc, setDoc, getDoc, updateDoc, deleteDoc, collection, getDocs,
  collectionGroup, writeBatch,
} = require('firebase/firestore');

const RULES = fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8');

const ADMIN = 'admin@jkss.in';
const A = 'a@jkss.in';
const B = 'b@jkss.in';
const C = 'c-new@jkss.in';

let env;
let pass = 0;
let fail = 0;
const tests = [];
function test(name, fn) { tests.push([name, fn]); }

// Sign-in contexts. Every real account the provisioning tool or an admin
// creates has a VERIFIED email (email_verified: true in the ID token).
// authedUnverified() models a self-registered account whose email was never
// verified (the squatting case the studentAccessOk() gate must refuse).
const uidOf = (email) => 'uid-' + email.replace(/[^a-z0-9]/g, '');
const authed = (email) => env.authenticatedContext(uidOf(email), { email, email_verified: true });
const authedUnverified = (email) => env.authenticatedContext(uidOf(email), { email, email_verified: false });
const adminCtx = () => authed(ADMIN);
const anonCtx = () => env.unauthenticatedContext();

/* Seed a deterministic world (bypasses rules — test setup only).
   A=5000 paise, B=4000 paise, committee=1000, and job j-old with ORIGINAL
   allocation history (a MAP {email: paise} — the v3.2 on-disk format). */
async function seed() {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'users/' + ADMIN), {
      email: ADMIN, role: 'admin', full_name: 'Admin', balancePaise: 0, balance: 0, txnSeq: 0,
    });
    await setDoc(doc(db, 'users/' + A), {
      email: A, role: 'student', full_name: 'A', balancePaise: 5000, balance: 50, txnSeq: 0,
    });
    await setDoc(doc(db, 'users/' + B), {
      email: B, role: 'student', full_name: 'B', balancePaise: 4000, balance: 40, txnSeq: 0,
    });
    // A and B are real-email legacy students that an admin has EXPLICITLY
    // authorized (Option B "otherwise authorized"). Without these documents
    // they are on hold and the access gate denies them everything.
    await setDoc(doc(db, 'legacyAuthorizations/' + A), { email: A, authorized: true });
    await setDoc(doc(db, 'legacyAuthorizations/' + B), { email: B, authorized: true });
    await setDoc(doc(db, 'meta/committee'), { balancePaise: 1000, balance: 10 });
    // Pre-v3.1 top-level ledger entry (audit-only path).
    await setDoc(doc(db, 'transactions/legacy1'), { type: 'earning', amount: 10 });
    // A fully-formed job with original allocation history.
    await setDoc(doc(db, 'jobs/j-old'), {
      name: 'Old job', date: '2026-01-01', status: 'active',
      amountPaise: 10000, committeeSharePaise: 1000, studentSharePaise: 9000,
      studentCount: 2,
      allocations: { [A]: 5000, [B]: 4000 },
    });
  });
}

/* Build the admin job-credit batch (the exact shape api.addJob produces).
   allocs: {email: amountPaise}; current: {email: currentPaise}. */
function jobCreditBatch(db, jobId, amountPaise, allocs, current, {
  omitTxnFor = null, omitCommittee = false, committeeNewPaise,
  committeeJobId = null, userFinal = {}, jobData = {},
} = {}) {
  const committee = Math.floor(amountPaise / 10);
  const pool = amountPaise - committee;
  const b = writeBatch(db);
  b.set(doc(db, 'jobs/' + jobId), Object.assign({
    name: 'Test job', date: '2026-10-01', status: 'active',
    amountPaise,
    committeeSharePaise: committee,
    studentSharePaise: pool,
    studentCount: Object.keys(allocs).length,
    allocations: allocs,
  }, jobData));
  Object.entries(allocs).forEach(([email, amount]) => {
    const final = userFinal[email] != null ? userFinal[email] : current[email] + amount;
    // v3.5 protocol: the user write carries the job reference (and always
    // both fields — the rules cannot read missing fields, but null is fine).
    b.update(doc(db, 'users/' + email), {
      balancePaise: final, balance: final / 100,
      creditJobId: jobId, reversalJobId: null,
    });
    if (omitTxnFor !== email) {
      b.set(doc(db, 'users/' + email + '/transactions/earn_' + jobId + '_' + email), {
        type: 'earning', studentId: email, jobId,
        amountPaise: amount, amount: amount / 100,
        description: 'Earning from Test job',
      });
    }
  });
  if (!omitCommittee) {
    b.update(doc(db, 'meta/committee'), {
      balancePaise: committeeNewPaise != null ? committeeNewPaise : 1000 + committee,
      balance: (committeeNewPaise != null ? committeeNewPaise : 1000 + committee) / 100,
      lastJobId: committeeJobId != null ? committeeJobId : jobId,
    });
  }
  return b;
}

/* Build the admin job-reversal batch (the exact shape api.deleteJob
   produces — a TOMBSTONE, never a delete).
   allocs: {email: originalAmountPaise}; current: {email: currentPaise}. */
function jobReversalBatch(db, jobId, allocs, current, {
  wrongUserFinalFor = null, omitCommittee = false, committeeNewPaise = 0,
  committeeJobId = null, omitJobTombstone = false,
} = {}) {
  const b = writeBatch(db);
  Object.entries(allocs).forEach(([email, amount]) => {
    let final = current[email] - amount;
    if (wrongUserFinalFor === email) final = current[email] - amount + 100;
    // v3.5 protocol: the user write carries the job reference.
    b.update(doc(db, 'users/' + email), {
      balancePaise: final, balance: final / 100,
      creditJobId: null, reversalJobId: jobId,
    });
    b.set(doc(db, 'users/' + email + '/transactions/rev_' + jobId + '_' + email), {
      type: 'reversal', studentId: email, jobId,
      amountPaise: amount, amount: amount / 100,
      description: 'Reversal — Old job',
    });
  });
  if (!omitCommittee) {
    b.update(doc(db, 'meta/committee'), {
      balancePaise: committeeNewPaise, balance: committeeNewPaise / 100,
      reversedJobId: committeeJobId != null ? committeeJobId : jobId,
    });
  }
  if (!omitJobTombstone) {
    b.update(doc(db, 'jobs/' + jobId), { status: 'reversed', reversedAt: 1 });
  }
  return b;
}

(async () => {
  env = await initializeTestEnvironment({
    projectId: 'jkss-fund-test',
    firestore: { rules: RULES },
  });

  for (const [name, fn] of tests) {
    try {
      await seed();
      await fn();
      pass++;
      console.log('  PASS  ' + name);
    } catch (e) {
      fail++;
      const lines = (e && e.message).split('\n');
      // First line is usually the gRPC code; the next carries the rule
      // evaluation detail (e.g. which allow clause was false).
      const detail = lines.slice(0, 3).join(' ').replace(/\s+/g, ' ').slice(0, 280);
      console.log('  FAIL  ' + name + '\n        → ' + detail);
    }
  }

  await env.cleanup();
  console.log('\n' + pass + ' passed, ' + fail + ' failed  (' + tests.length + ' total)');
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error('FATAL — could not initialize the rules test environment. ' + (e && e.message));
  console.error('Hint: run via `firebase emulators:exec --project jkss-fund-local --only firestore "node test/rules.test.js"`');
  process.exit(2);
});

/* =====================================================================
   1. Unauthenticated access — everything denied
   ===================================================================== */
test('unauthenticated: cannot read a user profile', async () => {
  const db = anonCtx().firestore();
  await assertFails(getDoc(doc(db, 'users/' + A)));
});
test('unauthenticated: cannot list users', async () => {
  const db = anonCtx().firestore();
  await assertFails(getDocs(collection(db, 'users')));
});
test('unauthenticated: cannot read committee balance', async () => {
  const db = anonCtx().firestore();
  await assertFails(getDoc(doc(db, 'meta/committee')));
});
test('unauthenticated: cannot create a profile (even with zero balances)', async () => {
  const db = anonCtx().firestore();
  await assertFails(setDoc(doc(db, 'users/' + C), {
    email: C, role: 'student', full_name: 'C', balancePaise: 0, balance: 0, txnSeq: 0,
  }));
});
test('unauthenticated: cannot create a job', async () => {
  const db = anonCtx().firestore();
  await assertFails(setDoc(doc(db, 'jobs/j1'), { name: 'x', date: '2026-10-01', amountPaise: 100 }));
});
test('unauthenticated: cannot read legacy top-level transactions', async () => {
  const db = anonCtx().firestore();
  await assertFails(getDoc(doc(db, 'transactions/legacy1')));
  await assertFails(getDocs(collection(db, 'transactions')));
});
test('unauthenticated: cannot write unknown paths (no catch-all)', async () => {
  const db = anonCtx().firestore();
  await assertFails(setDoc(doc(db, 'other/thing'), { x: 1 }));
  await assertFails(getDoc(doc(db, 'other/thing')));
});

/* =====================================================================
   2. Pre-authorization & privilege escalation
   ===================================================================== */
test('student: CANNOT self-create a profile (admin pre-authorization only)', async () => {
  const db = authed(C).firestore();
  await assertFails(setDoc(doc(db, 'users/' + C), {
    email: C, role: 'student', full_name: 'C', balancePaise: 0, balance: 0, txnSeq: 0,
  }));
});
test('student: CANNOT self-create profile with role admin (no self-elevation)', async () => {
  const db = authed(C).firestore();
  await assertFails(setDoc(doc(db, 'users/' + C), {
    email: C, role: 'admin', full_name: 'C', balancePaise: 0, balance: 0, txnSeq: 0,
  }));
});
test('student: CANNOT self-create profile with non-zero balance', async () => {
  const db = authed(C).firestore();
  await assertFails(setDoc(doc(db, 'users/' + C), {
    email: C, role: 'student', full_name: 'C', balancePaise: 100, balance: 1, txnSeq: 0,
  }));
});
test('student: CANNOT self-create profile for someone else email', async () => {
  const db = authed(C).firestore();
  await assertFails(setDoc(doc(db, 'users/' + A), {
    email: A, role: 'student', full_name: 'C', balancePaise: 0, balance: 0, txnSeq: 0,
  }));
});
test('student: CANNOT self-create profile with extra (unexpected) fields', async () => {
  const db = authed(C).firestore();
  await assertFails(setDoc(doc(db, 'users/' + C), {
    email: C, role: 'student', full_name: 'C', balancePaise: 0, balance: 0, txnSeq: 0,
    isAdminClaim: true,
  }));
});
test('student: CANNOT modify own role', async () => {
  const db = authed(A).firestore();
  await assertFails(updateDoc(doc(db, 'users/' + A), { role: 'admin' }));
});
test('student: CANNOT modify own balance without a companion txn', async () => {
  const db = authed(A).firestore();
  await assertFails(updateDoc(doc(db, 'users/' + A), { balancePaise: 999999 }));
  await assertFails(updateDoc(doc(db, 'users/' + A), { balance: 999.99, balancePaise: 999999 }));
});
test('student: CANNOT set own balance higher via balance-only float', async () => {
  const db = authed(A).firestore();
  await assertFails(updateDoc(doc(db, 'users/' + A), { balance: 500 }));
});
test('student: CAN update own profile fields (full_name, lastActiveAt)', async () => {
  const db = authed(A).firestore();
  await assertSucceeds(updateDoc(doc(db, 'users/' + A), { full_name: 'A Prime' }));
  await assertSucceeds(updateDoc(doc(db, 'users/' + A), { lastActiveAt: 12345 }));
});
test('student: CANNOT tombstone (remove) themselves', async () => {
  const db = authed(A).firestore();
  await assertFails(updateDoc(doc(db, 'users/' + A), { removedAt: 12345 }));
});
test('student: CANNOT delete own profile (tombstone-only removal)', async () => {
  const db = authed(A).firestore();
  await assertFails(deleteDoc(doc(db, 'users/' + A)));
});

/* =====================================================================
   3. Read isolation between students
   ===================================================================== */
test('student: CAN read own profile and own ledger', async () => {
  const db = authed(A).firestore();
  await assertSucceeds(getDoc(doc(db, 'users/' + A)));
  await assertSucceeds(getDocs(collection(db, 'users/' + A + '/transactions')));
});
test('student: CANNOT read another student profile', async () => {
  const db = authed(A).firestore();
  await assertFails(getDoc(doc(db, 'users/' + B)));
});
test('student: CANNOT read another student ledger', async () => {
  const db = authed(A).firestore();
  await assertFails(getDocs(collection(db, 'users/' + B + '/transactions')));
});
test('student: CANNOT list all users', async () => {
  const db = authed(A).firestore();
  await assertFails(getDocs(collection(db, 'users')));
});
test('student: CAN read public committee balance', async () => {
  const db = authed(A).firestore();
  await assertSucceeds(getDoc(doc(db, 'meta/committee')));
});
test('student: CANNOT read any job document', async () => {
  const db = authed(A).firestore();
  await assertFails(getDoc(doc(db, 'jobs/j-old')));
  await assertFails(getDocs(collection(db, 'jobs')));
});

/* =====================================================================
   4. Withdrawals — atomic pair, non-negative, exact delta
   ===================================================================== */
/* v3.5 protocol: the withdrawal user write bumps txnSeq by 1, names the
   companion txn (withdrawalTxnId), and the txn doc carries the seq —
   the bidirectional lock (the engine has no int->string). */
function withdrawalBatch(db, email, finalPaise, seq, amountPaise, { txnId, extraUser = {} } = {}) {
  const id = txnId || ('w_' + email + '_' + seq);
  const b = writeBatch(db);
  b.update(doc(db, 'users/' + email), Object.assign(
    { balancePaise: finalPaise, balance: finalPaise / 100, txnSeq: seq, withdrawalTxnId: id },
    extraUser));
  b.set(doc(db, 'users/' + email + '/transactions/' + id), {
    type: 'withdrawal', studentId: email, amountPaise, amount: amountPaise / 100,
    seq, description: 'Books',
  });
  return b;
}

test('student: withdrawal WITH matching companion txn (atomic) is allowed', async () => {
  const db = authed(A).firestore();
  // Withdraw 2000 of 5000 → 3000 left; seq 0 → 1; canonical id w_A_1.
  await assertSucceeds(withdrawalBatch(db, A, 3000, 1, 2000).commit());
});
test('student: withdrawal WITHOUT companion txn is denied', async () => {
  const db = authed(A).firestore();
  // The user write names a companion txn, but no txn write is in the
  // batch: getAfter(tid) finds nothing -> denied.
  await assertFails(updateDoc(doc(db, 'users/' + A),
    { balancePaise: 3000, balance: 30, txnSeq: 1, withdrawalTxnId: 'w_' + A + '_1' }));
});
test('student: companion txn WITHOUT balance reduction is denied', async () => {
  const db = authed(A).firestore();
  // No user write in this request: the post-batch user doc has no
  // withdrawalTxnId and no seq bump, so the bidirectional lock fails.
  await assertFails(setDoc(doc(db, 'users/' + A + '/transactions/w_' + A + '_1'), {
    type: 'withdrawal', studentId: A, amountPaise: 2000, amount: 20, seq: 1,
  }));
});
test('student: withdrawal driving balance negative is denied', async () => {
  const db = authed(A).firestore();
  await assertFails(withdrawalBatch(db, A, -1000, 1, 6000).commit());
});
test('student: withdrawal txn amount must EXACTLY equal the delta', async () => {
  const db = authed(A).firestore();
  // User drops by 1500 (→3500) but the companion txn claims 2000:
  // the txn rule checks final == pre - amount and denies the batch.
  const b = writeBatch(db);
  b.update(doc(db, 'users/' + A), {
    balancePaise: 3500, balance: 35, txnSeq: 1, withdrawalTxnId: 'w_' + A + '_1',
  });
  b.set(doc(db, 'users/' + A + '/transactions/w_' + A + '_1'), {
    type: 'withdrawal', studentId: A, amountPaise: 2000, amount: 20, seq: 1, // mismatch
  });
  await assertFails(b.commit());
});
test('student: second withdrawal cannot overdraw after first one (sequential)', async () => {
  const db = authed(A).firestore();
  // First: withdraw 4000 of 5000 → 1000 left (seq 0 → 1).
  await assertSucceeds(withdrawalBatch(db, A, 1000, 1, 4000).commit());
  // Second: attempt 2000 from 1000 → negative → denied.
  await assertFails(withdrawalBatch(db, A, -1000, 2, 2000).commit());
});
test('student: STALE withdrawal replay (double spend) is denied — delta 0', async () => {
  const db = authed(A).firestore();
  await assertSucceeds(withdrawalBatch(db, A, 3000, 1, 2000).commit());
  // Client retries the SAME stale batch: the pre-batch seq is already 1,
  // so the claimed newSeq 1 is not oldSeq+1 (and the txn id is taken).
  await assertFails(withdrawalBatch(db, A, 3000, 1, 2000, { txnId: 'w_' + A + '_1-retry' }).commit());
});
test('student: withdrawal batch bundling a profile field is denied (balance-only writes)', async () => {
  const db = authed(A).firestore();
  await assertFails(withdrawalBatch(db, A, 4500, 1, 500, { extraUser: { full_name: 'A Prime' } }).commit());
});
test('student: withdrawal batch that also edits role is denied', async () => {
  const db = authed(A).firestore();
  await assertFails(withdrawalBatch(db, A, 4500, 1, 500, { extraUser: { role: 'admin' } }).commit());
});
test('student: withdrawal batch with an EXTRA third write is denied', async () => {
  const db = authed(A).firestore();
  const b = withdrawalBatch(db, A, 4500, 1, 500);
  b.set(doc(db, 'users/' + A + '/transactions/w-extra'), {
    type: 'withdrawal', studentId: A, amountPaise: 1, amount: 0.01,
  });
  await assertFails(b.commit());
});
test('student: CANNOT create earning or reversal txns (withdrawals only)', async () => {
  const db = authed(A).firestore();
  await assertFails(setDoc(doc(db, 'users/' + A + '/transactions/fake'), {
    type: 'earning', studentId: A, jobId: 'j-old', amountPaise: 500, amount: 5,
  }));
  await assertFails(setDoc(doc(db, 'users/' + A + '/transactions/fake2'), {
    type: 'reversal', studentId: A, jobId: 'j-old', amountPaise: 500, amount: 5,
  }));
});
test('student: CANNOT delete or modify ledger entries', async () => {
  const db = authed(A).firestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const d = ctx.firestore();
    await setDoc(doc(d, 'users/' + A + '/transactions/t1'), {
      type: 'withdrawal', studentId: A, amountPaise: 100, amount: 1,
    });
  });
  await assertFails(deleteDoc(doc(db, 'users/' + A + '/transactions/t1')));
  await assertFails(updateDoc(doc(db, 'users/' + A + '/transactions/t1'), { amountPaise: 1 }));
});
test('student: CANNOT write to another student ledger', async () => {
  const db = authed(A).firestore();
  await assertFails(setDoc(doc(db, 'users/' + B + '/transactions/fake'), {
    type: 'withdrawal', studentId: B, amountPaise: 100, amount: 1,
  }));
});

/* =====================================================================
   5. Students cannot touch jobs / committee / unknown paths
   ===================================================================== */
test('student: CANNOT create, update or delete jobs', async () => {
  const db = authed(A).firestore();
  await assertFails(setDoc(doc(db, 'jobs/jx'), { name: 'x', date: 'd', amountPaise: 100 }));
  await assertFails(updateDoc(doc(db, 'jobs/j-old'), { name: 'hacked' }));
  await assertFails(deleteDoc(doc(db, 'jobs/j-old')));
});
test('student: CANNOT change committee balance (only job batches may)', async () => {
  const db = authed(A).firestore();
  await assertFails(updateDoc(doc(db, 'meta/committee'), { balancePaise: 999999 }));
  await assertFails(deleteDoc(doc(db, 'meta/committee')));
});
test('student: committee zero→zero no-op update is denied (no no-op write path)', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const d = ctx.firestore();
    await setDoc(doc(d, 'meta/committee'), { balancePaise: 0, balance: 0 });
  });
  const db = authed(A).firestore();
  await assertFails(updateDoc(doc(db, 'meta/committee'), { balancePaise: 0 }));
});
test('student: CANNOT write legacy /transactions (immutable audit)', async () => {
  const db = authed(A).firestore();
  await assertFails(setDoc(doc(db, 'transactions/n1'), { type: 'earning', amount: 1 }));
  await assertFails(deleteDoc(doc(db, 'transactions/legacy1')));
});

/* =====================================================================
   6. Admin: legitimate operations succeed
   ===================================================================== */
test('admin: can list all users and read all ledgers', async () => {
  const db = adminCtx().firestore();
  await assertSucceeds(getDocs(collection(db, 'users')));
  await assertSucceeds(getDoc(doc(db, 'users/' + B)));
  await assertSucceeds(getDocs(collection(db, 'users/' + B + '/transactions')));
});
test('admin: can provision a new student (zero balances)', async () => {
  const db = adminCtx().firestore();
  await assertSucceeds(setDoc(doc(db, 'users/' + C), {
    email: C, role: 'student', full_name: 'C', balancePaise: 0, balance: 0, txnSeq: 0,
  }));
});
test('admin: can provision another admin (only admin can grant admin, at create)', async () => {
  const db = adminCtx().firestore();
  await assertSucceeds(setDoc(doc(db, 'users/admin2@jkss.in'), {
    email: 'admin2@jkss.in', role: 'admin', full_name: 'Admin 2', balancePaise: 0, balance: 0, txnSeq: 0,
  }));
});
test('admin: CANNOT create a user with non-zero balance', async () => {
  const db = adminCtx().firestore();
  await assertFails(setDoc(doc(db, 'users/' + C), {
    email: C, role: 'student', full_name: 'C', balancePaise: 500, balance: 5,
  }));
});
test('admin: CANNOT edit any user balance (no manual balance edits exist)', async () => {
  const db = adminCtx().firestore();
  await assertFails(updateDoc(doc(db, 'users/' + A), { balancePaise: 0 }));
  await assertFails(updateDoc(doc(db, 'users/' + A), { balance: 0, balancePaise: 100 }));
});
test('admin: CANNOT change any user role (even to/from admin)', async () => {
  const db = adminCtx().firestore();
  await assertFails(updateDoc(doc(db, 'users/' + A), { role: 'admin' }));
  await assertFails(updateDoc(doc(db, 'users/' + ADMIN), { role: 'student' }));
});
test('admin: can rename a student and tombstone-remove a student', async () => {
  const db = adminCtx().firestore();
  await assertSucceeds(updateDoc(doc(db, 'users/' + B), { full_name: 'Bee' }));
  await assertSucceeds(updateDoc(doc(db, 'users/' + B), { removedAt: 12345 }));
});
test('admin: CANNOT delete a user doc (tombstone-only)', async () => {
  const db = adminCtx().firestore();
  await assertFails(deleteDoc(doc(db, 'users/' + B)));
});
test('admin: can create a job with a valid complete credit batch', async () => {
  const db = adminCtx().firestore();
  const b = jobCreditBatch(db, 'j1', 10000,
    { [A]: 4500, [B]: 4500 },
    { [A]: 5000, [B]: 4000 });
  await assertSucceeds(b.commit());
});
test('admin: can update a job status (active/archived only)', async () => {
  const db = adminCtx().firestore();
  await assertSucceeds(updateDoc(doc(db, 'jobs/j-old'), { status: 'archived' }));
});
test('admin: can reverse a job with a valid complete reversal batch (original allocations, tombstone)', async () => {
  const db = adminCtx().firestore();
  const b = jobReversalBatch(db, 'j-old',
    { [A]: 5000, [B]: 4000 },
    { [A]: 5000, [B]: 4000 });
  await assertSucceeds(b.commit());
});

/* =====================================================================
   7. Admin: invalid financial writes are denied
   ===================================================================== */
test('admin: job with wrong committee share (not floor 10%) is denied', async () => {
  const db = adminCtx().firestore();
  const b = jobCreditBatch(db, 'j1', 10000,
    { [A]: 4500, [B]: 4500 },
    { [A]: 5000, [B]: 4000 },
    { committeeNewPaise: 1000 + 1001 }); // +1001 ≠ floor(10000/10)=1000
  await assertFails(b.commit());
});
test('admin: job whose allocation values break the base/base+1 formula is denied', async () => {
  const db = adminCtx().firestore();
  // Pool 9000 over 2 → base 4500; values must be 4500 or 4501.
  // 4600/4400 keeps the SUM but violates the formula bounds.
  const b = jobCreditBatch(db, 'j1', 10000,
    { [A]: 4600, [B]: 4400 },
    { [A]: 5000, [B]: 4000 });
  await assertFails(b.commit());
});
test('admin: job with credit larger than its allocation is denied', async () => {
  const db = adminCtx().firestore();
  // Job says A gets 4500, but the users update credits 5000.
  const b = jobCreditBatch(db, 'j1', 10000,
    { [A]: 4500 },
    { [A]: 5000 },
    { userFinal: { [A]: 5000 + 5000 } });
  await assertFails(b.commit());
});
test('admin: incomplete job batch (missing a student txn) is denied atomically', async () => {
  const db = adminCtx().firestore();
  const b = jobCreditBatch(db, 'j1', 10000,
    { [A]: 4500, [B]: 4500 },
    { [A]: 5000, [B]: 4000 },
    { omitTxnFor: B });
  await assertFails(b.commit());
});
test('admin: job batch without the committee credit is denied', async () => {
  const db = adminCtx().firestore();
  const b = jobCreditBatch(db, 'j1', 10000,
    { [A]: 4500, [B]: 4500 },
    { [A]: 5000, [B]: 4000 },
    { omitCommittee: true });
  await assertFails(b.commit());
});
test('admin: job batch whose committee references a DIFFERENT job id is denied', async () => {
  const db = adminCtx().firestore();
  const b = jobCreditBatch(db, 'j1', 10000,
    { [A]: 4500, [B]: 4500 },
    { [A]: 5000, [B]: 4000 },
    { committeeJobId: 'j-other' });
  await assertFails(b.commit());
});
test('admin: job batch whose committee references a job NOT in the batch is denied', async () => {
  const db = adminCtx().firestore();
  const b = writeBatch(db);
  b.set(doc(db, 'jobs/j1'), {
    name: 'Test job', date: '2026-10-01', status: 'active',
    amountPaise: 10000, committeeSharePaise: 1000, studentSharePaise: 9000,
    studentCount: 2, allocations: { [A]: 4500, [B]: 4500 },
  });
  b.update(doc(db, 'users/' + A), { balancePaise: 9500, balance: 95 });
  b.set(doc(db, 'users/' + A + '/transactions/earn_j1_' + A), {
    type: 'earning', studentId: A, jobId: 'j1', amountPaise: 4500, amount: 45,
  });
  b.update(doc(db, 'users/' + B), { balancePaise: 8500, balance: 85 });
  b.set(doc(db, 'users/' + B + '/transactions/earn_j1_' + B), {
    type: 'earning', studentId: B, jobId: 'j1', amountPaise: 4500, amount: 45,
  });
  // Committee points at j-old (which is NOT written in this batch).
  b.update(doc(db, 'meta/committee'), {
    balancePaise: 2000, balance: 20, lastJobId: 'j-old',
  });
  await assertFails(b.commit());
});
test('admin: earning txn with a NON-CANONICAL id is denied', async () => {
  const db = adminCtx().firestore();
  const b = writeBatch(db);
  b.set(doc(db, 'jobs/j1'), {
    name: 'Test job', date: '2026-10-01', status: 'active',
    amountPaise: 10000, committeeSharePaise: 1000, studentSharePaise: 9000,
    studentCount: 1, allocations: { [A]: 9000 },
  });
  b.update(doc(db, 'users/' + A), { balancePaise: 5000 + 9000 });
  // Wrong txn id format (not earn_{jobId}_{email}).
  b.set(doc(db, 'users/' + A + '/transactions/j1:0'), {
    type: 'earning', studentId: A, jobId: 'j1', amountPaise: 9000, amount: 90,
  });
  b.update(doc(db, 'meta/committee'), {
    balancePaise: 2000, balance: 20, lastJobId: 'j1',
  });
  await assertFails(b.commit());
});
test('admin: committee update in a credit batch WITHOUT lastJobId is denied', async () => {
  const db = adminCtx().firestore();
  const b = writeBatch(db);
  b.set(doc(db, 'jobs/j1'), {
    name: 'Test job', date: '2026-10-01', status: 'active',
    amountPaise: 10000, committeeSharePaise: 1000, studentSharePaise: 9000,
    studentCount: 1, allocations: { [A]: 9000 },
  });
  b.update(doc(db, 'users/' + A), { balancePaise: 5000 + 9000 });
  b.set(doc(db, 'users/' + A + '/transactions/earn_j1_' + A), {
    type: 'earning', studentId: A, jobId: 'j1', amountPaise: 9000, amount: 90,
  });
  b.update(doc(db, 'meta/committee'), { balancePaise: 2000, balance: 20 });
  await assertFails(b.commit());
});
test('admin: job with legacy LIST allocations (old format) is denied', async () => {
  const db = adminCtx().firestore();
  const b = writeBatch(db);
  b.set(doc(db, 'jobs/j1'), {
    name: 'Old format', date: '2026-10-01',
    amountPaise: 10000, committeeSharePaise: 1000, studentSharePaise: 9000,
    studentCount: 1,
    allocations: [{ email: A, index: 0, amountPaise: 9000 }],
  });
  b.update(doc(db, 'users/' + A), { balancePaise: 5000 + 9000 });
  b.set(doc(db, 'users/' + A + '/transactions/earn_j1_' + A), {
    type: 'earning', studentId: A, jobId: 'j1', amountPaise: 9000, amount: 90,
  });
  b.update(doc(db, 'meta/committee'), {
    balancePaise: 2000, balance: 20, lastJobId: 'j1',
  });
  await assertFails(b.commit());
});
test('admin: CANNOT update job fields other than status', async () => {
  const db = adminCtx().firestore();
  await assertFails(updateDoc(doc(db, 'jobs/j-old'), { name: 'Hacked' }));
  await assertFails(updateDoc(doc(db, 'jobs/j-old'), { amountPaise: 1 }));
  await assertFails(updateDoc(doc(db, 'jobs/j-old'), { status: 'pending' }));
});
test('admin: CANNOT delete a job at all (tombstone-only, even with a full reversal batch)', async () => {
  const db = adminCtx().firestore();
  // Even a perfect reversal + delete in one batch is denied: deletion
  // would destroy the allocation history the ledger depends on.
  const b = jobReversalBatch(db, 'j-old',
    { [A]: 5000, [B]: 4000 },
    { [A]: 5000, [B]: 4000 });
  b.delete(doc(db, 'jobs/j-old'));
  await assertFails(b.commit());
  await assertFails(deleteDoc(doc(db, 'jobs/j-old')));
});
test('admin: reversal with wrong (recalculated) debit amount is denied', async () => {
  const db = adminCtx().firestore();
  const b = jobReversalBatch(db, 'j-old',
    { [A]: 5000, [B]: 4000 },
    { [A]: 5000, [B]: 4000 },
    { wrongUserFinalFor: A }); // user debit 4900 ≠ original allocation 5000
  await assertFails(b.commit());
});
test('admin: reversal using CURRENT-roster amounts (not original allocations) is denied', async () => {
  const db = adminCtx().firestore();
  // Roster "changed": someone tries to debit A 9000 (the whole pool)
  // instead of the original 5000.
  const b = writeBatch(db);
  b.update(doc(db, 'users/' + A), {
    balancePaise: 5000 - 9000, // → -4000, active
    creditJobId: null, reversalJobId: 'j-old',
  });
  b.set(doc(db, 'users/' + A + '/transactions/rev_j-old_' + A), {
    type: 'reversal', studentId: A, jobId: 'j-old', amountPaise: 9000, amount: 90,
  });
  b.update(doc(db, 'meta/committee'), { balancePaise: 0, balance: 0, reversedJobId: 'j-old' });
  b.update(doc(db, 'jobs/j-old'), { status: 'reversed', reversedAt: 1 });
  await assertFails(b.commit());
});
test('admin: reversal without committee credit-back is denied', async () => {
  const db = adminCtx().firestore();
  const b = jobReversalBatch(db, 'j-old',
    { [A]: 5000, [B]: 4000 },
    { [A]: 5000, [B]: 4000 },
    { omitCommittee: true });
  await assertFails(b.commit());
});
test('admin: reversal without the job tombstone write is denied', async () => {
  const db = adminCtx().firestore();
  const b = jobReversalBatch(db, 'j-old',
    { [A]: 5000, [B]: 4000 },
    { [A]: 5000, [B]: 4000 },
    { omitJobTombstone: true });
  await assertFails(b.commit());
});
test('admin: second reversal of the same (already tombstoned) job is denied', async () => {
  const db = adminCtx().firestore();
  const b1 = jobReversalBatch(db, 'j-old',
    { [A]: 5000, [B]: 4000 },
    { [A]: 5000, [B]: 4000 });
  await assertSucceeds(b1.commit());
  // Retry / double reversal: the users writes would debit again.
  const b2 = writeBatch(db);
  b2.update(doc(db, 'users/' + A), {
    balancePaise: 0 - 5000,
    creditJobId: null, reversalJobId: 'j-old',
  });
  b2.set(doc(db, 'users/' + A + '/transactions/rev_j-old_' + A + '_retry'), {
    type: 'reversal', studentId: A, jobId: 'j-old', amountPaise: 5000, amount: 50,
  });
  b2.update(doc(db, 'meta/committee'), {
    balancePaise: 0 - 1000, balance: -10, reversedJobId: 'j-old',
  });
  await assertFails(b2.commit());
});
test('admin: legacy job (no allocation history) CANNOT be reversed — manual reconciliation required', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const d = ctx.firestore();
    await setDoc(doc(d, 'jobs/j-legacy'), {
      name: 'Legacy', date: '2025-01-01', status: 'active',
      amount: 500, committeeShare: 50, studentShare: 450,
    });
  });
  const db = adminCtx().firestore();
  const b = writeBatch(db);
  b.update(doc(db, 'jobs/j-legacy'), { status: 'reversed', reversedAt: 1 });
  b.update(doc(db, 'meta/committee'), {
    balancePaise: 1000 - 5000, balance: -40, reversedJobId: 'j-legacy',
  });
  await assertFails(b.commit());
  await assertFails(deleteDoc(doc(db, 'jobs/j-legacy')));
});
test('admin: CANNOT update committee outside a job batch', async () => {
  const db = adminCtx().firestore();
  await assertFails(updateDoc(doc(db, 'meta/committee'), { balancePaise: 2000 }));
});
test('admin: CANNOT update committee with a dangling lastJobId (job not in batch)', async () => {
  const db = adminCtx().firestore();
  await assertFails(updateDoc(doc(db, 'meta/committee'), {
    balancePaise: 2000, lastJobId: 'j-ghost',
  }));
});
test('admin: CAN read legacy /transactions (audit) but CANNOT write them', async () => {
  const db = adminCtx().firestore();
  await assertSucceeds(getDoc(doc(db, 'transactions/legacy1')));
  await assertSucceeds(getDocs(collection(db, 'transactions')));
  await assertFails(setDoc(doc(db, 'transactions/n1'), { type: 'earning', amount: 1 }));
  await assertFails(deleteDoc(doc(db, 'transactions/legacy1')));
});
test('admin: CANNOT write unknown paths (no catch-all)', async () => {
  const db = adminCtx().firestore();
  await assertFails(setDoc(doc(db, 'other/thing'), { x: 1 }));
  await assertFails(updateDoc(doc(db, 'other/thing'), { x: 2 }));
});
test('removed student: reversal debits the ORIGINAL amount and may drive them negative', async () => {
  // Tombstone B, let B withdraw ₹10 (4000 → 3000, seq 0 → 1) as B, then
  // reverse j-old with the ORIGINAL allocations (A: 5000, B: 4000) — B
  // ends at -1000, which is allowed because B is removed (the fund's
  // standing liability).
  const db = adminCtx().firestore();
  await assertSucceeds(updateDoc(doc(db, 'users/' + B), { removedAt: 1 }));
  const dbB = authed(B).firestore();
  await assertSucceeds(withdrawalBatch(dbB, B, 3000, 1, 1000).commit());

  const b = jobReversalBatch(db, 'j-old',
    { [A]: 5000, [B]: 4000 },
    { [A]: 5000, [B]: 3000 });
  await assertSucceeds(b.commit());
});


/* =====================================================================
   13. v3.0 — USERNAME LOGINS: synthetic student identifiers
   ---------------------------------------------------------------------
   A student account's Firebase Auth email is
   `<username>@students.jkss-fund.invalid` (RFC 2606 `.invalid` domain).
   The rules know nothing about usernames — they key everything on the
   token's email — so these scenarios prove the SAME least-privilege model
   holds for the new identifiers, with no rules change required.
   ===================================================================== */
const S1 = 'thangal@students.jkss-fund.invalid';
const S2 = 'midlaj@students.jkss-fund.invalid';
const S3 = 'swabeeh@students.jkss-fund.invalid';   // never pre-authorized
const PLANNED_SHAPE = {
  email: S3, role: 'student', full_name: 'Swabeeh', avatar: '',
  balancePaise: 0, balance: 0, txnSeq: 0,
};

async function seedSynthetic() {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'users/' + S1), {
      email: S1, role: 'student', full_name: 'Thangal', avatar: '',
      balancePaise: 250000, balance: 2500, txnSeq: 0,
    });
    await setDoc(doc(db, 'users/' + S2), {
      email: S2, role: 'student', full_name: 'Midlaj', avatar: '',
      balancePaise: 0, balance: 0, txnSeq: 0,
    });
    await setDoc(doc(db, 'meta/committee'), { balancePaise: 0, balance: 0 });
  });
}

test('v3.0: admin pre-authorizes a student at a SYNTHETIC identifier (exact app shape)', async () => {
  await seedSynthetic();
  const db = adminCtx().firestore();
  await assertSucceeds(setDoc(doc(db, 'users/' + S3), Object.assign({}, PLANNED_SHAPE, { createdAt: 1 })));
});

test('v3.0: a synthetic student CANNOT self-create a profile (no self-provisioning)', async () => {
  await seedSynthetic();
  const db = authed(S3).firestore();
  await assertFails(setDoc(doc(db, 'users/' + S3), Object.assign({}, PLANNED_SHAPE, { createdAt: 1 })));
});

test('v3.0: a synthetic student CANNOT pre-authorize another student', async () => {
  await seedSynthetic();
  const db = authed(S1).firestore();
  await assertFails(setDoc(doc(db, 'users/' + S3), Object.assign({}, PLANNED_SHAPE, { createdAt: 1 })));
  // ...nor grant themselves admin, nor seed a non-zero balance.
  await assertFails(setDoc(doc(db, 'users/' + S1), {
    email: S1, role: 'admin', full_name: 'Thangal', avatar: '', balancePaise: 999999, balance: 9999.99, txnSeq: 0,
  }));
});

test('v3.0: an UNAUTHORIZED synthetic account can read nothing and write nothing', async () => {
  await seedSynthetic();
  const db = authed(S3).firestore();
  // Reading your OWN profile id is denied: the student gate requires a
  // pre-authorized profile, and this account has none. The committee balance
  // is a student-only read, so it is denied too.
  await assertFails(getDoc(doc(db, 'users/' + S3)));
  await assertFails(getDoc(doc(db, 'meta/committee')));
  await assertFails(getDoc(doc(db, 'users/' + S1)));                 // another student
  await assertFails(getDocs(collection(db, 'users')));               // roster list (admin-only)
  await assertFails(getDoc(doc(db, 'users/' + S1 + '/transactions/' + 'earn_j-syn_' + S1)));
  await assertFails(getDocs(collection(db, 'jobs')));
  await assertFails(getDoc(doc(db, 'jobs/j-old')));
  // Writes: no profile, no ledger entry, no balance, no job, no committee.
  await assertFails(setDoc(doc(db, 'users/' + S3), PLANNED_SHAPE));
  await assertFails(setDoc(doc(db, 'users/' + S3 + '/transactions/t1'), {
    type: 'withdrawal', studentId: S3, amountPaise: 1, amount: 0.01, seq: 1,
  }));
  await assertFails(updateDoc(doc(db, 'users/' + S1), { balancePaise: 999999 }));
  await assertFails(setDoc(doc(db, 'jobs/j-syn'), {
    name: 'x', date: '2026-10-01', status: 'active', amountPaise: 1000,
    committeeSharePaise: 100, studentSharePaise: 900, studentCount: 1, allocations: { [S1]: 900 },
  }));
  await assertFails(updateDoc(doc(db, 'meta/committee'), { balancePaise: 100000 }));
});

test('v3.0: a pre-authorized synthetic student reads ONLY their own data (+ the committee)', async () => {
  await seedSynthetic();
  const db = authed(S1).firestore();
  await assertSucceeds(getDoc(doc(db, 'users/' + S1)));
  await assertSucceeds(getDoc(doc(db, 'meta/committee')));           // public fund total
  await assertFails(getDoc(doc(db, 'users/' + S2)));                 // another student's profile
  await assertFails(getDocs(collection(db, 'users')));               // roster list
  await assertFails(getDoc(doc(db, 'users/' + S2 + '/transactions/anything')));
  await assertFails(getDoc(doc(db, 'jobs/j-nope')));
});

test('v3.0: synthetic student withdrawal (balance + canonical txn pair) is allowed', async () => {
  await seedSynthetic();
  const db = authed(S1).firestore();
  // 250000 → 240000 paise, seq 0 → 1, companion id w_S1_1.
  await assertSucceeds(withdrawalBatch(db, S1, 240000, 1, 10000).commit());
});

test('v3.0: synthetic student withdrawal withOUT the companion txn is denied', async () => {
  await seedSynthetic();
  const db = authed(S1).firestore();
  const b = writeBatch(db);
  b.update(doc(db, 'users/' + S1), {
    balancePaise: 240000, balance: 2400, txnSeq: 1, withdrawalTxnId: 'w_' + S1 + '_1',
  });
  await assertFails(b.commit());
});

test('v3.0: synthetic student cannot change their own balance/role without a withdrawal pair', async () => {
  await seedSynthetic();
  const db = authed(S1).firestore();
  await assertFails(updateDoc(doc(db, 'users/' + S1), { balancePaise: 999999 }));
  await assertFails(updateDoc(doc(db, 'users/' + S1), { role: 'admin' }));
  await assertFails(updateDoc(doc(db, 'users/' + S1), { txnSeq: 99 }));
  await assertFails(deleteDoc(doc(db, 'users/' + S1)));
});

test('v3.0: admin job credit with allocations keyed by SYNTHETIC identifiers is allowed', async () => {
  await seedSynthetic();
  const db = adminCtx().firestore();
  // ₹100 → 10000 paise: committee 1000 (floored 10%), pool 9000 over 2 students
  // → base 4500, so every allocation must be 4500 or 4501 (rule-enforced).
  const b = jobCreditBatch(db, 'j-syn', 10000,
    { [S1]: 4500, [S2]: 4500 },
    { [S1]: 250000, [S2]: 0 },
    { committeeNewPaise: 1000 });
  await assertSucceeds(b.commit());
});

test('v3.0: job credit is denied when a synthetic credit delta != the stored allocation', async () => {
  await seedSynthetic();
  const db = adminCtx().firestore();
  // Allocation says 4500 for S2 but the user document only moves 100 paise.
  const b = jobCreditBatch(db, 'j-syn-bad', 10000,
    { [S1]: 4500, [S2]: 4500 },
    { [S1]: 250000, [S2]: 0 },
    { committeeNewPaise: 1000, userFinal: { [S2]: 100 } });
  await assertFails(b.commit());
});

test('v3.0: job credit is denied when the committee share is not exactly 10%', async () => {
  await seedSynthetic();
  const db = adminCtx().firestore();
  const b = jobCreditBatch(db, 'j-syn-bad2', 10000,
    { [S1]: 4500, [S2]: 4500 },
    { [S1]: 250000, [S2]: 0 },
    { committeeNewPaise: 999 });
  await assertFails(b.commit());
});

test('v3.0: reversing a job allocated to SYNTHETIC identifiers replays the original amounts', async () => {
  await seedSynthetic();
  const db = adminCtx().firestore();
  await assertSucceeds(jobCreditBatch(db, 'j-syn-rev', 10000,
    { [S1]: 4500, [S2]: 4500 },
    { [S1]: 250000, [S2]: 0 },
    { committeeNewPaise: 1000 }).commit());
  // S1 = 254500, S2 = 4500, committee = 1000. Reversal → 250000 / 0 / 0.
  await assertSucceeds(jobReversalBatch(db, 'j-syn-rev',
    { [S1]: 4500, [S2]: 4500 },
    { [S1]: 254500, [S2]: 4500 },
    { committeeNewPaise: 0 }).commit());
  // A SECOND reversal must fail (the job is already tombstoned) and must not
  // debit anyone again — the ledger is append-only and double-reversal-proof.
  await assertFails(jobReversalBatch(db, 'j-syn-rev',
    { [S1]: 4500, [S2]: 4500 },
    { [S1]: 250000, [S2]: 0 },
    { committeeNewPaise: -1000 }).commit());
});

test('v3.0: an admin cannot create a synthetic profile whose email field != its id', async () => {
  await seedSynthetic();
  const db = adminCtx().firestore();
  await assertFails(setDoc(doc(db, 'users/' + S3), Object.assign({}, PLANNED_SHAPE, {
    email: S2, createdAt: 1,
  })));
  await assertFails(setDoc(doc(db, 'users/' + S3), Object.assign({}, PLANNED_SHAPE, {
    createdAt: 1, extraField: 'nope',
  })));
});

test('v3.0: a legacy real-email student with NO authorization is on hold: no student rights at all', async () => {
  await seedSynthetic();
  const db = adminCtx().firestore();
  // The admin can still write a legacy profile document (admin path)...
  await assertSucceeds(setDoc(doc(db, 'users/legacy.student@jkss.in'), {
    email: 'legacy.student@jkss.in', role: 'student', full_name: 'Legacy Student', avatar: '',
    balancePaise: 0, balance: 0, txnSeq: 0, createdAt: 1,
  }));
  // ...but without an authorization document the account reads nothing of its own.
  const legacy = authed('legacy.student@jkss.in').firestore();
  await assertFails(getDoc(doc(legacy, 'users/legacy.student@jkss.in')));
  await assertFails(getDoc(doc(legacy, 'users/' + S1)));
  await assertFails(setDoc(doc(legacy, 'users/' + S3), PLANNED_SHAPE));
});

/* =====================================================================
   14. Held legacy accounts (Option B): the access gate
   A real-email account with no legacyAuthorizations document is ON HOLD.
   It must not read or write any financial data, through any path. Admin
   access (reconciliation, legitimate job reversal) is unchanged.
   ===================================================================== */

const H = 'held.legacy@gmail.com';            // real email, NOT authorized
const H_OK = 'authorized.legacy@gmail.com';   // same shape, WITH authorization

// A held legacy profile exactly as the production data can look: a balance,
// a txnSeq, and a ledger entry. No authorization document.
async function seedHeld(email = H) {
  await seed();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'users/' + email), {
      email, role: 'student', full_name: 'Held Legacy', avatar: '',
      balancePaise: 7500, balance: 75, txnSeq: 3,
    });
    await setDoc(doc(db, 'users/' + email + '/transactions/t-old'), {
      type: 'earning', studentId: email, jobId: 'j-held', amountPaise: 1485, amount: 14.85,
      description: 'Old job', createdAt: 1,
    });
  });
}

// The original job whose only allocation belongs to H (for a reversal test).
async function seedHeldJob(email = H) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'jobs/j-held'), {
      name: 'Held job', date: '2026-01-02', status: 'active',
      amountPaise: 1650, committeeSharePaise: 165, studentSharePaise: 1485,
      studentCount: 1, allocations: { [email]: 1485 },
    });
  });
}

async function setAuthorization(email, value) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'legacyAuthorizations/' + email), value);
  });
}

test('held legacy: CANNOT read its own profile (the balance is financial data)', async () => {
  await seedHeld();
  await assertFails(getDoc(doc(authed(H).firestore(), 'users/' + H)));
});

test('held legacy: CANNOT list or read its own ledger', async () => {
  await seedHeld();
  const db = authed(H).firestore();
  await assertFails(getDocs(collection(db, 'users/' + H + '/transactions')));
  await assertFails(getDoc(doc(db, 'users/' + H + '/transactions/t-old')));
});

test('held legacy: CANNOT read the ledger through a collection-group query', async () => {
  await seedHeld();
  await assertFails(getDocs(collectionGroup(authed(H).firestore(), 'transactions')));
});

test('held legacy: CANNOT withdraw (the atomic balance + companion txn batch is denied)', async () => {
  await seedHeld();
  const db = authed(H).firestore();
  await assertFails(withdrawalBatch(db, H, 6500, 4, 1000).commit());
});

test('held legacy: CANNOT withdraw by writing only the companion ledger entry', async () => {
  await seedHeld();
  const db = authed(H).firestore();
  await assertFails(setDoc(doc(db, 'users/' + H + '/transactions/w_' + H + '_4'), {
    type: 'withdrawal', studentId: H, amountPaise: 1000, amount: 10, seq: 4,
  }));
});

test('held legacy: CANNOT withdraw by a balance-only or pair-shaped user update', async () => {
  await seedHeld();
  const db = authed(H).firestore();
  await assertFails(updateDoc(doc(db, 'users/' + H), { balancePaise: 999999, balance: 9999.99 }));
  await assertFails(updateDoc(doc(db, 'users/' + H), {
    balancePaise: 6500, balance: 65, txnSeq: 4, withdrawalTxnId: 'w_' + H + '_4',
  }));
});

test('held legacy: CANNOT change its profile (full_name, role, txnSeq) or delete it', async () => {
  await seedHeld();
  const db = authed(H).firestore();
  await assertFails(updateDoc(doc(db, 'users/' + H), { full_name: 'Renamed' }));
  await assertFails(updateDoc(doc(db, 'users/' + H), { role: 'admin' }));
  await assertFails(updateDoc(doc(db, 'users/' + H), { txnSeq: 0 }));
  await assertFails(deleteDoc(doc(db, 'users/' + H)));
});

test('held legacy: CANNOT write its own ledger entries of any type', async () => {
  await seedHeld();
  const db = authed(H).firestore();
  await assertFails(setDoc(doc(db, 'users/' + H + '/transactions/earn_x_' + H), {
    type: 'earning', studentId: H, jobId: 'x', amountPaise: 100, amount: 1,
  }));
  await assertFails(setDoc(doc(db, 'users/' + H + '/transactions/rev_x_' + H), {
    type: 'reversal', studentId: H, jobId: 'x', amountPaise: 100, amount: 1,
  }));
});

test('held legacy: CANNOT bypass the hold by bundling a withdrawal with a committee write', async () => {
  await seedHeld();
  const db = authed(H).firestore();
  const b = withdrawalBatch(db, H, 6500, 4, 1000);
  b.update(doc(db, 'meta/committee'), { balancePaise: 1100, balance: 11 });
  await assertFails(b.commit());
});

test('held legacy: CANNOT read the committee balance or write it', async () => {
  await seedHeld();
  const db = authed(H).firestore();
  await assertFails(getDoc(doc(db, 'meta/committee')));
  await assertFails(updateDoc(doc(db, 'meta/committee'), { balancePaise: 0, balance: 0 }));
});

test('held legacy: CANNOT read jobs or write any job', async () => {
  await seedHeld();
  await seedHeldJob();
  const db = authed(H).firestore();
  await assertFails(getDocs(collection(db, 'jobs')));
  await assertFails(getDoc(doc(db, 'jobs/j-held')));
  await assertFails(updateDoc(doc(db, 'jobs/j-held'), { status: 'reversed', reversedAt: 1 }));
  await assertFails(setDoc(doc(db, 'jobs/j-new'), {
    name: 'x', date: '2026-10-01', status: 'active', amountPaise: 1000,
    committeeSharePaise: 100, studentSharePaise: 900, studentCount: 1, allocations: { [H]: 900 },
  }));
});

test('held legacy: CANNOT authorize itself (no client can write legacyAuthorizations)', async () => {
  await seedHeld();
  const db = authed(H).firestore();
  await assertFails(setDoc(doc(db, 'legacyAuthorizations/' + H), { email: H, authorized: true }));
  // ...and so the withdrawal is still denied afterwards.
  await assertFails(withdrawalBatch(db, H, 6500, 4, 1000).commit());
});

test('held legacy: CANNOT read the authorization collection', async () => {
  await seedHeld();
  await assertFails(getDoc(doc(authed(H).firestore(), 'legacyAuthorizations/' + H)));
  await assertFails(getDocs(collection(authed(H).firestore(), 'legacyAuthorizations')));
});

test('held legacy: a real-email account whose email only CONTAINS the synthetic suffix is still held', async () => {
  const spoof = 'mallory@students.jkss-fund.invalid.example.com';
  await seedHeld(spoof);
  const db = authed(spoof).firestore();
  await assertFails(getDoc(doc(db, 'users/' + spoof)));
  await assertFails(withdrawalBatch(db, spoof, 6500, 4, 1000).commit());
});

test('held legacy: admin CANNOT authorize an account through the client (console/admin SDK only)', async () => {
  await seedHeld();
  const db = adminCtx().firestore();
  await assertFails(setDoc(doc(db, 'legacyAuthorizations/' + H), { email: H, authorized: true }));
});

test('held legacy: admin reconciliation still reads its profile, ledger and the user list', async () => {
  await seedHeld();
  const db = adminCtx().firestore();
  await assertSucceeds(getDoc(doc(db, 'users/' + H)));
  await assertSucceeds(getDocs(collection(db, 'users/' + H + '/transactions')));
  await assertSucceeds(getDocs(collection(db, 'users')));
});

test('held legacy: admin can still reverse a job allocated to it (legitimate reconciliation)', async () => {
  await seedHeld();
  await seedHeldJob();
  const db = adminCtx().firestore();
  const b = jobReversalBatch(db, 'j-held', { [H]: 1485 }, { [H]: 7500 }, { committeeNewPaise: 835 });
  await assertSucceeds(b.commit());
});

test('held legacy: an AUTHORIZED real-email account can read its profile and withdraw', async () => {
  await seedHeld(H_OK);
  await setAuthorization(H_OK, { email: H_OK, authorized: true });
  const db = authed(H_OK).firestore();
  await assertSucceeds(getDoc(doc(db, 'users/' + H_OK)));
  await assertSucceeds(withdrawalBatch(db, H_OK, 6500, 4, 1000).commit());
});

test('held legacy: REVOKING the authorization (authorized: false) holds the account again', async () => {
  await seedHeld(H_OK);
  await setAuthorization(H_OK, { email: H_OK, authorized: false });
  const db = authed(H_OK).firestore();
  await assertFails(getDoc(doc(db, 'users/' + H_OK)));
  await assertFails(withdrawalBatch(db, H_OK, 6500, 4, 1000).commit());
});

test('held legacy: an authorization document WITHOUT authorized == true does not authorize', async () => {
  await seedHeld(H_OK);
  await setAuthorization(H_OK, { email: H_OK });
  await assertFails(getDoc(doc(authed(H_OK).firestore(), 'users/' + H_OK)));
});

test('held legacy: an authorization for a DIFFERENT email does not authorize this account', async () => {
  await seedHeld();
  await setAuthorization(H_OK, { email: H_OK, authorized: true });
  await assertFails(withdrawalBatch(authed(H).firestore(), H, 6500, 4, 1000).commit());
});

test('held legacy: the username (synthetic) path is NOT affected by the gate', async () => {
  await seedSynthetic();
  const db = authed(S1).firestore();
  await assertSucceeds(getDoc(doc(db, 'users/' + S1)));
  await assertSucceeds(getDoc(doc(db, 'meta/committee')));
  await assertSucceeds(withdrawalBatch(db, S1, 240000, 1, 10000).commit());
});

/* =====================================================================
   15. Pre-authorization gate: verified email + pre-authorized profile
   A student financial path needs ALL of: a VERIFIED email, a users/{email}
   profile with role 'student' (created only by an admin), and EITHER a
   username identifier OR a legacyAuthorizations document. These scenarios
   try each way an account could get past one of those checks, and confirm
   that the legitimate paths (pre-authorized username student, authorized
   legacy student, admin) still work.
   ===================================================================== */

// Every student path an account WITHOUT a usable profile could try.
// `own` is the account's own identifier; `other` is another student.
async function assertNoStudentAccess(db, own, other) {
  await assertFails(getDoc(doc(db, 'meta/committee')));                       // committee balance
  await assertFails(getDoc(doc(db, 'users/' + own)));                         // own profile
  await assertFails(getDocs(collection(db, 'users/' + own + '/transactions'))); // own ledger
  await assertFails(withdrawalBatch(db, own, 240000, 1, 10000).commit());      // own withdrawal
  await assertFails(updateDoc(doc(db, 'users/' + own), { balancePaise: 0, balance: 0 }));
  await assertFails(getDoc(doc(db, 'users/' + other)));                       // another student
  await assertFails(withdrawalBatch(db, other, 240000, 1, 10000).commit());   // another's withdrawal
}

test('pre-auth: a synthetic account with NO profile cannot read the committee, another student, or the roster', async () => {
  await seedSynthetic();
  const db = authed(S3).firestore();
  await assertNoStudentAccess(db, S3, S1);
  await assertFails(getDocs(collection(db, 'users')));                        // roster
  await assertFails(getDocs(collectionGroup(db, 'transactions')));            // every ledger
  await assertFails(getDocs(collection(db, 'jobs')));
});

test('pre-auth: a synthetic account with NO profile cannot create a financial transaction or change any balance', async () => {
  await seedSynthetic();
  const db = authed(S3).firestore();
  await assertFails(setDoc(doc(db, 'users/' + S3 + '/transactions/w_' + S3 + '_1'), {
    type: 'withdrawal', studentId: S3, amountPaise: 1, amount: 0.01, seq: 1,
  }));
  await assertFails(setDoc(doc(db, 'users/' + S1 + '/transactions/w_' + S1 + '_2'), {
    type: 'withdrawal', studentId: S1, amountPaise: 1, amount: 0.01, seq: 2,
  }));
  await assertFails(setDoc(doc(db, 'users/' + S3 + '/transactions/earn_x_' + S3), {
    type: 'earning', studentId: S3, jobId: 'x', amountPaise: 100, amount: 1,
  }));
  await assertFails(updateDoc(doc(db, 'users/' + S1), { balancePaise: 0, balance: 0 }));
  await assertFails(updateDoc(doc(db, 'meta/committee'), { balancePaise: 0, balance: 0 }));
  await assertFails(setDoc(doc(db, 'users/' + S3), PLANNED_SHAPE));
});

test('pre-auth: a profile whose role is NOT student (guest) gives no student access, even with a verified email', async () => {
  await seedSynthetic();
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'users/' + S1), {
      email: S1, role: 'guest', full_name: 'Thangal', avatar: '', balancePaise: 250000, balance: 2500, txnSeq: 0,
    });
  });
  await assertNoStudentAccess(authed(S1).firestore(), S1, S2);
});

test('pre-auth: a profile with NO role field gives no student access', async () => {
  await seedSynthetic();
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'users/' + S1), {
      email: S1, full_name: 'Thangal', avatar: '', balancePaise: 250000, balance: 2500, txnSeq: 0,
    });
  });
  await assertNoStudentAccess(authed(S1).firestore(), S1, S2);
});

test('pre-auth: an UNVERIFIED email gets no student access, even with a valid pre-authorized profile', async () => {
  await seedSynthetic();
  // S1 has a pre-authorized profile (role student, balance 2500). A squatter
  // who registered the same address without verifying it must get nothing.
  await assertNoStudentAccess(authedUnverified(S1).firestore(), S1, S2);
});

test('pre-auth: an UNVERIFIED email with a legacy authorization is denied too', async () => {
  await seedHeld(H_OK);
  await setAuthorization(H_OK, { email: H_OK, authorized: true });
  await assertNoStudentAccess(authedUnverified(H_OK).firestore(), H_OK, S1);
});

test('pre-auth: a legacy AUTHORIZATION with NO profile gives no student access', async () => {
  const X = 'ghost.legacy@gmail.com';
  await seedSynthetic();
  await setAuthorization(X, { email: X, authorized: true });
  await assertNoStudentAccess(authed(X).firestore(), X, S1);
});

test('pre-auth: a pre-authorized, verified username student keeps every legitimate student operation', async () => {
  await seedSynthetic();
  const db = authed(S1).firestore();
  await assertSucceeds(getDoc(doc(db, 'users/' + S1)));                              // own profile
  await assertSucceeds(getDoc(doc(db, 'meta/committee')));                           // committee
  await assertSucceeds(getDocs(collection(db, 'users/' + S1 + '/transactions')));    // own ledger
  await assertSucceeds(withdrawalBatch(db, S1, 240000, 1, 10000).commit());          // withdrawal
  await assertSucceeds(withdrawalBatch(db, S1, 230000, 2, 10000).commit());          // a second one
  await assertSucceeds(updateDoc(doc(db, 'users/' + S1), { full_name: 'Thangal K' })); // profile edit
});

test('pre-auth: an AUTHORIZED legacy student with a profile and a verified email keeps its access', async () => {
  await seedHeld(H_OK);
  await setAuthorization(H_OK, { email: H_OK, authorized: true });
  const db = authed(H_OK).firestore();
  await assertSucceeds(getDoc(doc(db, 'users/' + H_OK)));
  await assertSucceeds(getDoc(doc(db, 'meta/committee')));
  await assertSucceeds(withdrawalBatch(db, H_OK, 6500, 4, 1000).commit());
});

test('pre-auth: admin keeps its reads (roster, every ledger, jobs, committee) and its own profile', async () => {
  await seedSynthetic();
  const db = adminCtx().firestore();
  await assertSucceeds(getDoc(doc(db, 'users/' + ADMIN)));
  await assertSucceeds(getDoc(doc(db, 'meta/committee')));
  await assertSucceeds(getDocs(collection(db, 'users')));
  await assertSucceeds(getDocs(collection(db, 'users/' + S1 + '/transactions')));
  await assertSucceeds(getDocs(collection(db, 'jobs')));
});
