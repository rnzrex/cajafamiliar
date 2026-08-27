# Project State

## Objective

Implement and publish BANK PREPAYMENT RECALCULATION V1 on `feat/bank-prepayment-recalculation-v1` for orchestrator audit. Keep PR #66 DRAFT and do not touch Production.

## Repository

- Branch: `feat/bank-prepayment-recalculation-v1`.
- Base: `c46d4b6faaee1cdcb2121a53696f69f757790eb5`.
- Implementation commits: `766d612` (`feat(bank): simulate post-prepayment schedules`) and `1e137c2` (`feat(bank): support prepayment lifecycle and schedule preview`).
- A metadata checkpoint commit is pending after this state update; Git is authoritative for the exact final HEAD.
- No migration file was modified or created.

## Constraints

- Support only the bank fixed-schedule prepayment lifecycle: regular payment plus extra principal or standalone principal prepayment.
- Preserve installment advance semantics separately; never treat it as principal prepayment.
- Estimated schedules must remain non-contractual and non-authoritative.
- No merge, Production Supabase writes, Gemini key/provider, Vercel env writes, manual Production deploy, real bank documents, financial test data, reset, force push, or migration repair.

## Completed

- Added pure deterministic `simulateBankPrepayment` engine with actual/360 and actual/365, contractual future dates, cent rounding, reduce-term, reduce-installment bisection, zero-ending balance, installment total modes, known insurance rules, and warning-based persistence guard.
- Added explicit bank UX cards: REDUCIR PLAZO, REDUCIR CUOTA, TENGO EL NUEVO CRONOGRAMA DEL BANCO, and BANCO TODAVÍA NO ME ENTREGA.
- Added explicit simulation preview and confirmation; estimated schedules save as `scheduleSource=estimated` and rely on the existing v3 RPC to create `reason=prepayment`, `isAuthoritative=false`, and `triggerEventId`.
- Official same-operation schedules save as contractual; pending schedules save principal/effect without inventing rows; existing lifecycle hides pending old obligations.
- Added immediate AppData merge of returned debt-operation RPC results before background authoritative refresh, preserving principal, movements, events, allocations, versions, installments, and contractual installment numbers.
- Added estimated-after-prepayment detail status and official schedule loading action.
- Added regression tests for the engine, UX, immediate operation merge, and installment-advance separation.

## Validation

- `npm test -- --testTimeout=15000`: PASS, 71 files / 994 tests.
- `npm run build`: PASS; existing dynamic-import and large-chunk warnings only.
- `npm run typecheck:api`: PASS.
- `npm run test:bank-prepayment-simulation`: PASS, 10 tests.
- `npm run test:bank-reconstruction-v4`: PASS, 1 file / 11 tests.
- `npm run test:bank-document-v5-local`: PASS, 6 files / 26 tests.
- `git diff --check`: PASS.
- `npm run test:bank-loan-v3:local`, `npm run test:bank-v2-local`, and `npm run test:debt2b2` were attempted only against local Supabase and are blocked because container `supabase_db_caja-familiar` is not running. No local container was started and no Production access/data mutation was used.

## Delivery

- Remote branch was verified after the implementation push at `1e137c27715de22d5ba77e5f6d07b4f11465c5f0`; the metadata checkpoint will advance it normally.
- PR #66: `https://github.com/rnzrex/cajafamiliar/pull/66`, open, `draft=true`, base `main`, head branch `feat/bank-prepayment-recalculation-v1`.
- Automatic Preview for implementation SHA: deployment `dpl_2NEPqhot3efkqGo1UtaC3yJwoLk7`, URL `https://cajafamiliar-l3io1km9p-renzorex.vercel.app`, branch alias `https://cajafamiliar-git-feat-bank-prepayment-recalculation-v1-renzorex.vercel.app`, exact Git SHA `1e137c27715de22d5ba77e5f6d07b4f11465c5f0`, state `READY`.
- The Preview is protected by Vercel SSO; deployment metadata and exact SHA were verified through Vercel API.

## Production

- Production untouched. No Supabase Production migration/data write, Gemini key, Vercel environment write, frontend Production deployment, merge, or test/junk financial data was used.

## Next Step

- Stop after the metadata checkpoint; orchestrator may audit the DRAFT Preview and run real UX tests without adding financial data.
- For a later official schedule entered after a pending prepayment, the existing append-only `update_debt_contractual_schedule_v1` path remains the supported route; its immutable signature does not accept a prepayment trigger/reason, so no applied migration was changed.

## Relevant Files

- `src/utils/bankPrepaymentSimulation.ts` — pure post-prepayment schedule engine.
- `src/components/DebtOperationForm.tsx` — four-choice lifecycle, simulation confirmation, and save payload selection.
- `src/components/DebtDetailModal.tsx` — estimated/pending schedule status and official-loading actions.
- `src/services/authoritativeSync.ts` and `src/App.tsx` — immediate operation result overlay and background reconciliation.
- `src/components/BankPrepaymentUX.test.tsx` — lifecycle/UX regression tests.
- `src/services/authoritativeSyncDebtOperation.test.ts` — immediate result merge regression test.