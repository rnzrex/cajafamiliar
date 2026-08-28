# Project State

## Objective

Implement and publish BANK PREPAYMENT RECALCULATION V1 on feat/bank-prepayment-recalculation-v1 for orchestrator audit. Keep PR #66 DRAFT and do not touch Production.

## Repository

- Branch: feat/bank-prepayment-recalculation-v1.
- Base: c46d4b6faaee1cdcb2121a53696f69f757790eb5.
- Prior implementation was 89a562e74782f925a57b42af7caa3d53f7715ec3 (fix(bank): correct prepayment schedule semantics), followed by metadata checkpoints.
- Current Audit Fix 2 implementation commit: 9fe9b5a191c591db3f084f9ba8acbd7ef8e50302 (fix(bank): close prepayment audit blockers), not pushed yet at this checkpoint.
- Working tree is clean; remote branch currently points to eec7c0f1c5ac11a13c09c89f907120431b416416.

## Constraints

- Support only the bank fixed-schedule prepayment lifecycle: regular payment plus extra principal or standalone principal prepayment.
- Preserve installment advance semantics separately; never treat it as principal prepayment.
- Estimated schedules must remain non-contractual and non-authoritative.
- Official post-prepayment entry starts empty and only accepts the bank-delivered schedule; prior schedules are read-only references.
- Automatic simulations require current schedule provenance contractual + authoritative and never persist calculated principal as reported_balance.
- No merge, Production Supabase writes, Gemini key/provider, Vercel env writes, manual Production deploy, real bank documents, financial test data, reset, force push, migration repair, --include-all, or manual SQL against Production.

## Completed

- Corrected deterministic simulateBankPrepayment semantics for original term, insurance modes, upfront/even totals, positive/unknown fees, mid-period dates, future allocations, and warning-based persistence guards.
- Added dedicated official schedule target selection from the exact prepayment event and dedicated update_bank_prepayment_schedule_v1 client path; generic schedule updates remain separate.
- Added one forward-only migration: supabase/migrations/20260827214244_bank_prepayment_schedule_lifecycle_v1.sql. It validates/persists contractual installment numbers and reported balances, preserves estimated history, adds authoritative official replacement with same-trigger idempotency/conflict checks, and exposes only the authenticated public RPC.
- Added a local-only SQL smoke script: scripts/test-bank-prepayment-lifecycle-local.mjs.
- No applied historical migration was modified.
- Fixed insurance with missing/unsupported basis no longer charges an invented amount; standalone prepayments and off-cycle payment + extra principal are conservative non-persistible paths.
- Contractual numbering now rejects mixed explicit/missing rows and preserves all-absent fallback to internal numbers in client and SQL paths.
- Added the fixed-schedule-only guard and stable client translation for update_bank_prepayment_schedule_v1.

## Validation

- npm test -- --testTimeout=15000: PASS, 71 files / 1007 tests.
- npm run test:bank-prepayment-simulation: PASS, 1 file / 17 tests.
- Targeted Audit Fix 2 UX/simulation tests: PASS, 3 files / 28 tests.
- Targeted UX/repository/planning tests: PASS, 4 files / 52 tests.
- npm run test:bank-reconstruction-v4: PASS, 1 file / 11 tests.
- npm run test:bank-document-v5-local: PASS, 6 files / 26 tests.
- npm run build: PASS; only existing dynamic-import and large-chunk warnings.
- npm run typecheck:api: PASS.
- npx tsc -b --pretty false: PASS.
- git diff --check: PASS.
- node --check scripts/test-bank-prepayment-lifecycle-local.mjs: PASS.
- npx supabase db lint --local exited 0 but reported unrelated pre-existing schema warnings/errors and did not validate the pending migration.
- npx supabase db push --local --dry-run was blocked by existing local migration-history drift; no repair/pull/reset/include-all was run.
- npm run test:bank-prepayment-lifecycle:local was attempted only against local Supabase and is blocked before SQL because Docker reports supabase_db_caja-familiar is not running. No container was started. No Production substitute was used. The script now covers estimated reported_balance null, numbering fallback/mixed rejection, and open-ended guard when the container is available.
- Prior local SQL suites (test:bank-loan-v3:local, test:bank-v2-local, test:debt2b2) remain blocked for the same local-container condition.

## Delivery

- gh auth status: authenticated to github.com as rnzrex via keyring/HTTPS; token not exposed.
- PR #66: https://github.com/rnzrex/cajafamiliar/pull/66, open, draft=true, base main, head branch feat/bank-prepayment-recalculation-v1. Body updated for Audit Fix 2; remote head remains eec7c0f1c5ac11a13c09c89f907120431b416416 until the pending push.
- Automatic Preview for the previous pushed SHA: deployment dpl_AqNegND6ftxzntioXa68EcVcCWzk, URL https://cajafamiliar-ployeaqr6-renzorex.vercel.app, branch alias https://cajafamiliar-git-feat-bank-prepayment-recalculation-v1-renzorex.vercel.app, exact Git SHA eec7c0f1c5ac11a13c09c89f907120431b416416, state READY.
- Next delivery step is a normal push of 9fe9b5a, then read-only verification of the automatic Preview exact SHA; no manual deployment.

## Production

- Production untouched. The new migration exists only in the branch and has not been applied to Supabase Production.
- No Production schema/data write, Gemini key/provider configuration, Vercel environment write, frontend Production deployment, merge, real bank document, or test/junk financial data was used.

## Next Step

- Push 9fe9b5a normally, verify PR #66 remains DRAFT and the automatic Preview exact SHA, then stop for orchestrator audit.
- Do not apply 20260827214244_bank_prepayment_schedule_lifecycle_v1.sql in Production from this task.

## Relevant Files

- src/utils/bankPrepaymentSimulation.ts — corrected pure post-prepayment schedule engine.
- src/components/DebtOperationForm.tsx — lifecycle choices, simulation confirmation, and official schedule payload selection.
- src/components/DebtDetailModal.tsx — exact event-targeted official schedule actions.
- src/components/DebtScheduleUpdateForm.tsx — dedicated official schedule-entry mode.
- src/services/dataRepository.ts — dedicated official RPC client serializer/call.
- src/utils/debtPlanning.ts — exact prepayment event target selection.
- supabase/migrations/20260827214244_bank_prepayment_schedule_lifecycle_v1.sql — pending forward-only lifecycle migration.
- scripts/test-bank-prepayment-lifecycle-local.mjs — local-only SQL smoke test.

