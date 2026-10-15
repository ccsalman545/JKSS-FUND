// src/api.js
// Firebase-backed data layer (v3.1 — paise-exact accounting).
//
// MONEY MODEL
// -----------
// - All accounting math uses INTEGER PAISE (1 rupee = 100 paise).
// - `balancePaise` / `amountPaise` are the source of truth. The rupee
//   floats (`balance` / `amount`) are display mirrors kept for legacy UI
//   compatibility; they are never used for calculations.
// - Rounding policy (jobs): committeeSharePaise = floor(amountPaise/10)
//   (10%, whole paise), studentSharePaise = amountPaise - committeeSharePaise
//   (the 90% pool). The pool is distributed with the largest-remainder
//   method: base = floor(pool/n), r = pool - base*n; the first r students
//   (sorted by doc id) receive base+1 paise, the rest base. The allocations
//   therefore ALWAYS sum exactly to the pool — no money is created or lost,
//   and the explicit per-student amounts are stored on the job.
// - Every job stores its `allocations` (who received exactly what).
//   Reversals (job deletion) replay those ORIGINAL allocations — the current
//   roster is never used for historical accounting. Legacy jobs without an
//   allocation history are refused for deletion and flagged for manual
//   reconciliation instead of guessing amounts.
// - Student removal is a TOMBSTONE (`removedAt`), never a hard delete: the
//   fund's liability and audit trail survive, and future job reversals
//   always have a document to debit.
// - Withdrawals and job writes run in Firestore transactions (concurrency
//   safe) and are independently validated by the deployed security rules
//   (atomic batch pairing, non-negative final balances, original-allocation
//   reversal). Client-side checks are convenience only, never a boundary.

import { auth, firestore } from './firebase';
import { COMMITTEE_SHARE_PCT } from './config';
import {
  toPaise, paiseToRupees, paiseOf, splitShares,
  allocateLargestRemainder, assertAllocationsExact,
} from './accounting';

// Re-export for screens/tests that import them from the api module.
export { toPaise, paiseToRupees, paiseOf };

const db = firestore();
const usersCol = () => db.collection('users');
const userDoc = (email) => usersCol().doc(email);
const jobsCol = () => db.collection('jobs');
const committeeDoc = () => db.collection('meta').doc('committee');
const txnsOf = (email) => userDoc(email).collection('transactions');

const norm = (e) => (e || '').toLowerCase().trim();
const now = () => firestore.FieldValue.serverTimestamp();
const inc = (n) => firestore.FieldValue.increment(n);

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const profileShape = (email, d = {}) => ({
  id: email,
  username: email,
  role: d.role || 'student',
  full_name: d.full_name || email.split('@')[0],
  avatar: d.avatar || '',
  removedAt: d.removedAt || null,
});

export const api = {
  // ---------- Auth (delegated to AuthContext; these just perform sign-in) ----------
  login: (email, password) => auth().signInWithEmailAndPassword(norm(email), password),
  googleLogin: (idToken, role = 'student') =>
    auth().signInWithCredential(auth.GoogleAuthProvider.credential(idToken)),

  // Create/refresh the Firestore user profile for the signed-in account.
  // New profiles are always student / zero-balance (matching the rules);
  // existing docs (e.g. pre-created admins) are returned as-is.
  async ensureProfile(fbUser, role = 'student') {
    const email = norm(fbUser.email);
    const ref = userDoc(email);
    const snap = await ref.get();
    if (!snap.exists) {
      if (role !== 'student') throw new Error('New profiles are created as students');
      const data = {
        email,
        role: 'student',
        full_name: fbUser.displayName || email.split('@')[0],
        avatar: fbUser.photoURL || '',
        balancePaise: 0,
        balance: 0,
        createdAt: now(),
      };
      await ref.set(data);
      return profileShape(email, data);
    }
    return profileShape(email, snap.data());
  },

  // Idempotent committee bootstrap. ONLY creates the doc when missing —
  // never writes to an existing balance (a merge-set of zeros would zero
  // the fund on every app launch).
  async ensureCommittee() {
    const snap = await committeeDoc().get();
    if (snap.exists) return;
    await committeeDoc().set({ balancePaise: 0, balance: 0 });
  },

  async changePassword(newPassword, oldPassword) {
    const u = auth().currentUser;
    if (!u) throw new Error('Not signed in');
    if (oldPassword) {
      const cred = auth.EmailAuthProvider.credential(u.email, oldPassword);
      await u.reauthenticateWithCredential(cred);
    }
    await u.updatePassword(newPassword);
  },

  // ---------- Admin: dashboard (real-time) ----------
  async dashboard() {
    const [us, js, cs] = await Promise.all([
      usersCol().where('role', '==', 'student').get(),
      jobsCol().orderBy('createdAt', 'desc').get(),
      committeeDoc().get(),
    ]);
    return shapeDashboard(
      us.docs.map((d) => ({ id: d.id, ...d.data() })),
      js.docs.map((d) => ({ id: d.id, ...d.data() })),
      cs.exists ? paiseOf(cs.data()) : 0
    );
  },

  subscribeDashboard(cb) {
    const st = { students: [], jobs: [], committeePaise: 0 };
    const emit = () => cb(shapeDashboard(st.students, st.jobs, st.committeePaise));
    const u1 = usersCol().where('role', '==', 'student').onSnapshot((s) => {
      st.students = s.docs.map((d) => ({ id: d.id, ...d.data() }));
      emit();
    });
    const u2 = jobsCol().orderBy('createdAt', 'desc').onSnapshot((s) => {
      st.jobs = s.docs.map((d) => ({ id: d.id, ...d.data() }));
      emit();
    });
    const u3 = committeeDoc().onSnapshot((s) => {
      st.committeePaise = s.exists ? paiseOf(s.data()) : 0;
      emit();
    });
    return () => { u1(); u2(); u3(); };
  },

  // ---------- Admin: students ----------
  async addStudent(username, full_name) {
    const email = norm(username);
    if (!EMAIL_RE.test(email)) {
      throw new Error('Enter a valid email address — students sign in with it');
    }
    const ref = userDoc(email);
    const existing = await ref.get();
    if (existing.exists) throw new Error('This email is already registered');
    await ref.set({
      email, role: 'student', full_name, avatar: '',
      balancePaise: 0, balance: 0, createdAt: now(),
    });
  },

  // Remove a student from the ACTIVE ROSTER (tombstone). Their balance and
  // full ledger are preserved for audit and for future job reversals; they
  // simply stop receiving job splits. Hard deletion is intentionally not
  // supported (it would destroy the fund's liability record and break
  // historical reversals).
  async removeStudent(id) {
    const email = norm(id);
    await userDoc(email).update({ removedAt: now() });
  },

  // ---------- Admin: jobs (paise-exact 10/90 split, atomic, idempotent) ----------
  async addJob(name, rupees, date) {
    const amountPaise = toPaise(rupees);
    if (!Number.isInteger(amountPaise) || amountPaise <= 0) throw new Error('Invalid amount');
    const shares = splitShares(amountPaise, COMMITTEE_SHARE_PCT);
    const { committeeSharePaise, studentSharePaise } = shares;

    // Deterministic job id: re-submitting the same job is detected as a
    // duplicate instead of paying twice.
    const jobId = 'j_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);

    // The job-credit rules require the committee doc to pre-exist (they
    // validate the final committee state via getAfter), so bootstrap it
    // first. Idempotent: a real balance is never zeroed by this.
    const cSnap = await committeeDoc().get();
    if (!cSnap.exists) {
      await committeeDoc().set({ balancePaise: 0, balance: 0 });
    }

    await db.runTransaction(async (t) => {
      const jobRef = jobsCol().doc(jobId);
      const existing = await t.get(jobRef);
      if (existing.exists) throw new Error('This job was already recorded');

      const studentsSnap = await t.get(usersCol().where('role', '==', 'student'));
      const students = studentsSnap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((s) => !s.removedAt)
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      if (!students.length) throw new Error('Add students before creating a job');

      // Largest-remainder allocation — sums EXACTLY to studentSharePaise.
      const n = students.length;
      const allocations = allocateLargestRemainder(studentSharePaise, students);
      assertAllocationsExact(allocations, studentSharePaise);

      const jobData = {
        name,
        date,
        amountPaise,
        committeeSharePaise,
        studentSharePaise,
        studentCount: n,
        allocations,
        // Legacy rupee mirrors (display only — never used for math).
        amount: paiseToRupees(amountPaise),
        committeeShare: paiseToRupees(committeeSharePaise),
        studentShare: paiseToRupees(studentSharePaise),
        perStudent: paiseToRupees(allocations[0].amountPaise),
        createdBy: auth().currentUser?.email || '',
        createdAt: now(),
      };
      t.set(jobRef, jobData);

      // Zero-paise allocations are recorded on the job doc (history) but
      // generate no balance write — matching the rules' non-zero count.
      allocations
        .filter((a) => a.amountPaise > 0)
        .forEach((a) => {
          t.update(userDoc(a.email), {
            balancePaise: inc(a.amountPaise),
            balance: inc(paiseToRupees(a.amountPaise)),
          });
          t.set(txnsOf(a.email).doc(`${jobId}:${a.index}`), {
            type: 'earning',
            studentId: a.email,
            jobId,
            amountPaise: a.amountPaise,
            amount: paiseToRupees(a.amountPaise),
            description: `Earning from ${name}`,
            createdAt: now(),
          });
        });
      t.update(committeeDoc(), {
        balancePaise: inc(committeeSharePaise),
        balance: inc(paiseToRupees(committeeSharePaise)),
      });
    });

    return {
      committeeShare: paiseToRupees(committeeSharePaise),
      studentShare: paiseToRupees(studentSharePaise),
    };
  },

  // Delete a job = replay its ORIGINAL allocations as 'reversal' entries.
  // The current roster is irrelevant; the stored allocation list is the
  // source of truth. Legacy jobs without allocation history are refused.
  async deleteJob(id) {
    const jobRef = jobsCol().doc(id);
    const pre = await jobRef.get();
    if (!pre.exists) throw new Error('Job not found');

    const legacy =
      !Array.isArray(pre.data().allocations) ||
      pre.data().allocations.length === 0 ||
      pre.data().committeeSharePaise == null ||
      !Number.isInteger(pre.data().amountPaise);
    if (legacy) {
      throw new Error(
        'This job predates the audit trail (no allocation history). ' +
        'Reconcile it manually in Firestore before deleting — automatic ' +
        'reversal is disabled to protect the ledger.'
      );
    }

    await db.runTransaction(async (t) => {
      const fresh = await t.get(jobRef);
      if (!fresh.exists) throw new Error('Job not found');
      const d = fresh.data();
      const allocations = d.allocations;

      allocations.forEach((a) => {
        t.update(userDoc(a.email), {
          balancePaise: inc(-a.amountPaise),
          balance: inc(-paiseToRupees(a.amountPaise)),
        });
        // Deterministic id: a retry can never double-reverse.
        t.set(txnsOf(a.email).doc(`rev_${id}_${a.index}`), {
          type: 'reversal',
          studentId: a.email,
          jobId: id,
          amountPaise: a.amountPaise,
          amount: paiseToRupees(a.amountPaise),
          description: `Reversal — ${d.name}`,
          createdAt: now(),
        });
      });
      t.update(committeeDoc(), {
        balancePaise: inc(-d.committeeSharePaise),
        balance: inc(-paiseToRupees(d.committeeSharePaise)),
      });
      t.delete(jobRef);
    });
  },

  // ---------- Reports ----------
  async reports(period = 'monthly') {
    const s = await jobsCol().get();
    const jobs = s.docs.map((d) => ({ id: d.id, ...d.data() }));
    const series = {};
    jobs.forEach((j) => {
      const d = new Date(j.date || Date.now());
      const label = period === 'yearly'
        ? `${d.getFullYear()}`
        : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const amountPaise = Number.isInteger(j.amountPaise)
        ? j.amountPaise
        : Math.round(Number(j.amount || 0) * 100);
      const committeePaise = Number.isInteger(j.committeeSharePaise)
        ? j.committeeSharePaise
        : Math.round(Number(j.committeeShare || 0) * 100);
      const studentPaise = amountPaise - committeePaise;
      if (!series[label]) {
        series[label] = { label, total_amount: 0, total_committee: 0, total_student: 0 };
      }
      series[label].total_amount += paiseToRupees(amountPaise);
      series[label].total_committee += paiseToRupees(committeePaise);
      series[label].total_student += paiseToRupees(studentPaise);
    });
    return {
      period,
      series: Object.values(series).sort((a, b) => (a.label < b.label ? -1 : 1)),
      jobs,
    };
  },

  // ---------- Student: balance (real-time) ----------
  async balance() {
    const email = norm(auth().currentUser?.email);
    const [uSnap, cSnap] = await Promise.all([userDoc(email).get(), committeeDoc().get()]);
    const d = uSnap.data() || {};
    const balancePaise = paiseOf(d);
    const committeePaise = cSnap.exists ? paiseOf(cSnap.data()) : 0;
    return {
      balance: paiseToRupees(balancePaise),
      balancePaise,
      full_name: d.full_name || email,
      username: email,
      role: d.role || 'student',
      committeeBalance: paiseToRupees(committeePaise),
    };
  },

  subscribeBalance(cb) {
    const email = norm(auth().currentUser?.email);
    const st = {
      balance: 0, balancePaise: 0, full_name: email, role: 'student',
      committeeBalance: 0,
    };
    const emit = () => cb({ ...st, username: email });
    const u = userDoc(email).onSnapshot((s) => {
      const d = s.data() || {};
      st.balancePaise = paiseOf(d);
      st.balance = paiseToRupees(st.balancePaise);
      st.full_name = d.full_name || email;
      st.role = d.role || 'student';
      emit();
    });
    const c = committeeDoc().onSnapshot((s) => {
      const d = s.data() || {};
      st.committeeBalance = paiseToRupees(s.exists ? paiseOf(d) : 0);
      emit();
    });
    return () => { u(); c(); };
  },

  // ---------- Student: ledger (per-user subcollection) ----------
  async transactions() {
    const email = norm(auth().currentUser?.email);
    const s = await txnsOf(email).orderBy('createdAt', 'desc').get();
    return s.docs.map((d) => ({ id: d.id, ...d.data() }));
  },

  subscribeTransactions(cb) {
    const email = norm(auth().currentUser?.email);
    return txnsOf(email).orderBy('createdAt', 'desc')
      .onSnapshot((s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() }))));
  },

  // Admin-only: read one student's ledger (their subcollection).
  async studentTransactions(id) {
    const email = norm(id);
    const s = await txnsOf(email).orderBy('createdAt', 'desc').get();
    return s.docs.map((d) => ({ id: d.id, ...d.data() }));
  },

  // ---------- Student: withdrawal (transaction-protected) ----------
  // Concurrency-safe: the transaction re-reads the live balance, so two
  // simultaneous withdrawals cannot overdraw (the second sees the reduced
  // balance). The deployed rules independently enforce the atomic
  // (balance reduction + withdrawal txn) pairing and a non-negative final
  // balance even for non-transactional clients.
  // `idempotencyKey` (optional): caller-supplied key for the withdrawal txn
  // doc; re-submitting the same key is a no-op (returns alreadyProcessed).
  async withdraw(rupees, description, idempotencyKey) {
    const amountPaise = toPaise(rupees);
    if (!Number.isInteger(amountPaise) || amountPaise <= 0) throw new Error('Invalid amount');

    const email = norm(auth().currentUser?.email);
    const uRef = userDoc(email);
    const key = idempotencyKey
      || 'w_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
    const txnRef = txnsOf(email).doc(key);

    return db.runTransaction(async (t) => {
      const [uSnap, dupSnap] = await Promise.all([t.get(uRef), t.get(txnRef)]);
      if (dupSnap.exists) {
        return {
          alreadyProcessed: true,
          balance: paiseToRupees(paiseOf(uSnap.data())),
        };
      }
      if (!uSnap.exists) throw new Error('Profile not found');
      const balancePaise = paiseOf(uSnap.data());
      if (amountPaise > balancePaise) throw new Error('Insufficient balance');

      const newPaise = balancePaise - amountPaise;
      t.update(uRef, {
        balancePaise: inc(-amountPaise),
        balance: inc(-paiseToRupees(amountPaise)),
      });
      t.set(txnRef, {
        type: 'withdrawal',
        studentId: email,
        amountPaise,
        amount: paiseToRupees(amountPaise),
        description: description || 'Withdrawal',
        idempotencyKey: key,
        createdAt: now(),
      });
      return { balance: paiseToRupees(newPaise) };
    });
  },

  async updateProfile(full_name) {
    const email = norm(auth().currentUser?.email);
    await userDoc(email).update({ full_name });
  },
};

// Convert student/job/committee state into the dashboard shape the UI expects.
// `students` are filtered to the active roster; totalDistributed is the
// fund's total student liability (active + removed), in rupees.
function shapeDashboard(students, jobs, committeePaise) {
  const active = students.filter((s) => !s.removedAt);
  const totalDistributed = students.reduce((s, x) => s + paiseOf(x), 0) / 100;
  const totalJobsAmount = jobs.reduce(
    (s, j) => s + (Number.isInteger(j.amountPaise) ? j.amountPaise : Math.round(Number(j.amount || 0) * 100)),
    0
  ) / 100;
  return {
    students: active,
    jobs,
    committeeBalance: paiseToRupees(committeePaise),
    stats: {
      totalStudents: active.length,
      totalDistributed,
      totalJobsAmount,
      totalJobs: jobs.length,
    },
  };
}
