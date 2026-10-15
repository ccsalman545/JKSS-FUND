// test/api.mock.test.js
// Executes the REAL mobile/src/api.js (transaction orchestration for
// addJob / deleteJob / withdraw / removeStudent / ensure*) against an
// in-memory Firestore mock with true transaction semantics (pending writes
// visible inside the txn, atomic commit, full rollback on error).
//
// Scope note: this verifies the app-side orchestration and accounting math
// end-to-end. It is NOT the Firestore emulator — rules-level enforcement
// (batch composition, non-negative finals, original-allocation reversal)
// is covered by the emulator suite in ../firebase/test/rules.test.js.
//
// Run:  node test/api.mock.test.js
'use strict';

const fs = require('fs');
const path = require('path');
const Module = require('module');

let pass = 0;
let fail = 0;
async function check(name, fn) {
  try {
    await fn();
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
function paise(rupees) { return Math.round(Number(rupees) * 100); }
function assertThrowsAsync(fn, re, msg) {
  return fn().then(
    () => { throw new Error((msg || 'expected throw') + ': no error'); },
    (e) => {
      if (re && !re.test(String(e.message))) {
        throw new Error((msg || 'throw message') + ': got "' + e.message + '"');
      }
    }
  );
}

/* =====================================================================
   1. In-memory Firestore mock (transaction-semantic)
   ===================================================================== */

const INCREMENT = Symbol('increment');
const SERVER_TS = Symbol('serverTimestamp');
function inc(n) { return { [INCREMENT]: n }; }

function applyField(obj, field, value) {
  if (value && typeof value === 'object' && INCREMENT in value) {
    obj[field] = (obj[field] || 0) + value[INCREMENT];
  } else if (value === SERVER_TS) {
    obj[field] = ++mock.clock;
  } else {
    obj[field] = value;
  }
}

const mock = {
  docs: new Map(),
  clock: 1000,
  authUser: null,
  txn: null,

  read(p) {
    if (mock.txn) {
      if (mock.txn.pending.has(p)) {
        const w = mock.txn.pending.get(p);
        if (w.kind === 'delete') return null;
        const committed = mock.docs.get(p) || {};
        return { ...committed, ...w.data };
      }
    }
    return mock.docs.has(p) ? mock.docs.get(p) : null;
  },

  commit(p, w) {
    if (w.kind === 'delete') mock.docs.delete(p);
    else mock.docs.set(p, w.data);
  },

  // Tests can install a commit-time validator (mirrors how the Firestore
  // backend evaluates rules/fails the whole batch at COMMIT, not per write).
  commitHook: null,

  runTransaction(fn) {
    if (mock.txn) return Promise.reject(new Error('nested transactions not supported in mock'));
    const txn = { pending: new Map() };
    mock.txn = txn;
    return Promise.resolve()
      .then(() => fn(txnApi()))
      .then(
        (result) => {
          const entries = [...txn.pending.entries()];
          if (mock.commitHook) {
            for (const [p, w] of entries) mock.commitHook(p, w); // may throw
          }
          for (const [p, w] of entries) mock.commit(p, w); // atomic
          return result;
        },
        (err) => {
          txn.pending.clear(); // atomic rollback
          throw err;
        }
      )
      .finally(() => { mock.txn = null; });
  },

  stageSet(p, data, opts) {
    const d = { ...data };
    Object.keys(d).forEach((k) => { if (d[k] === SERVER_TS) d[k] = ++mock.clock; });
    if (mock.txn) {
      const committed = mock.docs.get(p);
      const base = (opts && opts.merge && committed) ? { ...committed } : {};
      txnPending(mock.txn).set(p, { kind: 'set', data: { ...base, ...d } });
      return Promise.resolve();
    }
    const committed = mock.docs.get(p);
    const base = (opts && opts.merge && committed) ? { ...committed } : {};
    mock.docs.set(p, { ...base, ...d });
    return Promise.resolve();
  },

  stageUpdate(p, data) {
    if (mock.txn) {
      const existing = mock.read(p);
      if (existing == null) return Promise.reject(new Error('no such document (update) ' + p));
      const d = { ...existing };
      Object.keys(data).forEach((k) => applyField(d, k, data[k]));
      txnPending(mock.txn).set(p, { kind: 'set', data: d });
      return Promise.resolve();
    }
    const existing = mock.docs.get(p);
    if (existing == null) return Promise.reject(new Error('no such document (update) ' + p));
    const d = { ...existing };
    Object.keys(data).forEach((k) => applyField(d, k, data[k]));
    mock.docs.set(p, d);
    return Promise.resolve();
  },

  stageDelete(p) {
    if (mock.txn) {
      txnPending(mock.txn).set(p, { kind: 'delete' });
      return Promise.resolve();
    }
    mock.docs.delete(p);
    return Promise.resolve();
  },

  collection(coll) {
    const self = mock;
    const col = {
      doc(id) {
        const ref = {
          id,
          path: coll + '/' + id,
          get() {
            const d = self.read(ref.path);
            return Promise.resolve({ exists: d != null, data: () => (d == null ? undefined : { ...d }) });
          },
          set: (data, opts) => self.stageSet(ref.path, data, opts),
          update: (data) => self.stageUpdate(ref.path, data),
          delete: () => self.stageDelete(ref.path),
          // Subcollections (e.g. users/{email}/transactions).
          collection(sub) { return self.collection(ref.path + '/' + sub); },
        };
        return ref;
      },
      where(field, op, value) {
        return {
          orderBy() { return this; },
          onSnapshot() { throw new Error('subscriptions not needed in these tests'); },
          get() {
            const docs = [];
            for (const [p, d] of self.docs) {
              if (!p.startsWith(coll + '/')) continue;
              if (op === '==' && d[field] !== value) continue;
              docs.push({ id: p.slice(coll.length + 1), data: () => ({ ...d }) });
            }
            return Promise.resolve({ docs, size: docs.length, empty: docs.length === 0 });
          },
        };
      },
    };
    return col;
  },

  reset() {
    mock.docs.clear();
    mock.clock = 1000;
    mock.txn = null;
  },
};

function txnPending(txn) { return txn.pending; }

function txnApi() {
  return {
    get(ref) {
      // Queries (no .path) delegate to their own get(); doc refs read state.
      if (ref.path == null && typeof ref.get === 'function') return ref.get();
      const d = mock.read(ref.path);
      return Promise.resolve({ exists: d != null, data: () => (d == null ? undefined : { ...d }) });
    },
    set: (ref, data, opts) => mock.stageSet(ref.path, data, opts),
    update: (ref, data) => mock.stageUpdate(ref.path, data),
    delete: (ref) => mock.stageDelete(ref.path),
  };
}

/* =====================================================================
   2. Load the real api.js (minimal ESM→CJS transform + module stubs)
   ===================================================================== */

function loadApi() {
  let src = fs.readFileSync(path.join(__dirname, '..', 'src', 'api.js'), 'utf8');

  src = src.replace(/^import\s*\{([^}]+)\}\s*from\s*'([^']+)';/gm,
    (m, names, mod) => 'const { ' + names.replace(/\s+/g, ' ').trim() + ' } = require(' + JSON.stringify(mod) + ');');
  src = src.replace(/^import\s+([A-Za-z_$][\w$]*)\s+from\s*'([^']+)';/gm,
    (m, name, mod) => 'const ' + name + ' = require(' + JSON.stringify(mod) + ');');
  src = src.replace(/^export\s*\{([^}]+)\};/gm,
    (m, names) => names.split(',').map((n) => 'module.exports.' + n.trim() + ' = ' + n.trim() + ';').join('\n'));
  const exported = [];
  src = src.replace(/^export\s+const\s+([A-Za-z_$][\w$]*)/gm, (m, name) => {
    exported.push(name);
    return 'const ' + name;
  });
  exported.forEach((name) => { src += '\nmodule.exports.' + name + ' = ' + name + ';'; });

  const fbInstance = {
    collection: (c) => mock.collection(c),
    runTransaction: (fn) => mock.runTransaction(fn),
    FieldValue: { serverTimestamp: () => SERVER_TS, increment: inc },
  };
  const fbFn = () => fbInstance;
  fbFn.FieldValue = fbInstance.FieldValue; // RN Firebase: FieldValue hangs off the function
  const stubs = {
    './firebase': {
      auth: () => ({
        currentUser: mock.authUser,
        GoogleAuthProvider: { credential: (t) => t },
        EmailAuthProvider: { credential: () => {} },
        signInWithEmailAndPassword: () => Promise.reject(new Error('not in test')),
        signInWithCredential: () => Promise.reject(new Error('not in test')),
      }),
      firestore: fbFn,
    },
    './config': { COMMITTEE_SHARE_PCT: 10, STUDENT_SHARE_PCT: 90, MAX_STUDENTS: 24 },
  };

  const origLoad = Module._load;
  Module._load = function (request, parent) {
    if ((request === './firebase' || request === './config') &&
        parent && parent.filename && parent.filename.endsWith('api.js')) {
      return stubs[request];
    }
    return origLoad.apply(this, arguments);
  };
  const m = new Module('api-under-test');
  m.filename = path.join(__dirname, '..', 'src', 'api.js');
  m.paths = Module._nodeModulePaths(path.join(__dirname, '..', 'src'));
  m._compile(src, m.filename);
  Module._load = origLoad;
  return m.exports;
}

const api = loadApi().api;

/* =====================================================================
   3. Fixtures + scenarios
   ===================================================================== */

const ADMIN = 'admin@jkss.in';
const S = ['a@jkss.in', 'b@jkss.in', 'c@jkss.in'];
const C = 'meta/committee';

function seed() {
  mock.reset();
  mock.authUser = { email: ADMIN };
  // v3.5 protocol: every profile carries the withdrawal counter.
  mock.docs.set('users/' + ADMIN, { email: ADMIN, role: 'admin', full_name: 'Admin', balancePaise: 0, balance: 0, txnSeq: 0 });
  S.forEach((e) => mock.docs.set('users/' + e, {
    email: e, role: 'student', full_name: e[0].toUpperCase(), balancePaise: 0, balance: 0, txnSeq: 0,
  }));
  mock.docs.set(C, { balancePaise: 0, balance: 0 });
}
const getDoc = (p) => (mock.docs.has(p) ? mock.docs.get(p) : null);
const bal = (e) => getDoc('users/' + e).balancePaise;
const txnsOf = (email) => {
  const out = [];
  for (const [p, d] of mock.docs) {
    if (p.startsWith('users/' + email + '/transactions/')) out.push({ id: p.split('/')[3], ...d });
  }
  return out;
};
const jobs = () => [...mock.docs.keys()].filter((p) => p.startsWith('jobs/')).map((p) => ({ id: p.slice(5), ...getDoc(p) }));
const jobByName = (n) => jobs().find((j) => j.name === n);

let job1Id, job2Id;

(async () => {
  console.log('api.js — real orchestration against transaction-semantic mock');
  seed();

  await check('addJob ₹1000 → 10% committee / 90% pool, exact paise, ledger entries', async () => {
    const res = await api.addJob('Cleanup drive', 1000, '2026-10-01');
    eq(paise(res.committeeShare), 10000);
    eq(paise(res.studentShare), 90000);
    eq(jobs().length, 1);
    job1Id = jobs()[0].id;
    const job = getDoc('jobs/' + job1Id);
    eq(job.amountPaise, 100000);
    eq(job.committeeSharePaise, 10000);
    eq(job.studentSharePaise, 90000);
    eq(Object.keys(job.allocations).length, 3);
    eq(Object.values(job.allocations).reduce((s, x) => s + x, 0), 90000);
    eq(getDoc(C).balancePaise, 10000);
    S.forEach((e) => {
      eq(bal(e), 30000, 'student ' + e);
      const t = txnsOf(e).find((x) => x.jobId === job1Id);
      if (!t) throw new Error('missing earning txn for ' + e);
      eq(t.amountPaise, 30000);
      eq(t.type, 'earning');
    });
  });

  await check('addJob ₹999.99 → committee floored to ₹99.99, pool exact, sums match', async () => {
    await api.addJob('Event B', 999.99, '2026-10-02');
    const job = jobByName('Event B');
    job2Id = job.id;
    eq(job.amountPaise, 99999);
    eq(job.committeeSharePaise, 9999);
    eq(job.studentSharePaise, 90000);
    eq(Object.values(job.allocations).reduce((s, x) => s + x, 0), 90000);
    eq(getDoc(C).balancePaise, 19999);
  });

  await check('addJob ₹1.00 → tiny pool 90 paise split exactly (30/30/30)', async () => {
    const before = S.map((e) => bal(e));
    await api.addJob('Tiny', 1.0, '2026-10-03');
    eq(S.map((e, i) => bal(e) - before[i]).join(','), '30,30,30');
  });

  await check('addJob ₹10.05 over 4 students → largest remainder (227,226,226,226)', async () => {
    mock.docs.set('users/d@jkss.in', { email: 'd@jkss.in', role: 'student', full_name: 'D', balancePaise: 0, balance: 0, txnSeq: 0 });
    const roster = ['a@jkss.in', 'b@jkss.in', 'c@jkss.in', 'd@jkss.in'];
    const before = roster.map((e) => bal(e));
    await api.addJob('Uneven', 10.05, '2026-10-04');
    eq(roster.map((e, i) => bal(e) - before[i]).join(','), '227,226,226,226');
    // committee: 10000 (job1) + 9999 (job2) + 10 (tiny ₹1.00) + 100 (₹10.05)
    eq(getDoc(C).balancePaise, 10000 + 9999 + 10 + 100);
    const job = jobByName('Uneven');
    eq(job.studentCount, 4);
    eq(Object.values(job.allocations).reduce((s, x) => s + x, 0), 905);
  });

  await check('addJob duplicate job id → rejected, nothing paid', async () => {
    const realNow = Date.now;
    const realRand = Math.random;
    Date.now = () => 1000000000000;
    Math.random = () => 0.5; // (0.5).toString(36)='0.i' → slice(2,8)='i'
    const forcedId = 'j_' + (1000000000000).toString(36) + '_i';
    try {
      mock.docs.set('jobs/' + forcedId, { name: 'Pre', date: '2026-01-01', amountPaise: 100 });
      const snapshotBefore = JSON.stringify([...mock.docs.entries()]);
      await assertThrowsAsync(() => api.addJob('Doomed', 500, '2026-10-06'), /already recorded/);
      eq(JSON.stringify([...mock.docs.entries()]), snapshotBefore, 'state changed on duplicate');
    } finally {
      Date.now = realNow;
      Math.random = realRand;
      mock.docs.delete('jobs/' + forcedId);
    }
  });

  await check('removeStudent tombstones (no hard delete; liability + ledger survive)', async () => {
    const balBefore = bal('c@jkss.in');
    const nTxns = txnsOf('c@jkss.in').length;
    await api.removeStudent('c@jkss.in');
    const doc = getDoc('users/c@jkss.in');
    if (!doc) throw new Error('student doc hard-deleted (must be tombstone)');
    if (!doc.removedAt) throw new Error('removedAt not set');
    eq(doc.balancePaise, balBefore);
    eq(txnsOf('c@jkss.in').length, nTxns);
  });

  await check('new job after removal: removed student excluded, roster splits pool', async () => {
    const before = { a: bal('a@jkss.in'), b: bal('b@jkss.in'), c: bal('c@jkss.in'), d: bal('d@jkss.in') };
    await api.addJob('After removal', 100, '2026-10-05'); // 10000 → pool 9000 over a,b,d
    eq(bal('a@jkss.in') - before.a, 3000);
    eq(bal('b@jkss.in') - before.b, 3000);
    eq(bal('d@jkss.in') - before.d, 3000);
    eq(bal('c@jkss.in') - before.c, 0); // removed student untouched
    eq(jobByName('After removal').studentCount, 3);
  });

  await check('deleteJob reverses ORIGINAL allocations even after roster change', async () => {
    // a/b/c each received 30000 from job1. Roster later gained d, lost c.
    // Deleting job1 must debit exactly a:-30000, b:-30000, c:-30000,
    // committee:-10000 — and must NOT touch d (current-roster member).
    const a0 = bal('a@jkss.in'), b0 = bal('b@jkss.in'), c0 = bal('c@jkss.in'), d0 = bal('d@jkss.in');
    const c0c = getDoc(C).balancePaise;
    await api.deleteJob(job1Id);
    // v3.2: jobs are TOMBSTONED, never deleted (allocation history is audit).
    const jobDoc = getDoc('jobs/' + job1Id);
    if (!jobDoc || jobDoc.status !== 'reversed') throw new Error('job not tombstoned (status=) ' + (jobDoc && jobDoc.status));
    eq(bal('a@jkss.in'), a0 - 30000);
    eq(bal('b@jkss.in'), b0 - 30000);
    eq(bal('c@jkss.in'), c0 - 30000); // removed student debited by original alloc
    eq(bal('d@jkss.in'), d0);
    eq(getDoc(C).balancePaise, c0c - 10000);
    ['a@jkss.in', 'b@jkss.in', 'c@jkss.in'].forEach((e) => {
      const t = txnsOf(e).find((x) => x.type === 'reversal' && x.jobId === job1Id);
      if (!t) throw new Error('missing reversal txn for ' + e);
      eq(t.amountPaise, 30000);
    });
    eq(txnsOf('d@jkss.in').some((x) => x.jobId === job1Id), false);
  });

  await check('re-reversing a tombstoned job throws; never double-reverses', async () => {
    const a0 = bal('a@jkss.in');
    await assertThrowsAsync(() => api.deleteJob(job1Id), /already reversed/i);
    eq(bal('a@jkss.in'), a0);
  });

  await check('withdraw: paise-exact debit + ledger entry + idempotency marker', async () => {
    mock.authUser = { email: 'a@jkss.in' };
    const b0 = bal('a@jkss.in');
    const res = await api.withdraw(150.5, 'Books');
    eq(paise(res.balance), b0 - 15050);
    eq(bal('a@jkss.in'), b0 - 15050);
    const t = txnsOf('a@jkss.in').find((x) => x.type === 'withdrawal');
    if (!t) throw new Error('missing withdrawal txn');
    eq(t.amountPaise, 15050);
    eq(t.studentId, 'a@jkss.in');
    if (!t.idempotencyKey) throw new Error('missing idempotency key');
  });

  await check('withdraw: insufficient balance rejected, ledger untouched', async () => {
    mock.authUser = { email: 'a@jkss.in' };
    const b0 = bal('a@jkss.in');
    const n = txnsOf('a@jkss.in').length;
    await assertThrowsAsync(() => api.withdraw(b0 / 100 + 0.01), /Insufficient balance/);
    eq(bal('a@jkss.in'), b0);
    eq(txnsOf('a@jkss.in').length, n);
  });

  await check('withdraw: full balance → exactly zero (never negative)', async () => {
    mock.authUser = { email: 'b@jkss.in' };
    const b0 = bal('b@jkss.in');
    const res = await api.withdraw(b0 / 100);
    eq(paise(res.balance), 0);
    eq(bal('b@jkss.in'), 0);
  });

  await check('withdraw: retry with same idempotency key debits exactly once', async () => {
    mock.authUser = { email: 'd@jkss.in' };
    const b0 = bal('d@jkss.in');
    const key = 'w_test_fixed';
    const r1 = await api.withdraw(10, 'X', key);
    eq(paise(r1.balance), b0 - 1000);
    const r2 = await api.withdraw(10, 'X', key);
    if (!r2.alreadyProcessed) throw new Error('retry not detected');
    eq(bal('d@jkss.in'), b0 - 1000);
    eq(txnsOf('d@jkss.in').filter((x) => x.idempotencyKey === key).length, 1);
    eq(paise(r2.balance), b0 - 1000);
  });

  await check('removed student: full withdrawal then original-allocation reversal → negative liability OK', async () => {
    // c is tombstoned with a remaining balance from job2 (30000) + tiny + uneven.
    mock.authUser = { email: 'c@jkss.in' };
    const b0 = bal('c@jkss.in');
    eq(b0 > 0, true);
    await api.withdraw(b0 / 100);
    eq(bal('c@jkss.in'), 0);
    // Now reverse job2 (original alloc: c got 30000) → c goes to -30000.
    const a0 = bal('a@jkss.in'), d0 = bal('d@jkss.in'), cCommittee0 = getDoc(C).balancePaise;
    await api.deleteJob(job2Id);
    eq(bal('c@jkss.in'), -30000); // fund's standing liability — allowed for removed
    eq(bal('a@jkss.in'), a0 - 30000);
    eq(bal('d@jkss.in'), d0); // d was not in job2
    eq(getDoc(C).balancePaise, cCommittee0 - 9999);
  });

  await check('legacy job (no allocation history) → deletion refused, no mutation', async () => {
    mock.docs.set('jobs/legacy1', {
      name: 'Legacy', date: '2026-01-01', amount: 500,
      amountPaise: 50000, committeeShare: 50, studentShare: 450,
    });
    const before = JSON.stringify({
      c: getDoc(C).balancePaise,
      a: bal('a@jkss.in'),
      job: mock.docs.has('jobs/legacy1'),
    });
    await assertThrowsAsync(() => api.deleteJob('legacy1'), /reconcile/i);
    const after = JSON.stringify({
      c: getDoc(C).balancePaise,
      a: bal('a@jkss.in'),
      job: mock.docs.has('jobs/legacy1'),
    });
    eq(after, before, 'ledger mutated despite refusal');
  });

  await check('failed job transaction leaves NO partial state (atomicity)', async () => {
    const before = JSON.stringify([...mock.docs.entries()].sort((x, y) => x[0].localeCompare(y[0])));
    // Simulate the backend denying the batch at commit time (e.g. a rules
    // denial on one write): the ENTIRE batch must roll back.
    mock.commitHook = (p, w) => {
      if (p === 'users/a@jkss.in') throw new Error('simulated Firestore failure');
    };
    try {
      mock.authUser = { email: ADMIN };
      await assertThrowsAsync(() => api.addJob('Doomed', 500, '2026-10-07'), /simulated Firestore failure/);
    } finally {
      mock.commitHook = null;
    }
    const after = JSON.stringify([...mock.docs.entries()].sort((x, y) => x[0].localeCompare(y[0])));
    eq(after, before, 'partial commit after failed transaction');
  });

  await check('ensureProfile: NOT pre-authorized -> null, and NO doc is written', async () => {
    mock.authUser = { email: 'new@jkss.in', displayName: 'New Person', photoURL: '' };
    const p = await api.ensureProfile(mock.authUser);
    eq(p, null, 'unauthorized account must resolve to null');
    eq(getDoc('users/new@jkss.in'), null, 'no profile may be auto-created');
  });

  await check('ensureProfile: pre-authorized doc is returned as-is (read-only)', async () => {
    mock.authUser = { email: ADMIN, displayName: 'Zzz' };
    const p = await api.ensureProfile(mock.authUser);
    eq(p.role, 'admin');
    eq(getDoc('users/' + ADMIN).full_name, 'Admin');
  });

  await check('ensureProfile: existing student doc returned, fields untouched', async () => {
    const before = JSON.stringify(getDoc('users/' + S[0]));
    const p = await api.ensureProfile({ email: S[0] });
    eq(p.role, 'student');
    eq(JSON.stringify(getDoc('users/' + S[0])), before, 'profile doc must be unchanged');
  });

  await check('admin pre-authorization: addStudent creates the profile, ensureProfile then resolves', async () => {
    eq(await api.ensureProfile({ email: 'new@jkss.in' }), null, 'not yet authorized');
    await api.addStudent('New@Jkss.in', 'New Person'); // admin context (seed authUser)
    const d = getDoc('users/new@jkss.in');
    eq(d.role, 'student');
    eq(d.balancePaise, 0);
    eq(d.txnSeq, 0);
    eq(d.full_name, 'New Person');
    const p = await api.ensureProfile({ email: 'new@jkss.in' });
    eq(p.role, 'student', 'now authorized -> resolves');
  });

  await check('ensureCommittee: existing non-zero balance is never zeroed', async () => {
    const b0 = getDoc(C).balancePaise;
    eq(b0 > 0, true, 'precondition: committee should be non-zero here');
    await api.ensureCommittee();
    eq(getDoc(C).balancePaise, b0);
  });

  await check('ensureCommittee: creates doc at zero when missing', async () => {
    mock.docs.delete(C);
    await api.ensureCommittee();
    eq(getDoc(C).balancePaise, 0);
    eq(getDoc(C).balance, 0);
  });

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
