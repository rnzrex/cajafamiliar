# Project State

## Objective

Close the final BANK PREPAYMENT RECALCULATION V1 reversal-lifecycle blockers on `feat/bank-prepayment-recalculation-v1`, publish the implementation for orchestrator review, keep PR #66 DRAFT, and do not touch Production.

## Repository

- Branch: `feat/bank-prepayment-recalculation-v1`.
- Base: `main`.
- HEAD: `d988db647ec8393619fa4ab5cd8a990f4d0b53b2` (`fix(bank): guard dependent and late reversals`).
- The implementation commit was pushed normally to `origin/feat/bank-prepayment-recalculation-v1`; no force push.
- Working tree is clean before this metadata checkpoint.

## Constraints

- No new branch, merge, force push, Production Supabase writes/migration, manual Production SQL, Gemini key/provider, Vercel environment writes, manual Production deploy, Production financial/test data, real bank documents, migration repair/reset/include-all, or destructive cleanup.
- Modify only the existing pending migration; do not modify applied historical migrations or create a second migration.
- PR #66 must remain OPEN/DRAFT.

## Completed

- Preserved the previous first-target baseline rule and same-target estimated/official replay behavior.
- Made schedule validation reason-aware: reversal restoration may contain due dates before the reversal event, while prepayment/rate-change/manual-adjustment schedules still require future due dates.
- Added server-side `DEBT_REVERSAL_HAS_LATER_DEPENDENCIES` LIFO guard before new reversal mutation. It blocks later effective payment, prepayment, payoff, or installment advance events and later unrelated schedule versions, while ignoring already reversed events and same-target schedule versions. Exact replay remains checked first.
- Added client dependency helper/UI guard with the exact Spanish error guidance, plus error-code mapping and focused tests.
- Extended the local SQL smoke harness for late reversal, each dependency type, different-trigger schedules, reversed-later-event release, no-mutation-on-block, and replay after later activity.
- Existing pending migration remains: `supabase/migrations/20260827214244_bank_prepayment_schedule_lifecycle_v1.sql`.

## Validation

- `npm test -- --testTimeout=15000`: PASS, 74 files / 1024 tests.
- Focused reversal suite (`debtReversalSchedule.test.ts`, `debtReversalDependencies.test.ts`, `DebtOperationFormUX.test.tsx`): PASS, 3 files / 20 tests.
- `npm run test:bank-prepayment-simulation`: PASS, 18 tests.
- `npm run test:bank-reconstruction-v4`: PASS, 11 tests.
- `npm run test:bank-external-ai-import`: PASS, 29 tests.
- `npm run test:bank-document-v5-local`: PASS, 26 tests.
- `npm run build`: PASS; only existing dynamic-import and large-chunk warnings.
- `npm run typecheck:api`: PASS.
- `node --check scripts/test-bank-prepayment-lifecycle-local.mjs`: PASS.
- `git diff --check`: PASS.
- Local SQL smoke commands (`test:bank-prepayment-lifecycle:local`, `test:bank-loan-v3:local`, `test:bank-v2-local`, `test:debt2b2`): BLOCKED before SQL. Docker Desktop was installed and start was requested, but the daemon remained unavailable: `dockerDesktopLinuxEngine`/`docker_engine` named pipe missing and `.docker/config.json` access denied. No Production substitute was used.

## Delivery

- GitHub connector successfully read and updated PR #66. Final local `gh auth status` is authenticated as `rnzrex` over HTTPS with keyring-backed credentials; no token was exposed and no PAT was requested.
- PR #66: https://github.com/rnzrex/cajafamiliar/pull/66
- PR state before this metadata refresh: OPEN, `draft=true`, base `main`, head branch `feat/bank-prepayment-recalculation-v1`, head `d988db647ec8393619fa4ab5cd8a990f4d0b53b2`.
- PR body still needs the final late-reversal/dependency-guard details and current SQL-blocked status.
- Verify the automatic Vercel Preview against `d988db647ec8393619fa4ab5cd8a990f4d0b53b2`; do not deploy Production manually.

## Production

- Production untouched.
- Migration exists in the branch but is NOT applied to Supabase Production.
- No Production schema/data write, frontend Production deployment, Vercel environment write, Gemini key/provider, merge, real bank document, or financial/test/junk data was used.

## Next Step

- Refresh `.ai/STATE.md` metadata, commit it without code changes, push normally, update PR #66 while keeping it DRAFT, and verify the automatic Preview SHA.
- Do not apply `20260827214244_bank_prepayment_schedule_lifecycle_v1.sql` to Production from this task.
- Do not merge PR #66 or mark it ready.

## Relevant Files

- `src/components/DebtOperationForm.tsx` — reason-aware client schedule validator and reversal payload editor.
- `src/components/DebtOperationFormUX.test.tsx` — late restored due-date validation regression coverage.
- `src/components/DebtDetailModal.tsx` — client LIFO reversal button guard.
- `src/utils/debtReversalSchedule.ts` — first-target baseline resolver preserved unchanged.
- `src/utils/debtReversalDependencies.ts` — pure client dependency-state helper.
- `src/utils/debtReversalDependencies.test.ts` — dependency/LIFO helper coverage.
- `src/services/dataRepository.ts` — stable reversal dependency error code mapping.
- `src/utils/debtViewModel.ts` — exact Spanish dependency error translation.
- `supabase/migrations/20260827214244_bank_prepayment_schedule_lifecycle_v1.sql` — pending forward-only lifecycle migration and corrected reversal RPC.
- `scripts/test-bank-prepayment-lifecycle-local.mjs` — local-only SQL smoke tests.
- `.ai/STATE.md` — operational handoff state for this audit gate.
