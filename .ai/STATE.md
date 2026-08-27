# Project State

## Objective

Fix the existing-bank-debt onboarding gate and bank-contract entry-method UX on `feat/bank-external-ai-complete-dossier-v1`, then keep PR #65 in DRAFT for orchestrator audit.

## Repository

- Branch: `feat/bank-external-ai-complete-dossier-v1`.
- Baseline before this fix: `6663157a424104c33d5012f0fbca9fe3dd55f7b4`.
- Feature fix commit: `074ba9654a3c07430e5e94f6227a965296d8c60e` (`fix(bank): require last paid installment for existing loans`), pushed normally to origin.
- This file is the final closeout metadata checkpoint; Git is authoritative for the exact current head after its metadata commit.
- Applied migrations remain untouched and immutable.

## Constraints

- Existing bank loans require a known contractual last-paid installment: integer `>= 1` and `< termInstallments`.
- Blank existing-debt input is unknown/null; it must not become zero, mark baseline rows, derive capital, or be saved.
- New debt keeps internal `paidBefore=0` behavior.
- Entry-method cards only select; the bottom CONTINUAR button advances.
- No migration changes, Supabase Production writes, Gemini key/provider calls, Vercel env/deploy changes, merge, or financial test data.

## Completed

- Added required existing-debt input validation and exact missing/invalid UX messages.
- Added `LAST_PAID_INSTALLMENT_REQUIRED` completeness issue with the requested field, severity, title, message, and action.
- Prevented blank/invalid existing baselines and schedule-derived capital; preserved null through document completeness and estimate remaining-balance output.
- Added repository defense-in-depth so an explicitly existing-debt save cannot persist a missing/zero last-paid value.
- Converted all four bank contract entry cards to visual `aria-pressed` selection without auto-advance; external AI remains selected by default.
- Added external-import-before/after-last-paid, pending-only, completeness, selection, and save-payload regressions.

## Validation

- `npm test -- --testTimeout=15000`: PASS, 66 files / 973 tests.
- Focused UX/completeness/onboarding tests: PASS, 3 files / 40 tests; final UX suite: 14 tests.
- `npm run build`: PASS; only existing dynamic-import and large-chunk warnings.
- `npm run typecheck:api`: PASS.
- `npm run test:bank-external-ai-import`: PASS, 3 files / 29 tests.
- `npm run test:bank-reconstruction-v4`: PASS, 1 file / 11 tests.
- `npm run test:bank-document-v5-local`: PASS, 6 files / 26 tests.
- `git diff --check`: PASS.
- `test:bank-loan-v3:local`, `test:bank-v2-local`, and `test:debt2b2` were attempted but are blocked because `supabase_db_caja-familiar` is exited (137) and port 54322 is occupied by another local Supabase project; no Production access was used.

## Delivery

- PR #65 remains open against `main` and DRAFT.
- Remote branch was verified at `074ba9654a3c07430e5e94f6227a965296d8c60e` before this metadata closeout.
- Automatic Vercel Preview: deployment `dpl_24aLPR6dBSA32sTijH6Q8xgYbEfV`, branch alias `https://cajafamiliar-git-feat-bank-external-ai-complete-7f0639-renzorex.vercel.app`, exact Git SHA `074ba9654a3c07430e5e94f6227a965296d8c60e`, state `READY`.
- Preview is protected by Vercel SSO; connector/browser verification returned HTTP 302 to Vercel login rather than app HTTP 200. No authenticated browser login was attempted.
- No force push, merge, or Production deployment was performed.

## Production

- Production untouched. No Gemini key, billing change, real bank document, Vercel env write, frontend Production deployment, migration, or merge was performed.

## Next Step

- Stop after the metadata closeout commit and its normal push; the orchestrator may retest the existing-debt UX on the DRAFT Preview.

## Relevant Files

- `src/components/DebtForm.tsx` — existing-debt paid-installment gate, baseline/derivation semantics, and entry-method selection UX.
- `src/utils/bankDocumentCompleteness.ts` — required missing-last-paid completeness issue and pending-only gate.
- `src/utils/bankLoanBaseline.ts` — null/invalid existing baseline consistency handling.
- `src/utils/debtEstimation.ts` — preserves null remaining balance for unknown paid-before input.
- `src/services/dataRepository.ts` — save invariant defense-in-depth.
- `src/components/BankLoanFormUX.test.tsx`, `src/utils/bankDocumentCompleteness.test.ts`, `src/utils/bankLoanOnboardingV3.test.ts` — regression coverage.
