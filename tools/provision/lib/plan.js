// tools/provision/lib/plan.js
// PURE planning engine: roster → usernames → identifiers, and the mapping of
// EXISTING Firebase Auth accounts / Firestore profiles onto that roster.
//
// No I/O, no Firebase calls: everything here is a deterministic function of
// (roster, live state) so it can be unit-tested exhaustively and so every dry
// run produces the same plan.
//
// GUESSING POLICY
// ---------------
// The tool NEVER guesses an ambiguous mapping, and it NEVER creates a second
// profile for a student who already has one (that is how duplicate profiles and
// orphaned balances happen). Each existing profile is scored against each
// roster student:
//
//   score >= 0.9  → a *blocking* match: if it is tied or contested, the student
//                   is flagged `needs-review` and nothing is created for them.
//   0.3 .. 0.9    → a *weak* (name-only) match: reported as a warning, does not
//                   block anything.
//   < 0.3         → unmatched (former/unknown student): listed, never touched.
//
// A student whose legacy (real-email) profile was matched is ALWAYS held back
// (`migration-review` / `link-legacy`) and requires an explicit
// `migrate-identity` run (or an explicit `"ignoreLegacy": true` in roster.json,
// which records the human decision in the roster file itself).
'use strict';

const identity = require('../../../mobile/src/identity');

const { STUDENT_EMAIL_DOMAIN } = identity;
const MATCH_THRESHOLD = 0.9;  // may be auto-linked
const WEAK_THRESHOLD = 0.3;   // reported as a warning only

/* --------------------------------------------------------------- helpers -- */

// Comparable form of a name/email-local-part: lowercase, alphanumerics only.
function normKey(input) {
  return String(input == null ? '' : input)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function tokens(name) {
  return String(name == null ? '' : name)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function localPart(identifier) {
  const s = String(identifier == null ? '' : identifier).toLowerCase();
  const at = s.indexOf('@');
  return at > 0 ? s.slice(0, at) : s;
}

function balancePaiseOf(profile) {
  if (!profile) return 0;
  return Number.isInteger(profile.balancePaise)
    ? profile.balancePaise
    : Math.round(Number(profile.balance || 0) * 100);
}

/* ------------------------------------------------------------- the roster -- */

// roster.json → [{ index, name, username, identifier, legacyIdentifier }]
function buildRoster(rosterJson) {
  if (!rosterJson || !Array.isArray(rosterJson.students) || !rosterJson.students.length) {
    throw new Error('roster.json must contain a non-empty "students" array');
  }
  const entries = rosterJson.students.map((s, i) => {
    if (typeof s === 'string') return { index: i, name: s, username: null, legacyIdentifier: null, ignoreLegacy: false };
    if (!s || typeof s !== 'object') throw new Error('roster entry ' + (i + 1) + ' is not an object');
    if (!s.name) throw new Error('roster entry ' + (i + 1) + ' has no "name"');
    if (s.hold !== undefined && typeof s.hold !== 'boolean') {
      throw new Error('roster entry "' + s.name + '": "hold" must be true or false');
    }
    const holdReason = s.holdReason != null ? String(s.holdReason).trim() : '';
    if (s.hold === true && !holdReason) {
      throw new Error('roster entry "' + s.name + '" is on hold but has no "holdReason" (say why, e.g. "legacy balance under review")');
    }
    return {
      index: i,
      name: String(s.name),
      username: s.username != null ? String(s.username) : null,
      legacyIdentifier: s.legacyIdentifier != null ? String(s.legacyIdentifier).toLowerCase().trim() : null,
      ignoreLegacy: s.ignoreLegacy === true,
      hold: s.hold === true,
      holdReason: s.hold === true ? holdReason : null,
      note: s.note != null ? String(s.note) : null,
    };
  });

  const assigned = identity.assignUsernames(entries.map((e) => ({ name: e.name, username: e.username })));

  return entries.map((e, i) => {
    const a = assigned[i];
    if (e.legacyIdentifier && !identity.isEmailShaped(e.legacyIdentifier)) {
      throw new Error('roster entry "' + e.name + '" has a malformed legacyIdentifier');
    }
    return Object.assign({}, e, {
      username: a.username,
      base: a.base,
      usernameSource: a.source,
      collided: a.collided,
      syntheticIdentifier: a.identifier,
      // The login identity is ALWAYS the synthetic identifier; a
      // legacyIdentifier is only a matching hint for an existing document.
      identifier: a.identifier,
    });
  });
}

/* ------------------------------------------------ matching live profiles --- */

// Confidence ladder (higher = better).
const SCORE = {
  manual: 1.0,           // explicit roster.json legacyIdentifier
  exactName: 0.95,       // profile full_name === roster name
  identifierLocal: 0.9,  // profile id local part === roster name / username
  displayName: 0.9,      // auth displayName === roster name
  synthetic: 0.9,        // profile id IS this student's assigned identifier
  firstToken: 0.3,       // shares only the first name — never enough on its own
};

function scorePair(student, profile) {
  const reasons = [];
  const nameKey = normKey(student.name);
  const slugKey = normKey(student.username);
  const firstToken = tokens(student.name)[0] || '';
  const profileKeys = [
    normKey(profile.full_name),
    normKey(localPart(profile.id)),
    normKey(profile.displayName),
  ].filter(Boolean);

  if (student.legacyIdentifier && profile.id.toLowerCase() === student.legacyIdentifier) {
    return { score: SCORE.manual, reasons: ['manual: roster.json legacyIdentifier'] };
  }
  if (profile.id.toLowerCase() === student.syntheticIdentifier.toLowerCase()) {
    return { score: SCORE.synthetic, reasons: ['profile is already keyed by the assigned identifier'] };
  }

  let score = 0;
  if (normKey(profile.full_name) && normKey(profile.full_name) === nameKey) {
    score = SCORE.exactName;
    reasons.push('full_name matches the roster name exactly');
  } else if (profileKeys.includes(slugKey) || profileKeys.includes(nameKey)) {
    score = SCORE.identifierLocal;
    reasons.push('identifier / display name matches the roster name');
  }
  if (score < SCORE.identifierLocal) {
    const t = tokens(profile.full_name || '').concat(tokens(localPart(profile.id)));
    if (firstToken.length >= 3 && t.includes(firstToken)) {
      score = Math.max(score, SCORE.firstToken);
      reasons.push('shares the first name only');
    }
  }
  return { score, reasons };
}

// live: { authUsers: [{uid,email,displayName,hasPassword,providers,disabled}],
//         profiles: [{id, role, full_name, balancePaise, balance, txnSeq, removedAt, txnCount}],
//         jobs: [{id, status, allocations}] }
function matchProfiles(roster, live = {}) {
  // Admin profiles are NEVER matched to roster students: both admin documents
  // are preserved exactly as they are.
  const profiles = (live.profiles || [])
    .map((p) => Object.assign({}, p, { id: String(p.id), role: p.role || 'student' }))
    .filter((p) => p.role !== 'admin');

  const authByEmail = new Map();
  (live.authUsers || []).forEach((u) => {
    if (u && u.email) authByEmail.set(String(u.email).toLowerCase(), u);
  });

  const matrix = roster.map((student) => profiles.map((profile) => scorePair(student, profile)));
  const assignments = new Map(); // profile.id -> { studentIndex, score, reasons }
  const blocking = [];           // must be resolved by a human before creating
  const weak = [];               // reported, does not block

  // Who competes for each existing profile at the auto-link tier?
  const claims = profiles.map(() => []);
  roster.forEach((student, si) => {
    matrix[si].forEach((m, pi) => { if (m.score >= MATCH_THRESHOLD) claims[pi].push({ si, score: m.score }); });
  });
  const contestedProfiles = new Set();
  profiles.forEach((profile, pi) => {
    const best = Math.max.apply(null, claims[pi].map((c) => c.score).concat([0]));
    const holders = claims[pi].filter((c) => c.score === best);
    if (holders.length > 1) {
      contestedProfiles.add(profile.id);
      blocking.push({
        profileId: profile.id,
        students: holders.map((h) => roster[h.si].name),
        usernames: holders.map((h) => roster[h.si].username),
        reason: 'this existing profile matches several roster students equally well — resolve in roster.json',
        candidates: [{ id: profile.id, score: best, why: matrix[holders[0].si][pi].reasons }],
      });
    }
  });

  // Per-student assignment (unique best, uncontested, not tied).
  roster.forEach((student, si) => {
    const candidates = matrix[si]
      .map((m, pi) => ({ profile: profiles[pi], score: m.score, reasons: m.reasons }))
      .filter((c) => c.score >= MATCH_THRESHOLD)
      .sort((a, b) => b.score - a.score || a.profile.id.localeCompare(b.profile.id));
    if (!candidates.length) return;

    const best = candidates[0];
    const tied = candidates.filter((c) => c.score === best.score);
    if (tied.length > 1) {
      blocking.push({
        student: student.name,
        username: student.username,
        candidates: tied.map((c) => ({ id: c.profile.id, score: c.score, why: c.reasons })),
        reason: 'multiple existing profiles match this student equally well',
      });
      return;
    }
    if (contestedProfiles.has(best.profile.id)) return; // already reported above
    assignments.set(best.profile.id, { studentIndex: si, score: best.score, reasons: best.reasons });
  });

  // Pass 2 — everything left over.
  const unmatched = [];
  profiles.forEach((profile, pi) => {
    if (assignments.has(profile.id)) return;
    const scores = matrix.map((row) => row[pi].score);
    const bestScore = Math.max.apply(null, scores.concat([0]));
    if (bestScore >= WEAK_THRESHOLD) {
      const who = scores.indexOf(bestScore);
      weak.push({
        profileId: profile.id,
        student: roster[who].name,
        username: roster[who].username,
        score: bestScore,
        why: matrix[who][pi].reasons,
        reason: 'possible legacy profile for this student — confirm manually before linking',
      });
      return;
    }
    unmatched.push(profile);
  });

  return { assignments, blocking, weak, unmatched, authByEmail, profiles };
}

/* --------------------------------------------------------------- the plan -- */

function summarizeProfile(p) {
  const balancePaise = balancePaiseOf(p);
  return {
    id: String(p.id),
    role: p.role || 'student',
    full_name: p.full_name || null,
    balancePaise,
    balance: Number.isFinite(Number(p.balance)) ? Number(p.balance) : balancePaise / 100,
    txnSeq: Number.isInteger(p.txnSeq) ? p.txnSeq : null,
    txnCount: Number.isInteger(p.txnCount) ? p.txnCount : null,
    removedAt: !!p.removedAt,
    isSynthetic: identity.isStudentIdentifier(String(p.id)),
  };
}

// Produces the full, deterministic provisioning plan.
function buildPlan({ roster, live = {}, projectId = null, domain = STUDENT_EMAIL_DOMAIN }) {
  const { assignments, blocking, weak, unmatched, authByEmail } = matchProfiles(roster, live);
  const profileById = new Map((live.profiles || []).map((p) => [String(p.id), p]));
  const blockingByUsername = new Map();
  blocking.forEach((b) => {
    (b.usernames || [b.username]).forEach((u) => blockingByUsername.set(u, b));
    if (b.usernames) b.student = b.students.join(' / ');
  });

  const students = roster.map((student) => {
    const entry = {
      index: student.index + 1,
      name: student.name,
      username: student.username,
      identifier: student.syntheticIdentifier,
      legacyIdentifier: student.legacyIdentifier || null,
      usernameSource: student.usernameSource,
      auth: null,
      profile: null,
      legacyProfileId: null,
      legacyMatch: null,
      actions: [],
      notes: [],
      status: 'create',
      createAllowed: true,
      reviewed: null,
    };

    // ---- Firebase Auth account -------------------------------------------
    const authUser = authByEmail.get(student.syntheticIdentifier.toLowerCase()) || null;
    if (authUser) {
      entry.auth = {
        uid: authUser.uid,
        email: authUser.email,
        hasPassword: !!authUser.hasPassword,
        providers: authUser.providers || [],
        disabled: !!authUser.disabled,
      };
      entry.actions.push('auth-exists (password NOT touched)');
      if (!authUser.hasPassword && (authUser.providers || []).length === 0) {
        entry.notes.push('Auth account has no password credential — use reset-password');
      }
    } else {
      entry.actions.push('create-auth-user');
    }

    // ---- Profile keyed by the assigned identifier -------------------------
    const ownProfile = profileById.get(student.syntheticIdentifier);
    if (ownProfile) {
      entry.profile = summarizeProfile(ownProfile);
      entry.actions.push('profile-exists');
      if (!Number.isInteger(ownProfile.txnSeq)) entry.actions.push('set-txnSeq:0');
      entry.status = 'exists';
    } else {
      entry.actions.push('create-profile');
      entry.status = authUser ? 'add-profile' : 'create';
    }

    // ---- Legacy identity (real-email / differently-keyed profile) ---------
    const legacyId = student.legacyIdentifier
      || [...assignments.entries()].filter(([, a]) => a.studentIndex === student.index)
        .map(([id]) => id)
        .sort()[0]
      || null;
    const legacyProfile = legacyId ? profileById.get(legacyId) || null : null;

    if (legacyId && legacyProfile && !ownProfile) {
      const balance = balancePaiseOf(legacyProfile);
      const txns = Number.isInteger(legacyProfile.txnCount) ? legacyProfile.txnCount : null;
      entry.legacyProfileId = legacyId;
      entry.legacyMatch = {
        id: legacyId,
        score: (assignments.get(legacyId) || {}).score != null ? assignments.get(legacyId).score : null,
        reasons: (assignments.get(legacyId) || {}).reasons || [],
        balancePaise: balance,
        txnCount: txns,
        removedAt: !!legacyProfile.removedAt,
      };
      if (!Number.isInteger(legacyProfile.txnSeq)) entry.actions.push('set-txnSeq:0 (legacy)');

      if (student.ignoreLegacy) {
        entry.reviewed = 'ignoreLegacy: roster.json explicitly accepts a NEW identity for this student';
        entry.notes.push('roster.json sets ignoreLegacy — the existing profile users/' + legacyId +
          ' stays untouched and keeps receiving allocations for past jobs; confirm it is not in the active roster');
      } else {
        // NEVER create a second profile next to a live legacy one.
        entry.createAllowed = false;
        entry.status = (balance !== 0 || (txns || 0) > 0) ? 'migration-review' : 'link-legacy';
        entry.actions.push('HELD BACK — existing profile users/' + legacyId + ' (balance ' + balance +
          ' paise, ' + (txns == null ? '?' : txns) + ' ledger entries)');
        entry.notes.push('run: node provision.js migrate-identity --legacy ' + legacyId +
          ' --username ' + student.username + ' --apply   (see docs/USERNAME_LOGIN.md → Migration)');
      }
    }

    // ---- Explicit roster hold (decided by a human) -------------------------
    // Independent of the legacy/ambiguity checks: a held student is NEVER
    // created, even when there is no existing profile at all. The reason is
    // mandatory so the hold is always self-explanatory in the plan report.
    if (student.hold) {
      entry.hold = { reason: student.holdReason };
      entry.createAllowed = false;
      if (entry.status === 'create' || entry.status === 'add-profile') entry.status = 'held';
      entry.actions.push('HELD — roster hold (nothing will be created for this student)');
      entry.notes.push('Roster hold: ' + student.holdReason + '. Remove "hold" from roster.json only ' +
        'after the review in docs/USERNAME_LOGIN.md §7 is complete.');
    }

    // ---- Ambiguous mapping = blocking review ------------------------------
    const blocker = blockingByUsername.get(student.username);
    if (blocker) {
      entry.review = blocker;
      entry.status = 'needs-review';
      entry.createAllowed = false;
      entry.notes.push('AMBIGUOUS: ' + blocker.reason + ' — resolve in roster.json (legacyIdentifier) then re-plan');
    }
    return entry;
  });

  const adminProfiles = (live.profiles || [])
    .filter((p) => (p.role || 'student') === 'admin')
    .map((p) => summarizeProfile(p));

  // ---- Frozen profiles (decision D-1): NEVER written by apply --------------
  // A profile is FROZEN when it is:
  //   * matched as the legacy identity of a roster student (legacyProfileId),
  //     whether or not that student is being created;
  //   * keyed by the assigned identifier of a student who is NOT being created
  //     (held, or blocked for manual review);
  //   * named in an ambiguous review (blocking candidate).
  // Frozen profiles get no txnSeq:0 backfill and no other write. Everything else
  // (eligible students' own profiles, unmatched former profiles) keeps the normal
  // backfill. A held record is protected from this tool. The rules gate (SECURITY_REVIEW §3.2a)
  // separately stops the held account's own access once the rules are deployed.
  const frozenProfiles = new Map(); // profile id -> reason
  students.forEach((e) => {
    if (e.legacyProfileId) {
      frozenProfiles.set(String(e.legacyProfileId),
        'legacy identity of ' + e.name + (e.createAllowed ? '' : ' (held)'));
    }
    if (!e.createAllowed && profileById.has(String(e.identifier))) {
      frozenProfiles.set(String(e.identifier), 'profile of held/blocked student ' + e.name);
    }
  });
  blocking.forEach((b) => {
    if (b.profileId) frozenProfiles.set(String(b.profileId), 'ambiguous match — manual review');
    (b.candidates || []).forEach((c) => frozenProfiles.set(String(c.id), 'ambiguous match — manual review'));
  });

  // Synthetic student identities that are NOT on the roster (for example a
  // student removed from roster.json, whose login or profile still exists).
  // The tool never deletes, renames or rewrites them. `apply` refuses to write
  // while any exist unless --allow-unrostered is given, and even then they are
  // frozen: no txnSeq backfill and no other write.
  const rosterIds = new Set(students.map((e) => String(e.identifier).toLowerCase()));
  const unrosteredMap = new Map(); // identifier -> { id, profile, auth, balancePaise, removedAt }
  (live.profiles || []).forEach((p) => {
    const id = String(p.id);
    if (p.role === 'admin' || !identity.isStudentIdentifier(id) || rosterIds.has(id.toLowerCase())) return;
    unrosteredMap.set(id, { id, profile: true, auth: false, balancePaise: balancePaiseOf(p), removedAt: !!p.removedAt });
  });
  (live.authUsers || []).forEach((u) => {
    const id = String(u && u.email || '');
    if (!id || !identity.isStudentIdentifier(id) || rosterIds.has(id.toLowerCase())) return;
    const cur = unrosteredMap.get(id) || { id, profile: false, auth: false, balancePaise: null, removedAt: false };
    cur.auth = true;
    unrosteredMap.set(id, cur);
  });
  const unrostered = [...unrosteredMap.values()].sort((a, b) => a.id.localeCompare(b.id));
  unrostered.forEach((u) => {
    if (u.profile) frozenProfiles.set(u.id, 'not on the roster — left untouched');
  });

  const txnSeqBackfill = (live.profiles || [])
    .filter((p) => !Number.isInteger(p.txnSeq) && !frozenProfiles.has(String(p.id)))
    .map((p) => ({ id: String(p.id), role: p.role || 'student', removed: !!p.removedAt }));
  const txnSeqFrozen = (live.profiles || [])
    .filter((p) => !Number.isInteger(p.txnSeq) && frozenProfiles.has(String(p.id)))
    .map((p) => ({ id: String(p.id), reason: frozenProfiles.get(String(p.id)) }));

  const summary = {
    project: projectId,
    domain,
    rosterSize: students.length,
    adminProfiles: adminProfiles.length,
    toCreateAuth: students.filter((s) => s.createAllowed && s.actions.includes('create-auth-user')).length,
    authAlreadyExist: students.filter((s) => !!s.auth).length,
    toCreateProfile: students.filter((s) => s.createAllowed && s.actions.includes('create-profile')).length,
    profileAlreadyExist: students.filter((s) => !!s.profile).length,
    needsReview: students.filter((s) => s.status === 'needs-review').length,
    heldForMigration: students.filter((s) => !s.createAllowed && !!s.legacyMatch && s.status !== 'needs-review').length,
    rosterHold: students.filter((s) => !!s.hold).length,
    toCreate: students.filter((s) => s.createAllowed).length,
    weakMatches: weak.length,
    txnSeqBackfillCount: txnSeqBackfill.length,
    txnSeqFrozenCount: txnSeqFrozen.length,
    frozenProfileCount: frozenProfiles.size,
    unmatchedProfiles: unmatched.map((p) => ({ id: String(p.id), role: p.role || 'student', balance: balancePaiseOf(p) })),
    unrosteredCount: unrostered.length,
    liveJobs: (live.jobs || []).length,
    liveActiveJobs: (live.jobs || []).filter((j) => j.status !== 'reversed').length,
  };

  return {
    generatedAt: new Date().toISOString(),
    scope: live.scope || 'offline (no Firebase credentials used)',
    students,
    review: blocking,
    weakMatches: weak,
    adminProfiles,
    unmatchedProfiles: summary.unmatchedProfiles,
    unrostered,
    txnSeqBackfill,
    txnSeqFrozen,
    frozenProfileIds: [...frozenProfiles.keys()].sort(),
    summary,
    live: {
      authUserCount: (live.authUsers || []).length,
      profileCount: (live.profiles || []).length,
    },
  };
}

// The ONLY ids apply may pass to the txnSeq backfill. Throws (before any write)
// if a frozen profile is ever present in the backfill list.
function backfillTargets(plan) {
  const frozen = new Set(plan.frozenProfileIds || []);
  const ids = (plan.txnSeqBackfill || []).map((p) => String(p.id));
  const bad = ids.filter((id) => frozen.has(id));
  if (bad.length) {
    throw new Error('refusing to backfill frozen (held) profiles: ' + bad.join(', '));
  }
  return ids;
}

module.exports = {
  backfillTargets,
  SCORE,
  MATCH_THRESHOLD,
  WEAK_THRESHOLD,
  normKey,
  tokens,
  localPart,
  balancePaiseOf,
  buildRoster,
  scorePair,
  matchProfiles,
  buildPlan,
  summarizeProfile,
};
