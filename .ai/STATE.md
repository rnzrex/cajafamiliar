# Project State

## Objective

CREDIT CARDS SEPARATION Phase 1: separate credit cards from generic debt
management at the UX/application-routing layer, while preserving the existing
credit-card ledger and allowing eligible PEN cards as a spending source.

## Active Work

- Work is on `feat/credit-cards-separate-module`, created from `origin/main`.
- Phase 1 implementation is complete in the working tree and has not been
  committed, pushed, or opened as a PR.
- Production is untouched in this phase.
- No SQL, migration, RPC, or Supabase schema change was added; existing card
  RPCs and ledger semantics are reused.

## Repository

- Branch: `feat/credit-cards-separate-module`
- Base: `origin/main` = `f283d5b644046192670b09468319da226e8ef477`
- PR: none yet; create a DRAFT PR only after validation.
- Default branch: `main`
- BANK V2 PR: `#61` — MERGED
- BANK V2 merge commit: `54d26fcce957cf425067b7e18f8a9eb67c45e69e`
- Validated financial code checkpoint: `b859522b0bba761a5e1950305422d487b4bb4575`
- The actual current HEAD must always be read from Git; do not assume this file's commit is the repository HEAD.

## Completed

- Bank-loan onboarding and profile validation.
- Insurance terms and contractual/estimated schedules.
- Payment plus extra principal as one movement.
- Principal prepayment, installment advance, payoff, reversal, and contractual schedule updates.
- Append-only schedule versioning and `pending_bank_schedule` lifecycle/planning guards.
- QAPAQ `open_ended` regression preservation with no synthetic persisted installments.
- Cross-agent continuity layer installed: `AGENTS.md` plus `.ai/{README,STATE,DECISIONS,RUNBOOK}.md`.
- Supabase Production migrations applied in exact repository order:
  - `20260824225428_bank_credit_contract_v2.sql`
  - `20260825010000_bank_credit_contract_v2_audit_fix.sql`
  - `20260825071034_bank_credit_contract_v2_finalization.sql`
  - `20260825165854_bank_credit_contract_v2_schedule_state_guard.sql`
- Remote Production audit confirmed BANK V2 tables, columns, constraints, triggers, RPC signatures, RLS/policies, and zero BANK V2 test/junk rows.
- Supabase advisors reviewed; BANK V2 SECURITY DEFINER warnings are intentional and performance findings are non-blocking.
- Temporary accidental `noop` Edge Function removed; `reset-commercial-password` remains ACTIVE as the restored baseline.
- PR #61 merged into `main`.
- Vercel Production deployment `dpl_Egz921J8wJioBbSQpATsqhjFrGM1` reached READY for merge commit `54d26fcce957cf425067b7e18f8a9eb67c45e69e`.
- Public Production URL `https://cajafamiliar.vercel.app` returned HTTP 200.
- Recent Vercel Production runtime error check returned no errors.
- Added the top-level Tarjetas module and independent credit-card registration
  form without automatic income creation.
- Removed `credit_card` from generic debt onboarding and filtered cards out of
  generic debt planning, strategy, portfolio, and manager views.
- Added active non-archived PEN cards as an explicit spending source in
  `MovementForm`; recurring-payment flows cannot select cards.
- Routed card purchases through the existing atomic credit-card operation
  dispatcher with stable retry IDs and protected card movement contexts.
- Passed card entries and debts into movement exports so card currencies and
  totals resolve correctly.
- Added Tarjetas navigation, detail routing, legacy deep-link compatibility,
  statement alerts, focused eligibility tests, and updated UX tests.

## Active

- Credit Cards Phase 1 is ready for final diff review and an explicit
  commit/push decision.
- Browser-level preview/E2E validation has not been run in this session.

## Blocked

- None known after sequential local validation.
- The pre-existing statement-close RPC does not independently reject archived
  or non-active cards; its historical migration was intentionally not changed
  in this UI/application-layer phase.

## Next Move

1. Inspect the final working-tree diff and status for accidental or unrelated changes.
2. If explicitly authorized, create a coherent commit, push normally, and open a
   DRAFT PR toward `main`; do not merge.
3. Run preview/browser validation before any future production decision.

## Validation

- `npm test`: PASS, 51 files / 860 tests.
- `npm run typecheck:api`: PASS.
- `npm run build`: PASS.
- `npm run test:bank-v2-local`: PASS.
- `npm run test:debt2b2`: PASS.
- `npm run test:debt5fa:local`: PASS with Auth enabled temporarily for the
  local smoke; `supabase/config.toml` was restored to `auth.enabled = false`
  and the temporary Auth container was stopped.
- `git diff --check`: PASS.
- Build emitted existing chunk-size and ineffective dynamic-import warnings.
- Vercel Preview: not run for Credit Cards Phase 1.
- Vercel Production: READY.
- Production HTTP: 200.
- Production runtime errors after merge: none found.

## Production

- Supabase migration status: BANK V2 APPLIED.
- BANK V2 schema/RLS/RPC verification: PASS.
- BANK V2 test/junk data: none created.
- Edge Function cleanup: PASS.
- Frontend deployment: READY.
- Runtime error check: clean.
- Credit Cards Phase 1 changes: untouched / not deployed.

## Safety / Do Not

- Do not edit historical/applied BANK V2 migrations; use a new migration for future SQL changes.
- Do not create test or junk Production financial data.
- Do not rewrite history, reset destructively, force push, expose secrets, change billing, or perform unrelated destructive work.
- Preserve legacy non-bank behavior and the validated QAPAQ/cards regressions.

## Key Files

- `AGENTS.md`
- `.ai/README.md`
- `.ai/STATE.md`
- `.ai/DECISIONS.md`
- `.ai/RUNBOOK.md`
- `supabase/config.toml`
- `supabase/migrations/20260824225428_bank_credit_contract_v2.sql`
- `supabase/migrations/20260825010000_bank_credit_contract_v2_audit_fix.sql`
- `supabase/migrations/20260825071034_bank_credit_contract_v2_finalization.sql`
- `supabase/migrations/20260825165854_bank_credit_contract_v2_schedule_state_guard.sql`
- Expected Phase 1 files: `src/App.tsx`, `src/components/DebtForm.tsx`,
  `src/components/DebtsManager.tsx`, `src/components/MovementForm.tsx`,
  existing credit-card components, and focused tests.
- Phase 1 additions: `src/components/CreditCardForm.tsx`,
  `src/components/CreditCardsManager.tsx`,
  `src/utils/creditCardSpending.ts`, and its focused test.

## Last Handoff

- Agent: OpenCode
- Date: 2026-08-25
- Summary: implemented and validated Credit Cards Separation Phase 1 on the
  verified `origin/main` baseline; BANK V2 remains closed and Production
  untouched. Final code remains uncommitted pending explicit commit/push
  authorization.
