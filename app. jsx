import React, { useState, useEffect } from 'react';
import { DollarSign, Users, TrendingUp, Plus, X, Calendar, Wallet, LogOut, Eye, EyeOff, RefreshCw, ArrowDownCircle, ArrowUpCircle } from 'lucide-react';

// API Configuration - CHANGE THIS TO YOUR SERVER URL
const API_URL = 'http://YOUR_SERVER_IP:3000/api';

export default function HostelFundApp() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);

  // Login states
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Check for stored token on mount
  useEffect(() => {
    const storedToken = localStorage.getItem('token');
    const storedUser = localStorage.getItem('user');
    
    if (storedToken && storedUser) {
      setToken(storedToken);
      setUser(JSON.parse(storedUser));
      setIsLoggedIn(true);
    }
  }, []);

  const handleLogin = async () => {
    setLoginError('');
    setIsLoading(true);

    try {
      const response = await fetch(`${API_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Login failed');
      }

      // Store token and user
      localStorage.setItem('token', data.token);
      localStorage.setItem('user', JSON.stringify(data.user));

      setToken(data.token);
      setUser(data.user);
      setIsLoggedIn(true);
      setUsername('');
      setPassword('');
    } catch (error) {
      setLoginError(error.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setToken(null);
    setUser(null);
    setIsLoggedIn(false);
  };

  if (!isLoggedIn) {
    return <LoginScreen 
      username={username}
      setUsername={setUsername}
      password={password}
      setPassword={setPassword}
      showPassword={showPassword}
      setShowPassword={setShowPassword}
      handleLogin={handleLogin}
      loginError={loginError}
      isLoading={isLoading}
    />;
  }

  if (user?.role === 'admin') {
    return <AdminDashboard token={token} user={user} onLogout={handleLogout} />;
  }

  return <StudentDashboard token={token} user={user} onLogout={handleLogout} />;
}

// ======================
// LOGIN SCREEN
// ======================

function LoginScreen({ username, setUsername, password, setPassword, showPassword, setShowPassword, handleLogin, loginError, isLoading }) {
  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: '"Space Mono", monospace',
      padding: '20px'
    }}>
      <style>{`
        @keyframes float {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-20px); }
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(30px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .login-box {
          animation: fadeIn 0.6s ease-out;
        }
        .input-field {
          width: 100%;
          padding: 14px;
          border-radius: 10px;
          border: 2px solid rgba(255, 255, 255, 0.2);
          background: rgba(255, 255, 255, 0.1);
          color: white;
          font-family: 'Space Mono', monospace;
          font-size: 14px;
          transition: all 0.3s ease;
        }
        .input-field:focus {
          outline: none;
          border-color: rgba(255, 255, 255, 0.5);
          background: rgba(255, 255, 255, 0.15);
        }
        .input-field::placeholder {
          color: rgba(255, 255, 255, 0.5);
        }
        .btn-login {
          width: 100%;
          padding: 14px;
          border-radius: 10px;
          border: none;
          background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
          color: white;
          font-family: 'Space Mono', monospace;
          font-weight: 600;
          font-size: 14px;
          cursor: pointer;
          transition: all 0.3s ease;
          text-transform: uppercase;
          letter-spacing: 1px;
        }
        .btn-login:hover {
          transform: translateY(-2px);
          box-shadow: 0 10px 30px rgba(245, 87, 108, 0.4);
        }
        .btn-login:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
      `}</style>

      <div className="login-box" style={{
        background: 'rgba(255, 255, 255, 0.1)',
        backdropFilter: 'blur(20px)',
        padding: '40px',
        borderRadius: '20px',
        border: '1px solid rgba(255, 255, 255, 0.2)',
        maxWidth: '400px',
        width: '100%',
        boxShadow: '0 20px 60px rgba(0, 0, 0, 0.3)'
      }}>
        <div style={{ textAlign: 'center', marginBottom: '40px' }}>
          <div style={{
            width: '80px',
            height: '80px',
            background: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 20px',
            animation: 'float 3s ease-in-out infinite'
          }}>
            <Wallet size={40} color="white" />
          </div>
          <h1 style={{
            color: 'white',
            fontSize: '28px',
            fontWeight: '700',
            margin: '0 0 8px 0',
            textTransform: 'uppercase',
            letterSpacing: '2px'
          }}>
            Hostel Fund
          </h1>
          <p style={{ color: 'rgba(255, 255, 255, 0.7)', fontSize: '14px', letterSpacing: '1px' }}>
            MANAGEMENT SYSTEM
          </p>
        </div>

        <div style={{ marginBottom: '20px' }}>
          <label style={{ display: 'block', color: 'white', marginBottom: '8px', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '1px' }}>
            Username
          </label>
          <input
            type="text"
            className="input-field"
            placeholder="Enter username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleLogin()}
          />
        </div>

        <div style={{ marginBottom: '24px' }}>
          <label style={{ display: 'block', color: 'white', marginBottom: '8px', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '1px' }}>
            Password
          </label>
          <div style={{ position: 'relative' }}>
            <input
              type={showPassword ? 'text' : 'password'}
              className="input-field"
              placeholder="Enter password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleLogin()}
              style={{ paddingRight: '45px' }}
            />
            <button
              onClick={() => setShowPassword(!showPassword)}
              style={{
                position: 'absolute',
                right: '12px',
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'none',
                border: 'none',
                color: 'rgba(255, 255, 255, 0.6)',
                cursor: 'pointer',
                padding: '4px'
              }}
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
        </div>

        {loginError && (
          <div style={{
            background: 'rgba(239, 68, 68, 0.2)',
            border: '1px solid rgba(239, 68, 68, 0.4)',
            color: '#fca5a5',
            padding: '12px',
            borderRadius: '8px',
            marginBottom: '20px',
            fontSize: '12px'
          }}>
            {loginError}
          </div>
        )}

        <button
          className="btn-login"
          onClick={handleLogin}
          disabled={isLoading || !username || !password}
        >
          {isLoading ? 'Logging in...' : 'Login'}
        </button>

        <div style={{
          marginTop: '30px',
          padding: '20px',
          background: 'rgba(255, 255, 255, 0.05)',
          borderRadius: '10px',
          fontSize: '12px',
          color: 'rgba(255, 255, 255, 0.7)'
        }}>
          <div style={{ marginBottom: '8px', fontWeight: '600' }}>Default Credentials:</div>
          <div>Admin: username: <code style={{ color: '#f093fb' }}>admin</code> / password: <code style={{ color: '#f093fb' }}>admin123</code></div>
        </div>
      </div>
    </div>
  );
}

// ======================
// ADMIN DASHBOARD
// ======================

function AdminDashboard({ token, user, onLogout }) {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [stats, setStats] = useState(null);
  const [students, setStudents] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [isLoading, setIsLoading] = useState(false);

  // Modals
  const [showJobModal, setShowJobModal] = useState(false);
  const [showStudentModal, setShowStudentModal] = useState(false);

  // Forms
  const [jobForm, setJobForm] = useState({ name: '', amount: '', date: '' });
  const [studentForm, setStudentForm] = useState({ username: '', password: '', full_name: '' });

  useEffect(() => {
    if (activeTab === 'dashboard') loadDashboard();
    if (activeTab === 'students') loadStudents();
    if (activeTab === 'jobs') loadJobs();
  }, [activeTab]);

  const apiCall = async (endpoint, options = {}) => {
    const response = await fetch(`${API_URL}${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        ...options.headers
      }
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Request failed');
    return data;
  };

  const loadDashboard = async () => {
    setIsLoading(true);
    try {
      const data = await apiCall('/admin/dashboard');
      setStats(data);
    } catch (error) {
      alert('Failed to load dashboard: ' + error.message);
    } finally {
      setIsLoading(false);
    }
  };

  const loadStudents = async () => {
    setIsLoading(true);
    try {
      const data = await apiCall('/admin/students');
      setStudents(data);
    } catch (error) {
      alert('Failed to load students: ' + error.message);
    } finally {
      setIsLoading(false);
    }
  };

  const loadJobs = async () => {
    setIsLoading(true);
    try {
      const data = await apiCall('/admin/jobs');
      setJobs(data);
    } catch (error) {
      alert('Failed to load jobs: ' + error.message);
    } finally {
      setIsLoading(false);
    }
  };

  const addJob = async () => {
    if (!jobForm.name || !jobForm.amount || !jobForm.date) {
      alert('Please fill all fields');
      return;
    }

    try {
      await apiCall('/admin/jobs', {
        method: 'POST',
        body: JSON.stringify({
          name: jobForm.name,
          amount: parseFloat(jobForm.amount),
          date: jobForm.date
        })
      });

      setJobForm({ name: '', amount: '', date: '' });
      setShowJobModal(false);
      loadJobs();
      if (activeTab === 'dashboard') loadDashboard();
    } catch (error) {
      alert('Failed to add job: ' + error.message);
    }
  };

  const deleteJob = async (jobId) => {
    if (!confirm('Delete this job? Student balances will be adjusted.')) return;

    try {
      await apiCall(`/admin/jobs/${jobId}`, { method: 'DELETE' });
      loadJobs();
      if (activeTab === 'dashboard') loadDashboard();
    } catch (error) {
      alert('Failed to delete job: ' + error.message);
    }
  };

  const addStudent = async () => {
    if (!studentForm.username || !studentForm.password || !studentForm.full_name) {
      alert('Please fill all fields');
      return;
    }

    try {
      await apiCall('/admin/students', {
        method: 'POST',
        body: JSON.stringify(studentForm)
      });

      setStudentForm({ username: '', password: '', full_name: '' });
      setShowStudentModal(false);
      loadStudents();
    } catch (error) {
      alert('Failed to add student: ' + error.message);
    }
  };

  const deleteStudent = async (studentId) => {
    if (!confirm('Delete this student? All their data will be removed.')) return;

    try {
      await apiCall(`/admin/students/${studentId}`, { method: 'DELETE' });
      loadStudents();
    } catch (error) {
      alert('Failed to delete student: ' + error.message);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%)',
      fontFamily: '"Space Mono", monospace',
      color: '#fff'
    }}>
      <style>{`
        .stat-card {
          background: rgba(255, 255, 255, 0.05);
          backdrop-filter: blur(20px);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 16px;
          padding: 24px;
          transition: all 0.3s ease;
        }
        .stat-card:hover {
          transform: translateY(-5px);
          background: rgba(255, 255, 255, 0.08);
        }
        .btn {
          padding: 12px 24px;
          border-radius: 12px;
          border: none;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.3s ease;
          font-family: 'Space Mono', monospace;
          text-transform: uppercase;
          letter-spacing: 1px;
          font-size: 12px;
        }
        .btn-primary {
          background: linear-gradient(135deg, #9333ea 0%, #7928ca 100%);
          color: white;
        }
        .btn-primary:hover {
          transform: scale(1.05);
          box-shadow: 0 8px 24px rgba(147, 51, 234, 0.4);
        }
        .btn-danger {
          background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
          color: white;
        }
        .modal {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.7);
          backdrop-filter: blur(10px);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
        }
        .modal-content {
          background: linear-gradient(135deg, #1e1b4b 0%, #312e81 100%);
          padding: 32px;
          border-radius: 20px;
          max-width: 500px;
          width: 90%;
          border: 1px solid rgba(255, 255, 255, 0.1);
          max-height: 90vh;
          overflow-y: auto;
        }
        input {
          width: 100%;
          padding: 14px;
          border-radius: 10px;
          border: 1px solid rgba(255, 255, 255, 0.1);
          background: rgba(255, 255, 255, 0.05);
          color: white;
          font-family: 'Space Mono', monospace;
          margin-bottom: 16px;
          font-size: 14px;
        }
        input:focus {
          outline: none;
          border-color: #9333ea;
        }
        .tab {
          padding: 12px 20px;
          border: none;
          background: transparent;
          color: rgba(255, 255, 255, 0.6);
          cursor: pointer;
          font-family: 'Space Mono', monospace;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 1px;
          font-size: 11px;
          transition: all 0.3s ease;
          border-bottom: 2px solid transparent;
        }
        .tab:hover {
          color: rgba(255, 255, 255, 0.9);
        }
        .tab.active {
          color: #9333ea;
          border-bottom-color: #9333ea;
        }
        .item-card {
          background: rgba(255, 255, 255, 0.05);
          padding: 20px;
          border-radius: 12px;
          margin-bottom: 12px;
          border: 1px solid rgba(255, 255, 255, 0.1);
          transition: all 0.3s ease;
        }
        .item-card:hover {
          background: rgba(255, 255, 255, 0.08);
          transform: translateX(5px);
        }
      `}</style>

      {/* Header */}
      <div style={{
        background: 'rgba(0, 0, 0, 0.3)',
        padding: '20px',
        borderBottom: '1px solid rgba(255, 255, 255, 0.1)'
      }}>
        <div style={{ maxWidth: '1200px', margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: '24px', textTransform: 'uppercase', letterSpacing: '2px' }}>
              Hostel Fund - Admin
            </h1>
            <p style={{ margin: '4px 0 0 0', opacity: 0.7, fontSize: '12px' }}>Welcome, {user.full_name}</p>
          </div>
          <button className="btn btn-danger" onClick={onLogout}>
            <LogOut size={16} style={{ marginRight: '8px', display: 'inline' }} />
            Logout
          </button>
        </div>
      </div>

      <div style={{ padding: '40px 20px', maxWidth: '1200px', margin: '0 auto' }}>
        {/* Tabs */}
        <div style={{
          display: 'flex',
          gap: '8px',
          marginBottom: '40px',
          borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
          overflowX: 'auto'
        }}>
          <button className={`tab ${activeTab === 'dashboard' ? 'active' : ''}`} onClick={() => setActiveTab('dashboard')}>
            Dashboard
          </button>
          <button className={`tab ${activeTab === 'jobs' ? 'active' : ''}`} onClick={() => setActiveTab('jobs')}>
            Jobs
          </button>
          <button className={`tab ${activeTab === 'students' ? 'active' : ''}`} onClick={() => setActiveTab('students')}>
            Students
          </button>
        </div>

        {isLoading && (
          <div style={{ textAlign: 'center', padding: '40px' }}>
            <RefreshCw size={32} style={{ animation: 'spin 1s linear infinite' }} />
          </div>
        )}

        {/* Dashboard Tab */}
        {activeTab === 'dashboard' && stats && (
          <div>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
              gap: '24px',
              marginBottom: '40px'
            }}>
              <div className="stat-card">
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
                  <Wallet size={28} color="#9333ea" />
                  <span style={{ opacity: 0.7, fontSize: '12px', textTransform: 'uppercase' }}>Committee Fund</span>
                </div>
                <div style={{ fontSize: '32px', fontWeight: '700' }}>₹{stats.committeeFund.toFixed(2)}</div>
              </div>

              <div className="stat-card">
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
                  <Users size={28} color="#3b82f6" />
                  <span style={{ opacity: 0.7, fontSize: '12px', textTransform: 'uppercase' }}>Students</span>
                </div>
                <div style={{ fontSize: '32px', fontWeight: '700' }}>{stats.totalStudents}</div>
              </div>

              <div className="stat-card">
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
                  <TrendingUp size={28} color="#10b981" />
                  <span style={{ opacity: 0.7, fontSize: '12px', textTransform: 'uppercase' }}>Total Jobs</span>
                </div>
                <div style={{ fontSize: '32px', fontWeight: '700' }}>{stats.totalJobs}</div>
              </div>

              <div className="stat-card">
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
                  <DollarSign size={28} color="#f59e0b" />
                  <span style={{ opacity: 0.7, fontSize: '12px', textTransform: 'uppercase' }}>Distributed</span>
                </div>
                <div style={{ fontSize: '32px', fontWeight: '700' }}>₹{stats.totalDistributed.toFixed(2)}</div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', justifyContent: 'center' }}>
              <button className="btn btn-primary" onClick={() => setShowJobModal(true)}>
                <Plus size={18} style={{ marginRight: '8px', display: 'inline' }} />
                Add Job
              </button>
              <button className="btn btn-primary" onClick={() => setShowStudentModal(true)}>
                <Plus size={18} style={{ marginRight: '8px', display: 'inline' }} />
                Add Student
              </button>
              <button className="btn btn-primary" onClick={loadDashboard}>
                <RefreshCw size={18} style={{ marginRight: '8px', display: 'inline' }} />
                Refresh
              </button>
            </div>
          </div>
        )}

        {/* Jobs Tab */}
        {activeTab === 'jobs' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '16px' }}>
              <h2 style={{ fontSize: '20px', textTransform: 'uppercase', letterSpacing: '2px', margin: 0 }}>
                All Jobs ({jobs.length})
              </h2>
              <div style={{ display: 'flex', gap: '12px' }}>
                <button className="btn btn-primary" onClick={() => setShowJobModal(true)}>
                  <Plus size={16} style={{ marginRight: '8px', display: 'inline' }} />
                  Add Job
                </button>
                <button className="btn btn-primary" onClick={loadJobs}>
                  <RefreshCw size={16} />
                </button>
              </div>
            </div>

            {jobs.length === 0 ? (
              <div style={{ textAlign: 'center', opacity: 0.5, padding: '60px 20px' }}>
                <DollarSign size={64} style={{ margin: '0 auto 20px' }} />
                <p>No jobs added yet</p>
              </div>
            ) : (
              <div>
                {jobs.map(job => (
                  <div key={job.id} className="item-card">
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px', flexWrap: 'wrap', gap: '12px' }}>
                      <div>
                        <div style={{ fontSize: '18px', fontWeight: '600', marginBottom: '4px' }}>{job.name}</div>
                        <div style={{ opacity: 0.6, fontSize: '12px' }}>
                          <Calendar size={12} style={{ display: 'inline', marginRight: '6px' }} />
                          {job.date}
                        </div>
                      </div>
                      <button
                        onClick={() => deleteJob(job.id)}
                        style={{
                          background: 'rgba(239, 68, 68, 0.2)',
                          border: '1px solid rgba(239, 68, 68, 0.4)',
                          color: '#ef4444',
                          padding: '8px 16px',
                          borderRadius: '8px',
                          cursor: 'pointer',
                          fontSize: '11px',
                          fontFamily: 'Space Mono, monospace',
                          textTransform: 'uppercase'
                        }}
                      >
                        Delete
                      </button>
                    </div>
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
                      gap: '12px',
                      padding: '12px',
                      background: 'rgba(255, 255, 255, 0.03)',
                      borderRadius: '8px'
                    }}>
                      <div>
                        <div style={{ opacity: 0.6, fontSize: '11px', marginBottom: '4px' }}>Total</div>
                        <div style={{ fontSize: '16px', fontWeight: '600' }}>₹{job.amount}</div>
                      </div>
                      <div>
                        <div style={{ opacity: 0.6, fontSize: '11px', marginBottom: '4px' }}>Committee</div>
                        <div style={{ fontSize: '16px', fontWeight: '600', color: '#9333ea' }}>₹{job.committee_share.toFixed(2)}</div>
                      </div>
                      <div>
                        <div style={{ opacity: 0.6, fontSize: '11px', marginBottom: '4px' }}>Students</div>
                        <div style={{ fontSize: '16px', fontWeight: '600', color: '#10b981' }}>₹{job.student_share.toFixed(2)}</div>
                      </div>
                      <div>
                        <div style={{ opacity: 0.6, fontSize: '11px', marginBottom: '4px' }}>Per Student</div>
                        <div style={{ fontSize: '16px', fontWeight: '600', color: '#3b82f6' }}>₹{job.per_student.toFixed(2)}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Students Tab */}
        {activeTab === 'students' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px', flexWrap: 'wrap', gap: '16px' }}>
              <h2 style={{ fontSize: '20px', textTransform: 'uppercase', letterSpacing: '2px', margin: 0 }}>
                All Students ({students.length})
              </h2>
              <div style={{ display: 'flex', gap: '12px' }}>
                <button className="btn btn-primary" onClick={() => setShowStudentModal(true)}>
                  <Plus size={16} style={{ marginRight: '8px', display: 'inline' }} />
                  Add Student
                </button>
                <button className="btn btn-primary" onClick={loadStudents}>
                  <RefreshCw size={16} />
                </button>
              </div>
            </div>

            {students.length === 0 ? (
              <div style={{ textAlign: 'center', opacity: 0.5, padding: '60px 20px' }}>
                <Users size={64} style={{ margin: '0 auto 20px' }} />
                <p>No students added yet</p>
              </div>
            ) : (
              <div>
                {students.map(student => (
                  <div key={student.id} className="item-card">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '18px', fontWeight: '600', marginBottom: '4px' }}>{student.full_name}</div>
                        <div style={{ opacity: 0.6, fontSize: '12px', marginBottom: '8px' }}>@{student.username}</div>
                        <div style={{
                          display: 'inline-block',
                          background: 'rgba(16, 185, 129, 0.2)',
                          border: '1px solid rgba(16, 185, 129, 0.4)',
                          color: '#10b981',
                          padding: '4px 12px',
                          borderRadius: '6px',
                          fontSize: '14px',
                          fontWeight: '600'
                        }}>
                          Balance: ₹{student.balance.toFixed(2)}
                        </div>
                      </div>
                      <button
                        onClick={() => deleteStudent(student.id)}
                        style={{
                          background: 'rgba(239, 68, 68, 0.2)',
                          border: '1px solid rgba(239, 68, 68, 0.4)',
                          color: '#ef4444',
                          padding: '8px 16px',
                          borderRadius: '8px',
                          cursor: 'pointer',
                          fontSize: '11px',
                          fontFamily: 'Space Mono, monospace',
                          textTransform: 'uppercase'
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Add Job Modal */}
      {showJobModal && (
        <div className="modal" onClick={() => setShowJobModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
              <h2 style={{ fontSize: '20px', textTransform: 'uppercase', letterSpacing: '2px', margin: 0 }}>Add Job</h2>
              <button onClick={() => setShowJobModal(false)} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer' }}>
                <X size={24} />
              </button>
            </div>

            <label style={{ display: 'block', marginBottom: '8px', fontSize: '12px', opacity: 0.8 }}>Job Name</label>
            <input
              type="text"
              placeholder="Enter job name"
              value={jobForm.name}
              onChange={e => setJobForm({...jobForm, name: e.target.value})}
            />

            <label style={{ display: 'block', marginBottom: '8px', fontSize: '12px', opacity: 0.8 }}>Amount (₹)</label>
            <input
              type="number"
              placeholder="Enter amount"
              value={jobForm.amount}
              onChange={e => setJobForm({...jobForm, amount: e.target.value})}
            />

            <label style={{ display: 'block', marginBottom: '8px', fontSize: '12px', opacity: 0.8 }}>Date</label>
            <input
              type="date"
              value={jobForm.date}
              onChange={e => setJobForm({...jobForm, date: e.target.value})}
            />

            <div style={{ display: 'flex', gap: '12px', marginTop: '24px' }}>
              <button className="btn btn-primary" onClick={addJob} style={{ flex: 1 }}>Add Job</button>
              <button className="btn" onClick={() => setShowJobModal(false)} style={{ flex: 1, background: 'rgba(255, 255, 255, 0.1)', color: 'white' }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Add Student Modal */}
      {showStudentModal && (
        <div className="modal" onClick={() => setShowStudentModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
              <h2 style={{ fontSize: '20px', textTransform: 'uppercase', letterSpacing: '2px', margin: 0 }}>Add Student</h2>
              <button onClick={() => setShowStudentModal(false)} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer' }}>
                <X size={24} />
              </button>
            </div>

            <label style={{ display: 'block', marginBottom: '8px', fontSize: '12px', opacity: 0.8 }}>Full Name</label>
            <input
              type="text"
              placeholder="Enter full name"
              value={studentForm.full_name}
              onChange={e => setStudentForm({...studentForm, full_name: e.target.value})}
            />

            <label style={{ display: 'block', marginBottom: '8px', fontSize: '12px', opacity: 0.8 }}>Username</label>
            <input
              type="text"
              placeholder="Enter username"
              value={studentForm.username}
              onChange={e => setStudentForm({...studentForm, username: e.target.value})}
            />

            <label style={{ display: 'block', marginBottom: '8px', fontSize: '12px', opacity: 0.8 }}>Password</label>
            <input
              type="password"
              placeholder="Enter password"
              value={studentForm.password}
              onChange={e => setStudentForm({...studentForm, password: e.target.value})}
            />

            <div style={{ display: 'flex', gap: '12px', marginTop: '24px' }}>
              <button className="btn btn-primary" onClick={addStudent} style={{ flex: 1 }}>Add Student</button>
              <button className="btn" onClick={() => setShowStudentModal(false)} style={{ flex: 1, background: 'rgba(255, 255, 255, 0.1)', color: 'white' }}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ======================
// STUDENT DASHBOARD
// ======================

function StudentDashboard({ token, user, onLogout }) {
  const [balance, setBalance] = useState(0);
  const [transactions, setTransactions] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showWithdrawModal, setShowWithdrawModal] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawDescription, setWithdrawDescription] = useState('');

  useEffect(() => {
    loadBalance();
    loadTransactions();
  }, []);

  const apiCall = async (endpoint, options = {}) => {
    const response = await fetch(`${API_URL}${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        ...options.headers
      }
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Request failed');
    return data;
  };

  const loadBalance = async () => {
    setIsLoading(true);
    try {
      const data = await apiCall('/student/balance');
      setBalance(data.balance);
    } catch (error) {
      alert('Failed to load balance: ' + error.message);
    } finally {
      setIsLoading(false);
    }
  };

  const loadTransactions = async () => {
    try {
      const data = await apiCall('/student/transactions');
      setTransactions(data);
    } catch (error) {
      alert('Failed to load transactions: ' + error.message);
    }
  };

  const handleWithdraw = async () => {
    const amount = parseFloat(withdrawAmount);
    
    if (!amount || amount <= 0) {
      alert('Please enter a valid amount');
      return;
    }

    if (amount > balance) {
      alert('Insufficient balance');
      return;
    }

    try {
      await apiCall('/student/withdraw', {
        method: 'POST',
        body: JSON.stringify({
          amount,
          description: withdrawDescription || 'Withdrawal'
        })
      });

      setWithdrawAmount('');
      setWithdrawDescription('');
      setShowWithdrawModal(false);
      loadBalance();
      loadTransactions();
    } catch (error) {
      alert('Withdrawal failed: ' + error.message);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      fontFamily: '"Space Mono", monospace',
      color: '#fff'
    }}>
      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .balance-card {
          background: rgba(255, 255, 255, 0.1);
          backdrop-filter: blur(20px);
          border: 1px solid rgba(255, 255, 255, 0.2);
          border-radius: 20px;
          padding: 40px;
          text-align: center;
          box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
        }
        .transaction-item {
          background: rgba(255, 255, 255, 0.1);
          border: 1px solid rgba(255, 255, 255, 0.2);
          padding: 16px;
          border-radius: 12px;
          margin-bottom: 12px;
          transition: all 0.3s ease;
        }
        .transaction-item:hover {
          background: rgba(255, 255, 255, 0.15);
          transform: translateX(5px);
        }
        .btn {
          padding: 12px 24px;
          border-radius: 12px;
          border: none;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.3s ease;
          font-family: 'Space Mono', monospace;
          text-transform: uppercase;
          letter-spacing: 1px;
          font-size: 12px;
        }
        .btn-primary {
          background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
          color: white;
        }
        .btn-primary:hover {
          transform: scale(1.05);
          box-shadow: 0 8px 24px rgba(245, 87, 108, 0.4);
        }
        .btn-danger {
          background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
          color: white;
        }
        .modal {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.7);
          backdrop-filter: blur(10px);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
        }
        .modal-content {
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          padding: 32px;
          border-radius: 20px;
          max-width: 500px;
          width: 90%;
          border: 1px solid rgba(255, 255, 255, 0.2);
        }
        input {
          width: 100%;
          padding: 14px;
          border-radius: 10px;
          border: 1px solid rgba(255, 255, 255, 0.2);
          background: rgba(255, 255, 255, 0.1);
          color: white;
          font-family: 'Space Mono', monospace;
          margin-bottom: 16px;
          font-size: 14px;
        }
        input:focus {
          outline: none;
          border-color: rgba(255, 255, 255, 0.4);
        }
        input::placeholder {
          color: rgba(255, 255, 255, 0.5);
        }
      `}</style>

      {/* Header */}
      <div style={{
        background: 'rgba(0, 0, 0, 0.2)',
        padding: '20px',
        borderBottom: '1px solid rgba(255, 255, 255, 0.1)'
      }}>
        <div style={{ maxWidth: '800px', margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
          <div>
            <h1 style={{ margin: 0, fontSize: '24px', textTransform: 'uppercase', letterSpacing: '2px' }}>
              My Wallet
            </h1>
            <p style={{ margin: '4px 0 0 0', opacity: 0.8, fontSize: '12px' }}>Welcome, {user.full_name}</p>
          </div>
          <button className="btn btn-danger" onClick={onLogout}>
            <LogOut size={16} style={{ marginRight: '8px', display: 'inline' }} />
            Logout
          </button>
        </div>
      </div>

      <div style={{ padding: '40px 20px', maxWidth: '800px', margin: '0 auto' }}>
        {/* Balance Card */}
        <div className="balance-card" style={{ marginBottom: '40px' }}>
          <div style={{ opacity: 0.8, fontSize: '14px', textTransform: 'uppercase', letterSpacing: '2px', marginBottom: '12px' }}>
            Your Balance
          </div>
          <div style={{ fontSize: '56px', fontWeight: '700', marginBottom: '24px' }}>
            ₹{balance.toFixed(2)}
          </div>
          <div style={{ display: 'flex', gap: '16px', justifyContent: 'center', flexWrap: 'wrap' }}>
            <button className="btn btn-primary" onClick={() => setShowWithdrawModal(true)} disabled={balance <= 0}>
              <ArrowDownCircle size={16} style={{ marginRight: '8px', display: 'inline' }} />
              Withdraw Money
            </button>
            <button className="btn btn-primary" onClick={() => { loadBalance(); loadTransactions(); }}>
              <RefreshCw size={16} style={{ marginRight: '8px', display: 'inline' }} />
              Refresh
            </button>
          </div>
        </div>

        {/* Transactions */}
        <div>
          <h2 style={{ fontSize: '20px', textTransform: 'uppercase', letterSpacing: '2px', marginBottom: '20px' }}>
            Transaction History
          </h2>

          {isLoading ? (
            <div style={{ textAlign: 'center', padding: '40px' }}>
              <RefreshCw size={32} style={{ animation: 'spin 1s linear infinite' }} />
            </div>
          ) : transactions.length === 0 ? (
            <div style={{ textAlign: 'center', opacity: 0.6, padding: '60px 20px' }}>
              <Wallet size={64} style={{ margin: '0 auto 20px', opacity: 0.5 }} />
              <p>No transactions yet</p>
            </div>
          ) : (
            <div>
              {transactions.map(trans => (
                <div key={trans.id} className="transaction-item">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', flexWrap: 'wrap', gap: '12px' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                        {trans.type === 'earning' ? (
                          <ArrowUpCircle size={18} color="#10b981" />
                        ) : (
                          <ArrowDownCircle size={18} color="#ef4444" />
                        )}
                        <span style={{ 
                          fontSize: '14px', 
                          fontWeight: '600',
                          color: trans.type === 'earning' ? '#10b981' : '#ef4444',
                          textTransform: 'uppercase'
                        }}>
                          {trans.type}
                        </span>
                      </div>
                      <div style={{ fontSize: '12px', opacity: 0.8 }}>
                        {trans.description || trans.job_name || 'No description'}
                      </div>
                      <div style={{ fontSize: '11px', opacity: 0.6, marginTop: '4px' }}>
                        {new Date(trans.created_at).toLocaleString()}
                      </div>
                    </div>
                    <div style={{
                      fontSize: '20px',
                      fontWeight: '700',
                      color: trans.type === 'earning' ? '#10b981' : '#ef4444'
                    }}>
                      {trans.type === 'earning' ? '+' : '-'}₹{trans.amount.toFixed(2)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Withdraw Modal */}
      {showWithdrawModal && (
        <div className="modal" onClick={() => setShowWithdrawModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
              <h2 style={{ fontSize: '20px', textTransform: 'uppercase', letterSpacing: '2px', margin: 0 }}>Withdraw Money</h2>
              <button onClick={() => setShowWithdrawModal(false)} style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer' }}>
                <X size={24} />
              </button>
            </div>

            <div style={{
              background: 'rgba(255, 255, 255, 0.1)',
              padding: '16px',
              borderRadius: '12px',
              marginBottom: '24px',
              border: '1px solid rgba(255, 255, 255, 0.2)'
            }}>
              <div style={{ fontSize: '12px', opacity: 0.8, marginBottom: '6px' }}>Available Balance</div>
              <div style={{ fontSize: '28px', fontWeight: '700' }}>₹{balance.toFixed(2)}</div>
            </div>

            <label style={{ display: 'block', marginBottom: '8px', fontSize: '12px', opacity: 0.9 }}>Amount to Withdraw (₹)</label>
            <input
              type="number"
              placeholder="Enter amount"
              value={withdrawAmount}
              onChange={e => setWithdrawAmount(e.target.value)}
              max={balance}
              step="0.01"
            />

            <label style={{ display: 'block', marginBottom: '8px', fontSize: '12px', opacity: 0.9 }}>Description (Optional)</label>
            <input
              type="text"
              placeholder="What is this withdrawal for?"
              value={withdrawDescription}
              onChange={e => setWithdrawDescription(e.target.value)}
            />

            <div style={{ display: 'flex', gap: '12px', marginTop: '24px' }}>
              <button 
                className="btn btn-primary" 
                onClick={handleWithdraw} 
                style={{ flex: 1 }}
                disabled={!withdrawAmount || parseFloat(withdrawAmount) <= 0 || parseFloat(withdrawAmount) > balance}
              >
                Confirm Withdrawal
              </button>
              <button 
                className="btn" 
                onClick={() => setShowWithdrawModal(false)} 
                style={{ flex: 1, background: 'rgba(255, 255, 255, 0.2)', color: 'white' }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
