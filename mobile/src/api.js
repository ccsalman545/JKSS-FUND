// src/api.js
// Firebase-backed data layer (replaces the old Express API).
// Uses Cloud Firestore with document IDs = lowercased email, so admins can
// pre-register students and students later sign in with the same Google email.
import { auth, firestore } from './firebase';
import { COMMITTEE_SHARE_PCT, STUDENT_SHARE_PCT } from './config';

const db = firestore();
const usersCol = () => db.collection('users');
const jobsCol = () => db.collection('jobs');
const txnsCol = () => db.collection('transactions');
const committeeDoc = () => db.collection('meta').doc('committee');

const norm = (e) => (e || '').toLowerCase().trim();
const inc = (n) => firestore.FieldValue.increment(n);
const now = () => firestore.FieldValue.serverTimestamp();

const profileShape = (email, d = {}) => ({
  id: email,
  username: email,
  role: d.role || 'student',
  full_name: d.full_name || email.split('@')[0],
  avatar: d.avatar || '',
});

export const api = {
  // ---------- Auth (delegated to AuthContext; these just perform sign-in) ----------
  login: (email, password) => auth().signInWithEmailAndPassword(norm(email), password),
  googleLogin: (idToken, role = 'student') =>
    auth().signInWithCredential(auth.GoogleAuthProvider.credential(idToken)),

  // Create/refresh the Firestore user profile for the signed-in account.
  async ensureProfile(fbUser, role = 'student') {
    const email = norm(fbUser.email);
    const ref = usersCol().doc(email);
    const snap = await ref.get();
    if (!snap.exists) {
      const data = {
        email,
        role,
        full_name: fbUser.displayName || email.split('@')[0],
        avatar: fbUser.photoURL || '',
        balance: 0,
        createdAt: now(),
      };
      await ref.set(data);
      return profileShape(email, data);
    }
    return profileShape(email, snap.data());
  },

  async ensureCommittee() {
    await committeeDoc().set({ balance: 0 }, { merge: true });
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
    return shapeDashboard(us, js, cs);
  },

  subscribeDashboard(cb) {
    const st = { students: [], jobs: [], committeeBalance: 0 };
    const emit = () => cb(shapeDashboard(
      { docs: st.students }, { docs: st.jobs }, { exists: st.committeeBalance != null, data: () => ({ balance: st.committeeBalance }), _raw: true }
    ));
    const u1 = usersCol().where('role', '==', 'student').onSnapshot((s) => { st.students = s.docs; emit(); });
    const u2 = jobsCol().orderBy('createdAt', 'desc').onSnapshot((s) => { st.jobs = s.docs; emit(); });
    const u3 = committeeDoc().onSnapshot((s) => { st.committeeBalance = s.exists ? s.data().balance : 0; emit(); });
    return () => { u1(); u2(); u3(); };
  },

  // ---------- Admin: students ----------
  async addStudent(username, full_name) {
    const email = norm(username);
    await usersCol().doc(email).set({
      email, role: 'student', full_name, avatar: '', balance: 0, createdAt: now(),
    });
  },

  async deleteStudent(id) {
    const batch = db.batch();
    batch.delete(usersCol().doc(id));
    const txns = await txnsCol().where('studentId', '==', id).get();
    txns.forEach((t) => batch.delete(t.ref));
    await batch.commit();
  },

  // ---------- Admin: jobs (auto 10/90 split, atomic) ----------
  async addJob(name, amount, date) {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) throw new Error('Invalid amount');
    const studentsSnap = await usersCol().where('role', '==', 'student').get();
    const students = studentsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (!students.length) throw new Error('Add students before creating a job');
    const committeeShare = +(amt * (COMMITTEE_SHARE_PCT / 100)).toFixed(2);
    const studentShare = +(amt * (STUDENT_SHARE_PCT / 100)).toFixed(2);
    const perStudent = +(studentShare / students.length).toFixed(2);

    const batch = db.batch();
    const jobRef = jobsCol().doc();
    batch.set(jobRef, {
      name, amount: amt, date, committeeShare, studentShare, perStudent,
      createdBy: auth().currentUser?.email, createdAt: now(),
    });
    students.forEach((s) => {
      batch.update(usersCol().doc(s.id), { balance: inc(perStudent) });
      batch.set(txnsCol().doc(), {
        studentId: s.id, type: 'earning', amount: perStudent,
        jobId: jobRef.id, description: `Earning from ${name}`, createdAt: now(),
      });
    });
    batch.update(committeeDoc(), { balance: inc(committeeShare) }, { merge: true });
    await batch.commit();
    return { perStudent, committeeShare };
  },

  async deleteJob(id) {
    const jobSnap = await jobsCol().doc(id).get();
    if (!jobSnap.exists) throw new Error('Job not found');
    const job = jobSnap.data();
    const studentsSnap = await usersCol().where('role', '==', 'student').get();
    const students = studentsSnap.docs.map((d) => ({ id: d.id }));
    const perStudent = students.length ? +(job.studentShare / students.length).toFixed(2) : 0;

    const batch = db.batch();
    batch.update(committeeDoc(), { balance: inc(-job.committeeShare) }, { merge: true });
    students.forEach((s) => batch.update(usersCol().doc(s.id), { balance: inc(-perStudent) }));
    const txns = await txnsCol().where('jobId', '==', id).get();
    txns.forEach((t) => batch.delete(t.ref));
    batch.delete(jobsCol().doc(id));
    await batch.commit();
  },

  async studentTransactions(id) {
    const s = await txnsCol().where('studentId', '==', id).orderBy('createdAt', 'desc').get();
    return s.docs.map((d) => ({ id: d.id, ...d.data() }));
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
      if (!series[label]) series[label] = { label, total_amount: 0, total_committee: 0, total_student: 0 };
      series[label].total_amount += j.amount;
      series[label].total_committee += j.committeeShare;
      series[label].total_student += j.studentShare;
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
    const [uSnap, cSnap] = await Promise.all([usersCol().doc(email).get(), committeeDoc().get()]);
    const d = uSnap.data() || {};
    return {
      balance: d.balance || 0,
      full_name: d.full_name || email,
      username: email,
      role: d.role || 'student',
      committeeBalance: cSnap.exists ? cSnap.data().balance : 0,
    };
  },

  subscribeBalance(cb) {
    const email = norm(auth().currentUser?.email);
    const st = { balance: 0, full_name: email, role: 'student', committeeBalance: 0 };
    const emit = () => cb({ ...st, username: email });
    const u = usersCol().doc(email).onSnapshot((s) => {
      const d = s.data() || {};
      st.balance = d.balance || 0; st.full_name = d.full_name || email; st.role = d.role || 'student';
      emit();
    });
    const c = committeeDoc().onSnapshot((s) => { st.committeeBalance = s.exists ? s.data().balance : 0; emit(); });
    return () => { u(); c(); };
  },

  async transactions() {
    const email = norm(auth().currentUser?.email);
    const s = await txnsCol().where('studentId', '==', email).orderBy('createdAt', 'desc').get();
    return s.docs.map((d) => ({ id: d.id, ...d.data() }));
  },

  subscribeTransactions(cb) {
    const email = norm(auth().currentUser?.email);
    return txnsCol().where('studentId', '==', email).orderBy('createdAt', 'desc')
      .onSnapshot((s) => cb(s.docs.map((d) => ({ id: d.id, ...d.data() }))));
  },

  async withdraw(amount, description) {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) throw new Error('Invalid amount');
    const email = norm(auth().currentUser?.email);
    const uSnap = await usersCol().doc(email).get();
    const balance = uSnap.exists ? (uSnap.data().balance || 0) : 0;
    if (amt > balance) throw new Error('Insufficient balance');
    const batch = db.batch();
    batch.update(usersCol().doc(email), { balance: inc(-amt) });
    batch.set(txnsCol().doc(), {
      studentId: email, type: 'withdrawal', amount: amt,
      description: description || 'Withdrawal', createdAt: now(),
    });
    await batch.commit();
    return { balance: balance - amt };
  },

  async updateProfile(full_name) {
    const email = norm(auth().currentUser?.email);
    await usersCol().doc(email).update({ full_name });
  },
};

// Helper: convert Firestore snapshots into the dashboard shape the UI expects.
function shapeDashboard(usersSnap, jobsSnap, committeeSnap) {
  const students = usersSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const jobs = jobsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const committeeBalance = committeeSnap._raw ? committeeSnap.data().balance : (committeeSnap.exists ? committeeSnap.data().balance : 0);
  const totalStudents = students.length;
  const totalDistributed = students.reduce((s, x) => s + (x.balance || 0), 0);
  const totalJobsAmount = jobs.reduce((s, j) => s + (j.amount || 0), 0);
  return { students, jobs, committeeBalance, stats: { totalStudents, totalDistributed, totalJobsAmount, totalJobs: jobs.length } };
}
