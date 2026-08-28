# Project State

## Objective

Close the final BANK PREPAYMENT RECALCULATION V1 reversal-lifecycle blocker on `feat/bank-prepayment-recalculation-v1`, publish the fix for orchestrator review, keep PR #66 DRAFT, and do not touch Production.

## Repository

- Branch: `feat/bank-prepayment-recalculation-v1`.
- Base: `main`.
- Expected HEAD before this gate: `7f298bf47961a08405956fbfafca552e02d98cd7`.
- Latest code-affecting implementation commit: `27aafcead8f79a2301e38af010af3cde47d21b7b` (`fix(bank): restore pre-prepayment schedule on reversal`).
- The implementation commit and metadata-only state checkpoint were pushed normally without force.
- Working tree is clean.

## Constraints

- No new branch, merge, force push, Production Supabase writes/migration, manual Production SQL, Gemini key/provider, Vercel environment writes, manual Production deploy, Production financial/test data, real bank documents, migration repair/reset/include-all, or destructive cleanup.
- Modify only the existing pending migration; do not modify applied historical migrations or create a second migration.
- PR #66 must remain OPEN/DRAFT.

## Completed

- Preserved all prior Audit 3 behavior: four-card bank fixed-schedule UX as the sole source of truth, official contractual source, pending/estimated separation, stale prepayment-target guards, exact replay semantics, stable estimated balances, reported-vs-calculated principal separation, corrected all-in projected totals, conservative unknown-cost savings, and ALFIN regressions.
- Added `getDebtReversalScheduleBaseline`, resolving the latest schedule strictly before the first schedule version triggered by the target event.
- Updated `DebtOperationForm` reversal restoration and notes to use that helper while retaining latest target-trigger detection for whether a schedule payload is required.
- Replaced `public.reverse_debt_event_v1` in the pending migration with the same public signature and existing security/authorization/locking/ledger/idempotency/error/reconcile contract, changing only baseline resolution to skip every same-target version and preserve baseline source/authority metadata.
- Extended local SQL smoke coverage for estimated-only, official-only, estimated-to-official, pending-without-schedule, pending-then-later-official reversal, effective principal restoration, movement-count stability, replay, and payload conflict.
- Added pure helper tests and UX regression coverage proving V1 is restored instead of V2 when V2 estimated and V3 official share the target trigger.
- Existing pending migration remains: `supabase/migrations/20260827214244_bank_prepayment_schedule_lifecycle_v1.sql`.

## Validation

- `npm test -- --testTimeout=15000`: PASS, 73 files / 1017 tests.
- Focused reversal suite (`debtReversalSchedule.test.ts` + `DebtOperationFormUX.test.tsx`): PASS, 2 files / 13 tests.
- `npm run test:bank-prepayment-simulation`: PASS, 18 tests.
- `npm run test:bank-reconstruction-v4`: PASS, 11 tests.
- `npm run test:bank-external-ai-import`: PASS, 29 tests.
- `npm run test:bank-document-v5-local`: PASS, 26 tests.
- `npm run build`: PASS; only existing dynamic-import and large-chunk warnings.
- `npm run typecheck:api`: PASS.
- `node --check scripts/test-bank-prepayment-lifecycle-local.mjs`: PASS.
- `git diff --check`: PASS.
- Local SQL smoke commands (`test:bank-prepayment-lifecycle:local`, `test:bank-loan-v3:local`, `test:bank-v2-local`, `test:debt2b2`): BLOCKED before SQL because Docker Desktop/local Supabase is unavailable (`docker_engine` named pipe missing / container not running); no Production substitute was used.

## Delivery

- GitHub connector successfully read and updated PR #66; the local `gh auth status` command currently reports its stored CLI token invalid, so no token was exposed and no PAT was requested. Normal Git pushes succeeded using the configured Git credential.
- PR #66: https://github.com/rnzrex/cajafamiliar/pull/66
- PR state: OPEN, `draft=true`, base `main`, head branch `feat/bank-prepayment-recalculation-v1`, head SHA `4c804c9f6890148511cb0585fbeb64a3a8bef5cf`.
- PR body updated for the reversal lifecycle blocker, including baseline algorithm, all reversal scenarios, SQL smoke BLOCKED status, and Production safety restrictions.
- Automatic Vercel Preview for the implementation commit:
  - Deployment: `dpl_6aZZGm3xPgpJeRurNe257GXntfdw`
  - URL: https://cajafamiliar-fxqyinkmf-renzorex.vercel.app
  - Branch alias: https://cajafamiliar-git-feat-bank-prepayment-recalculation-v1-renzorex.vercel.app
  - Exact Git SHA: `27aafcead8f79a2301e38af010af3cde47d21b7b`
  - State: READY; target: null (Preview)
- Automatic Vercel Preview for the final metadata checkpoint:
  - Deployment: `dpl_CwZz6r2BF4cuXAreNjXMFHz7ABQ4`
  - URL: https://cajafamiliar-1a0qomcmf-renzorex.vercel.app
  - Branch alias: https://cajafamiliar-git-feat-bank-prepayment-recalculation-v1-renzorex.vercel.app
  - Exact Git SHA: `4c804c9f6890148511cb0585fbeb64a3a8bef5cf`
  - State: READY; target: null (Preview)
- `git ls-remote` verified remote branch SHA `4c804c9f6890148511cb0585fbeb64a3a8bef5cf`.

## Production

- Production untouched.
- Migration exists in the branch but is NOT applied to Supabase Production.
- No Production schema/data write, frontend Production deployment, Vercel environment write, Gemini key/provider, merge, real bank document, or financial/test/junk data was used.

## Next Step

- Stop for orchestrator reversal audit; the implementation is published and the PR remains DRAFT.
- Do not apply `20260827214244_bank_prepayment_schedule_lifecycle_v1.sql` to Production from this task.
- Do not merge PR #66 or mark it ready.

## Relevant Files

- `src/components/DebtOperationForm.tsx` — reversal editor baseline selection and existing bank prepayment UX.
- `src/components/DebtOperationFormUX.test.tsx` — reversal UI regression coverage.
- `src/utils/debtReversalSchedule.ts` — pure first-target baseline resolver.
- `src/utils/debtReversalSchedule.test.ts` — pure helper scenarios.
- `supabase/migrations/20260827214244_bank_prepayment_schedule_lifecycle_v1.sql` — pending forward-only lifecycle migration and corrected reversal RPC.
- `scripts/test-bank-prepayment-lifecycle-local.mjs` — local-only SQL smoke tests.
- `.ai/STATE.md` — operational handoff state for this audit gate.
