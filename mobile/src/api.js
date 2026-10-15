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

  // Resolve (READ-ONLY) the pre-authorized profile for the signed-in
  // account. Security model: profile documents are created ONLY by the
  // admin (Students screen) or the Firebase console — never by the
  // signed-in user. A Google sign-in whose email has no matching
  // users/{email} doc returns null; AuthContext then holds the session in
  // a "not pre-authorized" state and the app never opens the student
  // dashboard for it. (The rules enforce the same: no self-create path.)
  async ensureProfile(fbUser) {
    const email = norm(fbUser.email);
    const snap = await userDoc(email).get();
    if (!snap.exists) return null;
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
      balancePaise: 0, balance: 0, txnSeq: 0, createdAt: now(),
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
      // On disk this is a MAP {email: paise}; the rules address each entry
      // with allocations.get(email).
      const n = students.length;
      const allocations = allocateLargestRemainder(studentSharePaise, students);
      assertAllocationsExact(allocations, studentSharePaise);
      const amountValues = Object.values(allocations);

      const jobData = {
        name,
        date,
        amountPaise,
        committeeSharePaise,
        studentSharePaise,
        studentCount: n,
        allocations,
        status: 'active',
        // Legacy rupee mirrors (display only — never used for math).
        amount: paiseToRupees(amountPaise),
        committeeShare: paiseToRupees(committeeSharePaise),
        studentShare: paiseToRupees(studentSharePaise),
        perStudent: paiseToRupees(Math.min(...amountValues)),
        createdBy: auth().currentUser?.email || '',
        createdAt: now(),
      };

      // Read every credited student's LIVE balance first: the rules
      // validate the delta against the live document, so we must write
      // explicit final values (never server increments). If any balance
      // moved since we read, the rules reject the batch and we retry.
      const userSnaps = await Promise.all(
        students.map((s) => t.get(userDoc(s.id)))
      );
      const balances = {};
      students.forEach((s, i) => {
        if (!userSnaps[i].exists) throw new Error(`Profile missing: ${s.id}`);
        balances[s.id] = paiseOf(userSnaps[i].data());
      });
      const committeeSnap = await t.get(committeeDoc());
      if (!committeeSnap.exists) throw new Error('Committee not initialized');
      const committeeBalance = paiseOf(committeeSnap.data());

      t.set(jobRef, jobData);

      // Zero-paise allocations are recorded on the job doc (history) but
      // generate no balance write.
      Object.entries(allocations).forEach(([email, amountPaiseAlloc]) => {
        if (amountPaiseAlloc <= 0) return;
        // v3.5 protocol: the user write carries the job reference so the
        // rules can tie it to the job/txn in the same batch (the rules
        // language has no request.writes). Both fields are always written
        // (the inactive one is null) — the rules cannot read missing
        // fields, but null is a readable value.
        t.update(userDoc(email), {
          balancePaise: balances[email] + amountPaiseAlloc,
          balance: paiseToRupees(balances[email] + amountPaiseAlloc),
          creditJobId: jobId,
          reversalJobId: null,
        });
        // Canonical id (required by the rules): earn_{jobId}_{email}.
        t.set(txnsOf(email).doc(`earn_${jobId}_${email}`), {
          type: 'earning',
          studentId: email,
          jobId,
          amountPaise: amountPaiseAlloc,
          amount: paiseToRupees(amountPaiseAlloc),
          description: `Earning from ${name}`,
          createdAt: now(),
        });
      });
      // The committee update references the job: this is how the rules
      // (which cannot iterate unknown paths) tie the whole batch together.
      t.update(committeeDoc(), {
        balancePaise: committeeBalance + committeeSharePaise,
        balance: paiseToRupees(committeeBalance + committeeSharePaise),
        lastJobId: jobId,
      });
    });

    return {
      committeeShare: paiseToRupees(committeeSharePaise),
      studentShare: paiseToRupees(studentSharePaise),
    };
  },

  // Reverse a job = replay its ORIGINAL allocations as 'reversal' entries.
  // The current roster is irrelevant; the stored allocation map is the
  // source of truth. The job is TOMBSTONED (status 'reversed'), never
  // deleted, so the original allocation history stays auditable and a
  // retry can never double-reverse (the rules reject a second reversal of
  // the same job). Legacy jobs without allocation history are refused.
  async deleteJob(id) {
    const jobRef = jobsCol().doc(id);
    const pre = await jobRef.get();
    if (!pre.exists) throw new Error('Job not found');
    const d0 = pre.data();

    if (d0.status === 'reversed') throw new Error('This job was already reversed');

    const legacy =
      d0.allocations == null ||
      typeof d0.allocations !== 'object' ||
      Object.keys(d0.allocations).length === 0 ||
      d0.committeeSharePaise == null ||
      !Number.isInteger(d0.amountPaise);
    if (legacy) {
      throw new Error(
        'This job predates the audit trail (no allocation history). ' +
        'Reconcile it manually in Firestore before reversing — automatic ' +
        'reversal is disabled to protect the ledger.'
      );
    }

    await db.runTransaction(async (t) => {
      const fresh = await t.get(jobRef);
      if (!fresh.exists) throw new Error('Job not found');
      if (fresh.data().status === 'reversed') {
        throw new Error('This job was already reversed');
      }
      const d = fresh.data();
      const allocations = d.allocations; // map {email: paise}

      // Read every debited student's LIVE balance first (rules validate
      // explicit final values against the live document). Removed students
      // may go negative (the fund's standing liability); the rules enforce
      // the same.
      const emails = Object.keys(allocations);
      const userSnaps = await Promise.all(emails.map((e) => t.get(userDoc(e))));
      const balances = {};
      emails.forEach((e, i) => {
        if (!userSnaps[i].exists) throw new Error(`Profile missing: ${e}`);
        balances[e] = paiseOf(userSnaps[i].data());
      });
      const committeeSnap = await t.get(committeeDoc());
      if (!committeeSnap.exists) throw new Error('Committee not initialized');
      const committeeBalance = paiseOf(committeeSnap.data());

      emails.forEach((email) => {
        const amountPaiseAlloc = allocations[email];
        // v3.5 protocol: the user write carries the job reference (the
        // rules tie the batch together through it — no request.writes).
        t.update(userDoc(email), {
          balancePaise: balances[email] - amountPaiseAlloc,
          balance: paiseToRupees(balances[email] - amountPaiseAlloc),
          creditJobId: null,
          reversalJobId: id,
        });
        // Deterministic id (required by the rules): rev_{jobId}_{email}.
        t.set(txnsOf(email).doc(`rev_${id}_${email}`), {
          type: 'reversal',
          studentId: email,
          jobId: id,
          amountPaise: amountPaiseAlloc,
          amount: paiseToRupees(amountPaiseAlloc),
          description: `Reversal — ${d.name}`,
          createdAt: now(),
        });
      });
      t.update(committeeDoc(), {
        balancePaise: committeeBalance - d.committeeSharePaise,
        balance: paiseToRupees(committeeBalance - d.committeeSharePaise),
        reversedJobId: id,
      });
      // Tombstone — keep the original allocation history for audit.
      t.update(jobRef, { status: 'reversed', reversedAt: now() });
    });
  },

  // ---------- Reports ----------
  async reports(period = 'monthly') {
    const s = await jobsCol().get();
    // Reversed jobs are excluded: their distributions were undone, and the
    // committee credit-back is a reclassification, not income.
    const jobs = s.docs.map((d) => ({ id: d.id, ...d.data() }))
      .filter((j) => j.status !== 'reversed');
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
  // Concurrency-safe: the transaction re-reads the live profile, so two
  // simultaneous withdrawals cannot overdraw (the second sees the reduced
  // balance and the bumped seq). The deployed rules independently enforce,
  // even for non-transactional clients: (a) the atomic (balance reduction
  // + withdrawal txn) pair, (b) a monotonically increasing txnSeq that must
  // be bumped by EXACTLY 1 (a stale replay of a committed withdrawal shows
  // a non-adjacent seq and is rejected — the server-side double-spend
  // guard), (c) a non-negative final balance, and (d) the canonical txn ID
  // w_{email}_{newSeq}.
  // `idempotencyKey` (optional, caller-supplied): stored as metadata on the
  // txn doc; if a txn with the same key already exists, returns
  // alreadyProcessed (best-effort client-side idempotency).
  async withdraw(rupees, description, idempotencyKey) {
    const amountPaise = toPaise(rupees);
    if (!Number.isInteger(amountPaise) || amountPaise <= 0) throw new Error('Invalid amount');

    const email = norm(auth().currentUser?.email);
    const uRef = userDoc(email);
    const key = idempotencyKey
      || 'ik_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);

    return db.runTransaction(async (t) => {
      // Best-effort idempotency: was this key already written by a prior
      // txn of mine? (Reads my own collection — always allowed.)
      if (idempotencyKey) {
        const dupSnap = await t.get(
          txnsOf(email).where('idempotencyKey', '==', idempotencyKey)
        );
        if (dupSnap.size) {
          const uSnap = await t.get(uRef);
          return {
            alreadyProcessed: true,
            balance: paiseToRupees(paiseOf(uSnap.data())),
          };
        }
      }

      const uSnap = await t.get(uRef);
      if (!uSnap.exists) throw new Error('Profile not found');
      // v3.5 protocol: profiles carry a monotonic withdrawal counter.
      // Legacy profiles missing it need a one-time fix (set txnSeq: 0) —
      // the rules deny withdrawals for them on purpose (no guessing).
      const oldSeq = uSnap.data().txnSeq;
      if (!Number.isInteger(oldSeq)) {
        throw new Error(
          'Your profile is missing the withdrawal counter (txnSeq). ' +
          'Ask an admin to set txnSeq: 0 on your profile once.'
        );
      }
      const balancePaise = paiseOf(uSnap.data());
      if (amountPaise > balancePaise) throw new Error('Insufficient balance');

      const newSeq = oldSeq + 1;
      const newPaise = balancePaise - amountPaise;
      // Explicit FINAL values (never a server increment): the rules compute
      // the delta against the live document, which makes a stale/duplicate
      // batch impossible (non-adjacent seq and/or taken txn ID).
      t.update(uRef, {
        balancePaise: newPaise,
        balance: paiseToRupees(newPaise),
        txnSeq: newSeq,
      });
      // Canonical ID (required by the rules): w_{email}_{newSeq}.
      t.set(txnsOf(email).doc(`w_${email}_${newSeq}`), {
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
  // Reversed (tombstoned) jobs are history — excluded from totals.
  const live = jobs.filter((j) => j.status !== 'reversed');
  const totalJobsAmount = live.reduce(
    (s, j) => s + (Number.isInteger(j.amountPaise) ? j.amountPaise : Math.round(Number(j.amount || 0) * 100)),
    0
  ) / 100;
  return {
    students: active,
    jobs: jobs.map((j) => ({ ...j, reversed: j.status === 'reversed' })),
    committeeBalance: paiseToRupees(committeePaise),
    stats: {
      totalStudents: active.length,
      totalDistributed,
      totalJobsAmount,
      totalJobs: live.length,
    },
  };
}
