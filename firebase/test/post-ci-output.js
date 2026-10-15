// CI helper: post the tail of the rules-test output as a commit comment so
// failures are readable without raw-log access. Exits non-zero on failure.
const fs = require('fs');

(async () => {
  const file = process.argv[2] || 'rules-test-output.txt';
  const sha = process.env.GITHUB_SHA;
  const repo = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  if (!sha || !repo || !token) {
    console.error('missing GITHUB_SHA / GITHUB_REPOSITORY / GITHUB_TOKEN');
    process.exit(2);
  }
  let out = '(no output captured)';
  try {
    const full = fs.readFileSync(file, 'utf8');
    out = full.slice(-5000) || '(empty output file)';
  } catch (e) {
    out = `(could not read ${file}: ${e.message})`;
  }
  const body = [
    'Firestore rules test run failed. Captured output (tail):',
    '```',
    out,
    '```',
    '',
    '_posted automatically by CI_',
  ].join('\n');
  const res = await fetch(`https://api.github.com/repos/${repo}/commits/${sha}/comments`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ body }),
  });
  const text = await res.text();
  console.error(`POST /commits/${sha}/comments -> HTTP ${res.status}: ${text.slice(0, 300)}`);
  process.exit(res.ok ? 0 : 1);
})().catch((e) => {
  console.error(`post failed: ${e && e.stack || e}`);
  process.exit(1);
});
