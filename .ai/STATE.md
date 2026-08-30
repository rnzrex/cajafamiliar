# Project State

## Objective

Complete the final financial-precision fix gate for `CAJA FAMILIAR UNIVERSAL DEBT CONTRACT ENGINE V1` on `feat/universal-debt-contract-engine-v1`, publish the validated code as OPEN/DRAFT PR #67, verify a new exact-SHA Preview, and stop before any Production action.

## Repository

- Branch: `feat/universal-debt-contract-engine-v1`.
- Base: `86bb5eb4ef1ed8344abfb8f0fbcbcf2eeff0622f` from `origin/main`.
- Starting HEAD: `8628dee4f6da2a0cf0cffb45418f7ae17c7500e9`.
- PR: #67, `https://github.com/rnzrex/cajafamiliar/pull/67`, OPEN and DRAFT.
- Six implementation/test files are currently modified and ready for one justified checkpoint commit; the migration and schema snapshot are unchanged.

## Constraints

- No Supabase Production SQL/schema/data, real financial documents, Gemini key/provider, Vercel env writes, Production frontend deployment, merge, or ready-for-review transition.
- Additive migration only; no historical migration was changed.
- Disposable PostgreSQL 17 local testing is allowed; all fixture data is local-only and sanitized.
- Do not use the stale `supabase_db_caja-familiar` for the final BANK lifecycle gate because it lacks `recurring_payments.last_paid_month`.

## Completed

- Corrected universal post-prepayment fee semantics: `unknown` and `contract_schedule_only` now return null fees instead of copying original schedule fees; fixed/percentage/supported formula fees still calculate.
- Corrected refinance comparison semantics: omitted/null components remain unknown, explicit zero remains known, independently supplied complete totals remain usable, and costs/contributions are added exactly once.
- Expanded the External AI V2 prompt with complete contract fields, rate/fee/prepayment semantics, authority evidence, null-versus-zero, no TCEA installment interest, no TNA-to-TEA conversion, all rows, and PII omission rules.
- Extended the 129-row fixture through the same parser/mapper with principal basis, schedule-only fee semantics, null unknown tax percentage, official non-contractual authority, exact reconciliation, and no down-payment double count.
- Preserved imported target contract authority in `DebtRefinanceForm` for contractual, official_noncontractual, user_reported, estimated, and unknown documents; unknown imported schedules remain loadable with source null.
- Added regressions for both unknown fee modes, refinance component/cost/contribution precision, complete prompt semantics, 129-row contract semantics, and all refinance authority values.

## Validation

- Universal targeted suite: PASS — 2 files, 30 tests; migration hygiene PASS (additive-only, 13 required symbols, 0 forbidden terms).
- BANK reconstruction: PASS — 1 file, 11 tests.
- BANK prepayment simulation: PASS — 1 file, 18 tests.
- BANK external AI/import: PASS — 3 files, 29 tests.
- BANK document V5: PASS — 6 files, 26 tests.
- Full Vitest: PASS — 76 files, 1,067 tests.
- Typecheck: PASS (`npm run typecheck:api`). Build: PASS; only existing dynamic-import and large-chunk warnings.
- Node syntax checks for all `scripts/*.mjs` and `git diff --check` passed.
- Clean disposable PostgreSQL 17 container `bank_lifecycle_clean_pg17` (schema snapshot plus unreleased universal migration, local-only grants/trigger harness adjustment) passed: BANK prepayment lifecycle scenarios 1–30, BANK V3, BANK V2, DEBT2B2, and universal SQL smoke.
- Clean BANK lifecycle result is authoritative for this gate; the stale developer database failure was `last_paid_month` missing and is irrelevant to the clean result.
- Clean PG17 RLS/grants audit: required new columns present, RLS enabled on financing contracts/refinance links/schedules/installments/document jobs, authenticated read/execute paths present for intended targets/RPCs.
- Migration SHA-256: `549452ECDB96E92068E544B19804B7B3F56FA2DC28D7FBCED03A7FA2A0631848`.
- Schema snapshot SHA-256: `093CBEB8DD4E5D6812C062BF48080379AE8F3E3C5B8254E4DB6630C3ADF60780`.

## Next Step

- Commit only these precision fixes/tests/prompt/form documentation plus required state; push without force; rerun clean PG17 smoke at the final commit SHA; wait for the new Preview; verify exact final SHA/HTTP 200/logs; update PR #67 body with final evidence while keeping OPEN/DRAFT; stop.

## Production

- Production untouched. Observed Production baseline remains migration `20260827214244 bank_prepayment_schedule_lifecycle_v1`; no Production SQL, schema/data mutation, financial test data, real upload, frontend deployment, Vercel env change, Gemini key, or merge occurred.

## Relevant Files

- `src/utils/universalDebtSimulation.ts` — preserves unknown post-prepayment fees.
- `src/utils/universalDebtContract.ts` — null-safe refinance comparison.
- `src/utils/universalDebtDocumentImport.ts` — complete External AI V2 prompt.
- `src/components/DebtRefinanceForm.tsx` — preserves imported contract authority.
- `src/utils/universalDebtContract.test.ts` — precision and 129-row parser regressions.
- `src/components/DebtRefinanceForm.test.tsx` — authority-preservation UX regressions.
- `supabase/migrations/20260830100000_universal_debt_contract_engine_v1.sql` — unchanged additive migration under audit.