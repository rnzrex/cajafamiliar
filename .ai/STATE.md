# Project State

## Objective

CREDIT CARDS SEPARATION Phase 1: separate credit cards from generic debt
management at the UX/application-routing layer, while preserving the existing
credit-card ledger and allowing eligible PEN cards as a spending source. Harden
authoritative refresh handling so active MovementForm drafts are not lost, and
complete the final audit fixes for rates, historical references, and AuthGate.

## Active Work

- Work is on `feat/credit-cards-separate-module`, created from `origin/main`.
- Phase 1 implementation and the sync draft-preservation fix are pushed through commits
  `be0be8163393562f0f1e1250f3bb723a63ce7375` and
  `3dc6346f03e87c484175bb3c704d281724b6bdb0`, plus
  `a5fcfee fix(sync): preserve unsaved drafts across refresh`.
- DRAFT PR #62 is open at
  `https://github.com/rnzrex/cajafamiliar/pull/62`.
- The final audit fixes are implemented locally but have not been committed or
  pushed yet; the current Git HEAD remains `5cf42a96cae29251436bdabe5939e586c43011f5`.
- Production is untouched in this phase.
- No SQL, migration, RPC, or Supabase schema change was added; existing card
  RPCs and ledger semantics are reused.

## Repository

- Branch: `feat/credit-cards-separate-module`
- Base: `origin/main` = `f283d5b644046192670b09468319da226e8ef477`
- PR: `#62` — DRAFT; orchestrator audit pending.
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
- Changed `MovementForm` hydration to use logical movement/draft identity rather
  than authoritative array references, preserving dirty fields across refreshes.
- Preserved unavailable selected accounts, cards, and categories with explicit
  validation instead of silently falling back to another source.
- Kept the authorized App mounted during membership revalidation failures and
  exposed a retry through the existing sync control.
- Added `MovementFormSync.test.tsx` covering expenses, income, cards, recurring
  drafts, logical movement transitions, unavailable sources/categories, and
  successful reset after save.
- Added optional TEA/TCEA fields to `CreditCardForm`, including non-negative
  validation, numeric payload values, and exact `null` values for blank fields.
- Added historical account/category preservation for existing movements and
  regression coverage for archived references plus active reselection.
- Added `CreditCardForm.test.tsx` and `AuthGate.test.tsx` for the final audit
  payload and membership-revalidation behaviors.
- Ran real Chrome local smoke coverage for expense, income, and PEN card drafts:
  each remained intact after more than 21 seconds of periodic refresh; expense
  and card cases also survived a real target/tab switch with hidden/visible
  events.

## Active

- Credit Cards Phase 1, sync preservation, and final audit fixes are awaiting
  one commit/push checkpoint in DRAFT PR #62.
- Local browser smoke passed; Vercel Preview for the final audit commit is still
  pending because the commit has not been pushed.

## Blocked

- None known after sequential local validation.
- The pre-existing statement-close RPC does not independently reject archived
  or non-active cards; its historical migration was intentionally not changed
  in this UI/application-layer phase.

## Next Move

1. Review and commit only the intended audit files, then push normally.
2. Verify the resulting Vercel Preview/checks and update DRAFT PR #62.
3. Do not merge or touch Production from this branch.

## Validation

- `npm test`: PASS, 54 files / 877 tests.
- `npx vitest run src/components/CreditCardForm.test.tsx src/components/MovementFormSync.test.tsx src/components/AuthGate.test.tsx`: PASS, 3 files / 17 tests.
- Focused authoritative, card, debt, and reconciliation suites: PASS.
- `npm run typecheck:api`: PASS.
- `npm run build`: PASS.
- `npm run test:bank-v2-local`: PASS.
- `npm run test:debt2b2`: PASS.
- `npm run test:debt5fa:local`: PASS with Auth enabled temporarily for the
  local smoke; `supabase/config.toml` was restored to `auth.enabled = false`
  and the temporary Auth container was stopped.
- `git diff --check`: PASS.
- Local built preview: HTTP 200; real Chrome smoke passed expense, income, and
  PEN card draft preservation after periodic refresh and visibility changes.
- Build emitted existing chunk-size and ineffective dynamic-import warnings.
- Vercel Preview: pending final audit commit push.
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
- Credit Cards Phase 1 and sync draft-preservation changes: untouched / not deployed.

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
- Sync fix additions: `src/components/AuthGate.tsx` and
  `src/components/MovementFormSync.test.tsx`.
- Final audit tests: `src/components/CreditCardForm.test.tsx` and
  `src/components/AuthGate.test.tsx`.

## Last Handoff

- Agent: OpenCode
- Date: 2026-08-26
- Summary: implemented final audit fixes for TEA/TCEA payloads, historical
  movement references, and AuthGate coverage. Full tests (54/877), build, API
  typecheck, BANK/QAPAQ local smokes, focused suites, and real Chrome local
  browser smoke pass. Auth was restored to disabled and its temporary container
  stopped. Changes remain uncommitted/unpushed; next move is the normal Git
  checkpoint and DRAFT PR update. Production remains untouched.
