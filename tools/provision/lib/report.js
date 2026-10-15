// tools/provision/lib/report.js
// Human-readable rendering of the roster mapping and the provisioning plan.
// Pure string building — no I/O — so the reports can be unit-tested.
'use strict';

function pad(s, n) {
  const str = String(s == null ? '' : s);
  return str.length >= n ? str : str + ' '.repeat(n - str.length);
}

function padLeft(s, n) {
  const str = String(s == null ? '' : s);
  return str.length >= n ? str : ' '.repeat(n - str.length) + str;
}

function renderMappingTable(rows) {
  const lines = [];
  lines.push(pad('#', 3) + '  ' + pad('Name', 22) + pad('Username', 22) + 'Internal identifier');
  lines.push('-'.repeat(3) + '  ' + '-'.repeat(22) + '-'.repeat(22) + '-'.repeat(40));
  rows.forEach((r) => {
    lines.push(
      padLeft(r.index, 3) + '  ' +
      pad(r.name, 22) +
      pad(r.username + (r.collided ? ' *' : ''), 22) +
      r.identifier
    );
  });
  const collisions = rows.filter((r) => r.collided);
  if (collisions.length) {
    lines.push('');
    lines.push('* username disambiguated by the deterministic collision rule ' +
      '(first roster entry keeps the plain name; later duplicates get ".2", ".3", …):');
    collisions.forEach((r) => lines.push('    ' + r.name + ' → ' + r.username));
  }
  return lines.join('\n');
}

function renderPlan(plan) {
  const s = plan.summary;
  const lines = [];
  lines.push('PROVISIONING PLAN — ' + (s.project || '(no project: offline roster plan)'));
  lines.push('generated: ' + plan.generatedAt);
  lines.push('scope: ' + plan.scope);
  lines.push('domain: ' + s.domain);
  lines.push('');
  lines.push('roster size ...................... ' + s.rosterSize);
  lines.push('Auth accounts to CREATE .......... ' + s.toCreateAuth);
  lines.push('Auth accounts already existing ... ' + s.authAlreadyExist);
  lines.push('profiles to CREATE ............... ' + s.toCreateProfile);
  lines.push('profiles already existing ........ ' + s.profileAlreadyExist);
  lines.push('NOT on roster (left untouched) ... ' + (s.unrosteredCount || 0));
  lines.push('students to CREATE ............... ' + s.toCreate);
  lines.push('students needing MANUAL REVIEW ... ' + s.needsReview + ' (blocking)');
  lines.push('students held for MIGRATION ...... ' + s.heldForMigration + ' (existing profile)');
  lines.push('students on ROSTER HOLD .......... ' + (s.rosterHold || 0) + ' (roster.json "hold": true)');
  lines.push('weak name-only matches (warn) .... ' + s.weakMatches);
  lines.push('txnSeq:0 backfills required ...... ' + s.txnSeqBackfillCount);
  lines.push('txnSeq:0 FROZEN (held, untouched) . ' + (s.txnSeqFrozenCount || 0) +
    '  (decision D-1: held legacy profiles are never written)');
  (plan.txnSeqFrozen || []).forEach((f) => lines.push('      frozen: ' + f.id + '  — ' + f.reason));
  lines.push('admin profiles PRESERVED ......... ' + (plan.adminProfiles || []).length);
  lines.push('live Firestore user docs ......... ' + plan.live.profileCount);
  lines.push('live Auth users .................. ' + plan.live.authUserCount);
  lines.push('');

  if (plan.adminProfiles && plan.adminProfiles.length) {
    lines.push('ADMIN PROFILES (never touched by this tool):');
    plan.adminProfiles.forEach((p) => {
      lines.push('  ' + pad(p.id, 40) + 'balance=' + padLeft(p.balancePaise + 'p', 8) +
        ' txnSeq=' + (p.txnSeq == null ? '(missing → 0 will be added)' : p.txnSeq) +
        ' ledger=' + (p.txnCount == null ? '?' : p.txnCount));
    });
    lines.push('');
  }

  const withLegacy = plan.students.filter((st) => st.legacyProfileId);
  if (withLegacy.length) {
    lines.push('LEGACY IDENTITIES MATCHED TO THE ROSTER (nothing is moved automatically):');
    withLegacy.forEach((st) => {
      const m = st.legacyMatch || {};
      lines.push('  ' + pad(st.name, 22) + pad(st.username, 20) +
        'legacy=' + pad(st.legacyProfileId, 28) +
        'balance=' + padLeft((m.balancePaise || 0) + 'p', 10) +
        'ledger=' + padLeft((m.txnCount == null ? '?' : m.txnCount), 5));
      lines.push('      → ' + st.status + ': ' + (st.notes.join(' | ') || 'see docs/USERNAME_LOGIN.md → Migration'));
    });
    lines.push('');
  }

  if (plan.weakMatches && plan.weakMatches.length) {
    lines.push('WARNING — POSSIBLE (unconfirmed) LEGACY PROFILES (nothing blocked, nothing created for them):');
    plan.weakMatches.forEach((w) => {
      lines.push('  possible ' + pad(w.profileId, 40) + 'for ' + pad(w.student, 22) +
        'score=' + w.score + ' [' + (w.why || []).join('; ') + ']');
    });
    lines.push('  → if a match is real, add "legacyIdentifier": "<id>" to that student in roster.json and re-plan.');
    lines.push('');
  }

  if (plan.review.length) {
    lines.push('MANUAL REVIEW REQUIRED — NOTHING IS CREATED FOR THESE STUDENTS (the tool will NOT guess):');
    plan.review.forEach((r) => {
      lines.push('  ' + r.student + ' (' + r.username + '): ' + r.reason);
      (r.candidates || []).forEach((c) => {
        lines.push('      candidate ' + c.id + '  score=' + c.score + '  [' + (c.why || []).join('; ') + ']');
      });
    });
    lines.push('');
  }

  if (plan.unmatchedProfiles && plan.unmatchedProfiles.length) {
    lines.push('EXISTING PROFILES NOT IN THE ROSTER (left completely untouched):');
    plan.unmatchedProfiles.forEach((p) => {
      lines.push('  ' + pad(p.id, 40) + 'role=' + pad(p.role, 8) + 'balance=' +
        (p.balance != null ? p.balance : '?'));
    });
    lines.push('');
  }

  if (plan.txnSeqBackfill.length) {
    lines.push('txnSeq:0 BACKFILL (adds the field ONLY where it is missing; no balances change):');
    plan.txnSeqBackfill.forEach((p) => lines.push('  ' + p.id + (p.removed ? ' (removed/tombstoned)' : '')));
    lines.push('');
  }

  lines.push('PER-STUDENT ACTIONS:');
  plan.students.forEach((st) => {
    lines.push('  ' + pad(String(st.index) + '. ' + st.name, 24) + pad(st.username, 22) +
      pad(st.status, 20) + (st.createAllowed ? '' : '[HELD] ') + st.actions.join(', '));
    lines.push('      ' + st.identifier + (st.legacyProfileId ? '   (legacy: ' + st.legacyProfileId + ')' : ''));
  });
  return lines.join('\n');
}

function renderApplyResult({ project, created, skipped, backfills, credentialsFile, dryRun, passwordsShown, passwordMode }) {
  const lines = [];
  lines.push((dryRun ? 'DRY RUN — nothing was written.' : 'APPLY COMPLETE.'));
  lines.push('project: ' + project);
  lines.push('');
  lines.push('Auth accounts created ............ ' + created.auth);
  lines.push('Auth accounts skipped (exists) ... ' + skipped.auth);
  lines.push('profiles created ................. ' + created.profiles);
  lines.push('profiles skipped (exists) ........ ' + skipped.profiles);
  lines.push('txnSeq:0 backfills written ....... ' + backfills.applied);
  lines.push('students HELD (review/migration) . ' + skipped.held);
  lines.push('passwords reset .................. 0 (reruns never reset passwords)');
  lines.push('password mode .................... ' + (passwordMode === 'shared-test'
    ? 'owner shared initial password for NEW accounts, TEST MODE (emulators only; not printed or stored)'
    : passwordMode === 'shared'
      ? 'owner shared initial password for NEW accounts (not printed or stored)'
      : 'unique random password per NEW account'));
  lines.push('');
  if (credentialsFile) lines.push('credentials file: ' + credentialsFile + ' (mode 0600, git-ignored)');
  if (passwordsShown && passwordsShown.length) {
    lines.push('');
    lines.push('GENERATED TEMPORARY PASSWORDS (hand each one to its student, then delete the file):');
    passwordsShown.forEach((p) => lines.push('  ' + pad(p.username, 22) + p.password));
  }
  return lines.join('\n');
}

module.exports = { renderMappingTable, renderPlan, renderApplyResult, pad, padLeft };
