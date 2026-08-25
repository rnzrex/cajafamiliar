# Project State

## Objective

BANK CREDIT CONTRACT V2 is closed in Production. The feature is merged to `main`, Supabase migrations are applied and verified, Vercel Production is healthy, and the cross-agent continuity layer is active.

## Active Work

- No BANK CREDIT CONTRACT V2 work is pending.
- Future agents should treat this feature as a closed baseline unless a real regression is observed.

## Repository

- Default branch: `main`
- PR: `#61` — MERGED
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

## Active

- No active BANK V2 task.

## Blocked

- None known.

## Next Move

1. Start the next product objective from current `main`.
2. Before any new work, run the mandatory bootstrap from `AGENTS.md` and read this state plus `.ai/DECISIONS.md` and `.ai/RUNBOOK.md`.
3. Reopen BANK V2 only if a concrete Production regression is observed.

## Validation

- `npm test`: PASS, 50 files / 855 tests.
- `npm run typecheck:api`: PASS.
- `npm run build`: PASS.
- `npm run test:bank-v2-local`: PASS.
- `npm run test:debt2b2`: PASS.
- `npm run test:debt5fa:local`: PASS.
- `git diff --check`: PASS.
- Vercel Preview: PASS.
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

## Last Handoff

- Agent: ChatGPT orchestrator
- Date: 2026-08-25
- Summary: BANK CREDIT CONTRACT V2 is closed; Production database and frontend are deployed and verified, PR #61 is merged, and no blocker remains.
