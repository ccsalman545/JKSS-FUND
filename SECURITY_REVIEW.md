# JKSS-FUND v3.1 — Security & Financial Accounting Review

Scope: Firebase Auth + Firestore on the **Spark (free) plan**, Android app
(`com.jkssfund.app`, Expo SDK 51 + React Native Firebase). This document is the
record of the vulnerability review, the fixes, the schema changes, the test
results, and the exact steps to run tests and deploy — plus an honest
assessment of what is and is *not* safe for real money.

**Status:** implementation + executable tests complete on branch
`arena/dc657e31-jkss-fund`. Rules deployment and any production data change
are **not** done (per the task constraints) — see the deployment checklist at
the end.

---

## 1. Vulnerability summary (before → after)

### 1.1 Firestore rules (the security boundary)

The old rules file allowed, for any signed-in user, essentially full read/write
on the financial data. Every one of these is closed by the new ruleset
(`firebase/firestore.rules`):

| # | Vulnerability (old rules) | Impact | Fix (new rules) |
|---|---------------------------|--------|-----------------|
| V1 | Any signed-in user could **read/list all profiles** (`users` list for all) | All balances, names, emails exposed to every student | `get` = self or admin; `list` = admin only |
| V2 | Any signed-in user could **create a profile with `role: "admin"`** (self- or other-elevation) | Anyone becomes admin → full control of the fund | Self-create is **always** `role: "student"` with zero balances; only an existing admin can create an `admin`-role doc, and only **at create** |
| V3 | Any signed-in user could **modify any profile field of any user** — including `role`, `balance`, `balancePaise` | Direct balance inflation, self-admin-ification | Self-update restricted to `full_name`/`avatar`/`lastActiveAt` (or an atomic withdrawal pair); admin update restricted to `full_name`/`avatar`/`lastActiveAt`/`removedAt` — **no path exists that edits role or balance manually** |
| V4 | Any signed-in user could **delete any profile** (hard delete) | Erase debt/audit trail; re-create as admin | `allow delete: if false` everywhere on `users`; removal is a tombstone (`removedAt`) only, by admins |
| V5 | Any signed-in user could **create/modify/delete jobs** | Pay themselves, rewrite the 10/90 split | Jobs: read/create/update/delete **admin-only**; create additionally validated (see V7); update = `status` only (`active`/`archived`) |
| V6 | Any signed-in user could **write any field of `meta/committee`** | Inflate/deflate the committee fund | Committee: read for signed-in; create-at-zero for signed-in; **update only inside a job credit/reversal batch, by an admin**, with the final state verified via `getAfter()` |
| V7 | Job creation had **no shape validation** — `committeeShare`/`studentShare`/`perStudent` were client-supplied | Admin (or attacker) could record a 50/50 split, a 110% split, or any arbitrary amounts | `jobShapeOk()` enforces: `committeeSharePaise == floor(amountPaise/10)`, `studentSharePaise == amountPaise − committeeSharePaise`, `studentCount` consistency, and the **exact largest-remainder allocation formula** (base/base+1 distribution — the allocations are provably summing to the pool without needing a `sum()`) |
| V8 | Balance changes had **no atomicity requirement** — a `balance` update without a matching transaction record | Money created out of thin air, un-auditable ledger | Every balance change is legal only inside an atomic write-set: **withdrawal** = `users/{me}` update + exactly one companion withdrawal txn in the same commit, final balance ≥ 0, `txn.amountPaise` == the exact delta; **job credit** = complete job batch (job set + one credit + one earning txn per non-zero allocation + committee update, final committee verified via `getAfter`); **job reversal** = job delete + original-allocation debits + reversal txns + committee credit-back (final state via `getAfter`) |
| V9 | Top-level `transactions` collection was **writable by anyone** / readable by students (depending on version) | Ledger tampering, other students' ledgers leaked | Ledger moved to `users/{email}/transactions` (self or admin only); the legacy top-level collection is **admin-read-only**, all writes denied |
| V10 | No user-document ID validation; email casing not normalized | `Users/A@X.com` vs `users/a@x.com` split-brain profiles; ID injection | `isEmailId()` (lowercase, `@` required, no spaces) is required on every `users/{email}` access; the app normalizes to lowercase on all writes |
| V11 | Permissive fall-through behavior for unknown paths | Undefined surface area | Every path has explicit rules; final `match /{document=**} { allow read, write: if false; }` |

### 1.2 Client-side accounting (the app, `mobile/src/api.js`)

Client code is **never** the security boundary, but the old implementation had
correctness bugs that the new rules would have punished:

| # | Problem (old api.js) | Impact | Fix |
|---|----------------------|--------|-----|
| A1 | **Float rupee math** (`balance * 0.1`, `toFixed(2)`) for splits and balances | Rounding drift: the committee + students could sum to ≠ the job amount (paise created or lost); 0.1+0.2-style errors | All money is **integer paise** end-to-end (`src/accounting.js` — pure, unit-tested). Rupee floats are display mirrors only |
| A2 | 10/90 split computed by rounding each side independently | `committee + students ≠ amount` in edge cases (e.g. ₹999.99) | `splitShares`: committee = `floor(amountPaise/10)`, students = `amountPaise − committee` — **exact by construction** |
| A3 | Per-student split = `pool / n` rounded — the distributed total could differ from the pool | The fund silently loses or gains paise per job | **Largest-remainder allocation**: `base = floor(pool/n)`, first `r = pool − base·n` students get `base+1`. Always sums exactly to the pool (fuzz-tested over 100k random pools/rosters). The rules independently re-derive the formula, so a malicious/buggy client cannot skew it |
| A4 | Job deletion **recalculated against the current roster** | Reversals wrong after students joined/left; removed students' original share never recovered | Jobs store their `allocations` (original split). Deletion **replays the original allocations** with deterministic reversal txn IDs (`rev_{jobId}_{index}`); the rules verify each debit equals the *stored* amount |
| A5 | **No legacy-job guard** — a job without allocation history could be "reversed" by guesswork | Fabricated reversal amounts | `deleteJob` throws `reconcile manually` for jobs lacking `allocations`/paise fields; the rules refuse such deletions |
| A6 | **Student "deletion" was a hard delete** | Destroyed the fund's liability record and the reversal target; the student could re-create the doc as admin under the old rules | Removal = tombstone `removedAt` (admin-only). Balance + ledger preserved; removed students stop receiving new splits but can still be debited by historical reversals (allowed to go negative — the fund's standing liability) |
| A7 | `ensureCommittee` did `set({...0}, {merge:true})` on every launch | **Zeroed the committee fund on every app launch** (the rules now reject the write, but it would have been a constant permission error) | Only creates the doc when missing; never writes an existing balance |
| A8 | Withdrawal was a bare `update` with a separately-written txn (two commits) | Partial-failure window: debit without ledger entry (or vice versa); concurrent withdrawals could overdraw | Single Firestore **transaction**: re-reads live balance (concurrency-safe), debits and writes the ledger entry atomically, with a deterministic idempotency key on the txn doc (retries are no-ops) |
| A9 | Duplicate job processing possible on retry | Double payment | Deterministic job ID + `exists()` check inside the transaction → `This job was already recorded` |
| A10 | No input validation on money entry paths | NaN/negative writes reaching the DB | `toPaise`/`splitShares`/`allocateLargestRemainder` reject non-integer/non-positive inputs (the accounting functions refuse to truncate silently) |

---

## 2. Modified files & why

| File | Change |
|------|--------|
| `firebase/firestore.rules` | **Full rewrite** — least-privilege v3.1 ruleset (design in §3). No permissive catch-alls; every path explicit; atomic-batch validation with `getAfter()` |
| `firebase/firestore.indexes.json` | Emptied — all app queries are single-field (built-in indexes); the old composite index served only the legacy top-level `transactions` collection the app no longer queries |
| `firebase/firebase.json` | Reviewed — unchanged (rules/indexes paths + emulator ports are correct) |
| `firebase/test/rules.test.js` | **New** — 41-scenario emulator rules test suite (authorized + unauthorized, all required scenarios) |
| `firebase/package.json` (+ lockfile) | **New** — dev deps for the rules suite: `@firebase/rules-unit-testing`, `firebase` |
| `firebase/README.md` | Updated — v3.1 data model, admin provisioning with `balancePaise`, rules testing workflow, deployment notes |
| `mobile/src/accounting.js` | **New** — pure paise math (split, largest-remainder allocation, invariants), zero Firebase imports, directly unit-testable in Node |
| `mobile/src/api.js` | **Rewritten data layer** — paise-exact; per-user ledger subcollections; job credit/reversal/withdrawal as atomic transactions; original-allocation reversals; legacy-job guard; tombstone removal; idempotency keys; fixed `ensureCommittee` (A7) |
| `mobile/test/accounting.test.js` | **New** — 30 executed unit tests of the financial core (incl. 300k+ fuzz invariants) |
| `mobile/test/api.mock.test.js` | **New** — 21 executed integration tests of the real `api.js` orchestration against a transaction-semantic in-memory Firestore (incl. atomicity-on-failure, idempotent retry, original-allocation reversal after roster change) |
| `mobile/src/screens/JobsScreen.js` | Delete now surfaces server errors (Alert) instead of silently swallowing them; split preview is paise-exact with a "+₹0.01 to first N students" note |
| `mobile/src/screens/StudentsScreen.js` | Removal is a tombstone (copy + confirmation updated); add-student requires a valid Google email |
| `mobile/src/screens/StudentDashboard.js` | Max-withdrawal chip and over-balance check derived from integer paise (no float drift); withdrawal result handling |
| `mobile/src/screens/TransactionsScreen.js` | Summary + filters account for `reversal` entries (paise-exact totals) |
| `mobile/src/config.js`, `mobile/src/firebase.js`, `mobile/app.json`, `mobile/package.json` | Reviewed — unchanged (package name, Expo SDK, RN Firebase deps, google-services wiring all verified correct; no secrets in `config.js`) |

---

## 3. Final rules design (`firebase/firestore.rules`)

Helpers: `signedIn()`, `selfEmail()`, `isEmailId(id)` (normalized ID check),
`isSelf()`, `isAdmin()` (user doc exists **and** `role == 'admin'`),
`paiseOf(d)` (new/legacy balance read), `theirTxnWrites(stu)` /
`userWrites()` / `jobWrites()` (write-set composition helpers over
`request.writes`).

- **`/users/{email}`**
  - `get`: self or admin · `list`: admin
  - `create`: self → always `role: 'student'`, `balancePaise == 0`, `balance == 0`, `email` field == doc ID; admin → student or admin role, zero balances
  - `update` (OR of four exclusive branches):
    1. self: affected keys ⊆ `{full_name, avatar, lastActiveAt}`
    2. self **withdrawal**: affected keys ⊆ `{full_name, avatar, lastActiveAt, balance, balancePaise}`, final `balancePaise` integer ≥ 0, delta > 0, and the commit contains **exactly one** companion txn for this user with `type: 'withdrawal'`, `amountPaise == delta`
    3. admin maintenance: affected keys ⊆ `{full_name, avatar, lastActiveAt, removedAt}`
    4. admin **job credit**: delta == this user's `allocations` entry in the new job, with matching earning txn in the same batch
    5. admin **job reversal**: delta > 0, matching reversal txn in a job-DELETE batch; negative final allowed only if `removedAt != null`
  - `delete`: **denied for everyone** (tombstone-only removal)
- **`/users/{email}/transactions/{txnId}`** — get/list: self or admin;
  `create`: withdrawal txns only self + own-balance-update companion; earning
  txns only admin + job-set in batch; reversal txns only admin + job-delete in
  batch; `update`/`delete`: **denied for everyone** (immutable ledger)
- **`/jobs/{jobId}`** — admin-only on all operations:
  - `create`: `jobShapeOk` (name/date/amount validation, `committeeSharePaise ==
    floor(amountPaise/10)`, `studentSharePaise == amountPaise −
    committeeSharePaise`, allocation list matches `studentCount`, and the
    **largest-remainder formula** re-derived in rules) + `jobBatchComplete`
    (one credit + one txn per non-zero allocation, committee write present,
    final committee state via `getAfter` reflects exactly the committee share,
    stays ≥ 0)
  - `update`: `status` only, in `{active, archived}`
  - `delete`: only as a complete reversal batch — every **original**
    allocation debited with its canonical `rev_{jobId}_{index}` txn at the
    stored amount, committee credited back (final state via `getAfter`);
    legacy jobs without `allocations`/`amountPaise` are refused
- **`/meta/committee`** — read: signed-in; create: signed-in at zero;
  update: admin with exactly one job write in the batch; delete: denied
- **`/transactions/{txnId}`** (legacy) — read: admin; all writes denied
- **Catch-all** — explicit deny for everything else

### Schema / data-model changes
- Money: integer **paise** fields (`balancePaise`, `amountPaise`,
  `committeeSharePaise`, `studentSharePaise`) are authoritative; rupee floats
  are display mirrors (legacy compat: `paiseOf()` reads either shape).
- Ledger: per-user subcollection `users/{email}/transactions` (replaces the
  top-level `transactions` collection, which becomes admin-read-only audit).
- Jobs: gain `allocations`, paise fields, `studentCount`; `perStudent` becomes
  the first allocation's value (display only).
- Students: `removedAt` tombstone replaces hard deletion.
- No new indexes required (all queries single-field).

---

## 4. Tests — what was executed and results

### 4.1 Executed in this environment (Node, real code, real results)

**`mobile/test/accounting.test.js` — 30/30 PASSED**
(the financial core, `mobile/src/accounting.js`):
```
node test/accounting.test.js
  → 30 passed, 0 failed
```
Covers: rupee↔paise conversion incl. float-drift cases (`0.1+0.2` → 30 paise),
legacy-doc reads, committee floor semantics, sum-exactness of every split,
largest-remainder distribution shapes, zero-pool/empty-roster edges,
determinism, and **300,000+ randomized invariants** (allocations always sum
exactly to the pool; committee + pool always sum exactly to the job amount;
`base+1` count always equals the remainder).

**`mobile/test/api.mock.test.js` — 21/21 PASSED**
(the *real* `mobile/src/api.js` code — loaded, transformed, and executed —
against an in-memory Firestore with true transaction semantics, including
commit-time failure/rollback):
```
node test/api.mock.test.js
  → 21 passed, 0 failed
```
Covers: ₹1000 and ₹999.99 job splits exact to the paisa; tiny pools (₹1.00 →
30/30/30; ₹10.05 over 4 → 227/226/226/226); duplicate job ID rejected;
tombstone removal preserves liability + ledger; post-removal splits exclude the
removed student; **job deletion replays original allocations after roster
change** (removed student debited, later joiner untouched, committee credited
back, reversal txns written, job doc deleted); re-delete refused; withdrawal
paise-exact with ledger entry; over-balance rejected; full-balance → exactly
zero (never negative); **idempotency key debits exactly once on retry**;
removed student's negative liability after original-allocation reversal;
legacy job (no allocation history) deletion refused with zero mutation;
**failed transaction leaves NO partial state**; `ensureProfile`/
`ensureCommittee` semantics incl. "never zero a real committee balance".

> Scope note: the mock verifies the app-side orchestration and math. It is not
> the Firestore engine — rules-level enforcement is covered by 4.2.

### 4.2 NOT executed here — requires the Firestore emulator (Java)

**`firebase/test/rules.test.js` — 41 scenarios, official
`@firebase/rules-unit-testing` against the production rules engine.**
This sandbox has no Java runtime (and no network access to obtain one), so the
emulator cannot run here. **This suite has NOT been executed** — it must be run
on a machine with Java 11+ and Node 18+ before the rules are deployed:

```bash
cd firebase
npm install
firebase emulators:exec --only firestore "node test/rules.test.js"
```

Scenario coverage (the 10+ required by the task, plus more):
1. Student cannot create an admin profile (self- or via admin-create path) ✔ scenario present
2. Student cannot modify own role/balance (with or without companion txn) ✔
3. Student cannot read another student's profile or ledger ✔
4. Unauthenticated user: no reads, no profile/job creation, no legacy ledger ✔
5. Unauthorized (student) user cannot create jobs, change committee, or write unknown paths ✔
6. Withdrawal without matching balance reduction denied; mismatched delta denied; negative final denied ✔
7. Concurrent/sequential withdrawals cannot overdraw ✔ (sequential case; true parallelism is additionally guarded by the transaction + final-state rule check)
8. Job deletion reverses **original** allocations after roster changes; recalculated/wrong amounts denied; legacy job deletion denied ✔
9. Rounding creates/loses no money (committee floor + formula validation; skewed-but-summing allocations denied) ✔
10. Failed/partial ops leave no inconsistent state (every incomplete batch denied atomically) ✔
11. Admin legitimate ops succeed (provision students/admins, rename/tombstone, valid job credit, status update, valid reversal) ✔

---

## 5. Exact commands

### Run the tests
```bash
# Accounting + app-orchestration tests (any machine with Node 18+):
cd mobile
node test/accounting.test.js
node test/api.mock.test.js

# Security rules tests (needs Java 11+; throwaway local emulator, no production access):
cd firebase
npm install
firebase emulators:exec --only firestore "node test/rules.test.js"
```

### Deploy the rules (only after the test suite passes and you approve the production change)
```bash
cd firebase
npm i -g firebase-tools
firebase login
firebase use <your-project-id>
firebase deploy --only firestore
```

---

## 6. Firebase Console checklist (Spark plan — no billing changes)

1. **Authentication**
   - [ ] Google provider enabled; OAuth client for `com.jkssfund.app` registered; web client configured for the sign-in web flow.
   - [ ] Email/Password enabled for the admin account.
   - [ ] Admin user created (email + password).
2. **Firestore** (production mode — no changes needed for Spark; quotas are ample for a small fund)
   - [ ] `users` collection: create the first admin document (ID = lowercase admin email; `email`, `role: "admin"`, `full_name`, `avatar: ""`, `balancePaise: 0`, `balance: 0`).
   - [ ] Do **not** pre-create `meta/committee` — the app bootstraps it at zero.
   - [ ] Legacy data (if any): leave the old top-level `transactions` collection in place (it is now admin-read-only). Old `users/{id}` docs with non-email IDs or float-only balances: the new rules reject accesses to non-email IDs — **migrate any such docs to lowercase-email IDs (or note them as orphaned) before deploying**, and add `balancePaise = round(balance*100)` to each so they remain readable. Old `jobs` without `allocations`: leave them; the app refuses auto-deletion and flags them for manual reconciliation.
3. **Deploy**
   - [ ] Run the rules test suite (§5) and review the output.
   - [ ] `firebase deploy --only firestore` (rules + indexes).
   - [ ] Verify in the console: Rules tab shows the v3.1 ruleset; Indexes tab shows no new composite indexes required.
4. **Smoke-test on a test device / emulator** (with the app pointed at your project)
   - [ ] Admin signs in → dashboard loads, committee bootstrap at zero.
   - [ ] Add a student (Google email) → student signs in → profile auto-created (student, ₹0).
   - [ ] Admin adds a job (e.g. ₹100) → committee shows ₹10, students' ledgers show the split; split preview note matches.
   - [ ] Student withdraws part of the balance → ledger shows the withdrawal; balance updates live.
   - [ ] Remove a student → tombstone (ledger retained); new jobs don't include them.
   - [ ] Delete a test job → original allocations reversed; ledger shows reversal entries.
5. **Nothing else** — no iOS project, no Hosting, no Cloud Functions, no billing changes.

---

## 7. Assessment — safe for testing vs ready for real funds

**Safe for testing: YES.** The ruleset is defense-in-depth (every financial
write is shape- and batch-validated, least privilege, no catch-alls), the
accounting is exact-integer with independently re-derived invariants, and the
app-level flows are transactional with idempotency. The test suites above give
high confidence in the math and orchestration; the rules suite (once executed
with the emulator) closes the loop on the security boundary itself.

**Ready for real funds: NO — not yet, and not fully achievable on Spark.**
Remaining risks that should be understood before real money flows through the
app:

1. **The rules test suite has not been executed** (no Java in this
   environment). Deploying without running it would be deploying an
   unverified security boundary. *Action: run §5 on a Java machine; it is a
   few minutes of work.*
2. **No server-side (Cloud Functions) enforcement.** On Spark, Cloud Functions
   are available but moving balance operations into a trusted function is the
   standard "real funds" hardening: a single audited code path that does the
   math, enforces invariants, and writes the ledger — with the client rules as
   a backstop. The task constraint was *do not enable billing / leave Spark*;
   Functions on Spark (with their monthly free tier) do not require billing,
   but wiring them changes the app's write paths and was outside the approved
   scope. **Residual risk while functions are absent:** a *legitimate*
   (compromised or malicious) **admin** client can still perform rule-valid
   financial operations — the rules cannot distinguish "the real admin" from
   "the admin's stolen token". The rules prevent non-admins, escalation,
   malformed batches, and arithmetic skew, but the admin's token is the trust
   root. Mitigations available on Spark: keep admin accounts to 1–2 people,
   rotate the admin password, audit the ledger regularly (every change has a
   txn record), and add the functions path later.
3. **Client token trust for withdrawals.** Withdrawals are self-service and
   balance-bounded (cannot overdraw, cannot go negative, always ledgered) —
   appropriate for a fund where students withdrawing their own credited
   earnings is the intended flow. If "withdrawal" ever means *payout to a
   third party or an external bank*, that must move to a trusted flow (function
   + manual approval), not a client write.
4. **Admins can allocate to any user doc** (the rules validate amounts and
   atomicity, not the roster membership) — a compromised admin could credit an
   arbitrary email. Small-fund risk; noted for completeness.
5. **Timestamps**: `createdAt` uses server timestamps (good); ordering by
   `createdAt` during the same millisecond is arbitrary — cosmetic only.
6. **Quotas (Spark)**: Firestore free tier (50k reads / 50k writes / 20k
   deletes/day, 1 GiB) is fine for ≤24 students at this activity level; heavy
   real-time dashboard use by many devices is the first thing to watch.

**Bottom line:** deploy for **testing** once the emulator rules suite is
executed and green; treat the fund as a **bookkeeping system of record**
(reconcile withdrawals with your actual bank/payments manually) until the
Cloud Functions trusted-path upgrade is done. Do not describe the system as
production-grade for unattended real-money movement on the current architecture.

---

## 8. Unimplemented / deferred items (honest list)

- **Cloud Functions trusted balance operations** — assessed (§7.2); not
  implemented (scope: Spark-compatible changes only, no billing changes). The
  safest Spark-compatible approach *if/when* desired: a `https` function for
  withdrawals + an on-write `firestore` function that re-validates invariants
  (and can roll back via a compensation txn) — both fit the Spark free tier.
- **Role change for existing users** — intentionally impossible by design
  (no escalation path). A legitimate "demote an admin" requires console access
  (owner privileges bypass rules) — documented in `firebase/README.md`.
- **Automatic migration of legacy docs** — not automated (no data modification
  without approval). Manual steps are in §6.2.
- **iOS / Hosting** — out of scope per the task.
- **`removedAt` tombstones are never un-set** — re-adding a removed student
  requires creating a fresh identity (or console edit). Noted as a product
  decision.
