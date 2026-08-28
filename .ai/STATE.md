# Project State

## Objective

Close the final BANK PREPAYMENT RECALCULATION V1 blockers on `feat/bank-prepayment-recalculation-v1`: resolve reversal dependencies from effective schedule lineage and preserve restored installment state/carry coverage. Publish the same branch for orchestrator audit while keeping PR #66 DRAFT and Production untouched.

## Repository

- Branch: `feat/bank-prepayment-recalculation-v1`.
- Expected starting HEAD: `c238edc8ddf7c0a392822c3a8885be15b2111ef1`.
- Current starting remote/local HEAD: `c238edc8ddf7c0a392822c3a8885be15b2111ef1`.
- Working tree has the uncommitted effective-lineage, carried-state, and regression-test changes for this gate; commit and push normally after validation. Never force-push.
- PR: #66, base `main`, must remain OPEN/DRAFT.

## Constraints

- No new branch, merge, force push, Production Supabase writes/migration/manual SQL, Production frontend deploy, Vercel environment writes, Gemini key/provider, real bank documents, Production financial/test data, migration repair/reset/include-all, or destructive Docker cleanup.
- Modify only the existing pending migration `supabase/migrations/20260827214244_bank_prepayment_schedule_lifecycle_v1.sql`; do not modify applied historical migrations or create a second migration.
- Local Docker diagnostics and local SQL smoke tests are allowed; Production is never a test substitute.

## Completed

- Added `debt_installments.carried_allocated_amount` with a non-negative default/check in the existing pending migration.
- Added a private SQL schedule-trigger lineage helper and changed the reversal dependency guard to ignore only verified undo branches while continuing to block effective later financial/manual/rate schedule lineage.
- Added `private.debt2b2_restore_schedule_v1`, which copies baseline installment fields server-side, preserves `is_paid_before_tracking` and `reported_balance`, and carries effective pre-target direct allocation coverage without creating allocations, movements, or ledger rows.
- Replaced the pending migration’s allocation and advance validators so carried coverage participates in overage/advance checks.
- Added the client mapper/normalizer/type and `totalAllocatedAmountForInstallment`; updated progress, planning, payment allocation UI, advance eligibility, and client allocation validation. Direct effective allocations remain separate for economic ledger totals.
- Added frontend unit coverage for nested P1/P2 LIFO (including estimated/official), same-target behavior, effective manual/rate behavior, and carried progress/overage/planning.
- Extended `scripts/test-bank-prepayment-lifecycle-local.mjs` with nested schedule-generating LIFO, pretracking restore, full/partial/reverted carry, overage, no-duplication, and exact replay cases.

## Decisions

- Append-only schedule history is retained; dependency status is computed from `trigger_event_id` plus effective `DebtEvent` reversal lineage, not from version number alone.
- Carried coverage is obligation read/validation state only. Original allocation rows remain immutable and are never copied; economic event/movement/account totals remain canonical.
- Restore canonical-checks the client payload but copies actual baseline rows server-side. Ordinary schedule writers continue defaulting carried coverage to zero and clearing inherited pretracking flags; explicit restoration reapplies baseline state after the existing metadata trigger.
- `supabase/schema.sql` is intentionally not hand-edited: it is the applied/local snapshot, while this migration remains pending and Docker is unavailable for a generated dump.

## Validation

- `npm test -- --testTimeout=15000`: PASS, 74 files / 1031 tests.
- Focused carry/LIFO suite (`debtCalculations.test.ts`, `debtViewModel.test.ts`, `debtPlanning.test.ts`, `debtReversalDependencies.test.ts`): PASS, 4 files / 67 tests.
- `npm run test:bank-prepayment-simulation`: PASS, 18 tests.
- `npm run test:bank-reconstruction-v4`: PASS, 11 tests.
- `npm run test:bank-external-ai-import`: PASS, 29 tests.
- `npm run test:bank-document-v5-local`: PASS, 26 tests.
- `npm run build`: PASS; only existing dynamic-import and large-chunk warnings.
- `npm run typecheck:api`: PASS.
- `node --check scripts/test-bank-prepayment-lifecycle-local.mjs`: PASS.
- `git diff --check`: PASS.
- Local SQL smoke (`test:bank-prepayment-lifecycle:local`, `test:bank-loan-v3:local`, `test:bank-v2-local`, `test:debt2b2`): BLOCKED before SQL. Docker Desktop start was requested safely, but Docker API/named pipe remained unavailable and `.docker/config.json` was access-denied. No Production substitute was used.

## Delivery

- GitHub authentication was previously verified as `rnzrex` over HTTPS with keyring-backed credentials; no token was exposed.
- PR #66: https://github.com/rnzrex/cajafamiliar/pull/66; keep `draft=true`.
- Previous preview before this gate: `dpl_6LwRTd5j2HMPd1hZ21YAXSzMmsVr`, `https://cajafamiliar-we2kezmn6-renzorex.vercel.app`, READY for the prior pushed SHA. After commit/push, wait for the automatic preview and verify the new exact SHA.

## Production

- Production untouched. `20260827214244_bank_prepayment_schedule_lifecycle_v1.sql` exists locally but is NOT applied to Supabase Production.
- No Production schema/data write, frontend deployment, Vercel env write, Gemini key/provider, merge, real document, or financial/test/junk data was used.

## Next Step

- Review the SQL statically, commit the implementation, update/push operational state and PR #66 body, then verify the automatic Vercel Preview exact branch/SHA. Stop for orchestrator restored-state SQL audit.
- Do not apply the pending migration to Production, merge PR #66, mark it ready, add Gemini secrets, or deploy Production.

## Relevant Files

- `supabase/migrations/20260827214244_bank_prepayment_schedule_lifecycle_v1.sql` — pending lifecycle migration, effective schedule dependency helper, restore writer, carried-aware allocation/advance validators.
- `src/utils/debtReversalDependencies.ts` — pure effective schedule-lineage dependency mirror.
- `src/utils/debtCalculations.ts` — direct effective allocation vs total obligation coverage helpers.
- `src/utils/debtViewModel.ts` — progress and client allocation validation.
- `src/utils/debtPlanning.ts` — planning/agenda obligation coverage.
- `src/components/DebtOperationForm.tsx` — payment/advance allocation and eligibility UI.
- `src/services/dataRepository.ts`, `src/utils/debtNormalizers.ts`, `src/types.ts` — carried field mapping and client model.
- `src/utils/debtReversalDependencies.test.ts`, `src/utils/debtCalculations.test.ts`, `src/utils/debtViewModel.test.ts`, `src/utils/debtPlanning.test.ts` — focused regression tests.
- `scripts/test-bank-prepayment-lifecycle-local.mjs` — local-only SQL smoke harness.
- `.ai/STATE.md` — this operational handoff.
