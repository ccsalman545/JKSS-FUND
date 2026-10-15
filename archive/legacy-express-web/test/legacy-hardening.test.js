// archive/legacy-express-web/test/legacy-hardening.test.js
// Regression guard for the ARCHIVED legacy API. Even though this code is not
// deployed, a revived copy must never start with a default secret or a default
// admin account. Pure Node, no network, no Firebase.
// Run:  node archive/legacy-express-web/test/legacy-hardening.test.js
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SERVER = path.join(ROOT, 'backend', 'server.js');
const HAS_DEPS = fs.existsSync(path.join(ROOT, 'backend', 'node_modules', 'express'));

let pass = 0;
let fail = 0;
let skipped = 0;
function check(name, fn) {
  try {
    const r = fn();
    if (r === 'SKIP') { skipped++; console.log('  SKIP  ' + name + '  (needs backend/node_modules: run `npm ci` there)'); return; }
    pass++;
    console.log('  PASS  ' + name);
  } catch (e) {
    fail++;
    console.log('  FAIL  ' + name + '  →  ' + (e && e.message));
  }
}
function ok(v, msg) { if (!v) throw new Error(msg || 'expected truthy'); }
function eq(a, b, msg) { if (a !== b) throw new Error((msg || 'eq') + ': ' + JSON.stringify(a) + ' !== ' + JSON.stringify(b)); }

// Every text file in the archive, excluding installed dependencies and this test.
function archiveFiles(dir = ROOT, out = []) {
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules' || name === 'data.json' || name.endsWith('.db')) continue;
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) archiveFiles(full, out);
    else if (full !== __filename && !/\.(png|jpg|ico)$/.test(name)) out.push(full);
  }
  return out;
}

// Start the server with a minimal environment and report how it exits.
function runServer(env) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-hardening-'));
  const r = spawnSync(process.execPath, [SERVER], {
    cwd: path.dirname(SERVER),
    env: { PATH: process.env.PATH, DATA_FILE: path.join(dataDir, 'data.json'), PORT: '0', ...env },
    encoding: 'utf8',
    timeout: 15000,
  });
  fs.rmSync(dataDir, { recursive: true, force: true });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

console.log('\nlegacy-hardening (archived Express API)\n');

check('no default admin password literal anywhere in the archive', () => {
  const hits = archiveFiles().filter((f) => fs.readFileSync(f, 'utf8').includes('admin123'));
  eq(hits.length, 0, 'default password still present in: ' + hits.map((f) => path.relative(ROOT, f)).join(', '));
});

check('no hardcoded default JWT secret literal anywhere in the archive', () => {
  const hits = archiveFiles().filter((f) => /your-secret-key-change-this/.test(fs.readFileSync(f, 'utf8')));
  eq(hits.length, 0, 'default JWT secret still present in: ' + hits.map((f) => path.relative(ROOT, f)).join(', '));
});

check('server source has no JWT fallback to a non-empty literal', () => {
  const src = fs.readFileSync(SERVER, 'utf8');
  ok(!/JWT_SECRET\s*\|\|\s*'[^']+'/.test(src), 'a literal JWT fallback is present');
  ok(!/JWT_SECRET\s*\|\|\s*"[^"]+"/.test(src), 'a literal JWT fallback is present');
});

check('server refuses to start with no JWT_SECRET (before any require)', () => {
  const r = runServer({});
  eq(r.code, 1, 'expected exit 1, got ' + r.code + ' — output: ' + r.out.slice(0, 300));
  ok(/JWT_SECRET/.test(r.out), 'message should name JWT_SECRET: ' + r.out.slice(0, 300));
  ok(!/MODULE_NOT_FOUND/.test(r.out), 'refusal must happen before dependencies load');
});

check('server refuses a short JWT_SECRET (< 32 chars)', () => {
  const r = runServer({ JWT_SECRET: 'too-short' });
  eq(r.code, 1, 'expected exit 1, got ' + r.code);
  ok(/at least 32/.test(r.out), 'message should state the length rule');
});

check('server refuses an empty JWT_SECRET', () => {
  const r = runServer({ JWT_SECRET: '' });
  eq(r.code, 1, 'empty secret must refuse');
});

check('first run with no ADMIN_USERNAME/ADMIN_PASSWORD creates NO account (exits)', () => {
  if (!HAS_DEPS) return 'SKIP';
  const r = runServer({ JWT_SECRET: 'x'.repeat(40) });
  eq(r.code, 1, 'expected exit 1, got ' + r.code + ' — output: ' + r.out.slice(0, 300));
  ok(/ADMIN_USERNAME/.test(r.out), 'message should name ADMIN_USERNAME');
  ok(!/admin123|Created the initial admin/.test(r.out), 'must not seed anything');
});

check('first run with a short ADMIN_PASSWORD (< 12 chars) is refused', () => {
  if (!HAS_DEPS) return 'SKIP';
  const r = runServer({ JWT_SECRET: 'x'.repeat(40), ADMIN_USERNAME: 'boss', ADMIN_PASSWORD: 'short' });
  eq(r.code, 1, 'expected exit 1, got ' + r.code);
});

console.log('\n' + pass + ' passed, ' + fail + ' failed' + (skipped ? ', ' + skipped + ' skipped' : ''));
process.exit(fail === 0 ? 0 : 1);
