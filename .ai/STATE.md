# Project State

## Objective

Close the final BANK PREPAYMENT RECALCULATION V1 carried-lineage reversibility blocker on `feat/bank-prepayment-recalculation-v1`, publish the fix for PR #66 audit, and keep the pending migration unapplied to Production.

## Repository

- Branch: `feat/bank-prepayment-recalculation-v1`.
- Expected starting HEAD: `e13e974c09fd8bd4aa88395d83a5ec894646d1d0`.
- Current HEAD before this checkpoint: `e13e974c09fd8bd4aa88395d83a5ec894646d1d0`; carried-lineage implementation is currently uncommitted.
- PR: #66, base `main`, must remain OPEN/DRAFT.
- Next implementation commit: `fix(bank): preserve carried allocation lineage`.

## Constraints

- No new branch, merge, force push, Production Supabase writes/manual SQL, Production frontend deploy, Vercel env writes, Gemini key/provider, real bank documents, Production financial/test data, migration repair/reset/include-all, or destructive Docker cleanup.
- Modify only the existing pending migration `supabase/migrations/20260827214244_bank_prepayment_schedule_lifecycle_v1.sql`; do not modify applied historical migrations or create a second migration.
- Local Docker diagnostics and local SQL smoke tests are allowed; Production is never a test substitute.

## Completed

- Replaced stale scalar carried coverage with `public.debt_installment_carried_allocations`, keyed to restored installment, source event, and source allocation; protected with composite FKs, source deduplication, RLS, and private effective-lineage helpers.
- Updated the restore writer to flatten inherited lineage plus direct baseline allocations, ordered strictly before the target event and filtered by current effective source events; nested restores deduplicate by source allocation ID and do not copy economic ledger rows.
- Updated private operation result functions and client mapping/sync so returned carried lineage is authoritative for the rendered state while a later source reversal dynamically removes effective coverage.
- Updated client types, snapshots, normalization, planning, detail/progress views, payment/advance allocation validation, and allocation UI. `is_paid_before_tracking` remains independent and direct effective allocations remain economic-only.
- Added inverse timing, multiple-source, nested, direct-plus-carried, source-reversal, replay, and post-reversal overage SQL smoke cases in `scripts/test-bank-prepayment-lifecycle-local.mjs`.
- Removed all stale `carried_allocated_amount` / `carriedAllocatedAmount` references from source, migration, and smoke harness.

## Validation

- `npm test -- --testTimeout=15000`: PASS, 74 files / 1033 tests.
- Focused carried/LIFO suite (`debtCalculations`, `debtViewModel`, `debtPlanning`, `debtReversalDependencies`): PASS, 4 files / 68 tests.
- `npm run test:bank-prepayment-simulation`: PASS, 1 file / 18 tests.
- `npm run test:bank-reconstruction-v4`: PASS, 1 file / 11 tests.
- `npm run test:bank-external-ai-import`: PASS, 3 files / 29 tests.
- `npm run test:bank-document-v5-local`: PASS, 6 files / 26 tests.
- `npm run build`: PASS; only existing dynamic-import and large-chunk warnings.
- `npm run typecheck:api`: PASS.
- `node --check scripts/test-bank-prepayment-lifecycle-local.mjs`: PASS.
- `git diff --check`: PASS.
- SQL smoke `npm run test:bank-prepayment-lifecycle:local`: BLOCKED before SQL because Docker API/named pipe is unavailable and `.docker/config.json` is access-denied.
- Existing SQL smokes `npm run test:bank-loan-v3:local`, `npm run test:bank-v2-local`, and `npm run test:debt2b2`: BLOCKED for the same local Docker unavailability. No Production substitute was used.

## Delivery

- GitHub authentication was previously verified as `rnzrex` over HTTPS with keyring-backed credentials; no token was exposed.
- After commit: push normally to `origin/feat/bank-prepayment-recalculation-v1`, verify remote SHA, update PR #66 body while preserving `draft=true`, and wait for automatic Vercel Preview only.
- Previous Preview was for the pre-fix SHA; a new Preview must be checked against the final pushed SHA and branch, with target `null`.

## Production

- Production untouched. `supabase/migrations/20260827214244_bank_prepayment_schedule_lifecycle_v1.sql` exists locally but is NOT applied to Supabase Production.
- No Production schema/data write, frontend deployment, Vercel env write, Gemini key/provider, merge, real document, or financial/test/junk data was used.

## Next Step

- Review staged diff, commit the implementation plus this operational state, push normally, verify PR/remote SHA, update PR #66 DRAFT, and verify automatic Preview.
- Do not apply the pending migration to Production, merge PR #66, mark it ready, add Gemini secrets, or deploy Production.

## Relevant Files

- `supabase/migrations/20260827214244_bank_prepayment_schedule_lifecycle_v1.sql` — pending lifecycle migration, relational carried lineage, restore writer, effective validators, and result payloads.
- `src/types.ts` — carried lineage domain type and AppData field.
- `src/utils/debtCalculations.ts` — effective carried lineage and direct-vs-total obligation helpers.
- `src/utils/debtViewModel.ts`, `src/utils/debtPlanning.ts` — progress, validation, planning, and agenda obligation projections.
- `src/components/DebtOperationForm.tsx`, `src/components/DebtDetailModal.tsx`, `src/App.tsx` — carried-aware UI and data wiring.
- `src/services/dataRepository.ts`, `src/services/authoritativeSync.ts`, `src/utils/debtNormalizers.ts`, `src/utils/storage.ts` — remote rows, RPC result payloads, cache normalization, and idempotent overlay.
- `scripts/test-bank-prepayment-lifecycle-local.mjs` — local-only SQL smoke harness.
