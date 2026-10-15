# JKSS-FUND v3.2 — Security & Financial Accounting Review

Scope: Firebase Auth + Firestore on the **Spark (free) plan**, Android app
(`com.jkssfund.app`, Expo SDK 51 + React Native Firebase). This document is the
record of the vulnerability review, the fixes, the schema changes, the test
results, and the exact steps to run tests and deploy — plus an honest
assessment of what is and is *not* safe for real money.

**Status:** implementation + executable tests complete on branch
`arena/dc657e31-jkss-fund`. The rules suite is **executed in GitHub Actions CI**
(Firestore emulator, production rules engine) — see §4. Rules deployment and
any production data change are **not** done (per the task constraints).

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
| V2 | Any signed-in user could **create a profile with `role: "admin"`** | Anyone becomes admin → full control of the fund | Self-create is **always** `role: "student"`, zero balances, and **only the 7 known fields** (a field allowlist via `keys().hasOnly(...)`); only an existing admin can create an `admin`-role doc, and only **at create** |
| V3 | Any signed-in user could **modify any profile field of any user** — including `role`, `balance`, `balancePaise` | Direct balance inflation, self-admin-ification | Self-update restricted to `full_name`/`avatar`/`lastActiveAt` (or a pure withdrawal pair); admin update restricted to `full_name`/`avatar`/`lastActiveAt`/`removedAt` (or a verified job batch) — **no path exists that edits role or balance manually** |
| V4 | Any signed-in user could **delete any profile** (hard delete) | Erase debt/audit trail; re-create as admin | `allow delete: if false` on `users`; removal is a tombstone (`removedAt`) only, by admins |
| V5 | Any signed-in user could **create/modify/delete jobs** | Pay themselves, rewrite the 10/90 split | Jobs: all operations **admin-only**; create shape-validated; update = `status` toggle or reversal tombstone only; **delete denied entirely** (audit history must survive) |
| V6 | Any signed-in user could **write any field of `meta/committee`** | Inflate/deflate the committee fund | Committee: read for signed-in; create-at-zero for signed-in (zero only, exact fields); **update only by an admin, only inside a job batch** (the batch must contain the job write at the exact key the committee doc references); final balance verified via `getAfter()` by the `/jobs` rules; delete denied |
| V7 | Job creation had **no shape validation** | Record a 50/50 split, a 110% split, arbitrary amounts | `jobShapeOk()` enforces: `committeeSharePaise == floor(amountPaise/10)`, `studentSharePaise == amountPaise − committeeSharePaise`, `studentCount` consistency, `allocations` is a **map** of exactly `studentCount` entries, and **every value is `base` or `base+1`** (the largest-remainder bound, re-derived in rules) |
| V8 | Balance changes had **no atomicity requirement** | Money created out of thin air, un-auditable ledger | Every balance change is legal only inside a verified atomic batch: **withdrawal** = exactly 2 writes (user update + one companion withdrawal txn under `users/{me}/transactions/`), final `balancePaise` integer ≥ 0, txn amount == the exact delta computed against the **live** document; **job credit** = job set + per-student credit + canonical `earn_{jobId}_{email}` txn + committee update carrying `lastJobId`; **job reversal** = job **tombstone** update + original-allocation debits + canonical `rev_{jobId}_{email}` txns + committee credit-back carrying `reversedJobId` |
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

| File | Change |
|------|--------|
| `firebase/firestore.rules` | **Full rewrite (v3.2)** — least-privilege ruleset using only verified language constructs (design in §3); batch protocol with exact-path cross-references; tombstone job reversal |
| `firebase/.firebaserc` | Default project fixed to the real project `jkss-fund` (was the invalid uppercase placeholder `YOUR_FIREBASE_PROJECT_ID`, which made `firebase emulators:exec` refuse to start — project IDs must be lowercase) |
| `firebase/firestore.indexes.json` | Emptied — all app queries are single-field (built-in indexes) |
| `firebase/firebase.json` | Reviewed — unchanged (rules/indexes paths + emulator ports are correct) |
| `firebase/test/rules.test.js` | **New (v3.2 shapes)** — 46-scenario emulator rules test suite (authorized + unauthorized, all required scenarios, plus the new protocol's invariants) |
| `firebase/package.json` (+ lockfile) | **New** — dev deps for the rules suite: `firebase@^10.14.1` (peer of `@firebase/rules-unit-testing@^3.0.4`), lockfile `npm ci`-verified |
| `firebase/README.md` | Updated — v3.2 data model + batch protocol, local testing workflow, deployment notes, `.firebaserc`/project selection |
| `.github/workflows/firestore-rules.yml` | **New** — CI: rules suite in the Firestore emulator (Java 21, emulator-jar cache, project `jkss-fund-local`, full output published as a job annotation) + Node suites for the mobile tests |
| `mobile/src/accounting.js` | **New** — pure paise math; `allocateLargestRemainder` returns the on-disk **map** `{email: paise}`; `assertAllocationsExact` validates the map |
| `mobile/src/api.js` | **Rewritten data layer** — paise-exact; per-user ledger subcollections; job credit/reversal/withdrawal as atomic transactions with **explicit final balances**; canonical txn IDs (`earn_{jobId}_{email}` / `rev_{jobId}_{email}`); committee update carries `lastJobId`/`reversedJobId`; reversal = job **tombstone** (never delete); original-allocation reversals; legacy-job guard; tombstone removal; idempotency keys; fixed `ensureCommittee` (A7) |
| `mobile/test/accounting.test.js` | **New** — 31 executed unit tests of the financial core (incl. 100k fuzz invariants + 1,000-job no-drift fuzz) |
| `mobile/test/api.mock.test.js` | **New** — 21 executed integration tests of the real `api.js` orchestration against a transaction-semantic in-memory Firestore (incl. atomicity-on-failure, idempotent retry, original-allocation reversal after roster change, tombstone re-reversal refusal) |
| `mobile/src/screens/JobsScreen.js` | Reversed jobs shown with a "reversed" badge and excluded from totals; reversal confirm text updated (tombstone, audit record) |
| `mobile/src/screens/StudentsScreen.js` | Removal is a tombstone (copy + confirmation updated); add-student requires a valid email |
| `mobile/src/screens/StudentDashboard.js` | Max-withdrawal chip and over-balance check derived from integer paise; withdrawal result handling |
| `mobile/src/screens/TransactionsScreen.js` | Summary + filters account for `reversal` entries (paise-exact totals) |
| `mobile/src/screens/LoginScreen.js` | Google sign-in button hidden until real OAuth client IDs are configured (see §9) |
| `mobile/src/config.js` | `GOOGLE_SIGNIN_CONFIGURED` flag derived from the client IDs (placeholders detected) |
| `mobile/src/context/AuthContext.js` | `GoogleSignin.configure` called only with real IDs (placeholder IDs would make the native library misbehave); email/password auth unaffected |

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

- Cross-write checks use **exact paths only**: `request.writes.get('jobs/' +
  jobId, null)` style, where the path comes from a **wildcard capture** or a
  **field of a write at a known exact key** (never from iterating unknown keys).
- **`map[key]` on a missing key is an error** (verified in the compiler), so
  all optional lookups use `.get(key, null)` or an `x is not T` guard first.
- The batch's job reference travels in the **committee write**: the committee
  update carries `lastJobId` (credit) or `reversedJobId` (reversal), and the
  committee is always at the exact key `/meta/committee` — so any rule in the
  batch can address the job write and the canonical txn keys without
  iteration.
- Job `allocations` is a **map keyed by email** (`{email: amountPaise}`), so
  "this student's allocation" is `allocations.get(email)` — no list scanning.

### 3.1 Helpers

`signedIn()`, `isEmailId(id)`, `isSelf(email)` (parameterized), `isAdmin()`
(user doc exists **and** `role == 'admin'`), `paiseOf(d)` (`balancePaise` or
legacy `math.round(balance*100)`), `balanceFieldsOnly()` (affected keys ⊆
`{balance, balancePaise}` and include `balancePaise`).

### 3.2 Path-by-path

- **`/users/{email}`**
  - `get`: self or admin · `list`: admin only
  - `create`: self → always `role: 'student'`, `balancePaise == 0`,
    `balance == 0`, `email` field == doc ID, **fields ⊆ the 7 known fields**;
    admin → student or admin role, zero balances, same field allowlist
  - `update` (OR of four exclusive branches):
    1. self profile: affected keys ⊆ `{full_name, avatar, lastActiveAt}`
    2. self **withdrawal**: balance-fields-only, final `balancePaise` integer
       ≥ 0, delta > 0 against the **live** doc, and the batch is **exactly
       2 writes**: this user update + one `set` under
       `users/{me}/transactions/{any}` with `type: 'withdrawal'`,
       `amountPaise == delta` (a stale replayed batch has delta 0 → denied)
    3. admin maintenance: affected keys ⊆ `{full_name, avatar, lastActiveAt,
       removedAt}`
    4. admin **job credit**: balance-fields-only, delta > 0, committee update
       in the batch with `lastJobId == jobId`, job **set** at
       `jobs/{jobId}`, `allocations.get(email) == delta`, canonical
       `earn_{jobId}_{email}` txn in the batch at the same amount
    5. admin **job reversal**: balance-fields-only, delta > 0, committee
       update with `reversedJobId == jobId`, job **tombstone update** in the
       batch, **original** `allocations.get(email) == delta` (via
       `get()`, pre-batch), canonical `rev_{jobId}_{email}` txn; negative
       final allowed only if `removedAt != null`
  - `delete`: **denied for everyone** (tombstone-only removal)
- **`/users/{email}/transactions/{txnId}`** — get/list: self or admin.
  `create`: (a) self withdrawal — exactly the 2-write batch, live delta ==
  amount; (b) admin earning — canonical id `earn_{jobId}_{email}`, job set in
  batch, stored allocation == amount, user write in batch credits exactly
  that amount vs the live doc; (c) admin reversal — canonical id
  `rev_{jobId}_{email}`, job tombstone in batch, **original** stored
  allocation == amount, user write debits exactly that amount.
  `update`/`delete`: **denied for everyone** (immutable ledger).
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
  `rev_{jobId}_{email}`, withdrawal = caller-chosen (idempotency key).
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

---

## 4. Tests — what was executed and results

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

**`mobile/test/api.mock.test.js` — 21/21 PASSED**
(the *real* `mobile/src/api.js` — loaded and executed — against an
in-memory Firestore with true transaction semantics, including commit-time
failure/rollback):
```
cd mobile && node test/api.mock.test.js
  → 21 passed, 0 failed
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

**`firebase/test/rules.test.js` — 46 scenarios, official
`@firebase/rules-unit-testing` against the real Firestore emulator
(cloud-firestore-emulator, production rules engine).** This sandbox has no
Java runtime, so the suite is executed in **GitHub Actions**
(`.github/workflows/firestore-rules.yml`, triggered on every push to this
branch): the job installs Java 21 + firebase-tools, starts a throwaway
emulator with project `jkss-fund-local` (never the production project),
loads `firebase/firestore.rules`, and runs the suite; the full output is
published on the job.

**How to read the results:** check the branch's Actions runs — the
"Rules unit tests (emulator)" job is green when the last line is
`46 passed, 0 failed`. The job also emits a `rules-output` annotation with
the full captured output on any failure.

```bash
# Or locally, on any machine with Java 21+ and Node 18+ (throwaway emulator):
cd firebase
npm ci
firebase emulators:exec --project jkss-fund-local --only firestore "node test/rules.test.js"
```

Scenario coverage (the 10+ required by the task, plus the v3.2 protocol
invariants):
1. Student cannot create an admin profile (self- or extra-fields) ✔
2. Student cannot modify own role/balance (with or without companion txn) ✔
3. Student cannot read another student's profile or ledger ✔
4. Unauthenticated: no reads, no profile/job creation, no legacy ledger, no unknown paths ✔
5. Student cannot create jobs, change committee, or write unknown paths ✔
6. Withdrawal without matching balance reduction denied; mismatched delta denied; negative final denied; **stale replay (double spend) denied**; extra-write batch denied; bundled profile/role edits denied ✔
7. Sequential withdrawals cannot overdraw ✔ (plus live-delta rejection of stale batches)
8. Job reversal replays **original** allocations after roster changes; recalculated/wrong amounts denied; missing txn/committee/tombstone denied; **double-reversal denied**; legacy job denied; job **deletion always denied** ✔
9. Rounding creates/loses no money (committee floor; base/base+1 bound; skewed-but-summing allocations denied; legacy list-format allocations denied) ✔
10. Failed/partial ops leave no inconsistent state (every incomplete batch denied atomically) ✔
11. Admin legitimate ops succeed (provision students/admins, rename/tombstone, valid job credit, status update, valid reversal, removed-student negative liability) ✔
12. Committee references: dangling/missing/wrong `lastJobId`/`reversedJobId` all denied ✔
13. Canonical txn IDs enforced (`earn_{jobId}_{email}`, `rev_{jobId}_{email}`) ✔

---

## 5. Exact commands

### Run the tests
```bash
# Accounting + app-orchestration tests (any machine with Node 18+):
cd mobile
node test/accounting.test.js
node test/api.mock.test.js

# Security rules tests (needs Java 21+; throwaway local emulator, no production access):
cd firebase
npm ci
firebase emulators:exec --project jkss-fund-local --only firestore "node test/rules.test.js"
```
(CI runs the same on every push — see the branch's Actions runs.)

### Deploy the rules (only after the test suite passes and you approve the production change)
```bash
cd firebase
npm i -g firebase-tools
firebase login
firebase use --add            # select the real project (default is jkss-fund)
firebase deploy --only firestore --project jkss-fund
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
   - [ ] Legacy data (if any): leave the old top-level `transactions` collection in place (admin-read-only). Old `users/{id}` docs with non-email IDs or float-only balances: migrate to lowercase-email IDs **before** deploying (the new rules reject non-email IDs) and add `balancePaise = round(balance*100)`. Old `jobs` without map `allocations`: leave them — the app refuses auto-reversal and flags them for manual reconciliation; note that v3.2 jobs use the **map** format, so mixed v3.1 list-format jobs cannot be reversed automatically either.
3. **Deploy**
   - [ ] Confirm the branch's CI run is green (rules suite + Node suites).
   - [ ] `firebase deploy --only firestore` (rules + indexes).
   - [ ] Verify in the console: Rules tab shows the v3.2 ruleset; Indexes tab shows no new composite indexes required.
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

**Safe for testing: YES** — once the CI rules suite is green (see §4.2).
The ruleset is defense-in-depth (least privilege, batch-validated financial
writes, no catch-alls, verified language constructs), the accounting is
exact-integer with independently re-derived invariants, and the app flows are
transactional with idempotency.

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
  modification without approval). Manual steps in §6.2.
- **Google sign-in** — not configurable from this repo: the project's
  `google-services.json` ships with `oauth_client: []` (no OAuth clients
  registered at all), so there are no client IDs to plug in yet. The app is
  built to enable it automatically the moment real IDs land in
  `mobile/src/config.js` (+ `app.json`). See §9.
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
- `extra.googleWebClientId` = `YOUR_GOOGLE_WEB_CLIENT_ID…` — **placeholder**
  (see §9.3); consumed by `config.js`.
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
