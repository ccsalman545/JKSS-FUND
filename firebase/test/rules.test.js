// DIAGNOSTIC — one read per candidate get() pattern; the FAIL names in the
// CI annotation tell us exactly which path-expression forms the engine
// resolves. (Temporary — replaced by the real suite after diagnosis.)
'use strict';

const fs = require('fs');
const path = require('path');
const { initializeTestEnvironment, assertSucceeds } = require('@firebase/rules-unit-testing');
const { doc, getDoc, setDoc } = require('firebase/firestore');

const RULES = fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8');
const ADMIN = 'admin@jkss.in';

(async () => {
  const env = await initializeTestEnvironment({
    projectId: 'jkss-fund-test',
    firestore: { rules: RULES },
  });
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'users/' + ADMIN), { email: ADMIN, role: 'admin', full_name: 'Admin' });
    await setDoc(doc(db, 'meta/committee'), { balancePaise: 1000, balance: 10 });
  });

  const admin = env.authenticatedContext('uid-admin', { email: ADMIN }).firestore();
  let pass = 0;
  let fail = 0;
  for (const k of ['d1', 'd2', 'd3', 'd4', 'd5']) {
    try {
      await assertSucceeds(getDoc(doc(admin, 'diag/' + k)));
      pass++;
      console.log('  PASS  diag ' + k + ' allowed');
    } catch (e) {
      fail++;
      console.log('  FAIL  diag ' + k + ' denied → ' +
        String(e && e.message).split('\n').slice(0, 2).join(' ').replace(/\s+/g, ' ').slice(0, 240));
    }
  }
  await env.cleanup();
  console.log('\n' + pass + ' passed, ' + fail + ' failed  (5 total)');
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error('FATAL — could not initialize the rules test environment. ' + (e && e.message));
  process.exit(2);
});
