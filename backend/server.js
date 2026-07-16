// backend/server.js
// JKSS-FUND (AiCoN FundMe) v2 - Hostel Fund Management Backend
// Features: JWT auth, Google Sign-In (ID token verification), automatic 10/90
// fund splitting, student balances, withdrawals, committee fund, reports,
// Expo push notifications, profile management.
//
// All monetary amounts are in Indian Rupees (INR).

const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const bodyParser = require('body-parser');
const { OAuth2Client } = require('google-auth-library');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this-in-production';
// Google OAuth client ID used to verify ID tokens from the mobile app.
// Create one at https://console.cloud.google.com/apis/credentials (type: "Web application"
// OR "Android" with your SHA-1). The same client ID is configured in the mobile app.
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;
const COMMITTEE_SHARE = 0.10; // 10% to committee
const STUDENT_SHARE = 0.90;   // 90% split among students
const MAX_STUDENTS = 24;

// Middleware
app.use(cors());
app.use(bodyParser.json());

// Initialize Database
const db = new sqlite3.Database(process.env.DB_PATH || './hostel_fund.db', (err) => {
  if (err) console.error('Database error:', err);
  else console.log('Connected to SQLite database');
});

// Helper: run a query as a promise
const run = (sql, params = []) =>
  new Promise((resolve, reject) => db.run(sql, params, function (err) {
    if (err) reject(err); else resolve(this);
  }));
const get = (sql, params = []) =>
  new Promise((resolve, reject) => db.get(sql, params, (err, row) => {
    if (err) reject(err); else resolve(row);
  }));
const all = (sql, params = []) =>
  new Promise((resolve, reject) => db.all(sql, params, (err, rows) => {
    if (err) reject(err); else resolve(rows);
  }));

// Create / migrate schema
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT,
    role TEXT NOT NULL CHECK(role IN ('admin','student')),
    full_name TEXT NOT NULL,
    google_id TEXT,
    avatar TEXT,
    push_token TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    amount REAL NOT NULL,
    date DATE NOT NULL,
    committee_share REAL NOT NULL,
    student_share REAL NOT NULL,
    created_by INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS student_balances (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER NOT NULL,
    balance REAL DEFAULT 0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (student_id) REFERENCES users(id),
    UNIQUE(student_id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('earning','withdrawal')),
    amount REAL NOT NULL,
    job_id INTEGER,
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (student_id) REFERENCES users(id),
    FOREIGN KEY (job_id) REFERENCES jobs(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS committee_fund (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    balance REAL DEFAULT 0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  db.run(`INSERT OR IGNORE INTO committee_fund (id, balance) VALUES (1, 0)`);

  // Default admin (only if no admin exists)
  db.get(`SELECT id FROM users WHERE role='admin' LIMIT 1`, (err, row) => {
    if (!row) {
      const defaultPassword = bcrypt.hashSync('admin123', 10);
      db.run(
        `INSERT INTO users (username, password, role, full_name) VALUES (?, ?, 'admin', 'Administrator')`,
        ['admin', defaultPassword]
      );
    }
  });
});

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
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  next();
};

const signToken = (user) =>
  jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '30d' });

// ---------- Push notifications (Expo) ----------
async function sendPush(title, body, data = {}) {
  try {
    const rows = await all(`SELECT push_token FROM users WHERE role='student' AND push_token IS NOT NULL`);
    const tokens = rows.map(r => r.push_token).filter(Boolean);
    if (!tokens.length) return;
    const messages = tokens.map(token => ({ to: token, title, body, data }));
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(messages),
    });
  } catch (e) {
    console.error('Push error:', e.message);
  }
}

// ---------- Auth routes ----------
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await get(`SELECT * FROM users WHERE username = ?`, [username]);
    if (!user || !user.password || !bcrypt.compareSync(password, user.password)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const token = signToken(user);
    res.json({
      token,
      user: { id: user.id, username: user.username, role: user.role, full_name: user.full_name, avatar: user.avatar },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Google Sign-In: verify ID token, create user if needed, return JWT
app.post('/api/auth/google', async (req, res) => {
  try {
    const { idToken, role = 'student', full_name, avatar } = req.body;
    if (!idToken) return res.status(400).json({ error: 'idToken required' });
    if (!googleClient) return res.status(500).json({ error: 'Google Sign-In not configured on server (set GOOGLE_CLIENT_ID)' });

    const ticket = await googleClient.verifyIdToken({ idToken, audience: GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload();
    if (!payload || !payload.email) return res.status(400).json({ error: 'Invalid Google token' });

    let user = await get(`SELECT * FROM users WHERE google_id = ? OR username = ?`, [payload.sub, payload.email]);
    if (!user) {
      const username = payload.email;
      await run(
        `INSERT INTO users (username, password, role, full_name, google_id, avatar)
         VALUES (?, NULL, ?, ?, ?, ?)`,
        [username, role, payload.name || full_name || username, payload.sub, payload.picture || avatar]
      );
      // create a balance row
      const newUser = await get(`SELECT * FROM users WHERE username = ?`, [username]);
      await run(`INSERT OR IGNORE INTO student_balances (student_id, balance) VALUES (?, 0)`, [newUser.id]);
      user = newUser;
    } else {
      // keep avatar fresh
      await run(`UPDATE users SET avatar = ?, full_name = ? WHERE id = ?`,
        [payload.picture || user.avatar, payload.name || user.full_name, user.id]);
    }
    const token = signToken(user);
    res.json({
      token,
      user: { id: user.id, username: user.username, role: user.role, full_name: user.full_name, avatar: user.avatar },
    });
  } catch (e) {
    res.status(401).json({ error: 'Google authentication failed: ' + e.message });
  }
});

app.post('/api/auth/change-password', authenticateToken, async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Only admin can change password here' });
    const user = await get(`SELECT * FROM users WHERE id = ?`, [req.user.id]);
    if (user.password && !bcrypt.compareSync(oldPassword || '', user.password)) {
      return res.status(400).json({ error: 'Current password is incorrect' });
    }
    const hashed = bcrypt.hashSync(newPassword, 10);
    await run(`UPDATE users SET password = ? WHERE id = ?`, [hashed, req.user.id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Register Expo push token
app.post('/api/auth/push-token', authenticateToken, async (req, res) => {
  try {
    const { token } = req.body;
    await run(`UPDATE users SET push_token = ? WHERE id = ?`, [token, req.user.id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------- Admin: dashboard ----------
app.get('/api/admin/dashboard', authenticateToken, isAdmin, async (req, res) => {
  try {
    const students = await all(`SELECT u.id, u.full_name, u.username, sb.balance
      FROM users u LEFT JOIN student_balances sb ON u.id = sb.student_id
      WHERE u.role='student' ORDER BY u.full_name`);
    const jobs = await all(`SELECT * FROM jobs ORDER BY created_at DESC`);
    const committee = await get(`SELECT balance FROM committee_fund WHERE id=1`);
    const totalStudents = students.length;
    const totalDistributed = students.reduce((s, x) => s + (x.balance || 0), 0);
    const totalJobsAmount = jobs.reduce((s, j) => s + j.amount, 0);
    res.json({
      students,
      jobs,
      committeeBalance: committee ? committee.balance : 0,
      stats: { totalStudents, totalDistributed, totalJobsAmount, totalJobs: jobs.length },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------- Admin: students ----------
app.post('/api/admin/students', authenticateToken, isAdmin, async (req, res) => {
  try {
    const { username, full_name, password } = req.body;
    const count = await get(`SELECT COUNT(*) as c FROM users WHERE role='student'`);
    if (count.c >= MAX_STUDENTS) return res.status(400).json({ error: `Maximum ${MAX_STUDENTS} students allowed` });
    const hash = password ? bcrypt.hashSync(password, 10) : null;
    const result = await run(
      `INSERT INTO users (username, password, role, full_name) VALUES (?, ?, 'student', ?)`,
      [username, hash, full_name]
    );
    await run(`INSERT OR IGNORE INTO student_balances (student_id, balance) VALUES (?, 0)`, [result.lastID]);
    res.json({ success: true, id: result.lastID });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(400).json({ error: 'Username already exists' });
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/admin/students', authenticateToken, isAdmin, async (req, res) => {
  try {
    const rows = await all(`SELECT u.id, u.full_name, u.username, sb.balance
      FROM users u LEFT JOIN student_balances sb ON u.id = sb.student_id
      WHERE u.role='student' ORDER BY u.full_name`);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/admin/students/:id', authenticateToken, isAdmin, async (req, res) => {
  try {
    await run(`DELETE FROM student_balances WHERE student_id = ?`, [req.params.id]);
    await run(`DELETE FROM transactions WHERE student_id = ?`, [req.params.id]);
    await run(`DELETE FROM users WHERE id = ? AND role='student'`, [req.params.id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------- Admin: jobs (with auto distribution) ----------
app.post('/api/admin/jobs', authenticateToken, isAdmin, async (req, res) => {
  try {
    const { name, amount, date } = req.body;
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) return res.status(400).json({ error: 'Invalid amount' });

    const students = await all(`SELECT id FROM users WHERE role='student'`);
    if (students.length === 0) return res.status(400).json({ error: 'Add students before creating a job' });

    const committeeShare = +(amt * COMMITTEE_SHARE).toFixed(2);
    const studentShare = +(amt * STUDENT_SHARE).toFixed(2);
    const perStudent = +(studentShare / students.length).toFixed(2);

    const result = await run(
      `INSERT INTO jobs (name, amount, date, committee_share, student_share, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [name, amt, date, committeeShare, studentShare, req.user.id]
    );
    const jobId = result.lastID;

    // committee fund
    await run(`UPDATE committee_fund SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE id=1`, [committeeShare]);

    // student balances + earnings transactions
    for (const s of students) {
      await run(`INSERT INTO student_balances (student_id, balance) VALUES (?, ?)
        ON CONFLICT(student_id) DO UPDATE SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP`,
        [s.id, perStudent, perStudent]);
      await run(
        `INSERT INTO transactions (student_id, type, amount, job_id, description)
         VALUES (?, 'earning', ?, ?, ?)`,
        [s.id, perStudent, jobId, `Earning from ${name}`]
      );
    }

    sendPush('💰 New Fund Added!', `${name} — ₹${perStudent} credited to your balance`)
      .catch(() => {});

    res.json({ success: true, jobId, perStudent, committeeShare });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/admin/jobs', authenticateToken, isAdmin, async (req, res) => {
  try {
    const rows = await all(`SELECT * FROM jobs ORDER BY created_at DESC`);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Delete job -> reverse balances & transactions
app.delete('/api/admin/jobs/:id', authenticateToken, isAdmin, async (req, res) => {
  try {
    const job = await get(`SELECT * FROM jobs WHERE id = ?`, [req.params.id]);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    const students = await all(`SELECT id FROM users WHERE role='student'`);
    const perStudent = students.length ? +(job.student_share / students.length).toFixed(2) : 0;

    await run(`UPDATE committee_fund SET balance = balance - ?, updated_at = CURRENT_TIMESTAMP WHERE id=1`, [job.committee_share]);
    for (const s of students) {
      await run(`UPDATE student_balances SET balance = balance - ?, updated_at = CURRENT_TIMESTAMP WHERE student_id = ?`,
        [perStudent, s.id]);
    }
    await run(`DELETE FROM transactions WHERE job_id = ?`, [job.id]);
    await run(`DELETE FROM jobs WHERE id = ?`, [job.id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------- Admin: reports ----------
app.get('/api/admin/reports', authenticateToken, isAdmin, async (req, res) => {
  try {
    const { period = 'monthly' } = req.query; // monthly | yearly
    const groupFmt = period === 'yearly' ? "%Y" : "%Y-%m";
    const rows = await all(
      `SELECT strftime('${groupFmt}', created_at) as label,
              SUM(amount) as total_amount,
              SUM(committee_share) as total_committee,
              SUM(student_share) as total_student
       FROM jobs GROUP BY label ORDER BY label`
    );
    const byJob = await all(`SELECT name, amount, committee_share, student_share, date FROM jobs ORDER BY created_at DESC`);
    res.json({ period, series: rows, jobs: byJob });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/admin/students/:id/transactions', authenticateToken, isAdmin, async (req, res) => {
  try {
    const rows = await all(`SELECT * FROM transactions WHERE student_id = ? ORDER BY created_at DESC`, [req.params.id]);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------- Student routes ----------
app.get('/api/student/balance', authenticateToken, async (req, res) => {
  try {
    const row = await get(`SELECT balance FROM student_balances WHERE student_id = ?`, [req.user.id]);
    const user = await get(`SELECT full_name, username, avatar, role FROM users WHERE id = ?`, [req.user.id]);
    const committee = await get(`SELECT balance FROM committee_fund WHERE id=1`);
    res.json({
      balance: row ? row.balance : 0,
      full_name: user.full_name,
      username: user.username,
      avatar: user.avatar,
      role: user.role,
      committeeBalance: committee ? committee.balance : 0,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/student/transactions', authenticateToken, async (req, res) => {
  try {
    const rows = await all(`SELECT * FROM transactions WHERE student_id = ? ORDER BY created_at DESC`, [req.user.id]);
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/student/withdraw', authenticateToken, async (req, res) => {
  try {
    const amount = parseFloat(req.body.amount);
    if (!amount || amount <= 0) return res.status(400).json({ error: 'Invalid amount' });
    const row = await get(`SELECT balance FROM student_balances WHERE student_id = ?`, [req.user.id]);
    const balance = row ? row.balance : 0;
    if (amount > balance) return res.status(400).json({ error: 'Insufficient balance' });
    await run(`UPDATE student_balances SET balance = balance - ?, updated_at = CURRENT_TIMESTAMP WHERE student_id = ?`,
      [amount, req.user.id]);
    await run(
      `INSERT INTO transactions (student_id, type, amount, description) VALUES (?, 'withdrawal', ?, ?)`,
      [req.user.id, amount, req.body.description || 'Withdrawal']
    );
    res.json({ success: true, balance: balance - amount });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/student/profile', authenticateToken, async (req, res) => {
  try {
    const { full_name } = req.body;
    await run(`UPDATE users SET full_name = ? WHERE id = ?`, [full_name, req.user.id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Health check
app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

app.listen(PORT, () => {
  console.log(`JKSS-FUND backend running on port ${PORT}`);
  if (!GOOGLE_CLIENT_ID) console.log('⚠️  GOOGLE_CLIENT_ID not set — Google Sign-In disabled.');
});
