# Project State

## Objective

Close the final BANK PREPAYMENT RECALCULATION V1 contractual-coherence blockers on `feat/bank-prepayment-recalculation-v1`, publish the fix for PR #66 audit, and keep the pending migration unapplied to Production.

## Repository

- Branch: `feat/bank-prepayment-recalculation-v1`.
- Expected starting HEAD: `3528641bebb77aff05a2d2657f5d48d17b02b985`.
- Implementation commit: `239b7f2ad001f196c1d48de33fa118f35fa4afb5` (`fix(bank): enforce post-prepayment schedule coherence`), pushed normally.
- Prior carried-lineage implementation remains in history and must not be redesigned.
- PR: #66, base `main`, must remain OPEN/DRAFT.
- Any further commit must be metadata-only operational-state handoff; no implementation change.

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
- Added `private.debt2b2_is_effective_schedule_trigger` before the official schedule RPC and made historical contractual versions block only while their trigger lineage is effective; unknown/orphan/null triggers remain conservative blockers.
- Added `private.debt2b2_validate_schedule_principal_v1` with 2-decimal rounding and 0.01 tolerance, used by payment-with-extra, prepayment, and official schedule update paths without mutating financial state.
- Added later effective payment/installment-advance date protection, client error mapping, exact Spanish translation, and a non-blocking `DebtScheduleUpdateForm` warning.
- Corrected lifecycle smoke fixtures to reconcile complete post-operation schedule principal totals and added atomic mismatch/match, effective P2 reversal, replay, and later-payment cases.

## Validation

- `npm test -- --testTimeout=15000`: PASS, 74 files / 1036 tests.
- Focused contractual-coherence/client suite (`debtCalculations`, `debtHardened`, `DebtOperationFormUX`, `debtViewModel`): PASS, 4 files / 80 tests.
- `npm run test:bank-prepayment-simulation`: PASS, 1 file / 18 tests.
- `npm run test:bank-reconstruction-v4`: PASS, 1 file / 11 tests.
- `npm run test:bank-external-ai-import`: PASS, 3 files / 29 tests.
- `npm run test:bank-document-v5-local`: PASS, 6 files / 26 tests.
- `npm run build`: PASS; only existing dynamic-import and large-chunk warnings.
- `npm run typecheck:api`: PASS.
- `node --check scripts/test-bank-prepayment-lifecycle-local.mjs`: PASS.
- `git diff --check`: PASS.
- `docker info` is available only with escalated Docker Desktop access; normal sandbox access cannot open the Docker named pipe.
- `npx supabase db push --local` was not usable because the local database contains remote-only migration versions and the command suggested forbidden migration repair. The pending migration was executed directly against the local container only for smoke validation; Production was never contacted.
- SQL smoke `npm run test:bank-prepayment-lifecycle:local`: BLOCKED by local database drift after reaching the lifecycle cases. The local DB has remote-only later migrations (`20260828100000`, `20260828120000`) and their `private.require_bank_loan_schedule` trigger rejects the legacy open-ended fixture with `BANK_SCHEDULE_REQUIRED`; no trigger was disabled and no reset/repair was used.
- Existing SQL smokes `npm run test:bank-loan-v3:local`, `npm run test:bank-v2-local`, and `npm run test:debt2b2`: not re-approved after the local migration-history mismatch; no Production substitute was used.

## Delivery

- GitHub authentication was previously verified as `rnzrex` over HTTPS with keyring-backed credentials; no token was exposed.
- The prior carried-lineage implementation and the contractual-coherence commit were pushed normally; remote branch SHA is `239b7f2ad001f196c1d48de33fa118f35fa4afb5`.
- PR #66 body was updated while preserving `state=open` and `draft=true`; it documents the coherence implementation, validation counts, and SQL/Docker limitation.
- Git-triggered Preview `dpl_2g4Zrh7fdrvVRr8754QJA6nUMXed` is `READY` at `https://cajafamiliar-69ubsst03-renzorex.vercel.app`, branch `feat/bank-prepayment-recalculation-v1`, exact SHA `239b7f2ad001f196c1d48de33fa118f35fa4afb5`, target `null`; no manual deployment was used.

## Production

- Production untouched. `supabase/migrations/20260827214244_bank_prepayment_schedule_lifecycle_v1.sql` exists locally but is NOT applied to Supabase Production.
- No Production schema/data write, frontend deployment, Vercel env write, Gemini key/provider, merge, real document, or financial/test/junk data was used.

## Next Step

- Handoff is complete for code publication, PR metadata, and exact-SHA Preview verification. The SQL gate remains blocked by local migration-history drift and must be rerun in a clean/intended SQL execution environment before any Production decision.
- Do not apply the pending migration to Production, merge PR #66, mark it ready, add Gemini secrets, or deploy Production.

## Relevant Files

- `supabase/migrations/20260827214244_bank_prepayment_schedule_lifecycle_v1.sql` — pending lifecycle migration, relational carried lineage, restore writer, effective validators, and result payloads.
- `src/types.ts` — carried lineage domain type and AppData field.
- `src/utils/debtCalculations.ts` — effective carried lineage and direct-vs-total obligation helpers.
- `src/utils/debtViewModel.ts`, `src/utils/debtPlanning.ts` — progress, validation, planning, and agenda obligation projections.
- `src/components/DebtOperationForm.tsx`, `src/components/DebtDetailModal.tsx`, `src/App.tsx` — carried-aware UI and data wiring.
- `src/services/dataRepository.ts`, `src/services/authoritativeSync.ts`, `src/utils/debtNormalizers.ts`, `src/utils/storage.ts` — remote rows, RPC result payloads, cache normalization, and idempotent overlay.
- `scripts/test-bank-prepayment-lifecycle-local.mjs` — local-only SQL smoke harness.
- `src/components/DebtScheduleUpdateForm.tsx` — official prepayment schedule warning.
- `src/services/dataRepository.ts` — stable debt-operation error code mapping.
