# JKSS-FUND v3.5.2 — Security & Financial Accounting Review

Scope: Firebase Auth + Firestore on the **Spark (free) plan**, Android app
(`com.jkssfund.app`, Expo SDK 51 + React Native Firebase). This document is the
record of the vulnerability review, the fixes, the schema changes, the test
results, and the exact steps to run tests and deploy — plus an honest
assessment of what is and is *not* safe for real money.

**Status:** implementation + executable tests complete on branch
`arena/dc657e31-jkss-fund` (tip `3cbe1da`). **v3.0 addendum (username logins):
the username login did not change `firestore.rules`; see §11. The later held-account and pre-authorization
gate DID change the rules; see §3.2a.** The rules suite is
**executed in GitHub Actions CI** (Firestore emulator, production rules
engine) — see §4. Latest run **38704744622: SUCCESS — 75/75 rules scenarios
passed, 0 failure annotations**; Node suites green in the same run. Rules
deployment and any production data change are **not** done (per the task
constraints) — the manual deploy commands are in §5, to run only after
explicit approval.

> **v3.5.2 (this revision) — three rounds of emulator-discovered engine
> behavior, each fixed and re-verified in CI.**
> 1. **v3.4→v3.5** — the engine has no `.exists` property on `get()`/
>    `getAfter()` results (only `.data`) and no `toString()`; the rules were
>    rewritten on the CI-verified primitives `exists(path)` (clean bool) +
>    `get(path).data.field` (always guarded by `exists`/type checks) —
>    run 38703715491: 71/75 (all admin + read scenarios green; the 4
>    failures were the withdrawal batches dying on the missing `toString`).
> 2. **v3.5→v3.5.2** — the withdrawal canonical id `w_{email}_{seq}` could
>    not be reconstructed in rules at all (no int→string). Replaced with a
>    **bidirectional companion lock** (the user write carries
>    `withdrawalTxnId`, the txn carries `seq`; each side verifies the other)
>    — run 38704744622: **75/75**.
> 3. **Admin pre-authorization (v3.5)** — students can no longer
>    self-create profiles at all; only an existing admin (app or console)
>    can provision one, in the exact `newProfileOk` shape (student role,
>    zero balances, `txnSeq: 0`, field allowlist). The app's `ensureProfile`
>    is now **read-only** and blocks the dashboard until an admin has
>    pre-authorized the student.

> **v3.2 (this revision) — why the rules changed a second time.** After the
> first emulator run, the production rules compiler rejected the v3.1 ruleset:
> the classic Firestore rules language has **no lambda/`filter`/`map` over
> collections, no `indexOf`/`startsWith`, no bare `round`, no `sum`, and no
> `number` type** (verified against the official grammar shipped with
> `firebase/eslint-tools` and the emulator's open-source compiler). v3.2
> redesigns every check around what the language *can* express (exact-path
> writes, `request.writes.get(path, null)`, wildcard captures,
> `map.get(k, default)`, `list.hasAny/hasAll/hasOnly/removeAll`,
> `get()`/`getAfter()`) and changes the on-disk job `allocations` to a **map
> keyed by email** so each student's entry is addressable without iteration.

---

## 1. Vulnerability summary (before → after)

### 1.1 Firestore rules (the security boundary)

The old rules file allowed, for any signed-in user, essentially full read/write
on the financial data. Every one of these is closed by the new ruleset
(`firebase/firestore.rules`):

| # | Vulnerability (old rules) | Impact | Fix (new rules) |
|---|---------------------------|--------|-----------------|
| V1 | Any signed-in user could **read/list all profiles** | All balances, names, emails exposed to every student | `get` = self or admin; `list` = admin only |
| V2 | Any signed-in user could **create a profile with `role: "admin"`** (or any profile at all) | Anyone becomes admin → full control of the fund | **Self-create is now impossible** (`create: if false` for non-admins). Only an existing admin can create a profile: student or admin role, **zero balances required**, field allowlist via `keys().hasOnly(...)`. Pre-authorized profiles are created **only by an admin** (via the app or the Firebase console) in the exact `newProfileOk` shape — student role, zero balances, `txnSeq: 0`, field allowlist; students have **no self-create or self-activation path**. A Google sign-in with no matching doc simply has no profile — the app gates the dashboard on it (see §3.2 + the admin migration plan in §10) |
| V3 | Any signed-in user could **modify any profile field of any user** — including `role`, `balance`, `balancePaise` | Direct balance inflation, self-admin-ification | Self-update restricted to `full_name`/`avatar`/`lastActiveAt` (or a pure withdrawal pair); admin update restricted to `full_name`/`avatar`/`lastActiveAt`/`removedAt` (or a verified job batch) — **no path exists that edits role or balance manually** |
| V4 | Any signed-in user could **delete any profile** (hard delete) | Erase debt/audit trail; re-create as admin | `allow delete: if false` on `users`; removal is a tombstone (`removedAt`) only, by admins |
| V5 | Any signed-in user could **create/modify/delete jobs** | Pay themselves, rewrite the 10/90 split | Jobs: all operations **admin-only**; create shape-validated; update = `status` toggle or reversal tombstone only; **delete denied entirely** (audit history must survive) |
| V6 | Any signed-in user could **write any field of `meta/committee`** | Inflate/deflate the committee fund | Committee: read for signed-in; create-at-zero for signed-in (zero only, exact fields); **update only by an admin, only inside a job batch** (the batch must contain the job write at the exact key the committee doc references); final balance verified via `getAfter()` by the `/jobs` rules; delete denied |
| V7 | Job creation had **no shape validation** | Record a 50/50 split, a 110% split, arbitrary amounts | `jobShapeOk()` enforces: `committeeSharePaise == floor(amountPaise/10)`, `studentSharePaise == amountPaise − committeeSharePaise`, `studentCount` consistency, `allocations` is a **map** of exactly `studentCount` entries, and **every value is `base` or `base+1`** (the largest-remainder bound, re-derived in rules) |
| V8 | Balance changes had **no atomicity requirement** | Money created out of thin air, un-auditable ledger | Every balance change is legal only inside a verified atomic batch: **withdrawal** = exactly 2 writes (user update + one companion withdrawal txn under `users/{me}/transactions/`), final `balancePaise` integer ≥ 0, txn amount == the exact delta computed against the **live** document, and the pair is a **bidirectional lock** (user write names the txn via `withdrawalTxnId`; the txn carries `seq`; each side cross-verifies the other's post-state — a third write, an extra txn, a stale replay, or a detached balance write is all denied); **job credit** = job set + per-student credit + canonical `earn_{jobId}_{email}` txn + committee update carrying `lastJobId`; **job reversal** = job **tombstone** update + original-allocation debits + canonical `rev_{jobId}_{email}` txns + committee credit-back carrying `reversedJobId` (reversal of an already-reversed job denied via `getAfter(jobs/{id}).data.status`) |
| V9 | Top-level `transactions` collection was **writable** | Ledger tampering | Ledger lives at `users/{email}/transactions` (self or admin read; the three verified creations only; update/delete denied for everyone); legacy top-level collection is **admin-read-only**, all writes denied |
| V10 | No user-document ID validation; email casing not normalized | Split-brain profiles; ID injection | `isEmailId()` (non-empty, lowercase, exactly one `@`, no spaces, ≤200 chars) required on every `users/{email}` access; the app normalizes to lowercase on all writes |
| V11 | Permissive fall-through for unknown paths | Undefined surface area | Every path has explicit rules; final `match /{document=**} { allow read, write: if false; }` |
| V12 | (v3.1 ruleset) relied on **syntax the rules language does not have** (`filter`/lambdas) — the ruleset **would not compile** at deploy time | The "hardened" rules could never actually be deployed; a silent revert to permissive behavior was the real risk | v3.2 uses only verified language constructs; the suite is **executed against the production rules engine in CI** on every push (see §4.2) |

### 1.2 Client-side accounting (the app, `mobile/src/api.js`)

Client code is **never** the security boundary, but the old implementation had
correctness bugs that the new rules would have punished:

| # | Problem (old api.js) | Impact | Fix |
|---|----------------------|--------|-----|
| A1 | **Float rupee math** for splits and balances | Rounding drift; paise created or lost; 0.1+0.2-style errors | All money is **integer paise** end-to-end (`src/accounting.js` — pure, unit-tested). Rupee floats are display mirrors only |
| A2 | 10/90 split rounded each side independently | `committee + students ≠ amount` in edge cases (e.g. ₹999.99) | `splitShares`: committee = `floor(amountPaise/10)`, students = `amountPaise − committee` — **exact by construction** |
| A3 | Per-student split = `pool / n` rounded | The distributed total could differ from the pool | **Largest-remainder allocation**: `base = floor(pool/n)`, first `r = pool − base·n` students get `base+1`. Always sums exactly to the pool (fuzz-tested over 100k random pools/rosters) |
| A4 | Job deletion **recalculated against the current roster** | Reversals wrong after students joined/left | Jobs store their `allocations` map (original split). Reversal **replays the original allocations** with deterministic txn IDs (`rev_{jobId}_{email}`); the rules verify each debit equals the *stored* amount (read via `get()`, i.e. pre-batch — immune to the tombstone update in the same batch) |
| A5 | **No legacy-job guard** | Fabricated reversal amounts | `deleteJob` throws `reconcile manually` for jobs lacking `allocations`/paise fields; the rules refuse such reversals |
| A6 | Student "deletion" was a hard delete | Destroyed the fund's liability record | Removal = tombstone `removedAt` (admin-only). Balance + ledger preserved; removed students stop receiving new splits but can still be debited by historical reversals (allowed to go negative — the fund's standing liability) |
| A7 | `ensureCommittee` merged zeros over the existing doc on every launch | **Zeroed the committee fund on every app launch** | Only creates the doc when missing; never writes an existing balance |
| A8 | Withdrawal wrote balance and txn in **two commits** | Partial-failure window; concurrent overdraw | Single Firestore **transaction** with explicit **final** balance values (never `FieldValue.increment`) — the rules compute the delta against the live document, so a stale/duplicate replayed batch yields delta 0 and is rejected; idempotency key on the txn doc (retries are no-ops) |
| A9 | Duplicate job processing possible on retry | Double payment | Deterministic job ID + `exists()` check inside the transaction → `This job was already recorded` |
| A10 | No input validation on money entry paths | NaN/negative writes reaching the DB | `toPaise`/`splitShares`/`allocateLargestRemainder` reject non-integer/non-positive inputs |
| A11 | (v3.1 app) used `FieldValue.increment` for batched balances | The rules see the increment sentinel, not the final value — final-state checks are impossible | All batched balance writes are **explicit final values** computed from live reads inside the transaction |

---

## 2. Modified files & why

> Historical record of the pre-v3.0 rewrite. For the v3.0 deltas see §2.1. Where this table
> and the runbook disagree, the runbook (`docs/USERNAME_LOGIN.md` §8) wins.

| File | Change |
|------|--------|
| `firebase/firestore.rules` | **Full rewrite (v3.2)** — least-privilege ruleset using only verified language constructs (design in §3); batch protocol with exact-path cross-references; tombstone job reversal |
| `firebase/.firebaserc` | Default project fixed to the real project `jkss-fund` (was the invalid uppercase placeholder `YOUR_FIREBASE_PROJECT_ID`, which made `firebase emulators:exec` refuse to start — project IDs must be lowercase) |
| `firebase/firestore.indexes.json` | Emptied — all app queries are single-field (built-in indexes) |
| `firebase/firebase.json` | Reviewed — unchanged (rules/indexes paths + emulator ports are correct) |
| `firebase/test/rules.test.js` | **Rewritten to the v3.5 protocol — 75 scenarios** (all admin scenarios, student authz, pre-authorization flow incl. unauthorized self-create denial + no-field-grabbing on activation, protected fields, private txns, withdrawals incl. overdraw/stale-replay/extra-write/amount-mismatch/detached-write, job creation, committee changes, job reversal incl. double-reversal + legacy + removed-student negative liability, unauthorized paths) |
| `firebase/package.json` (+ lockfile) | **New** — dev deps for the rules suite: `firebase@^10.14.1` (peer of `@firebase/rules-unit-testing@^3.0.4`), lockfile `npm ci`-verified |
| `firebase/README.md` | Updated — v3.2 data model + batch protocol, local testing workflow, deployment notes, `.firebaserc`/project selection |
| `.github/workflows/firestore-rules.yml` | **New** — CI: rules suite in the Firestore emulator (Java 21, emulator-jar cache, project `jkss-fund-local`, full output published as a job annotation) + Node suites for the mobile tests |
| `mobile/src/accounting.js` | **New** — pure paise math; `allocateLargestRemainder` returns the on-disk **map** `{email: paise}`; `assertAllocationsExact` validates the map |
| `mobile/src/api.js` | **Rewritten data layer** — paise-exact; per-user ledger subcollections; job credit/reversal/withdrawal as atomic transactions with **explicit final balances**; canonical txn IDs (`earn_{jobId}_{email}` / `rev_{jobId}_{email}`); withdrawal = **bidirectional lock** (user write carries `withdrawalTxnId`, txn doc carries `seq`); committee update carries `lastJobId`/`reversedJobId`; reversal = job **tombstone** (never delete); original-allocation reversals; legacy-job guard; tombstone removal; idempotency keys; fixed `ensureCommittee` (A7); **`ensureProfile` is now read-only** (no auto-create; returns the profile or `null` for unauthorized students) |
| `mobile/test/accounting.test.js` | **New** — 31 executed unit tests of the financial core (incl. 100k fuzz invariants + 1,000-job no-drift fuzz) |
| `mobile/test/api.mock.test.js` | **22 executed integration tests** of the real `api.js` orchestration against a transaction-semantic in-memory Firestore (incl. atomicity-on-failure, idempotent retry, original-allocation reversal after roster change, tombstone re-reversal refusal, **pre-authorization: unauthorized student gets `null` (no auto-create), authorized `txnSeq:0` doc activates, profile field is never mutated by ensureProfile**) |
| `mobile/App.js` / `mobile/src/context/AuthContext.js` | **Pre-authorization gate** — after auth, the app resolves the profile; `status: 'authorized' | 'unauthorized'` in context; unauthorized students see a read-only "awaiting admin authorization" screen (no auto-create, no dashboard); unauthorized state re-checked on app resume |
| `mobile/src/screens/StudentsScreen.js` | Admin "add student" = **provisioning** (creates the pre-authorized doc); copy updated; add-student requires a valid email |
| `mobile/src/screens/JobsScreen.js` | Reversed jobs shown with a "reversed" badge and excluded from totals; reversal confirm text updated (tombstone, audit record) |
| `mobile/src/screens/StudentsScreen.js` | Removal is a tombstone (copy + confirmation updated); add-student requires a valid email |
| `mobile/src/screens/StudentDashboard.js` | Max-withdrawal chip and over-balance check derived from integer paise; withdrawal result handling |
| `mobile/src/screens/TransactionsScreen.js` | Summary + filters account for `reversal` entries (paise-exact totals) |
| `mobile/src/screens/LoginScreen.js` | Google sign-in button hidden until real OAuth client IDs are configured (see §9) |
| `mobile/src/config.js` | `GOOGLE_SIGNIN_CONFIGURED` flag derived from the client IDs (placeholders detected) |
| `mobile/src/context/AuthContext.js` | `GoogleSignin.configure` called only with real IDs (placeholder IDs would make the native library misbehave); email/password auth unaffected |

### 2.1 v3.0 delta (username/password logins)

The table above is the security/accounting release's record. v3.0 changed **no
rules**; it added:

| File | Change |
|------|--------|
| `mobile/src/identity.js` | **New** — single source of truth: slugify → username → internal identifier, deterministic collision resolution, roster assignment, login resolution, password policy (shared by app, suites and tool) |
| `mobile/src/api.js` | `login(usernameOrEmail, password)` (username → identifier, admin email passes through); `googleLogin` removed; `addStudent(username, …)` pre-authorizes `users/{identifier}`; profile exposes `username` **and** `loginIdentifier` |
| `mobile/src/context/AuthContext.js` | Google Sign-In removed; `status` gate unchanged (unauthorized students never reach the dashboard) |
| `mobile/src/screens/LoginScreen.js` | Username + password form, in-app help, no Google button |
| `mobile/src/screens/NotAuthorizedScreen.js` | **New** — "Awaiting admin authorization" screen |
| `mobile/src/screens/ProfileScreen.js` | Change-password available to **students** too; forgotten-password guidance |
| `mobile/src/screens/StudentsScreen.js` | Add student by **username** (pre-authorization) |
| `mobile/src/config.js`, `mobile/app.json`, `mobile/package.json` | Google OAuth placeholder + `@react-native-google-signin/google-signin` dependency **removed** (nothing else read them; §9.3 note) |
| `mobile/test/identity.test.js` | **New** — 63 executed tests (normalization, collisions, identifier mapping, policy, 20k fuzz) |
| `mobile/test/api.mock.test.js` | Extended to **37 tests** (username login with real `auth/*` codes, identical error text for unknown-user vs wrong-password, ledger identity) |
| `tools/provision/**` | **New** — the local provisioning tool + 3 suites (plan 36, passwords 15, emulator E2E 31) |
| `firebase/test/rules.test.js` | **121 scenarios** (89 before the held-account gate, +22 in section 14, +10 in section 15 — see §3.2a) |
| `.github/workflows/username-login.yml` | **New** — node suites + Auth/Firestore emulator E2E job |
| `docs/USERNAME_LOGIN.md`, `tools/provision/README.md`, `README.md`, `PRIVACY_POLICY.md`, `mobile/PLAY_STORE.md`, `SECURITY_REVIEW.md`, `firebase/README.md` | Documentation for the above |

Consequences for §9/§10: the app.json OAuth placeholder and the Google sign-in
console checklist no longer apply (kept only as history).

---

## 3. Final rules design (`firebase/firestore.rules`, v3.2)

### 3.0 Language constraints (verified, not assumed)

The classic Firestore rules language (what the production emulator compiles)
**cannot** iterate a collection with a predicate. Verified against the official
grammar (`firebase/eslint-tools/grammar`) and the emulator's open-source
compiler:

- **No** `filter` / `map` / any lambda (`=>`) over lists or maps — the parser
  rejects `=>` outright.
- **No** `indexOf` / `startsWith` on strings; **no** `sum()`; **no** bare
  `round()` (it is `math.round()`); **no** `number` type (only `int`/`float`).
- **Yes**: `map.get(k)`, `map.get(k, default)`, `map.keys()`, `map.values()`,
  `map.size()`, `map.diff(other)` (+`affectedKeys()`/`addedKeys()`/…),
  `list.size()`, `list.hasAny/hasAll/hasOnly(other)`, `list.removeAll(other)`,
  `list.toSet()`, `string.split/size/lower/matches/…`, the `in` operator,
  ternaries, `let`, `get()`, `getAfter()`, `math.*`, `hashing.*`.

Consequences for the design:

- Cross-write checks use **exact paths only**: wildcard captures or a
  **field of a write at a known exact key** (never from iterating unknown
  keys).
- **`map[key]` on a missing key is an error** (verified in the compiler), so
  all optional lookups use `.get(key, null)` or an `x is not T` guard first.
- The batch's job reference travels in the **committee write**: the committee
  update carries `lastJobId` (credit) or `reversedJobId` (reversal), and the
  committee is always at the exact key `/meta/committee` — so any rule in the
  batch can address the job write and the canonical txn keys without
  iteration.
- Job `allocations` is a **map keyed by email** (`{email: amountPaise}`), so
  "this student's allocation" is `allocations.get(email)` — no list scanning.

### 3.0a Engine-verified runtime semantics (CI probes, v1.22.0 — v3.5)

Beyond the grammar, the emulator/production engine behaves as follows
(each fact was established by a dedicated probe run and then encoded):

| Probe | Result |
|-------|--------|
| `get(path)` / `getAfter(path)` return shape | a **map with one member: `.data`** (the doc field map, or `null` if absent). There is **no `.exists` member** — `x.exists` throws "Property exists is undefined on object" |
| Direct field access on the wrapper (e.g. `get(p).field`) | **error** — always go through `.data` |
| `exists(path)` | **clean boolean**, no side effects — the only correct "doc present" test |
| `get(p) is map` / `get(p) != null` on a **missing** path | `true` (the wrapper exists) — **never** use as an existence test |
| `is int/string/bool` or `== null` applied directly to a get() result | **evaluation error** even when the honest answer is false — guard with `exists()` or read `.data` fields only |
| `toString()` / any int→string conversion | **does not exist** ("Function not found error: Name: [toString]") — canonical ids must be string-only, or supplied by the client as a string field (v3.5.2 bidirectional lock) |
| `request.writes` | **does not exist** — batch visibility only via `get()`/`getAfter()` at exact paths |
| `if` statements, lambdas | not in the language (see §3.0) |

Encoded patterns (all 75 CI scenarios pass on these): `let cOld =
exists(p) ? get(p).data : null;`, `let cAfter = getAfter(p).data;`
(always `&&`-gated by `exists`-style conditions so an absent doc can never
reach a bare `.data` read), and boolean presence via `exists(p) == true`.

### 3.1 Helpers

`signedIn()`, `isEmailId(id)`, `isSelf(email)` (parameterized), `isAdmin()`
(user doc exists **and** `role == 'admin'`), `paiseOf(d)` (`balancePaise` or
legacy `math.round(balance*100)`), `balanceFieldsOnly()` (affected keys ⊆
`{balance, balancePaise}` and include `balancePaise`),
`newProfileOk(d)` (create/activation shape: field allowlist, student role,
zero balances, `email` == doc ID, `txnSeq` absent or exactly 0 — used both
for admin create and for the pre-authorization **activation** update), plus
per-batch helpers implementing the protocol in §3.2.

Access-gate helpers (held legacy accounts, §3.2a): `usernameIdentifier(e)`,
`legacyAuthorized(e)`, `studentAccessOk()`, `selfAccessOk()`.

### 3.2 Path-by-path

- **`/users/{email}`**
  - `get`: self or admin · `list`: admin only
  - `create`: **admin only** (`isAdmin() && newProfileOk(...)`): student or
    admin role, `balancePaise == 0`, `balance == 0`, `email` field == doc
    ID, `txnSeq == 0`, **fields ⊆ the 8 known fields**. Students cannot
    create their own profile — a sign-in with no pre-authorized doc has no
    profile and the app shows the "awaiting admin authorization" state.
  - `update` (OR of exclusive branches):
    1. self profile: affected keys ⊆ `{full_name, avatar, lastActiveAt}`
    2. self **withdrawal** (bidirectional lock, v3.5.2): affected keys ⊆
       `{balance, balancePaise, txnSeq, withdrawalTxnId}`; final
       `balancePaise` int ≥ 0; delta > 0 against the **live** doc;
       `txnSeq` advanced by exactly 1; `withdrawalTxnId` is a string; the
       txn at that id is **absent before** the batch (`exists(...) ==
       false`) and **present after** (`getAfter`), with `type ==
       'withdrawal'` and `seq == newSeq`. The companion txn write (see
       below) verifies the user side of the lock in return.
    3. admin maintenance: affected keys ⊆ `{full_name, avatar, lastActiveAt,
       removedAt}`
    4. admin **job credit**: user write carries `creditJobId`; job **set**
       at `jobs/{jobId}` must be NEW in the batch
       (`exists == false` / `getAfter` present); `allocations.get(email) ==
       delta`; canonical `earn_{jobId}_{email}` txn is NEW in the batch at
       the same amount (committee delta enforced on the `/jobs` +
       `/meta/committee` rules via `getAfter`)
    5. admin **job reversal**: user write carries `reversalJobId`; the
       **pre-batch** job (`get()`) must have `status == 'active'` and the
       **post-batch** job (`getAfter`) `status == 'reversed'` (double
       reversal denied); debit == **original** stored allocation; canonical
       `rev_{jobId}_{email}` txn NEW in the batch at the same amount;
       negative final allowed only if `removedAt != null`
  - `delete`: **denied for everyone** (tombstone-only removal)
- **`/users/{email}/transactions/{txnId}`** — get/list: self or admin.
  `create`: (a) self withdrawal — the user write in the same batch must
  reference **this exact txn id** (`uAfter.data.withdrawalTxnId == txnId`),
  carry `txnSeq == t.seq`, and land at `finalPaise == prePaise − amountPaise`
  (the second half of the bidirectional lock — a balance write without its
  ledger entry, an extra companion, or a detached id is all denied);
  (b) admin earning — canonical id `earn_{jobId}_{email}`, job set in batch,
  stored allocation == amount, user write credits exactly that amount;
  (c) admin reversal — canonical id `rev_{jobId}_{email}`, job tombstone in
  batch, **original** stored allocation == amount, user write debits exactly
  that amount. `update`/`delete`: **denied for everyone** (immutable ledger).
- **`/jobs/{jobId}`** — admin-only on all operations:
  - `create`: `jobShapeOk` (name/date/amount validation,
    `committeeSharePaise == floor(amountPaise/10)`,
    `studentSharePaise == amountPaise − committeeSharePaise`, `allocations`
    is a map of exactly `studentCount` entries, **every value is `base` or
    `base+1`** where `base = studentSharePaise / studentCount`) +
    `jobCreditBatchOk` (committee update in batch references exactly this
    job; **final** committee state via `getAfter` grew by exactly
    `committeeSharePaise`; stays ≥ 0)
  - `update`: (a) `status` only, in `{active, archived}`; or (b) **reversal
    tombstone** — `status: 'reversed'` (+`reversedAt`), the batch carries the
    committee credit-back (final state via `getAfter` returns exactly the
    **original** `committeeSharePaise`; stays ≥ 0) and references this job
    via `reversedJobId`; legacy jobs without `allocations`/`amountPaise` are
    refused
  - `delete`: **denied entirely** — deletion would destroy the allocation
    history the ledger and audits depend on; reversal is a tombstone
- **`/meta/committee`** — read: signed-in (public fund); create: signed-in,
  zero only, exact fields `{balancePaise, balance}`; update: admin, and the
  batch must contain the job write at the exact key referenced by
  `lastJobId`/`reversedJobId` (amount deltas are enforced by the `/jobs`
  rules via `getAfter`); delete: denied
- **`/transactions/{txnId}`** (legacy) — read: admin; all writes denied
- **Catch-all** — explicit deny for everything else

### 3.2a Student access gate (held legacy accounts and pre-authorization)

**Threat.** Before this gate, a real-email account that had a `users/{email}`
profile (a legacy student on hold, Option B) could read its own balance and ledger,
and could withdraw from its own balance. The rules only asked "is this my own
document?", so the hold existed only in the provisioning tool. A later review also
found that a signed-in synthetic identifier could read the committee balance without
any profile check, and that the sign-in email was not verified (see the rationale below).

**Rule.** A signed-in account may use a student financial path only when all of these
hold (`studentAccessOk()`):

1. its sign-in email is **verified** (`request.auth.token.email_verified == true`);
2. `users/{email}` **exists with `role == 'student'`**. Only an admin (or the console)
   can create that profile, so the profile is the admin's pre-authorization. A missing
   profile, a missing `role` field, or any other role denies;
3. **either** its email is a username identifier (`^[a-z0-9._-]+@students[.]jkss-fund[.]invalid$`,
   the v3.0 login), **or** `legacyAuthorizations/{email}` exists with `authorized == true`.
   Only an admin can read that collection. Clients cannot write it. The owner creates it
   in the console or with an admin SDK script, which is a manual, approved production write.

Any other account reads and writes no financial data. A real-email account without
item 3 is a legacy student on hold.

**Why the verified-email check (item 1).** The profile check alone is not enough. The app
ships the public Web API key, and email/password sign-up is open unless the owner has
turned it off. Without item 1, someone could register `<username>@students.jkss-fund.invalid`
or a legacy student's real address before its owner, and inherit the profile that
already exists. Synthetic identifiers use the `.invalid` domain, which can never receive
mail, so no verification can ever complete for a self-registered synthetic account. The
provisioning tool creates every student account with `emailVerified: true`
(`tools/provision/lib/firebase.js`).

**Gated paths** (`studentAccessOk()` / `selfAccessOk()`):

| Path | Before | After |
|---|---|---|
| `users/{self}` get | self | self **and gate** (admin unchanged) |
| `users/{self}` update (profile or withdrawal) | self | self **and gate** |
| `users/{self}/transactions` get/list | self | self **and gate** |
| `users/{self}/transactions` create (withdrawal) | self | self **and gate** |
| `meta/committee` get / create | any signed-in account | **gate** |
| `legacyAuthorizations/{email}` | (none) | admin read only; no client write |

Admin paths are unchanged: user list and any profile or ledger read, job credit and
reversal, reconciliation, the legacy `/transactions` audit read. `isAdmin()` does **not**
check email verification. The existing admin account is preserved as it is, and an admin
check added without verifying that account could lock the owner out (see residual 5).
`selfAccessOk()` keeps an admin's own self-access as it was.

**Tests.**
* `firebase/test/rules.test.js` §14 (22 scenarios): held legacy accounts have no read or
  write of the profile, ledger, committee or jobs, no withdrawal by any shape, no
  self-authorization. A look-alike domain stays held, and revoking, a missing
  `authorized` field, or another email's authorization keeps the account held.
* `firebase/test/rules.test.js` §15 (10 scenarios): a synthetic account with **no profile**
  reads no committee balance, no other student, no roster, no ledger; creates no
  financial transaction; changes no balance. A profile with role `guest`, or with no
  `role`, gets nothing. An **unverified** email gets nothing, even with a valid profile,
  and so does an unverified legacy authorization. A legacy authorization with **no
  profile** gets nothing. The legitimate paths still work: a pre-authorized, verified
  username student reads its profile, the committee and its ledger, and withdraws; an
  authorized legacy student keeps access; admin keeps every admin read.
* `tools/provision/test/emulator.test.js` §6b (E2E, real ID tokens): the Auth emulator
  issues ID tokens, and the suite reads through the Firestore emulator REST API with
  `Authorization: Bearer <token>`, so the rules judge the real `email_verified` claim.
  It checks: a provisioned username student reads its own profile and the committee and
  is denied another student's profile; an unprovisioned account is denied the committee
  and profiles; a pre-authorized profile whose email is unverified is denied; the held
  legacy account is denied its own profile and the committee; the admin keeps its access.

**Residuals (honest list).**
1. **Not in force until deployed.** The live project still runs its existing ruleset.
   Until the gated deploy (runbook §8 step 7), held accounts keep their current access.
2. **Owner decision needed before deploy.** Any real-email account without an
   authorization document is denied as soon as the rules are live. That includes
   unmatched former students as well as held ones. Each account the owner wants to keep
   needs an authorization document first.
3. **Rollback re-opens held accounts.** Restoring the previous rules removes the gate.
4. **Pre-deploy data checks.** The gate needs every username account to be email-verified
   and every username profile to have `role: 'student'`. Accounts created by the tool
   satisfy both. A console-created account, or a profile without a `role` field, would
   lose access on deploy. Check both before step 7 (runbook §8). The check is read-only:
   `firebase auth:export` to a file **outside the repository**, then delete the file,
   because it contains password hashes.
5. **The admin account is not verification-gated.** `isAdmin()` is unchanged. Adding the
   same verified-email check to admin is a reasonable follow-up, but only after the owner
   confirms the admin Auth account is verified. Otherwise the owner could be locked out.
6. **Username regex is looser than the app's.** The rules accept leading, trailing or
   doubled separators (for example `a..b`) that `mobile/src/identity.js` never issues. That
   is not a bypass, because only accounts already on the synthetic domain can match. The
   app's exact form needs no lookahead, so the rules could use it:
   `^[a-z0-9]+([._-][a-z0-9]+)*@students[.]jkss-fund[.]invalid$`. Changing it is a separate
   change, and it needs a check of existing usernames first.
7. **Removed students keep their access.** A tombstoned (`removedAt`) student still reads
   its own balance and can withdraw. This is the existing behaviour, and the gate does not
   change it. It is a policy question for the owner.

### 3.3 Schema / data-model changes

- Money: integer **paise** fields (`balancePaise`, `amountPaise`,
  `committeeSharePaise`, `studentSharePaise`) are authoritative; rupee floats
  are display mirrors (legacy compat: `paiseOf()` reads either shape).
- Ledger: per-user subcollection `users/{email}/transactions` (the legacy
  top-level `transactions` collection becomes admin-read-only audit).
- **Jobs**: `allocations` is a **map `{email: amountPaise}`** (was a list of
  `{email, index, amountPaise}`); new fields `status` (`active`/`archived`/
  `reversed`) and `reversedAt`; `perStudent` (display) = the minimum
  allocation value.
- **Committee doc** gains `lastJobId` / `reversedJobId` (written only inside
  job batches; audit of the last financial operation).
- **Canonical txn IDs**: earning = `earn_{jobId}_{email}`, reversal =
  `rev_{jobId}_{email}` (rule-reconstructed, string-only). Withdrawal =
  `w_{email}_{txnSeq}`, **client-deterministic** and verified
  bidirectionally: the user write carries `withdrawalTxnId` (string), the
  txn doc carries `seq` (int) — required because this rules engine has no
  int→string conversion (v3.5.2; see §3.0a).
- **User docs** carry `txnSeq` (withdrawal counter, always 0 at
  provisioning) and, after a withdrawal, `withdrawalTxnId` (last companion
  id — audit trail).
- Students: `removedAt` tombstone replaces hard deletion.
- No new indexes required (all queries single-field).

### 3.4 What the rules provably guarantee (and the honest residuals)

Provable from the rules alone: no role/balance self-modification; no
privilege escalation; read isolation; every balance movement is inside a
verified atomic batch with an immutable ledger entry; withdrawals cannot
overdraw or go negative and **stale replays are rejected** (delta computed
against the live document); job credits match stored allocations with exact
committee accounting; reversals replay **original** allocations; no
double-reversal (the job must not already be tombstoned and the second
batch's checks fail); legacy jobs cannot be auto-reversed; no unknown-path
writes.

Residuals (consequences of the language limits, all bounded, all
admin-trust-root or cosmetic):

1. **Allocation-sum bound, not equality.** The rules can check every
   allocation value is `base` or `base+1` (so the sum deviates from the pool
   by **at most `studentCount` paise** — i.e. < ₹1 for a roster under 100)
   but cannot count how many values are `base+1` (no `filter`). The app's
   largest-remainder builder is exact and unit/fuzz-tested; a *malicious*
   admin could at most skew a job's student pool by < ₹1. (A `set`-based
   multiset equality was considered; sets deduplicate, so it cannot count.)
2. **Batch completeness is per-student, not global.** Each student's
   credit/debit is fully verified against the job, but the `/jobs` rule
   cannot verify that *every* allocation has a companion write (no
   iteration). A partial credit batch is still rejected in practice because
   the missing student's *own* rule branch fails for the present writes…
   precisely: a student whose write is missing simply is not credited (no
   money movement for them); a student whose write is *extra* (not in the
   allocations) is denied. So a malformed batch can only **under-allocate**
   (the fund retains the difference, detectable by auditing the job's
   allocations against the ledger), never over-allocate.
3. **The admin token is the trust root** (see §7.2).
4. **The held-account gate depends on the deployed ruleset** (§3.2a). Until the gated
   deploy, held real-email accounts keep their current access in the live project.

---

## 4. Tests — what was executed and results

> **v3.0 update:** the suite grew from 75 to **89 scenarios** and five new Node
> suites were added; the *current* results (CI runs, exact numbers) are in
> **§11.2**, and the exact commands in §5. Everything below is the
> security/accounting release's record, kept as history.

### 4.1 Executed in this environment (Node, real code, real results)

**`mobile/test/accounting.test.js` — 31/31 PASSED**
```
cd mobile && node test/accounting.test.js
  → 31 passed, 0 failed
```
Covers: rupee↔paise conversion incl. float-drift cases, legacy-doc reads,
committee floor semantics, sum-exactness of every split, largest-remainder
distribution shapes (now over the on-disk **map** format), zero-pool/
empty-roster edges, determinism, and **100,000 randomized invariants**
(allocations always sum exactly to the pool; `base+1` count always equals the
remainder) plus a **1,000-job no-drift fuzz** (total liability == total pool).

**`mobile/test/api.mock.test.js` — 22/22 PASSED**
(the *real* `mobile/src/api.js` — loaded and executed — against an
in-memory Firestore with true transaction semantics, including commit-time
failure/rollback):
```
cd mobile && node test/api.mock.test.js
  → 22 passed, 0 failed
```
Covers: ₹1000 and ₹999.99 job splits exact to the paisa (map allocations
sum-exact); tiny pools (₹1.00 → 30/30/30; ₹10.05 over 4 → 227/226/226/226);
duplicate job ID rejected; tombstone removal preserves liability + ledger;
post-removal splits exclude the removed student; **job reversal replays
original allocations after roster change** (removed student debited, later
joiner untouched, committee credited back, reversal txns written, **job
tombstoned not deleted**); re-reversal refused (`already reversed`);
withdrawal paise-exact with ledger entry; over-balance rejected;
full-balance → exactly zero; **idempotency key debits exactly once on retry**;
removed student's negative liability after original-allocation reversal;
legacy job reversal refused with zero mutation; **failed transaction leaves
NO partial state**; `ensureProfile`/`ensureCommittee` semantics.

> Scope note: the mock verifies the app-side orchestration and math. It is
> not the Firestore engine — rules-level enforcement is covered by 4.2.

### 4.2 Executed in CI — the production rules engine

**`firebase/test/rules.test.js` — 75 scenarios, official
`@firebase/rules-unit-testing` against the real Firestore emulator
(cloud-firestore-emulator, production rules engine v1.22.0).** This sandbox
has no Java runtime, so the suite is executed in **GitHub Actions**
(`.github/workflows/firestore-rules.yml`, triggered on every push to this
branch): the job installs Java 21 + firebase-tools, starts a throwaway
emulator with project `jkss-fund-local` (never the production project),
loads `firebase/firestore.rules`, and runs the suite; the full output is
published on the job.

**Latest result (commit `3cbe1da`, run `38704744622`):** **75 passed,
0 failed** — job conclusion `success`, 0 failure annotations. The run
before it (`d1071b7`, `38703715491`) was 71 passed / 4 failed, all four
legitimate-withdrawal batches dying on `Function not found error:
Name: [toString]` — which is what motivated the v3.5.2 bidirectional lock.

**How to read the results:** check the branch's Actions runs — the
"Rules unit tests (emulator)" job is green when the last line is
`75 passed, 0 failed`. The job also emits a `rules-output` annotation with
the full captured output on any failure.

```bash
# Or locally, on any machine with Java 21+ and Node 18+ (throwaway emulator):
cd firebase
npm ci
firebase emulators:exec --project jkss-fund-local --only firestore "node test/rules.test.js"
```

Scenario coverage (the 10+ required by the task, plus the v3.5 protocol
invariants) — **75 scenarios, all passing in the latest CI run**:
1. **Pre-authorization**: student self-create denied (plain, admin-role, non-zero balance, someone-else's email, extra fields); role/balance self-modification denied ✔
2. Read isolation: no cross-student profile/ledger reads; unauthenticated: no reads, no profile/job creation, no legacy ledger, no unknown paths ✔
3. Student cannot create jobs, change committee, or write unknown paths ✔
4. **Withdrawal protocol**: legitimate atomic pair allowed; WITHOUT companion txn denied; amount/delta mismatch denied; negative final denied; **stale replay (double spend) denied**; extra companion txn denied; **detached balance write (no named txn) denied**; **txn-only write (no user write) denied**; bundled profile/role edits denied ✔
5. Sequential withdrawals cannot overdraw (the second one is denied live) ✔
6. Job reversal replays **original** allocations after roster changes; recalculated/wrong amounts denied; missing txn/committee/tombstone denied; **double-reversal denied** (getAfter status check); legacy job denied; job **deletion always denied** ✔
7. Job creation: valid 10/90 split allowed; wrong split, wrong allocation count, non-base+1 values, list-format allocations denied ✔
8. Rounding creates/loses no money (committee floor; base/base+1 bound; skewed-but-summing allocations denied) ✔
9. Failed/partial ops leave no inconsistent state (every incomplete batch denied atomically) ✔
10. Admin legitimate ops succeed (provision students/admins at zero, rename/tombstone, valid job credit batch, status update, valid reversal, removed-student negative liability) ✔
11. Committee references: dangling/missing/wrong `lastJobId`/`reversedJobId` all denied ✔
12. Canonical txn IDs enforced (`earn_{jobId}_{email}`, `rev_{jobId}_{email}`, `w_{email}_{seq}` + the bidirectional lock) ✔

---

## 5. Exact commands

### Run the tests
```bash
# --- v3.0 suites (any machine with Node 18+, no Java needed) ---
cd mobile
node test/identity.test.js       # 63 passed, 0 failed  username ↔ identifier mapping
node test/accounting.test.js     # 31 passed, 0 failed  paise math
node test/api.mock.test.js       # 37 passed, 0 failed  data layer + username login

cd tools/provision
node test/plan.test.js           # 51 passed, 0 failed  roster/mapping/migration/hold/frozen (D-1)/docs-vs-CLI
node test/apply.test.js          # 4 passed, 0 failed   D-1 through the real apply path (Firebase stubbed)
node test/passwords.test.js      # 15 passed, 0 failed  CSPRNG + credentials file

# --- emulator suites (need Java 21+; throwaway emulators, no production access) ---
cd firebase
npm ci
firebase emulators:exec --project jkss-fund-local --only firestore "node test/rules.test.js"
#   → 121 passed, 0 failed
firebase emulators:exec --project jkss-fund-e2e --only firestore,auth \
  "node ../tools/provision/test/emulator.test.js"
#   → 31 passed, 0 failed  (real accounts created/signed-in/deleted in the emulator)

# --- provisioning dry run (no credentials, prints the 24-row mapping) ---
#   No --project/--credentials means a pure-offline plan: nothing is read from or
#   written to Firebase; the only side effect is a local 0600 report file under
#   tools/provision/reports/ (git-ignored).
node tools/provision/provision.js plan
```
CI runs the same on every push: `.github/workflows/firestore-rules.yml`
(rules suite + accounting/identity/api suites) and
`.github/workflows/username-login.yml` (node suites + the provisioning E2E job).
Both jobs fail unless the output ends with `N passed, 0 failed`.

### Deploy the rules — gated, last (see `docs/USERNAME_LOGIN.md` §8, step 7)

> Deploying the rules is **not** part of merging this PR or of setting up username
> login. It happens once, in the order given in the runbook §8, after the admin
> profile check (step 5) and the `txnSeq` backfill (step 6). The command is shown here
> for reference only. Do not run it earlier. Deploying also turns on the held-account gate
> (§3.2a): real-email accounts are denied unless an owner-created authorization document exists.
```bash
cd firebase
firebase deploy --only firestore --project jkss-fund   # runbook §8 step 7 only
```

---

## 6. Firebase Console checklist (Spark plan — no billing changes)

1. **Authentication**
   - [ ] Email/Password enabled; admin user created (email + password).
   - [ ] (For Google sign-in — currently **not configured**, see §9.) Add an
     **OAuth 2.0 Client ID of type Android** for package `com.jkssfund.app`
     (with the app's SHA-1) and a Web client ID in the Google Cloud console,
     then put the real IDs in `mobile/src/config.js` +
     `mobile/app.json → extra.googleWebClientId`. The app automatically shows
     the Google button once real IDs are set.
2. **Firestore** (production mode — no changes needed for Spark; quotas are ample for a small fund)
   - [ ] `users` collection: create the first admin document (ID = lowercase admin email; `email`, `role: "admin"`, `full_name`, `avatar: ""`, `balancePaise: 0`, `balance: 0`). This must exist **before** the rules deploy (the bootstrap chicken-and-egg: only an admin can create admins, and no update path can grant the role).
   - [ ] Do **not** pre-create `meta/committee` — the app bootstraps it at zero.
   - [ ] Legacy data (if any): leave the old top-level `transactions` collection in place (admin-read-only). Old `users/{id}` docs with non-email IDs or float-only balances: migrate to lowercase-email IDs **before** deploying (the rules do not validate ID format; a legacy document with a non-email ID is unreachable to any student, because students can read only `users/<their own auth email>`, and it stays visible to the admin) and add `balancePaise = round(balance*100)`. **Also add `txnSeq: 0` to every existing user doc** (v3.5.2: the withdrawal counter is required on every user write — a doc without it cannot be the subject of a verified withdrawal/credit/reversal batch until it has `txnSeq: 0`). Old `jobs` without map `allocations`: leave them — the app refuses auto-reversal and flags them for manual reconciliation; note that v3.2 jobs use the **map** format, so mixed v3.1 list-format jobs cannot be reversed automatically either.
   - [ ] **Admin profile**: the existing production admin doc uses ID `thrikkakarajkss` but its `email` field is `thrikkakarajkss@gmail.com`. The v3.5 rules resolve admin via the **doc ID == auth email**, so a sign-in as the existing account looks up `users/thrikkakarajkss@gmail.com` and finds nothing → the admin would be locked out of the admin dashboard after deploy. Do **not** delete or recreate the existing Firebase Auth account. Follow the safe reversible migration in **§10** (create the correctly-IDed doc, keep the old one). This must be done in the console (owner privileges bypass rules) **before** the rules deploy (runbook §8 step 5).
3. **Deploy** (gated — runbook §8 step 7; do not start until its prerequisites are ticked)
   - [ ] Prerequisites in `docs/USERNAME_LOGIN.md` §8 step 7 are all ticked, including the admin-profile check (step 5) and the `txnSeq` backfill (step 6).
   - [ ] `firebase deploy --only firestore --project jkss-fund` (rules + indexes), run from a clean checkout of the merge commit.
   - [ ] Verify in the console: the Rules tab shows the new release; the Indexes tab shows no new composite index required.
4. **Smoke-test on a device/emulator** (app pointed at the project)
   - [ ] Admin signs in → dashboard loads, committee bootstrap at zero.
   - [ ] Add a student (email) → student signs in → profile auto-created (student, ₹0).
   - [ ] Admin adds a job (e.g. ₹100) → committee shows ₹10, students' ledgers show the split; `lastJobId` recorded on the committee doc.
   - [ ] Student withdraws part of the balance → ledger shows the withdrawal; balance updates live; a duplicate/replayed withdrawal is rejected.
   - [ ] Remove a student → tombstone (ledger retained); new jobs don't include them.
   - [ ] Reverse a test job → original allocations reversed; **job kept as `status: 'reversed'`**; ledger shows reversal entries; committee credited back.
5. **Nothing else** — no iOS project, no Hosting, no Cloud Functions, no billing changes.

---

## 7. Assessment — safe for testing vs ready for real funds

**Safe for testing: YES** — the CI rules suite is currently **green**
(commit `3cbe1da`, run `38704744622`: 75/75, see §4.2). The ruleset is
defense-in-depth (least privilege, batch-validated financial writes, no
catch-alls, engine-verified constructs only), the accounting is exact-integer
with independently re-derived invariants, and the app flows are transactional
with idempotency. **Two console prerequisites precede any real-data use:
the admin-profile migration (§10) and, if Google sign-in is wanted, the
OAuth checklist (§9.3/§10.3).**

**Ready for real funds: NO — not yet, and not fully achievable on Spark.**
Remaining risks:

1. **CI is the only place the rules suite executes** (no Java in this
   sandbox). Treat any commit without a green "Rules unit tests (emulator)"
   job as unverified — do not deploy rules from such a commit.
2. **No server-side (Cloud Functions) enforcement.** The standard "real
   funds" hardening is a trusted function path: a single audited code path
   that does the math, enforces invariants, and writes the ledger — with the
   client rules as a backstop. Functions on Spark (2nd gen, monthly free
   tier) do **not** require billing, but wiring them changes the app's write
   paths and was outside the approved scope. **Residual risk while functions
   are absent:** a compromised/malicious **admin** token can still perform
   rule-valid financial operations (bounded by §3.4.1–3.2: exact amounts
   tied to stored allocations, committee accounting, < ₹1 pool skew per
   job, under-allocation only). Mitigations on Spark: 1–2 admin accounts,
   password rotation, regular ledger audits (every change has a txn record),
   reconcile withdrawals with the actual bank/payments manually.
3. **Client-token withdrawals** are self-service and balance-bounded
   (cannot overdraw, cannot go negative, always ledgered, stale replays
   rejected) — appropriate for students withdrawing their own credited
   earnings. If "withdrawal" ever means *payout to a third party*, it must
   move to a trusted flow (function + manual approval).
4. **Admins can allocate to any user doc** (amounts and atomicity are
   validated, roster membership is not) — a compromised admin could credit
   an arbitrary email that has a user doc. Small-fund risk; noted for
   completeness.
5. **Timestamps**: `createdAt`/`reversedAt` are server timestamps;
   same-millisecond ordering is arbitrary — cosmetic only.
6. **Quotas (Spark)**: Firestore free tier (50k reads / 50k writes / 20k
   deletes per day, 1 GiB) is fine for ≤24 students; heavy real-time
   dashboard use by many devices is the first thing to watch.

**Bottom line:** deploy for **testing** once CI is green; treat the fund as a
**bookkeeping system of record** (reconcile withdrawals with your actual
bank/payments manually) until the Cloud Functions trusted-path upgrade is
done. Do not describe the system as production-grade for unattended
real-money movement on the current architecture.

---

## 8. Unimplemented / deferred items (honest list)

- **Cloud Functions trusted balance operations** — assessed (§7.2); not
  implemented (scope: Spark-compatible changes only, no billing changes).
  Safest Spark-compatible approach if/when desired: an `https` function for
  withdrawals + an on-write `firestore` function that re-validates
  invariants (and can roll back via a compensation txn) — both fit the Spark
  free tier.
- **Rules-language collection iteration** (`filter`/`map`/lambdas) does not
  exist in the classic language — the §3.4 residuals are the direct
  consequence, bounded and documented. (Firebase has been experimenting with
  a newer rules language in preview; adopting it would allow exact
  sum-equality checks, but it is not what the current emulator/deployment
  path compiles.)
- **Role change for existing users** — intentionally impossible by design
  (no escalation path). Demoting an admin requires console access (owner
  privileges bypass rules).
- **Automatic migration of legacy docs** — not automated (no data
  modification without approval). Manual steps in §6.2 (incl. the v3.5.2
  `txnSeq: 0` backfill).
- **Admin profile migration** — the existing production admin doc
  (ID `thrikkakarajkss` vs email `thrikkakarajkss@gmail.com`) needs a
  correctly-IDed companion doc before the v3.5 rules go live. **Not done**
  (no production data modification without approval); exact reversible
  console steps in **§10**.
- **Google sign-in** — **removed in v3.0** (students sign in with a username;
  no student Google account is needed). The project's `google-services.json`
  ships with `oauth_client: []`, the `@react-native-google-signin/google-signin`
  dependency and the `app.json` client-id placeholder are gone, and no code
  reads them. Restoring Google sign-in would mean re-adding all three (§10.3 is
  the historical checklist).
- **Legacy web app + API — ARCHIVED** to `archive/legacy-express-web/`. The code
  no longer seeds `admin`/`admin123` and refuses to start without `JWT_SECRET`
  (≥ 32 chars); `archive/legacy-express-web/test/legacy-hardening.test.js` is in CI.
  A copy deployed from the OLD code is not changed by the repository and must be
  checked by the owner (`DEPLOY.md` → Legacy section).
- **Repository hygiene — resolved.** The six stray root files were archived
  (`root-snapshots/`), except `app. jsx`, which was byte-identical to `app` and was
  removed. The superseded snapshots had their default credentials redacted; the
  originals are at base commit `0f362d9`.
- **Real-email legacy profiles — ON HOLD (owner decision, Option B).** Students
  whose existing profile is matched are held: no account is created, no password
  is reset, no record is migrated, until each is reviewed (`docs/USERNAME_LOGIN.md`
  §7.2). An explicit `"hold": true` + `"holdReason"` in `roster.json` blocks
  creation even without a legacy profile.
  **Enforced by the rules (§3.2a)** after the gated deploy: a held real-email account
  reads and writes no financial data. Until that deploy, the live project still runs its
  existing rules and held accounts keep their current access.
  **Frozen (decision D-1):** a held legacy profile, a profile keyed to a student who
  is not being created, and an ambiguous candidate are never backfilled with
  `txnSeq: 0`; `apply` enforces this before any write. Residual risk: this is a tool guard. The rules gate (§3.2a) separately stops a held account's own access, but only once the gated deploy has happened.
- **iOS / Hosting** — out of scope per the task.
- **`removedAt` tombstones are never un-set** — re-adding a removed student
  requires a fresh identity (or console edit). Product decision.
- **Un-reversing a tombstoned job** — not supported (would require
  re-crediting + compensation txns + committee re-charge; console-only
  remedy while it exists).

---

## 9. Configuration verification (app.json · .firebaserc · OAuth)

Requested checks, with results:

### 9.1 `mobile/app.json`
- `android.package` = `com.jkssfund.app` ✔ (matches the requirement and the
  `package_name` in `google-services.json`) — kept unchanged.
- `expo.plugins` = `["@react-native-firebase/app"]` ✔ — the Expo config
  plugin auto-registers the `com.google.gms.google-services` Gradle plugin
  and the BoM, so no manual `android/` Gradle edits are needed (the
  Firebase console's "Add Firebase to your app" Gradle steps apply to bare
  native projects only).
- `ios.bundleIdentifier` = `com.jkssfund.app` — present but **out of scope**
  (no iOS work per the task); harmless.
- `extra.googleWebClientId` — **removed in v3.0** together with the Google
  Sign-In button and the `@react-native-google-signin/google-signin`
  dependency (§11). `expo.extra` no longer exists; nothing reads it.
- No secrets, no service-account data ✔.

### 9.2 `firebase/.firebaserc`
- Was: `"default": "YOUR_FIREBASE_PROJECT_ID"` — **invalid** (uppercase);
  `firebase emulators:exec` refuses to start with it ("Project id must be
  all lowercase"). This was the first CI blocker.
- Now: `"default": "jkss-fund"` — verified against the real
  `google-services.json` (`project_info.project_id = "jkss-fund"`).
- Emulator runs in CI always pass `--project jkss-fund-local` explicitly
  (a valid lowercase id that cannot collide with the production project —
  the emulator is local-only and never contacts it).
- Deploying: `firebase deploy --only firestore --project jkss-fund`
  (or `firebase use <project>` first) — the default now already points at
  the right project.

### 9.3 OAuth configuration (`google-services.json` ↔ app)

> **v3.0 note:** Google Sign-In was removed from the app (the project never had
> OAuth clients, and students must not need a Google account). Everything below
> is the historical verification record; the checklist in §10.3 is kept only in
> case Google sign-in is ever wanted again. Student login is now
> username/password — see §11 and `docs/USERNAME_LOGIN.md`.
- `mobile/google-services.json` = the **real config for project `jkss-fund`**
  (project number `753895495162`), Android client for `com.jkssfund.app` ✔.
  The `api_key` inside is a standard *client* key (meant to ship in the app;
  it is not a service-account secret). Recommendation: restrict it in the
  console to Android apps with the app's SHA-1 (Firebase does this
  automatically when the client is created via the console).
- **`oauth_client: []` — empty.** No OAuth 2.0 client IDs exist for this
  project yet, so Google Sign-In **cannot work until** an Android OAuth
  client (package `com.jkssfund.app` + SHA-1) and a Web client ID are
  created in the Google Cloud console (Identity → Sign-in method / APIs &
  Services → Credentials).
- `mobile/src/config.js` previously shipped the placeholders
  `YOUR_GOOGLE_WEB_CLIENT_ID…` / `YOUR_GOOGLE_ANDROID_CLIENT_ID…`;
  `GoogleSignin.configure()` was called with them unconditionally.
  **Fixed:** `GOOGLE_SIGNIN_CONFIGURED` is true only when both IDs are real;
  `AuthContext` configures Google Sign-In only then, and `LoginScreen` hides
  the Google button (with an explanatory note) otherwise. Email/password
  sign-in works in all cases — so the app is fully usable today, and the
  Google button appears automatically once real IDs are pasted in.
- Nothing in `config.js`/`app.json` contains real secrets ✔ (placeholders
  only, and the only credential-adjacent value in the repo is the standard
  client API key inside `google-services.json`).

---

## 10. Manual console actions required (reversible, no approval-grabbing)

These are the only things that cannot be done from this repository. They are
ordered so that nothing is irreversible, and nothing modifies or deletes the
existing admin Firebase Auth account or the old admin document.

### 10.1 Admin profile migration (reversible) — do this BEFORE the rules deploy

> Order: runbook §8 step 5 (verify) and step 7 (deploy). If the admin document is
> missing when the rules go live, the admin is locked out.

**Why:** the v3.5 rules resolve "is this user an admin" as
`exists(users/{auth.email}) && users/{auth.email}.data.role == 'admin'`. The
existing production admin document has **ID `thrikkakarajkss`** but its
`email` field is `thrikkakarajkss@gmail.com`. A sign-in as the existing
account presents `auth.email = thrikkakarajkss@gmail.com`, so the rule looks
up `users/thrikkakarajkss@gmail.com` — which does not exist — and the admin
would be locked out of every admin operation (including the pre-authorization
of students) once the new rules are live.

**Do (console, owner credentials — console writes bypass rules):**
1. Open **Firestore → `users`** collection. Open the document
   `thrikkakarajkss`. Note its **full field set** (email, role, full_name,
   avatar, balancePaise, balance, and anything else — including
   `removedAt`/`lastActiveAt` if present).
2. Create a **new** document in `users` with ID exactly
   `thrikkakarajkss@gmail.com` (the lowercase auth email — must match the
   Firebase Auth account's email character-for-character).
3. Copy **every field** from the old document into the new one, **except**
   ensure:
   - `email` = `thrikkakarajkss@gmail.com` (the doc ID),
   - `role` = `admin`,
   - `txnSeq` = `0` (required by the v3.5.2 protocol; if the old doc has no
     `txnSeq`, add it — this is the only field you add),
   - balances: keep the old doc's `balancePaise`/`balance` values **exactly
     as they are** (an admin's balance is normally 0; if it is non-zero,
     keep it — the rules never move it).
4. **Do not delete, edit, or move the old `thrikkakarajkss` document.** It
   becomes an inert archive (nothing in the rules or app references that ID
   anymore, so it can no longer grant anything).

**Verify (no production financial data touched):**
- In the app, sign in with the existing admin email/password  → the admin dashboard opens, the student list loads, and
  "add student" (pre-authorization) works.
- If anything looks wrong, **revert** by deleting the new
  `users/thrikkakarajkss@gmail.com` document only. The old document and the
  Auth account were never touched, so the system returns exactly to its
  pre-migration state. (The only irreversible-looking step is the delete
  used to revert, which removes a doc you just created.)

**Constraints honored:** the existing Firebase Auth account is not deleted,
recreated, or password-reset; no production document is deleted; the old
admin doc is preserved; no credentials are exposed or stored in the repo; the
migration is a pure console operation the owner can repeat or undo.

### 10.2 Student pre-authorization (ongoing, in-app)

With the rules live, the admin adds a student **by username** in the app (Students
screen → add student). The app writes `users/<username>@students.jkss-fund.invalid`
in exactly the shape the rules allow (`addStudent` in `mobile/src/api.js`): role
`student`, zero balances, `txnSeq: 0`, no other data. That document is the only way a
student gets a profile. A student who signs in with a username but has no such document
is signed in normally, sees the "awaiting admin authorization" screen, and **cannot**
open the student dashboard. No profile is ever created from a student's own sign-in.

### 10.3 Google Sign-In — exact Google Cloud Console checklist

Re-checked against the repo: `mobile/google-services.json` is the **real**
config for project `jkss-fund` (project number `753895495162`, package
`com.jkssfund.app`), but its `oauth_client` array is **empty**, and
`mobile/app.json → extra.googleWebClientId` is still a placeholder. The app
deliberately hides the Google button until real IDs exist (email/password
works regardless). To enable Google Sign-In, do exactly this in the **Google
Cloud console** for project `jkss-fund` (you must not create duplicate
clients — check existing credentials first):

1. **Android OAuth client (required for the native app).**
   - Go to **APIs & Services → Credentials → Create credentials → OAuth
     client ID → Android**.
   - Name: e.g. `JKSS-FUND Android`.
   - Package name: `com.jkssfund.app` (must match exactly).
   - SHA-1 fingerprint(s): the SHA-1 of the certificate that will sign the
     app.
       - **Debug builds** (Expo development build / local `expo prebuild` +
         gradle): the Android debug keystore's SHA-1. On a machine that has
         built the app:
         `keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android -keypass android`
         (note the `SHA1:` line).
       - **Release APK** (Play/CI-signed): the SHA-1 of the upload/app
         signing key you generate (keep the keystore file safe; it is never
         committed to this repo).
   - This creates an OAuth client ID of the form
     `NNNN.apps.googleusercontent.com`.
2. **Web OAuth client (required by `react-native-google-signin` on the web
   path and by Firebase for the token exchange).**
   - **Create credentials → OAuth client ID → Web application**.
   - Name: e.g. `JKSS-FUND Web`.
   - Authorized JavaScript origins: `http://localhost` (local dev) and your
     production web origin if any (e.g. `https://jkss-fund.web.app` — only
     if you later add Hosting; not required for Android).
   - Copy the resulting Web client ID.
3. **Paste the real IDs into the app** (this is the only repo change the
   OAuth work needs — no code change required):
   - `mobile/app.json → extra.googleWebClientId` = the **Web** client ID.
   - `mobile/src/config.js → GOOGLE_ANDROID_CLIENT_ID` = the **Android**
     client ID (and confirm `GOOGLE_WEB_CLIENT_ID` reads from `app.json`).
   - After this, `GOOGLE_SIGNIN_CONFIGURED` becomes true, `AuthContext`
     configures Google Sign-In, and the Google button appears on the login
     screen.
4. **No other console action is required** — do not add the app again in
   Firebase's "Your apps" (the Android app + `google-services.json` already
   exist and are correct), do not create duplicate OAuth clients, and do not
   enable billing.

> If you prefer Firebase's own UI: **Project settings → Your apps → (the
> Android app) → add the SHA-1/SHA-256 to its signing keys, then re-download
> google-services.json** — the freshly downloaded file will now contain a
> non-empty `oauth_client` array, and you can drop it straight into
> `mobile/google-services.json`. That produces the same Android client as
> step 1.

### 10.4 What you must NOT do (boundaries)

- Do not deploy the rules, change Firebase billing/plan, modify production
  financial data, or delete any document without explicit approval.
- Do not delete/recreate/reset the existing admin Firebase Auth account.
- Do not enable iOS or Firebase Hosting (out of scope).
- Do not commit service-account credentials, private keys, or the release
  signing keystore to this repository.


---

## 11. v3.0 addendum — username/password logins for students

**Goal:** students sign in with an admin-assigned username + password; no student
email address is created or required; the admin keeps the existing Email/Password
account; the completed security and accounting work stays intact.

### 11.1 What is (and is not) different in the security model

| | |
|---|---|
| `firebase/firestore.rules` | **Unchanged by the v3.0 login work** (historical; the held-account and pre-authorization gate changed the rules later, §3.2a). No rule was added, relaxed or removed to make the login work. The rules already resolve identity from `request.auth.token.email`, and a student's auth email *is* the synthetic identifier (below) |
| Student identity | `users/{identifier}` where `identifier = <username>@students.jkss-fund.invalid` — the same string that Firebase Authentication stores as the account's email, the same string used for `users/{id}/transactions/*` and for `jobs/{job}.allocations` keys |
| Admin identity | Unchanged: the existing Auth account; `users/{admin-email}` + the legacy `users/thrikkakarajkss` document. **Both are preserved** — the provisioning tool never matches an admin profile (it is excluded from roster matching) and only ever adds a missing `txnSeq: 0` to any user document |
| Pre-authorization | Unchanged and still the only way in: `allow create: if isAdmin() && newProfileOk(...)`. There is **no self-provisioning path** for a student, which is why an unauthorized sign-in sees only the "awaiting authorization" screen |
| Passwords | Students' passwords live **only** in Firebase Authentication. Nothing stores them in Firestore, and the only local copy is the tool's 0600 credentials file (git-ignored). The app never calls `sendPasswordResetEmail` |
| Why `.invalid` | RFC 2606 reserves the TLD: it can never be registered or delivered to. A reset email addressed to a student identifier therefore cannot reach a third party, and we are not inventing a real address |

### 11.2 New tests (all executed in CI; commands in §5)

**Actual results on branch `arena/883804d8-jkss-fund` after the v3.0 commits:**

| Job | Run | Result |
|---|---|---|
| Rules unit tests (Firestore emulator, production rules engine) | `38717587168` | **SUCCESS — 89 passed, 0 failed** (75 previous + 14 new synthetic-identifier scenarios) |
| Rules unit tests after the held-account gate (commit `cd63dbe`) | `38729530740` | **SUCCESS** — exit 0, so 0 failed of 111 (89 + 22 section-14 held-account scenarios). The printed count was not readable from the sandbox. The job log and artifact are not downloadable from it. |
| Accounting + identity + api orchestration | `38717587168` | SUCCESS — 63 identity + 31 accounting + 37 api/login + 36 provisioning plan + 15 password checks (the plan suite now also proves every command/flag printed in the docs exists in the CLI: 39) |
| Username login (v3.0) → Node suites | `38717587462` | SUCCESS |
| Username login (v3.0) → Provisioning + login E2E (Auth + Firestore emulators, `firebase-admin`) | `38717587462` | **SUCCESS — 31 passed, 0 failed** |

The first CI run of the new suites found three *test-harness* expectations to
correct (one rules assertion that was actually an allowed "read your own missing
profile" call, and two E2E invocation mistakes) — the tool and rules behaviour
were already correct in that run; the annotations made both visible without
touching production.


* `mobile/test/identity.test.js` — normalization, collision rules, injective
  identifier mapping, RFC 2606 domain, password policy, 20k fuzz inputs.
* `mobile/test/api.mock.test.js` (extended) — username login against a stubbed
  Firebase Auth with **real `auth/*` error codes**, identical error text for
  "unknown username" and "wrong password" (no enumeration), invalid input
  rejected before any Auth call, the unauthorized-account gate, and ledger/doc
  IDs all embedding the identifier.
* `tools/provision/test/plan.test.js` / `passwords.test.js` — roster mapping,
  collision determinism, blocking-vs-warning ambiguity handling, held-back
  students, admin-profile preservation, unsafe flags refused, CSPRNG password
  properties, credentials-file permissions and never-overwrite behaviour, plus a
  docs↔code mapping-drift check and a docs↔CLI check (every `provision.js`
  command and `--flag` an admin could copy out of the docs must exist in the
  parser, and `help` must list every accepted flag).
* `firebase/test/rules.test.js` — **89 scenarios** at v3.0 (**121** after the held-account gate and the pre-authorization gate, §3.2a) in the production rules
  engine, including 14 new ones that run the engine with synthetic identifiers
  (pre-authorization, unauthorized lockout, withdrawal/credit/reversal with
  synthetic ids, no-loosening checks).
* `tools/provision/test/emulator.test.js` — end-to-end against the Auth +
  Firestore emulators: dry runs create no Auth user and touch no document, 23 accounts created idempotently,
  the admin account/password and both admin documents preserved, balances and
  ledgers byte-identical, **no plaintext password anywhere in Firestore**,
  valid/invalid password sign-in, an unauthorized account with no profile,
  reset-password, identity migration with a pre-write backup, and the safety
  gates (production `verify-identifier` refused; live writes need
  `--confirm-project`).

### 11.3 Residual risks introduced by v3.0 (honest list)

1. **The identifier is guessable from the roster** (`thangal@…`). It is not a
   secret and is not treated as one: the password is the credential, sign-in
   failures are indistinguishable between "unknown username" and "wrong
   password", and Firestore access still requires the pre-authorized profile.
2. **The temporary-password distribution channel is human.** The credentials
   file is plaintext by necessity (it must be handed out) — mode 0600,
   git-ignored, one password per student, never a shared or name-based one. Move
   it into a password manager and delete it after distribution.
3. **Admin-side resets are a privileged local operation.** Anyone holding the
   service-account key can reset a password. Treat that key like the fund's
   bank credentials; it never belongs in the app or the repo.
4. **`verify-identifier` cannot be run from this sandbox** against a real test
   project (no credentials, and no production project may be touched). The
   command is implemented and exercised against the Auth emulator in CI; the
   real-project preflight remains a manual step (§4.5 of
   `docs/USERNAME_LOGIN.md`) and must be run before bulk creation.
5. **Legacy identities still keyed by a real email** are held. Once the gated deploy is
   done (§3.2a) they are denied all financial access unless the owner has created an
   authorization document for them. The planner keeps them out of creation, so no
   duplicate profile or balance is made. Migrating them carries the *legacy lien* caveat
   documented in `docs/USERNAME_LOGIN.md` §7.4.
