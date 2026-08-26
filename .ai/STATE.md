# Project State

## Objective

Implement BANK LOAN ONBOARDING V3 on the existing `feat/bank-loan-onboarding-v3` branch:
existing-loan baseline, contractual-vs-internal schedule numbering, smart Excel/CSV import, total fixed-insurance semantics, original-contract estimation, and simplified bank-loan UX.

## Active Work

- BANK LOAN ONBOARDING V3 is implemented, committed, pushed, and available in DRAFT PR #63 for review.
- Production remains untouched. Do not apply the new migration remotely, merge, or deploy manually.
- Historical BANK V2 migrations remain immutable.

## Repository

- Branch: `feat/bank-loan-onboarding-v3`
- Starting branch HEAD: `d9f16dd55ca77b4bd3cc72051a54273112240db6`
- Implementation checkpoint SHA: `7c51797fa5e30f4e7ed76a0a9ee25f3bf11fbb0b`; the final continuity metadata commit is on top of it. Read Git for the exact current HEAD and remote SHA.
- DRAFT PR: https://github.com/rnzrex/cajafamiliar/pull/63, base `main`, head `feat/bank-loan-onboarding-v3`.
- The actual current HEAD and remote state must always be read from Git.

## Completed — BANK LOAN ONBOARDING V3

- Added additive migration `supabase/migrations/20260826141250_bank_loan_onboarding_v3.sql`.
- Added `bank_loan_profiles.installments_paid_before_tracking` with non-negative and term-bound checks.
- Added `debt_installments.is_paid_before_tracking` and nullable `contractual_installment_number`, backfilled legacy contractual numbers to internal numbers.
- Kept BANK V2 `installment_number` internal 1..N; preserved bank numbering separately for partial schedules such as contractual 6..18.
- Updated `create_bank_loan_v1` without changing its public signature. It stores baseline metadata and marks only complete initial schedules; no historical movements, events, expenses, or allocations are fabricated.
- Added server and client allocation guards for pre-tracking rows; later schedule versions clear baseline flags.
- Extended only the initial bank schedule guard to accept a strict pending-only initial schedule; later lifecycle validators still require their existing internal invariants.
- Reordered the bank form into: 1 Sobre el crédito, 2 Contrato original, 3 Situación actual, 4 Seguros y costos, 5 Cronograma, 6 Revisión.
- Added file import via existing `xlsx` dependency for `.xlsx`, `.xls`, `.csv`, `.tsv`, and `.txt`, with aliases, preview, explicit mapping, duplicate/missing-column errors, and full/partial schedule support.
- Added fixed insurance bases: per installment, total-even with cent adjustment, upfront, and unknown distribution with warning.
- Estimation now prioritizes original financed amount, prefers a valid contractual periodic rate, reports theoretical-vs-current balance differences without blocking, and never uses TCEA as interest input.
- Updated planning, agenda/projection, intelligence, detail, operation selectors, labels, mappers, normalizers, and legacy defaults to exclude baseline rows and display contractual numbers.
- Preserved non-bank, pledge, QAPAQ, card, and BANK V2 behavior through regression coverage.

## Validation

- `npm test -- --reporter=dot`: PASS — 55 files / 889 tests.
- Focused `src/utils/bankLoanOnboardingV3.test.ts`: PASS — 12 tests after the latest client-allocation guard and import coverage.
- `npm run build`: PASS.
- `npm run typecheck:api`: PASS.
- `git diff --check`: PASS.
- `npm run test:bank-loan-v3:local`: PASS — baseline, no-history, baseline allocation rejection, pending allocation, later schedule clearing, partial 6..7 normalization, invalid baseline, and new-loan baseline=0.
- `npm run test:bank-v2-local`: PASS.
- `npm run test:debt2b2`: PASS.
- `npm run test:debt5fa:local`: PASS — all assertions passed after temporarily enabling local Auth; `supabase/config.toml` was restored to `auth.enabled = false` and local services restarted without Auth.
- Local HTTP smoke with Vite and local Supabase environment: `/` returned HTTP 200 and rendered the root mount. Visual `agent-browser` verification was unavailable because the CLI/browser connector is not installed; no remote environment was opened.
- Automatic Vercel Preview checks for PR #63 passed: `Vercel` deployment completed and `Vercel Preview Comments` passed.
- `supabase db reset` is not a clean repository workflow because the first migration expects an external/base schema. For local SQL validation, `supabase/schema.sql` was loaded only into the local container, then the real migrations/smokes were applied. `supabase/schema.sql` was not modified.

## Production

- No Production data, migration, SQL, deployment, or manual Vercel action was performed for this objective.
- Vercel Preview check passed automatically for PR #63; Production remains untouched.

## BANK V2 Baseline / Restrictions

- Do not edit: `20260824225428_bank_credit_contract_v2.sql`, `20260825010000_bank_credit_contract_v2_audit_fix.sql`, `20260825071034_bank_credit_contract_v2_finalization.sql`, or `20260825165854_bank_credit_contract_v2_schedule_state_guard.sql`.
- Use a new migration for future SQL. Do not run remote Supabase migrations or touch Production without explicit authorization.
- Do not reset/clean/discard uncommitted work, force push, merge, or deploy manually.

## Next Move

1. Await review and requested changes on DRAFT PR #63.
2. If changes are requested, update `.ai/STATE.md`, preserve the additive migration rule, rerun the relevant local gates, and push a new checkpoint.
3. Do not merge, apply remote Supabase migrations, or touch Production without explicit authorization.

## Key Files

- `supabase/migrations/20260826141250_bank_loan_onboarding_v3.sql` — additive schema, allocation guards, create RPC, initial schedule guard.
- `src/components/DebtForm.tsx` — bank onboarding UX, import/mapping/preview, estimator, insurance semantics, review.
- `src/utils/debtScheduleFileParser.ts` — XLSX/CSV/TSV/TXT parser and column mapping.
- `src/utils/bankLoanBaseline.ts` — baseline marking, normalization, consistency summary/warnings.
- `src/utils/debtEstimation.ts` — original-contract schedule estimator and total-insurance distribution.
- `src/utils/debtPlanning.ts` — pending planning excludes baseline rows.
- `src/utils/debtViewModel.ts` — baseline progress and allocation validation.
- `src/services/dataRepository.ts` and `src/types.ts` — snake/camel mappers and domain types.
- `src/utils/bankLoanOnboardingV3.test.ts` — focused estimator/import/baseline/planning tests.
- `scripts/test-bank-loan-onboarding-v3-local.mjs` — local SQL smoke suite.

## Last Handoff

- Agent: Codex
- Date: 2026-08-26
- Summary: BANK LOAN ONBOARDING V3 is implemented and all code/local SQL gates are green. The implementation checkpoint and final continuity metadata are pushed; DRAFT PR #63 is open and the latest Vercel Preview check is rerunning after the metadata-only push. Production is untouched.
