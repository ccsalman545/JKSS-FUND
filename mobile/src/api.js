// src/api.js
// Thin fetch wrapper around the backend API.
import { API_URL } from './config';

const request = async (method, path, { body, token } = {}) => {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch (e) { /* no body */ }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
};

export const api = {
  login: (username, password) => request('POST', '/auth/login', { body: { username, password } }),
  googleLogin: (idToken, role) => request('POST', '/auth/google', { body: { idToken, role } }),
  changePassword: (token, oldPassword, newPassword) =>
    request('POST', '/auth/change-password', { token, body: { oldPassword, newPassword } }),
  registerPush: (token, pushToken) =>
    request('POST', '/auth/push-token', { token, body: { token: pushToken } }),

  dashboard: (token) => request('GET', '/admin/dashboard', { token }),
  addStudent: (token, username, full_name, password) =>
    request('POST', '/admin/students', { token, body: { username, full_name, password } }),
  deleteStudent: (token, id) => request('DELETE', `/admin/students/${id}`, { token }),
  addJob: (token, name, amount, date) =>
    request('POST', '/admin/jobs', { token, body: { name, amount, date } }),
  deleteJob: (token, id) => request('DELETE', `/admin/jobs/${id}`, { token }),
  studentTransactions: (token, id) => request('GET', `/admin/students/${id}/transactions`, { token }),
  reports: (token, period) => request('GET', `/admin/reports?period=${period}`, { token }),

  balance: (token) => request('GET', '/student/balance', { token }),
  transactions: (token) => request('GET', '/student/transactions', { token }),
  withdraw: (token, amount, description) =>
    request('POST', '/student/withdraw', { token, body: { amount, description } }),
  updateProfile: (token, full_name) => request('PUT', '/student/profile', { token, body: { full_name } }),
};
