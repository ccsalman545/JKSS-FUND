// CI helper: publish the tail of the rules-test output into the check run's
// own output summary (visible in the Checks tab, readable via the API).
// Fallback: commit comment. Exits non-zero only if everything failed.
const fs = require('fs');

const sha = process.env.GITHUB_SHA;
const repo = process.env.GITHUB_REPOSITORY;
const runId = process.env.GITHUB_RUN_ID;
const token = process.env.GITHUB_TOKEN;
const file = process.argv[2] || 'firebase/rules-test-output.txt';

async function api(method, path, payload) {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  const text = await res.text();
  return { status: res.status, ok: res.ok, text };
}

(async () => {
  if (!sha || !repo || !token) {
    console.error('missing GITHUB_SHA / GITHUB_REPOSITORY / GITHUB_TOKEN');
    process.exit(2);
  }
  let out = '(no output captured)';
  try {
    const full = fs.readFileSync(file, 'utf8');
    out = full.length > 50000 ? full.slice(-50000) : full;
  } catch (e) {
    out = `(could not read ${file}: ${e.message})`;
  }
  const summary = [
    '## Firestore rules test output',
    '',
    '```',
    out,
    '```',
    '',
    '_posted automatically by CI_',
  ].join('\n');

  let published = false;
  if (runId) {
    try {
      const jobs = await api('GET', `/repos/${repo}/actions/runs/${runId}/jobs`);
      if (jobs.ok) {
        const job = JSON.parse(jobs.text).jobs.find((j) =>
          j.name.toLowerCase().includes('emulator'));
        if (job && job.check_run_url) {
          const crPath = job.check_run_url.replace(/^https:\/\/api\.github\.com/, '');
          const patch = await api('PATCH', crPath, {
            output: { title: 'Rules test output', summary, text: summary },
          });
          console.error(`PATCH check-run output -> HTTP ${patch.status}`);
          published = patch.ok;
        } else {
          console.error('check_run_url not found in job list');
        }
      } else {
        console.error(`GET jobs -> HTTP ${jobs.status}: ${jobs.text.slice(0, 200)}`);
      }
    } catch (e) {
      console.error(`check-run update failed: ${e && e.message || e}`);
    }
  }

  if (!published) {
    const c = await api('POST', `/repos/${repo}/commits/${sha}/comments`, { body: summary });
    console.error(`POST commit comment -> HTTP ${c.status}: ${c.text.slice(0, 200)}`);
    if (!c.ok) {
      console.error('could not publish output anywhere');
      process.exit(1);
    }
  }
})().catch((e) => {
  console.error(`helper failed: ${e && e.stack || e}`);
  process.exit(1);
});
