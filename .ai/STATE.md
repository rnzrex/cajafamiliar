# Project State

## Objective

Close the final BANK PREPAYMENT RECALCULATION V1 audit blockers on `feat/bank-prepayment-recalculation-v1`, publish the implementation for orchestrator review, keep PR #66 DRAFT, and do not touch Production.

## Repository

- Branch: `feat/bank-prepayment-recalculation-v1`.
- Base: `main`.
- Previous expected HEAD before this gate: `0fe59e71cd35ad44dfc34f35e8b253902caff33e`.
- Latest code-affecting implementation commit: `3663d70188b8dd0557a5ec0755d43a023c46b1cc` (`fix(bank): close final prepayment audit blockers`).
- The implementation commit was pushed normally; any later metadata-only checkpoint must not alter application behavior.
- Working tree is expected to be clean after the state checkpoint is committed and pushed.

## Constraints

- No new branch, merge, force push, Production Supabase writes/migration, manual Production SQL, Gemini key/provider, Vercel environment writes, manual Production deploy, Production financial/test data, real bank documents, migration repair/reset/include-all, or destructive cleanup.
- Modify the existing pending migration only if SQL changes are required; do not modify applied historical migrations or create a second migration.
- PR #66 must remain OPEN/DRAFT.

## Completed

- Made the four-card bank fixed-schedule prepayment UX the sole source of truth for standalone prepayment and payment + extra principal; hidden legacy duplicate effect/source controls in that scenario.
- Fixed the official-bank path to open the direct schedule editor, accept contract number/date/total/capital/interest/fees/insurance/reported balance/notes, and force `scheduleSource = contractual`.
- Added server-side `DEBT_PREPAYMENT_SCHEDULE_TARGET_STALE` guards for later effective prepayments and later contractual schedule versions.
- Preserved exact official replay idempotency and same-identity payload conflict behavior by checking replay before stale creation guards.
- Added client error-code parsing and Spanish translation for the stale-target error.
- Corrected `financial_installment_plus_costs` reduce-term projected total to use the recalculated first-row all-in total.
- Removed false exact interest/savings when unknown insurance or fees make persistence unsafe.
- Fixed estimated Debt Detail balances to derive from future schedule principals only; missing principals remain “Por confirmar”. Estimated schedules continue to leave `reported_balance` null.
- Extended UX, simulation, debt-detail, and local SQL smoke regression coverage.
- Existing pending migration remains:
  `supabase/migrations/20260827214244_bank_prepayment_schedule_lifecycle_v1.sql`.

## Validation

- `npm test -- --testTimeout=15000`: PASS, 72 files / 1012 tests.
- `npm run test:bank-prepayment-simulation`: PASS, 18 tests.
- `npm run test:bank-reconstruction-v4`: PASS, 11 tests.
- `npm run test:bank-external-ai-import`: PASS, 29 tests.
- `npm run test:bank-document-v5-local`: PASS, 26 tests.
- `npm run build`: PASS; only existing dynamic-import and large-chunk warnings.
- `npm run typecheck:api`: PASS.
- `node --check scripts/test-bank-prepayment-lifecycle-local.mjs`: PASS.
- `git diff --check`: PASS.
- Local SQL smoke commands (`test:bank-prepayment-lifecycle:local`, `test:bank-loan-v3:local`, `test:bank-v2-local`, `test:debt2b2`): BLOCKED before SQL because Docker Desktop/local Supabase is unavailable; no Production substitute was used.
- Earlier `npx supabase db lint --local` and local dry-run checks remain non-authoritative because the local container/history was unavailable or drifted; no repair/reset/include-all was used.

## Delivery

- GitHub authentication is valid for `rnzrex` via keyring/HTTPS; token was not exposed.
- Normal push completed for implementation commit `3663d70188b8dd0557a5ec0755d43a023c46b1cc`.
- PR #66: https://github.com/rnzrex/cajafamiliar/pull/66
- PR state: OPEN, `draft=true`, base `main`, head branch `feat/bank-prepayment-recalculation-v1`.
- PR body updated for Audit Fix 3.
- Automatic Vercel Preview for the implementation commit:
  - Deployment: `dpl_64iaVFBvvHniPRWboeDDGGE1GUv5`
  - URL: https://cajafamiliar-54e3ffipv-renzorex.vercel.app
  - Branch alias: https://cajafamiliar-git-feat-bank-prepayment-recalculation-v1-renzorex.vercel.app
  - Exact Git SHA: `3663d70188b8dd0557a5ec0755d43a023c46b1cc`
  - State: READY; target: null (Preview)
- A metadata-only STATE checkpoint may create a newer automatic Preview, which must remain Preview and must not be manually deployed.

## Production

- Production untouched.
- Migration exists in the branch but is NOT applied to Supabase Production.
- No Production schema/data write, frontend Production deployment, Vercel environment write, Gemini key/provider, merge, real bank document, or financial/test data was used.

## Next Step

- Stop for orchestrator Audit 3 review.
- Do not apply `20260827214244_bank_prepayment_schedule_lifecycle_v1.sql` to Production from this task.
- Do not merge PR #66 or mark it ready.

## Relevant Files

- `src/components/DebtOperationForm.tsx` — four-card UX and direct official-bank schedule editor.
- `src/components/BankPrepaymentUX.test.tsx` — four-card/official/pending UX regression coverage.
- `src/components/DebtOperationFormUX.test.tsx` — payment+extra and official form coverage.
- `src/utils/bankPrepaymentSimulation.ts` — prepayment simulation and conservative savings behavior.
- `src/utils/bankPrepaymentSimulation.test.ts` — ALFIN and unknown-cost regression coverage.
- `src/utils/debtEstimatedBalance.ts` — immutable estimated historical balance derivation.
- `src/components/DebtDetailModal.tsx` — estimated balance display.
- `src/services/dataRepository.ts` and `src/utils/debtViewModel.ts` — stale-target error mapping.
- `supabase/migrations/20260827214244_bank_prepayment_schedule_lifecycle_v1.sql` — pending forward-only lifecycle migration and stale guards.
- `scripts/test-bank-prepayment-lifecycle-local.mjs` — local-only SQL smoke tests.

