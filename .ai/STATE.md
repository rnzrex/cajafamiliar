# Project State

## Objective

Complete the orchestrator audit fix gate for `CAJA FAMILIAR UNIVERSAL DEBT CONTRACT ENGINE V1` on `feat/universal-debt-contract-engine-v1`, publish the validated fix as an OPEN/DRAFT PR #67, verify the automatic Preview, and stop before any Production action.

## Repository

- Branch: `feat/universal-debt-contract-engine-v1`.
- Base: `86bb5eb4ef1ed8344abfb8f0fbcbcf2eeff0622f` from `origin/main`.
- Pre-fix HEAD: `ec2550d2c6450e92e7ce8284cbeb0bbc9a94f7ea`.
- PR: #67, `https://github.com/rnzrex/cajafamiliar/pull/67`, OPEN and DRAFT.
- Audit-fix implementation commit: `ef58e5ddb8c4302499c7dcdf5aceb13ad733a21d` (`fix: complete universal debt lifecycle audit gate`).
- No reset, clean, force push, merge, migration repair, include-all, or unrelated work.

## Constraints

- No Supabase Production SQL/schema/data, real financial documents, Gemini key/provider, Vercel env writes, Production frontend deployment, merge, or ready-for-review transition.
- Additive migration only; no historical migration was changed.
- Disposable PostgreSQL 17 local testing is allowed; its fixture data is not Production data.

## Completed

- Routed non-bank fixed standalone payments, extra principal, prepayments, pending schedules, contractual replacements, advances, allocations, reversals, and idempotent replays through universal structure-driven wrappers while preserving Bank V3 delegation and guards.
- Added exact universal schedule arithmetic with positive/zero/null tax semantics, effective allocations, carried residuals, overdue/next/total projections, and unknown component handling.
- Added generic non-bank simulation for nominal TNA actual/360 and actual/365, effective annual, and effective periodic rates; schedule-only/unknown terms remain insufficient instead of invented.
- Added four creditor-neutral prepayment choices and separate asset/down/scheduled/financed/opening principal fields in debt creation.
- Added External AI V2 prompt, JSON parser, normalization, authority review, proforma warning, all-row mapping, metadata job persistence, and universal schedule import; the sanitized 129-row fixture passes through the same parser/mapper.
- Added refinancing comparison with component/cost/contribution/payment/term deltas, explicit pending or imported target schedule, stable retry IDs, cash-neutral settlement, cost/contribution movements, household isolation, portfolio exclusion, and reversal dependency guard.
- Added additive migration `supabase/migrations/20260830100000_universal_debt_contract_engine_v1.sql`; static hygiene reports additive-only with 13 required symbols and 0 forbidden terms.

## Validation

- `npx vitest run --maxWorkers=1`: PASS — 76 files, 1,059 tests.
- `npm run test:universal-debt-contract-engine`: PASS — 2 files, 22 tests; migration hygiene PASS.
- BANK reconstruction: PASS — 11 tests.
- BANK prepayment simulation: PASS — 18 tests.
- BANK external AI/import: PASS — 3 files, 29 tests.
- BANK document V5: PASS — 6 files, 26 tests.
- `npm run typecheck:api`: PASS.
- `npm run build`: PASS; only existing dynamic-import and large-chunk warnings.
- `git diff --check` and Node syntax check: PASS.
- Universal PG17 disposable smoke: PASS — standalone non-bank prepayment, replay, payments/extra principal, positive-tax schedule/prepayment, partial allocation/reversal, advance, authority/document V2, refinancing, isolation, safe reversal, movements, and dependency guard.
- BANK V2 local smoke: PASS.
- BANK onboarding V3 local smoke: PASS.
- Generic DEBT-2B.2 local smoke: PASS.
- BANK prepayment lifecycle rerun against `supabase_db_caja-familiar` is environment-blocked by that container's stale `recurring_payments` schema (`last_paid_month` missing); this is unrelated to the universal migration and the prior disposable PG17 lifecycle run passed.
- Disposable schema audit: required universal columns/table present; RLS enabled on financing contract, refinance lineage, schedule versions, installments, and document jobs; authenticated SELECT/EXECUTE grants are present for the intended tables/RPCs.
- Migration SHA-256: `549452ECDB96E92068E544B19804B7B3F56FA2DC28D7FBCED03A7FA2A0631848`.
- Schema snapshot SHA-256: `093CBEB8DD4E5D6812C062BF48080379AE8F3E3C5B8254E4DB6630C3ADF60780`.

## Delivery

- The audit-fix commit is pushed without force; remote SHA verified as `ef58e5ddb8c4302499c7dcdf5aceb13ad733a21d`.
- PR #67 remains OPEN/DRAFT and MERGEABLE.
- Automatic Preview for the pushed audit-fix SHA is READY at `https://cajafamiliar-o0bfcuf8f-renzorex.vercel.app`; Vercel metadata matches the exact SHA and build/runtime error scan is clean.
- No further code changes are planned; stop at this DRAFT/Preview gate and do not apply Production.

## Production

- Production untouched: no Production SQL/schema/data, no test/junk financial records, no real uploads, no frontend deployment, no Vercel env changes, no Gemini secret, no merge.

## Relevant Files

- `supabase/migrations/20260830100000_universal_debt_contract_engine_v1.sql` — additive universal contract, schedule metadata/import, lifecycle wrappers, and refinancing lineage.
- `src/utils/universalDebtContract.ts` — universal state, tax arithmetic, TNA, residual, and refinance comparison logic.
- `src/utils/universalDebtSimulation.ts` — generic non-bank fixed schedule simulation.
- `src/utils/universalDebtDocumentImport.ts` — External AI V2 prompt, parser, normalizer, and mapper.
- `src/components/UniversalDebtDocumentImportPanel.tsx` — user-facing no-API document import/review/save path.
- `src/components/DebtOperationForm.tsx` — universal non-bank lifecycle UX while preserving Bank UX.
- `src/components/DebtRefinanceForm.tsx` — target schedule/pending refinance workflow and comparison.
- `src/services/dataRepository.ts`, `src/types.ts` — RPC mappings and domain contracts.
- `scripts/test-universal-debt-contract-engine-local.mjs` — repeatable disposable PostgreSQL 17 end-to-end smoke suite.
