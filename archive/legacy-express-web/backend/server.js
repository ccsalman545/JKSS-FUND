// backend/server.js
// ARCHIVED (v3.0): this legacy Express service is no longer deployed or
// maintained. See ../README.md before running it. It refuses to start without
// explicit configuration — there are no default secrets or default accounts.

// Checked BEFORE any require() so the refusal holds even without node_modules.
const JWT_SECRET = process.env.JWT_SECRET || '';
if (JWT_SECRET.length < 32) {
  console.error('FATAL: JWT_SECRET must be set to a random value of at least 32 characters. There is no default.');
  process.exit(1);
}

const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');

// Middleware
app.use(cors());
app.use(bodyParser.json());

// ---------- JSON file-backed data store (no native deps) ----------
function emptyStore() {
  return {
    users: [],
    student_balances: [],
    jobs: [],
    transactions: [],
    committee_fund: { id: 1, balance: 0, updated_at: new Date().toISOString() },
    _nextId: { users: 1, jobs: 1, transactions: 1 },
  };
}

function loadStore() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      return Object.assign(emptyStore(), parsed);
    }
  } catch (e) {
    console.error('Failed to load data store:', e);
  }
  return null;
}

function saveStore(store) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2));
  } catch (e) {
    console.error('Failed to save data store:', e);
  }
  scheduleGcsUpload();
}

// ---------- Google Cloud Storage auto-backup ----------
const GCS_BUCKET = process.env.GCS_BUCKET || '';
const GCS_OBJECT = process.env.GCS_OBJECT || 'jkss-fund/data.json';
let _storage = null;
function gcsClient() {
  if (_storage) return _storage;
  try {
    const { Storage } = require('@google-cloud/storage');
    let opts = {};
    if (process.env.GCS_KEY_JSON) {
      opts.credentials = JSON.parse(process.env.GCS_KEY_JSON);
    }
    _storage = new Storage(opts);
    return _storage;
  } catch (e) {
    console.error('GCS client init failed:', e.message);
    return null;
  }
}
function gcsConfigured() {
  return !!GCS_BUCKET;
}

async function restoreFromGcs() {
  const storage = gcsClient();
  if (!storage) return;
  try {
    await storage.bucket(GCS_BUCKET).file(GCS_OBJECT).download({ destination: DATA_FILE });
    console.log('Restored data from Google Cloud Storage');
  } catch (e) {
    // object may not exist yet
    console.log('No GCS backup to restore (or restore failed):', e.message);
  }
}

let _uploadTimer = null;
function scheduleGcsUpload() {
  if (!gcsConfigured()) return;
  if (_uploadTimer) clearTimeout(_uploadTimer);
  _uploadTimer = setTimeout(async () => {
    const storage = gcsClient();
    if (!storage) return;
    try {
      await storage.bucket(GCS_BUCKET).upload(DATA_FILE, { destination: GCS_OBJECT, resumable: false });
      // also keep a timestamped copy
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      await storage.bucket(GCS_BUCKET).upload(DATA_FILE, { destination: `jkss-fund/backups/data-${ts}.json`, resumable: false });
      console.log('Backed up data to Google Cloud Storage');
    } catch (e) {
      console.error('GCS backup failed:', e.message);
    }
  }, 5000);
}

// patch saveStore to trigger backup
const _origSaveStore = saveStore;

let store;

function nextId(key) {
  const v = store._nextId[key]++;
  saveStore(store);
  return v;
}

// ---------- Auth middleware ----------
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Access denied' });
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Invalid token' });
    req.user = user;
    next();
  });
};

const isAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

// ---------- AUTH ROUTES ----------
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  const user = store.users.find((u) => u.username === username);
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  const validPassword = bcrypt.compareSync(password, user.password);
  if (!validPassword) return res.status(401).json({ error: 'Invalid credentials' });

  const token = jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: '7d' }
  );

  res.json({
    token,
    user: { id: user.id, username: user.username, role: user.role, full_name: user.full_name },
  });
});

app.post('/api/auth/change-password', authenticateToken, (req, res) => {
  const { oldPassword, newPassword } = req.body;
  const user = store.users.find((u) => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const validPassword = bcrypt.compareSync(oldPassword, user.password);
  if (!validPassword) return res.status(401).json({ error: 'Invalid old password' });
  user.password = bcrypt.hashSync(newPassword, 10);
  saveStore(store);
  res.json({ message: 'Password updated successfully' });
});

// ---------- ADMIN ROUTES ----------
app.get('/api/admin/dashboard', authenticateToken, isAdmin, (req, res) => {
  const committeeFund = store.committee_fund ? store.committee_fund.balance : 0;
  const totalStudents = store.users.filter((u) => u.role === 'student').length;
  const totalJobs = store.jobs.length;
  const totalDistributed = store.jobs.reduce((s, j) => s + (j.student_share || 0), 0);
  res.json({ committeeFund, totalStudents, totalJobs, totalDistributed });
});

app.post('/api/admin/students', authenticateToken, isAdmin, (req, res) => {
  const { username, password, full_name } = req.body;
  if (!username || !password || !full_name) {
    return res.status(400).json({ error: 'All fields required' });
  }
  if (store.users.some((u) => u.username === username)) {
    return res.status(400).json({ error: 'Username already exists' });
  }
  const id = nextId('users');
  const hashedPassword = bcrypt.hashSync(password, 10);
  store.users.push({
    id,
    username,
    password: hashedPassword,
    role: 'student',
    full_name,
    created_at: new Date().toISOString(),
  });
  store.student_balances.push({ student_id: id, balance: 0, updated_at: new Date().toISOString() });
  saveStore(store);
  res.json({ id, username, full_name, role: 'student' });
});

app.get('/api/admin/students', authenticateToken, isAdmin, (req, res) => {
  const students = store.users
    .filter((u) => u.role === 'student')
    .map((u) => {
      const sb = store.student_balances.find((b) => b.student_id === u.id);
      return {
        id: u.id,
        username: u.username,
        full_name: u.full_name,
        created_at: u.created_at,
        balance: sb ? sb.balance : 0,
      };
    })
    .sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''));
  res.json(students);
});

app.delete('/api/admin/students/:id', authenticateToken, isAdmin, (req, res) => {
  const studentId = parseInt(req.params.id, 10);
  const idx = store.users.findIndex((u) => u.id === studentId && u.role === 'student');
  if (idx === -1) return res.status(404).json({ error: 'Student not found' });
  store.users.splice(idx, 1);
  store.student_balances = store.student_balances.filter((b) => b.student_id !== studentId);
  store.transactions = store.transactions.filter((t) => t.student_id !== studentId);
  saveStore(store);
  res.json({ message: 'Student deleted successfully' });
});

app.post('/api/admin/jobs', authenticateToken, isAdmin, (req, res) => {
  const { name, amount, date } = req.body;
  if (!name || !amount || !date) {
    return res.status(400).json({ error: 'All fields required' });
  }
  const amt = parseFloat(amount);
  const committeeShare = amt * 0.1;
  const studentShare = amt * 0.9;

  const jobId = nextId('jobs');
  store.jobs.push({
    id: jobId,
    name,
    amount: amt,
    date,
    committee_share: committeeShare,
    student_share: studentShare,
    created_by: req.user.id,
    created_at: new Date().toISOString(),
  });

  // committee fund
  store.committee_fund.balance = (store.committee_fund.balance || 0) + committeeShare;
  store.committee_fund.updated_at = new Date().toISOString();

  const students = store.users.filter((u) => u.role === 'student');
  if (students.length === 0) {
    saveStore(store);
    return res.json({ id: jobId, name, amount: amt, date, committeeShare, studentShare, perStudent: 0 });
  }

  const perStudent = studentShare / students.length;

  students.forEach((student) => {
    let sb = store.student_balances.find((b) => b.student_id === student.id);
    if (!sb) {
      sb = { student_id: student.id, balance: 0, updated_at: new Date().toISOString() };
      store.student_balances.push(sb);
    }
    sb.balance = (sb.balance || 0) + perStudent;
    sb.updated_at = new Date().toISOString();

    const txId = nextId('transactions');
    store.transactions.push({
      id: txId,
      student_id: student.id,
      type: 'earning',
      amount: perStudent,
      job_id: jobId,
      description: `Earning from: ${name}`,
      created_at: new Date().toISOString(),
    });
  });

  saveStore(store);
  res.json({ id: jobId, name, amount: amt, date, committeeShare, studentShare, perStudent });
});

app.get('/api/admin/jobs', authenticateToken, isAdmin, (req, res) => {
  const studentCount = store.users.filter((u) => u.role === 'student').length;
  const jobs = store.jobs
    .map((j) => ({
      ...j,
      student_count: studentCount,
      per_student: studentCount > 0 ? j.student_share / studentCount : 0,
    }))
    .sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return new Date(b.created_at) - new Date(a.created_at);
    });
  res.json(jobs);
});

app.delete('/api/admin/jobs/:id', authenticateToken, isAdmin, (req, res) => {
  const jobId = parseInt(req.params.id, 10);
  const job = store.jobs.find((j) => j.id === jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });

  const jobTxns = store.transactions.filter((t) => t.job_id === jobId);
  // reverse balances
  jobTxns.forEach((t) => {
    const sb = store.student_balances.find((b) => b.student_id === t.student_id);
    if (sb) sb.balance = (sb.balance || 0) - t.amount;
  });

  // committee fund
  store.committee_fund.balance = (store.committee_fund.balance || 0) - job.committee_share;

  // delete transactions
  store.transactions = store.transactions.filter((t) => t.job_id !== jobId);
  // delete job
  store.jobs = store.jobs.filter((j) => j.id !== jobId);

  saveStore(store);
  res.json({ message: 'Job deleted successfully' });
});

app.get('/api/admin/students/:id/transactions', authenticateToken, isAdmin, (req, res) => {
  const studentId = parseInt(req.params.id, 10);
  const txns = store.transactions
    .filter((t) => t.student_id === studentId)
    .map((t) => {
      const job = t.job_id ? store.jobs.find((j) => j.id === t.job_id) : null;
      return { ...t, job_name: job ? job.name : null };
    })
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  res.json(txns);
});

// ---------- STUDENT ROUTES ----------
app.get('/api/student/balance', authenticateToken, (req, res) => {
  if (req.user.role !== 'student') return res.status(403).json({ error: 'Student access only' });
  const sb = store.student_balances.find((b) => b.student_id === req.user.id);
  res.json({ balance: sb ? sb.balance : 0 });
});

app.get('/api/student/transactions', authenticateToken, (req, res) => {
  if (req.user.role !== 'student') return res.status(403).json({ error: 'Student access only' });
  const txns = store.transactions
    .filter((t) => t.student_id === req.user.id)
    .map((t) => {
      const job = t.job_id ? store.jobs.find((j) => j.id === t.job_id) : null;
      return { ...t, job_name: job ? job.name : null };
    })
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 50);
  res.json(txns);
});

app.post('/api/student/withdraw', authenticateToken, (req, res) => {
  if (req.user.role !== 'student') return res.status(403).json({ error: 'Student access only' });
  const { amount, description } = req.body;
  const amt = parseFloat(amount);
  if (!amt || amt <= 0) return res.status(400).json({ error: 'Invalid amount' });

  const sb = store.student_balances.find((b) => b.student_id === req.user.id);
  const currentBalance = sb ? sb.balance || 0 : 0;
  if (currentBalance < amt) return res.status(400).json({ error: 'Insufficient balance' });

  if (sb) {
    sb.balance = currentBalance - amt;
    sb.updated_at = new Date().toISOString();
  } else {
    store.student_balances.push({ student_id: req.user.id, balance: currentBalance - amt, updated_at: new Date().toISOString() });
  }

  const txId = nextId('transactions');
  store.transactions.push({
    id: txId,
    student_id: req.user.id,
    type: 'withdrawal',
    amount: amt,
    job_id: null,
    description: description || 'Withdrawal',
    created_at: new Date().toISOString(),
  });

  saveStore(store);
  res.json({ id: txId, newBalance: currentBalance - amt, amount: amt, message: 'Withdrawal successful' });
});

// ---------- Health check ----------
app.get('/api/health', (req, res) => res.json({ status: 'ok', uptime: process.uptime() }));

// ---------- Serve frontend build (production) ----------
const distPath = path.join(__dirname, '..', 'frontend', 'dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

async function startup() {
  // Restore from Google Cloud Storage if local data is missing
  if (!fs.existsSync(DATA_FILE) && gcsConfigured()) {
    await restoreFromGcs();
  }
  store = loadStore();
  if (!store) {
    // First run only: the admin account must come from the environment.
    const adminUser = process.env.ADMIN_USERNAME || '';
    const adminPass = process.env.ADMIN_PASSWORD || '';
    if (!adminUser || adminPass.length < 12) {
      console.error('FATAL: no data store found. For the first run set ADMIN_USERNAME and ' +
        'ADMIN_PASSWORD (min 12 chars). No default account is created.');
      process.exit(1);
    }
    store = emptyStore();
    store.users.push({
      id: store._nextId.users++,
      username: adminUser,
      password: bcrypt.hashSync(adminPass, 10),
      role: 'admin',
      full_name: 'Administrator',
      created_at: new Date().toISOString(),
    });
    saveStore(store);
    console.log('Created the initial admin from ADMIN_USERNAME (password not logged).');
  }
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    if (gcsConfigured()) console.log(`Google Cloud Storage backup enabled: bucket=${GCS_BUCKET}`);
    else console.log('GCS backup disabled (set GCS_BUCKET to enable).');
  });
}
startup().catch((e) => { console.error('Startup failed:', e); process.exit(1); });
