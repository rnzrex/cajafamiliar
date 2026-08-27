# Project State

## Objective

Fix the existing-bank-debt onboarding gate and bank-contract entry-method UX on `feat/bank-external-ai-complete-dossier-v1`, then keep PR #65 in DRAFT for orchestrator audit.

## Repository

- Branch: `feat/bank-external-ai-complete-dossier-v1`.
- Baseline before this fix: `6663157a424104c33d5012f0fbca9fe3dd55f7b4`.
- The working tree contains the paid-installment validation, null-preserving baseline logic, completeness gate, selection-only cards, and regression coverage; it is not committed yet.
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
- Next command: commit the coherent fix, push normally to the same branch, verify remote SHA/PR/Preview, then stop.

## Production

- Production untouched. No Gemini key, billing change, real bank document, Vercel env write, frontend Production deployment, migration, or merge was performed.

## Next Step

- Commit and push the fix without force; verify the automatic Vercel Preview matches the pushed SHA and remains non-Production.

## Relevant Files

- `src/components/DebtForm.tsx` — existing-debt paid-installment gate, baseline/derivation semantics, and entry-method selection UX.
- `src/utils/bankDocumentCompleteness.ts` — required missing-last-paid completeness issue and pending-only gate.
- `src/utils/bankLoanBaseline.ts` — null/invalid existing baseline consistency handling.
- `src/utils/debtEstimation.ts` — preserves null remaining balance for unknown paid-before input.
- `src/services/dataRepository.ts` — save invariant defense-in-depth.
- `src/components/BankLoanFormUX.test.tsx`, `src/utils/bankDocumentCompleteness.test.ts`, `src/utils/bankLoanOnboardingV3.test.ts` — regression coverage.
