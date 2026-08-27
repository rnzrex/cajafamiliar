# Project State

## Objective

Close the bank-loan onboarding UX gate on `feat/bank-external-ai-complete-dossier-v1`, publish the fix for orchestrator audit, and keep PR #65 in DRAFT.

## Repository

- Branch: `feat/bank-external-ai-complete-dossier-v1`.
- Current local HEAD before this metadata commit: `86d190b90c0748d0f2b0d1c8cc176855d28179db`.
- Feature commits: `5687eaa` (`feat(bank): add explicit current principal calculation`) and `86d190b` (`fix(debt): surface created debt immediately after save`), both pushed normally to origin.
- Git is authoritative for the exact HEAD after this metadata checkpoint.
- Applied migrations remain untouched and immutable.

## Constraints

- Calculated current principal is a suggestion only; the user must explicitly confirm it with `CALCULAR` / `USAR CÁLCULO`.
- Blank `none` principal remains unknown/null; manual and explicitly imported principal provenance remains distinct.
- Created debt rows must be visible immediately after save through the returned create result, followed by background authoritative reconciliation.
- No migration changes, Supabase Production writes, Gemini key/provider calls, Vercel env/deploy changes, merge, or financial test data.
- PR #65 must remain open against `main` and DRAFT.

## Completed

- Added source-aware calculated-principal semantics, explicit confirmation, recalculation after `paidBefore` changes, manual override, invalidation, and friendly completeness guidance.
- Added `DebtForm.onSaved(result)` propagation for `createDebt` / `createBankLoan`.
- Added idempotent AppData merging for returned debt, schedule version, installments, and collaterals; unrelated rows are preserved and pending results survive stale/failed refreshes.
- Added regression coverage for principal UX/completeness and immediate post-save debt visibility.

## Validation

- `npm test -- --testTimeout=15000`: PASS, 68 files / 981 tests.
- `npm run build`: PASS; only existing dynamic-import and large-chunk warnings.
- `npm run typecheck:api`: PASS.
- `npm run test:bank-external-ai-import`: PASS, 3 files / 29 tests.
- `npm run test:bank-reconstruction-v4`: PASS, 1 file / 11 tests.
- `npm run test:bank-document-v5-local`: PASS, 6 files / 26 tests.
- `git diff --check`: PASS.
- `test:bank-loan-v3:local`, `test:bank-v2-local`, and `test:debt2b2` were attempted but are blocked because the local `supabase_db_caja-familiar` container is not running; no Production access or data mutation was used.

## Delivery

- Remote branch currently verified at `86d190b90c0748d0f2b0d1c8cc176855d28179db`.
- PR #65: `https://github.com/rnzrex/cajafamiliar/pull/65`, open, `draft=true`, head branch `feat/bank-external-ai-complete-dossier-v1`, head SHA `86d190b90c0748d0f2b0d1c8cc176855d28179db`.
- PR description updated with explicit principal confirmation, immediate AppData merge, background reconciliation, and no-reload behavior.
- Automatic Vercel Preview: deployment `dpl_3F2SDjcCoauPebd2H4cSYvpSkbJu`, URL `https://cajafamiliar-2wsz32upn-renzorex.vercel.app`, branch alias `https://cajafamiliar-git-feat-bank-external-ai-complete-7f0639-renzorex.vercel.app`, exact Git SHA `86d190b90c0748d0f2b0d1c8cc176855d28179db`, state `READY`.
- No force push, merge, Production deployment, or Vercel environment write was performed.

## Production

- Production untouched. No Gemini key, billing change, real bank document, financial test data, Vercel env write, frontend Production deployment, migration, or merge was performed.

## Next Step

- Stop after this metadata checkpoint; orchestrator may perform the final real bank-loan UX retest from the DRAFT Preview.

## Relevant Files

- `src/components/DebtForm.tsx` — explicit principal calculation action, source semantics, and create-result propagation.
- `src/utils/bankDocumentCompleteness.ts` — current-principal required/confirmed behavior.
- `src/services/authoritativeSync.ts` — idempotent create-result merge and containment helpers.
- `src/App.tsx` — immediate debt merge plus background authoritative refresh.
- `src/components/BankLoanFormUX.test.tsx`, `src/utils/bankDocumentCompleteness.test.ts`, `src/services/authoritativeSyncDebtCreate.test.ts`, `src/App.test.tsx` — regression coverage.
