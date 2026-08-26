# Project State

## Objective

BANK LOAN ONBOARDING V3 is CLOSED in Production.

The bank-loan onboarding now supports existing-loan baselines without synthetic history, contractual numbering distinct from internal schedule numbering, XLSX/XLS/CSV/TSV/TXT schedule import, fixed-total insurance semantics, original-contract estimation, and the reordered six-step bank UX.

## Repository

- Default branch: `main`.
- PR #63: MERGED.
- Validated PR head: `389aeff376a38b6a1b4e3c85fde551d037254940`.
- Merge commit: `65851e7e11f597e858e2eea606368dd04e78be9c`.
- Read Git for the current HEAD because this continuity update is committed after the functional merge.

## Completed — BANK LOAN ONBOARDING V3

- Added `bank_loan_profiles.installments_paid_before_tracking`.
- Added `debt_installments.contractual_installment_number` and `is_paid_before_tracking`.
- Pre-tracking installments are metadata-only: no historical movements, debt events, expenses, account changes, or allocations are fabricated.
- Internal schedule numbering remains 1..N; contractual numbering preserves bank numbering such as 6..18 for partial imports.
- Initial partial contractual schedules must start at `installments_paid_before_tracking + 1`; partial estimated schedules are rejected.
- Pre-tracking rows cannot receive allocations; later schedule versions cannot inherit the baseline flag.
- Bank form order: 1 Sobre el crédito, 2 Contrato original, 3 Situación actual, 4 Seguros y costos, 5 Cronograma, 6 Revisión.
- Partial imports do not overwrite the original first due date; the first pending imported date is separate.
- Import supports XLSX/XLS/CSV/TSV/TXT with aliases, preview, manual mapping, duplicate/continuity/date validation, and full or pending-only schedules.
- Estimation prioritizes original financed amount, supports contractual periodic rate, does not use TCEA for interest, and compares theoretical vs actual current principal without overwriting the real baseline.
- Fixed insurance supports per-installment, total-even, upfront, and unknown-distribution buckets independently, including cent adjustment.
- Agenda, planning, intelligence, and debt detail share the contractual next-installment SSOT.
- Existing BANK V2, QAPAQ, non-bank debt, pledge, credit-card, account, and movement semantics were preserved by regression coverage.

## Validation

- `npm test`: PASS — 55 files / 893 tests.
- Focused BANK V3: PASS — 15 tests.
- DebtForm bank UX: PASS — 4 tests.
- Build: PASS.
- Typecheck API: PASS.
- `git diff --check`: PASS.
- BANK V3 SQL smoke: PASS.
- BANK V2 / DEBT2B2 / DEBT5FA local suites: PASS.
- Local HTTP smoke: 200.
- Vercel Preview for final PR head `389aeff...`: READY.

## Supabase Production

Project: `dxogrdvgdbvbdyoepqtx`.

- Migration applied exactly: `20260826141250_bank_loan_onboarding_v3`.
- Historical BANK V2 migrations remain unchanged.
- Production audit PASS for new columns/defaults/constraints/index/triggers, `create_bank_loan_v1`, partial-schedule guard, allocation guard, RLS, and policy presence.
- `create_bank_loan_v1` remains the intentional authenticated SECURITY DEFINER RPC with `auth.uid()`, household-membership authorization, `search_path=''`, and no EXECUTE for `anon`.
- Security/performance advisors were reviewed. Current notices are pre-existing/intended or informational; the new pretracking index is naturally reported unused immediately after creation.
- No Production test/junk financial data was created. No synthetic historical payments were inserted.

## Vercel Production

- Functional merge deployment: `dpl_84PKvggUcWDpY5UQWcepggKgBeXM`.
- Deployment Git SHA: `65851e7e11f597e858e2eea606368dd04e78be9c`.
- State: READY.
- `https://cajafamiliar.vercel.app`: HTTP 200.
- Runtime `error` / `fatal` check after deployment: no entries.

## BANK V2 / Migration Safety

Do not edit applied migrations:

- `20260824225428_bank_credit_contract_v2.sql`
- `20260825010000_bank_credit_contract_v2_audit_fix.sql`
- `20260825071034_bank_credit_contract_v2_finalization.sql`
- `20260825165854_bank_credit_contract_v2_schedule_state_guard.sql`
- `20260826141250_bank_loan_onboarding_v3.sql`

Future SQL changes require a new additive migration. Never use destructive reset/clean/force-push workflows for routine work.

## Next Move

BANK LOAN ONBOARDING V3 has no pending implementation gate. Reopen it only for a concrete Production regression or explicit new scope.

The next planned debt-domain objective is broader Peru debt taxonomy coverage (for example non-card revolving credit, overdraft, leasing/lease-back, merchant financing, and business-credit classifications), but it is not part of BANK V3.

## Last Handoff

- Agent: ChatGPT orchestrator.
- Date: 2026-08-26.
- Summary: Production schema audit passed, PR #63 was marked ready and merged with exact expected head, merge deployment reached READY, public Production returned HTTP 200, and runtime error/fatal logs were clean. BANK LOAN ONBOARDING V3 is CLOSED in Production.
