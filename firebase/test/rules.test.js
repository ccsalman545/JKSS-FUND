// test/rules.test.js
// Firestore SECURITY RULES test suite for JKSS-FUND v3.1.
//
// Runs the DEPLOYED rules (firebase/firestore.rules) inside the real
// Firestore emulator (production rules engine) via the official
// @firebase/rules-unit-testing library. This is NOT a simulation: every
// assertSucceeds/assertFails is evaluated by the same engine that runs in
// production.
//
// Prerequisites (one-time, on a machine with Node 18+ and Java 11+):
//   cd firebase
//   npm install                 (installs @firebase/rules-unit-testing + firebase)
//   npm i -g firebase-tools     (provides the emulator)
//
// Run (starts a throwaway local emulator, never touches production):
//   cd firebase
//   firebase emulators:exec --only firestore "node test/rules.test.js"
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

/* Seed a deterministic world (bypasses rules — test setup only). */
async function seed() {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'users/' + ADMIN), {
      email: ADMIN, role: 'admin', full_name: 'Admin', balancePaise: 0, balance: 0,
    });
    await setDoc(doc(db, 'users/' + A), {
      email: A, role: 'student', full_name: 'A', balancePaise: 5000, balance: 50,
    });
    await setDoc(doc(db, 'users/' + B), {
      email: B, role: 'student', full_name: 'B', balancePaise: 4000, balance: 40,
    });
    await setDoc(doc(db, 'meta/committee'), { balancePaise: 1000, balance: 10 });
    // Pre-v3.1 top-level ledger entry (audit-only path).
    await setDoc(doc(db, 'transactions/legacy1'), { type: 'earning', amount: 10 });
    // A fully-formed job with original allocation history.
    await setDoc(doc(db, 'jobs/j-old'), {
      name: 'Old job', date: '2026-01-01',
      amountPaise: 10000, committeeSharePaise: 1000, studentSharePaise: 9000,
      studentCount: 2,
      allocations: [
        { email: A, index: 0, amountPaise: 5000 },
        { email: B, index: 1, amountPaise: 4000 },
      ],
    });
  });
}

/* Build the admin job-credit batch (the shape api.addJob produces). */
function jobCreditBatch(db, jobId, amountPaise, allocs, { omitTxnFor = null, omitCommittee = false, committeeDelta } = {}) {
  const committee = committeeDelta != null ? committeeDelta : Math.floor(amountPaise / 10);
  const pool = amountPaise - committee;
  const b = writeBatch(db);
  b.set(doc(db, 'jobs/' + jobId), {
    name: 'Test job', date: '2026-10-01',
    amountPaise,
    committeeSharePaise: committee,
    studentSharePaise: pool,
    studentCount: allocs.length,
    allocations: allocs.map((a, i) => ({ email: a.email, index: i, amountPaise: a.amountPaise })),
  });
  allocs.forEach((a, i) => {
    const cur = a.currentPaise;
    b.update(doc(db, 'users/' + a.email), { balancePaise: cur + a.amountPaise });
    if (omitTxnFor !== a.email) {
      b.set(doc(db, 'users/' + a.email + '/transactions/' + jobId + ':' + i), {
        type: 'earning', studentId: a.email, jobId,
        amountPaise: a.amountPaise, amount: a.amountPaise / 100,
        description: 'Earning from Test job',
      });
    }
  });
  if (!omitCommittee) b.update(doc(db, 'meta/committee'), { balancePaise: 1000 + committee });
  return b;
}

/* Build the admin job-reversal batch (the shape api.deleteJob produces). */
function jobReversalBatch(db, jobId, allocs, { wrongAmountFor = null, omitCommittee = false, extraTxnIdPrefix } = {}) {
  const b = writeBatch(db);
  allocs.forEach((a, i) => {
    const amt = wrongAmountFor === a.email ? a.amountPaise - 100 : a.amountPaise;
    b.update(doc(db, 'users/' + a.email), { balancePaise: a.currentPaise - a.amountPaise });
    const txnId = (extraTxnIdPrefix || 'rev_') + jobId + '_' + i;
    b.set(doc(db, 'users/' + a.email + '/transactions/' + txnId), {
      type: 'reversal', studentId: a.email, jobId,
      amountPaise: amt, amount: amt / 100,
      description: 'Reversal — Old job',
    });
  });
  if (!omitCommittee) b.update(doc(db, 'meta/committee'), { balancePaise: 0 });
  b.delete(doc(db, 'jobs/' + jobId));
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
      console.log('  FAIL  ' + name + '\n        → ' + (e && e.message).split('\n')[0]);
    }
  }

  await env.cleanup();
  console.log('\n' + pass + ' passed, ' + fail + ' failed  (' + tests.length + ' total)');
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error('FATAL — could not initialize the rules test environment.', e.message);
  console.error('Hint: run via `firebase emulators:exec --only firestore "node test/rules.test.js"`');
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
    email: C, role: 'student', full_name: 'C', balancePaise: 0, balance: 0,
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
    email: C, role: 'student', full_name: 'C', balancePaise: 0, balance: 0,
  }));
});
test('student: CANNOT self-create profile with role admin (no self-elevation)', async () => {
  const db = authed(C).firestore();
  await assertFails(setDoc(doc(db, 'users/' + C), {
    email: C, role: 'admin', full_name: 'C', balancePaise: 0, balance: 0,
  }));
});
test('student: CANNOT self-create profile with non-zero balance', async () => {
  const db = authed(C).firestore();
  await assertFails(setDoc(doc(db, 'users/' + C), {
    email: C, role: 'student', full_name: 'C', balancePaise: 100, balance: 1,
  }));
});
test('student: CANNOT self-create profile for someone else email', async () => {
  const db = authed(C).firestore();
  await assertFails(setDoc(doc(db, 'users/' + A), {
    email: A, role: 'student', full_name: 'C', balancePaise: 0, balance: 0,
  }));
});
test('student: CANNOT modify own role', async () => {
  const db = authed(A).firestore();
  await assertFails(updateDoc(doc(db, 'users/' + A), { role: 'admin' }));
});
test('student: CANNOT modify own balance without a companion txn', async () => {
  const db = authed(A).firestore();
  await assertFails(updateDoc(doc(db, 'users/' + A), { balancePaise: 999999 }));
  await assertFails(updateDoc(doc(db, 'users/' + A), { balance: 9999.99, balancePaise: 999999 }));
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
test('student: withdrawal WITH matching companion txn (atomic) is allowed', async () => {
  const db = authed(A).firestore();
  const b = writeBatch(db);
  b.update(doc(db, 'users/' + A), { balancePaise: 3000, balance: 30 });
  b.set(doc(db, 'users/' + A + '/transactions/w1'), {
    type: 'withdrawal', studentId: A, amountPaise: 2000, amount: 20,
    description: 'Books',
  });
  await assertSucceeds(b.commit());
});
test('student: withdrawal WITHOUT companion txn is denied', async () => {
  const db = authed(A).firestore();
  await assertFails(updateDoc(doc(db, 'users/' + A), { balancePaise: 3000 }));
});
test('student: companion txn WITHOUT balance reduction is denied', async () => {
  const db = authed(A).firestore();
  await assertFails(setDoc(doc(db, 'users/' + A + '/transactions/w1'), {
    type: 'withdrawal', studentId: A, amountPaise: 2000, amount: 20,
  }));
});
test('student: withdrawal driving balance negative is denied', async () => {
  const db = authed(A).firestore();
  const b = writeBatch(db);
  b.update(doc(db, 'users/' + A), { balancePaise: -1000 });
  b.set(doc(db, 'users/' + A + '/transactions/w1'), {
    type: 'withdrawal', studentId: A, amountPaise: 6000, amount: 60,
  });
  await assertFails(b.commit());
});
test('student: withdrawal txn amount must EXACTLY equal the delta', async () => {
  const db = authed(A).firestore();
  const b = writeBatch(db);
  b.update(doc(db, 'users/' + A), { balancePaise: 3500 }); // delta 1500
  b.set(doc(db, 'users/' + A + '/transactions/w1'), {
    type: 'withdrawal', studentId: A, amountPaise: 2000, amount: 20, // mismatch
  });
  await assertFails(b.commit());
});
test('student: second withdrawal cannot overdraw after first one (sequential)', async () => {
  const db = authed(A).firestore();
  // First: withdraw 4000 of 5000 → 1000 left.
  let b = writeBatch(db);
  b.update(doc(db, 'users/' + A), { balancePaise: 1000 });
  b.set(doc(db, 'users/' + A + '/transactions/w1'), {
    type: 'withdrawal', studentId: A, amountPaise: 4000, amount: 40,
  });
  await assertSucceeds(b.commit());
  // Second: attempt 2000 from 1000 → denied.
  b = writeBatch(db);
  b.update(doc(db, 'users/' + A), { balancePaise: -1000 });
  b.set(doc(db, 'users/' + A + '/transactions/w2'), {
    type: 'withdrawal', studentId: A, amountPaise: 2000, amount: 20,
  });
  await assertFails(b.commit());
});
test('student: withdrawal may bundle an allowed profile field (not role/balance extras)', async () => {
  const db = authed(A).firestore();
  const b = writeBatch(db);
  b.update(doc(db, 'users/' + A), { balancePaise: 4500, full_name: 'A Prime' });
  b.set(doc(db, 'users/' + A + '/transactions/w1'), {
    type: 'withdrawal', studentId: A, amountPaise: 500, amount: 5,
  });
  await assertSucceeds(b.commit());
});
test('student: withdrawal batch that also edits role is denied', async () => {
  const db = authed(A).firestore();
  const b = writeBatch(db);
  b.update(doc(db, 'users/' + A), { balancePaise: 4500, role: 'admin' });
  b.set(doc(db, 'users/' + A + '/transactions/w1'), {
    type: 'withdrawal', studentId: A, amountPaise: 500, amount: 5,
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
    email: C, role: 'student', full_name: 'C', balancePaise: 0, balance: 0,
  }));
});
test('admin: can provision another admin (only admin can grant admin, at create)', async () => {
  const db = adminCtx().firestore();
  await assertSucceeds(setDoc(doc(db, 'users/admin2@jkss.in'), {
    email: 'admin2@jkss.in', role: 'admin', full_name: 'Admin 2', balancePaise: 0, balance: 0,
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
  const b = jobCreditBatch(db, 'j1', 10000, [
    { email: A, amountPaise: 4500, currentPaise: 5000 },
    { email: B, amountPaise: 4500, currentPaise: 4000 },
  ]);
  await assertSucceeds(b.commit());
});
test('admin: can update a job status (active/archived only)', async () => {
  const db = adminCtx().firestore();
  await assertSucceeds(updateDoc(doc(db, 'jobs/j-old'), { status: 'archived' }));
});
test('admin: can delete a job with a valid complete reversal batch (original allocations)', async () => {
  const db = adminCtx().firestore();
  const b = jobReversalBatch(db, 'j-old', [
    { email: A, amountPaise: 5000, currentPaise: 5000 },
    { email: B, amountPaise: 4000, currentPaise: 4000 },
  ]);
  await assertSucceeds(b.commit());
});

/* =====================================================================
   7. Admin: invalid financial writes are denied
   ===================================================================== */
test('admin: job with wrong committee share (not floor 10%) is denied', async () => {
  const db = adminCtx().firestore();
  const b = jobCreditBatch(db, 'j1', 10000, [
    { email: A, amountPaise: 4500, currentPaise: 5000 },
    { email: B, amountPaise: 4500, currentPaise: 4000 },
  ], { committeeDelta: 1001 }); // 10.01% — must be exactly floor(10000/10)=1000
  await assertFails(b.commit());
});
test('admin: job whose allocations do not follow the largest-remainder formula is denied', async () => {
  const db = adminCtx().firestore();
  // Pool 9000 over 2 → must be 4500/4500. 4600/4400 keeps the SUM but
  // breaks the formula (big=0 ≠ r=0... actually base+1 count mismatch).
  const b = writeBatch(db);
  b.set(doc(db, 'jobs/j1'), {
    name: 'Skewed', date: '2026-10-01',
    amountPaise: 10000, committeeSharePaise: 1000, studentSharePaise: 9000,
    studentCount: 2,
    allocations: [
      { email: A, index: 0, amountPaise: 4600 },
      { email: B, index: 1, amountPaise: 4400 },
    ],
  });
  b.update(doc(db, 'users/' + A), { balancePaise: 5000 + 4600 });
  b.update(doc(db, 'users/' + B), { balancePaise: 4000 + 4400 });
  b.set(doc(db, 'users/' + A + '/transactions/j1:0'), {
    type: 'earning', studentId: A, jobId: 'j1', amountPaise: 4600, amount: 46,
  });
  b.set(doc(db, 'users/' + B + '/transactions/j1:1'), {
    type: 'earning', studentId: B, jobId: 'j1', amountPaise: 4400, amount: 44,
  });
  b.update(doc(db, 'meta/committee'), { balancePaise: 2000 });
  await assertFails(b.commit());
});
test('admin: job with credit larger than its allocation is denied', async () => {
  const db = adminCtx().firestore();
  // Job says A gets 4500, but the users update credits 5000.
  const b = writeBatch(db);
  b.set(doc(db, 'jobs/j1'), {
    name: 'Skim', date: '2026-10-01',
    amountPaise: 10000, committeeSharePaise: 1000, studentSharePaise: 9000,
    studentCount: 1,
    allocations: [{ email: A, index: 0, amountPaise: 4500 }],
  });
  b.update(doc(db, 'users/' + A), { balancePaise: 5000 + 5000 });
  b.set(doc(db, 'users/' + A + '/transactions/j1:0'), {
    type: 'earning', studentId: A, jobId: 'j1', amountPaise: 5000, amount: 50,
  });
  b.update(doc(db, 'meta/committee'), { balancePaise: 2000 });
  await assertFails(b.commit());
});
test('admin: incomplete job batch (missing a student txn) is denied atomically', async () => {
  const db = adminCtx().firestore();
  const b = jobCreditBatch(db, 'j1', 10000, [
    { email: A, amountPaise: 4500, currentPaise: 5000 },
    { email: B, amountPaise: 4500, currentPaise: 4000 },
  ], { omitTxnFor: B });
  await assertFails(b.commit());
});
test('admin: job batch without the committee credit is denied', async () => {
  const db = adminCtx().firestore();
  const b = jobCreditBatch(db, 'j1', 10000, [
    { email: A, amountPaise: 4500, currentPaise: 5000 },
    { email: B, amountPaise: 4500, currentPaise: 4000 },
  ], { omitCommittee: true });
  await assertFails(b.commit());
});
test('admin: CANNOT update job fields other than status', async () => {
  const db = adminCtx().firestore();
  await assertFails(updateDoc(doc(db, 'jobs/j-old'), { name: 'Hacked' }));
  await assertFails(updateDoc(doc(db, 'jobs/j-old'), { amountPaise: 1 }));
  await assertFails(updateDoc(doc(db, 'jobs/j-old'), { status: 'pending' }));
});
test('admin: CANNOT delete a job without a full reversal batch', async () => {
  const db = adminCtx().firestore();
  await assertFails(deleteDoc(doc(db, 'jobs/j-old')));
});
test('admin: reversal with wrong (recalculated) amounts is denied', async () => {
  const db = adminCtx().firestore();
  const b = jobReversalBatch(db, 'j-old', [
    { email: A, amountPaise: 5000, currentPaise: 5000 },
    { email: B, amountPaise: 4000, currentPaise: 4000 },
  ], { wrongAmountFor: A }); // txn says 4900 ≠ original 5000
  await assertFails(b.commit());
});
test('admin: reversal using CURRENT-roster amounts (not original allocations) is denied', async () => {
  const db = adminCtx().firestore();
  // Roster changed: B is gone, pool "recalculated" evenly to A alone.
  const b = writeBatch(db);
  b.update(doc(db, 'users/' + A), { balancePaise: 5000 - 9000 }); // -4000 → negative, active
  b.set(doc(db, 'users/' + A + '/transactions/rev_j-old_0'), {
    type: 'reversal', studentId: A, jobId: 'j-old', amountPaise: 9000, amount: 90,
  });
  b.update(doc(db, 'meta/committee'), { balancePaise: 0 });
  b.delete(doc(db, 'jobs/j-old'));
  await assertFails(b.commit());
});
test('admin: reversal without committee credit-back is denied', async () => {
  const db = adminCtx().firestore();
  const b = jobReversalBatch(db, 'j-old', [
    { email: A, amountPaise: 5000, currentPaise: 5000 },
    { email: B, amountPaise: 4000, currentPaise: 4000 },
  ], { omitCommittee: true });
  await assertFails(b.commit());
});
test('admin: legacy job (no allocation history) CANNOT be deleted — manual reconciliation required', async () => {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const d = ctx.firestore();
    await setDoc(doc(d, 'jobs/j-legacy'), {
      name: 'Legacy', date: '2025-01-01', amount: 500, committeeShare: 50, studentShare: 450,
    });
  });
  const db = adminCtx().firestore();
  await assertFails(deleteDoc(doc(db, 'jobs/j-legacy')));
});
test('admin: CANNOT update committee outside a job batch', async () => {
  const db = adminCtx().firestore();
  await assertFails(updateDoc(doc(db, 'meta/committee'), { balancePaise: 2000 }));
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
  // Tombstone B, let B withdraw ₹10 (4000 → 3000), then reverse j-old with
  // the ORIGINAL allocations (A: 5000, B: 4000) — B ends at -1000, which is
  // allowed because B is removed (the fund's standing liability).
  const db = adminCtx().firestore();
  await assertSucceeds(updateDoc(doc(db, 'users/' + B), { removedAt: 1 }));
  let b = writeBatch(db);
  b.update(doc(db, 'users/' + B), { balancePaise: 3000 });
  b.set(doc(db, 'users/' + B + '/transactions/w-b'), {
    type: 'withdrawal', studentId: B, amountPaise: 1000, amount: 10,
  });
  await assertSucceeds(b.commit());

  b = writeBatch(db);
  b.update(doc(db, 'users/' + A), { balancePaise: 0 });            // 5000 - 5000
  b.set(doc(db, 'users/' + A + '/transactions/rev_j-old_0'), {
    type: 'reversal', studentId: A, jobId: 'j-old', amountPaise: 5000, amount: 50,
  });
  b.update(doc(db, 'users/' + B), { balancePaise: -1000 });        // 3000 - 4000 (allowed: removed)
  b.set(doc(db, 'users/' + B + '/transactions/rev_j-old_1'), {
    type: 'reversal', studentId: B, jobId: 'j-old', amountPaise: 4000, amount: 40,
  });
  b.update(doc(db, 'meta/committee'), { balancePaise: 0 });
  b.delete(doc(db, 'jobs/j-old'));
  await assertSucceeds(b.commit());
});
