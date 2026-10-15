// test/rules.test.js
// Firestore SECURITY RULES test suite for JKSS-FUND v3.5.
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
  writeBatch,
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

const authed = (email) => env.authenticatedContext('uid-' + email.replace(/[^a-z0-9]/g, ''), { email });
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
   2. Student self-provisioning & privilege escalation
   ===================================================================== */
test('student: can self-create profile (student role, zero balances) on first sign-in', async () => {
  const db = authed(C).firestore();
  await assertSucceeds(setDoc(doc(db, 'users/' + C), {
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
/* v3.5 protocol: the withdrawal user write bumps txnSeq by 1 and the
   companion txn MUST live at the canonical id w_{email}_{newSeq}. */
function withdrawalBatch(db, email, finalPaise, seq, amountPaise, { txnId, extraUser = {} } = {}) {
  const b = writeBatch(db);
  b.update(doc(db, 'users/' + email), Object.assign(
    { balancePaise: finalPaise, balance: finalPaise / 100, txnSeq: seq }, extraUser));
  b.set(doc(db, 'users/' + email + '/transactions/' + (txnId || ('w_' + email + '_' + seq))), {
    type: 'withdrawal', studentId: email, amountPaise, amount: amountPaise / 100,
    description: 'Books',
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
  await assertFails(updateDoc(doc(db, 'users/' + A),
    { balancePaise: 3000, balance: 30, txnSeq: 1 }));
});
test('student: companion txn WITHOUT balance reduction is denied', async () => {
  const db = authed(A).firestore();
  await assertFails(setDoc(doc(db, 'users/' + A + '/transactions/w_' + A + '_1'), {
    type: 'withdrawal', studentId: A, amountPaise: 2000, amount: 20,
  }));
});
test('student: withdrawal driving balance negative is denied', async () => {
  const db = authed(A).firestore();
  await assertFails(withdrawalBatch(db, A, -1000, 1, 6000).commit());
});
test('student: withdrawal txn amount must EXACTLY equal the delta', async () => {
  const db = authed(A).firestore();
  // User drops by 1500 (→3500) but the canonical txn claims 2000:
  // the txn rule checks final == pre - amount and denies the batch.
  const b = writeBatch(db);
  b.update(doc(db, 'users/' + A), { balancePaise: 3500, balance: 35, txnSeq: 1 });
  b.set(doc(db, 'users/' + A + '/transactions/w_' + A + '_1'), {
    type: 'withdrawal', studentId: A, amountPaise: 2000, amount: 20, // mismatch
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
