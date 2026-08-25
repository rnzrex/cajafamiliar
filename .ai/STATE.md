# Project State

## Objective

BANK CREDIT CONTRACT V2 is functionally audited. The cross-agent continuity
layer is installed. The project is prepared for the Production/merge gate.

## Active Work

- No functional change is pending.
- Next work: close BANK CREDIT CONTRACT V2 in Production.

## Repository

- Expected branch: `feat/bank-credit-contract-v2`
- PR: `#61` (DRAFT)
- Validated financial code checkpoint: `b859522b0bba761a5e1950305422d487b4bb4575`
- Remote base: `origin/main` = `82a3c8871a801324b32a5fc1c8d2c945ace8010a`
- Worktree expectation: clean after this state commit.
- Code checkpoint commit: `b859522...` is the last validated financial code;
  continuity commit and push status must be read from Git.
- The actual HEAD must always be obtained from Git; do not store a circular
  claim that this file is in the same commit as the current HEAD.
- Local `main` is `b28119ae87afd3f61c85ce7050190ba4676c9e7c`, behind
  `origin/main`; do not reconcile it with reset or merge as part of this work.

## Completed

- Bank-loan onboarding and profile validation.
- Insurance terms and contractual or estimated schedules.
- Payment plus extra principal as one movement.
- Principal prepayment, installment advance, payoff, and reversal.
- Append-only schedule versioning and contractual schedule updates.
- `pending_bank_schedule` lifecycle and planning guards.
- QAPAQ `open_ended` regression preservation with no synthetic persisted installments.
- BANK CREDIT CONTRACT V2 functional audit and validation at the checkpoint above.
- Cross-agent continuity layer:
  - `AGENTS.md`
  - `.ai/README.md`
  - `.ai/STATE.md`
  - `.ai/DECISIONS.md`
  - `.ai/RUNBOOK.md`
- Continuity commit `ae39d9697ef55e51a476bfe1465b4777b501f71a` published.
- Orchestrator continuity audit completed.

## Active

- No functional change is pending.
- The next authorized work is the Production closing sequence for BANK V2.

## Blocked

- No functional blocker is known.
- BANK V2 has not yet been applied in Production.
- PR `#61` remains DRAFT.
- The stale local `main` is not a blocker and must not be fixed with reset.

## Next Move

1. Verify Git, PR, and Production pre-state.
2. Apply BANK V2 migrations to Production in order.
3. Verify schema, RPCs, RLS, and advisors.
4. Verify that no test or junk data was created.
5. If everything is correct, merge PR `#61`.
6. Wait for and verify Vercel Production.
7. Run non-destructive Production smoke and regression checks.
8. Update STATE with the final closing result.

Documented only here; do not execute these steps in this state commit.

## Validation

- `npm test`: PASS, 50 files / 855 tests.
- `npm run typecheck:api`: PASS.
- `npm run build`: PASS.
- `npm run test:bank-v2-local`: PASS.
- `npm run test:debt2b2`: PASS.
- `npm run test:debt5fa:local`: PASS.
- `git diff --check`: PASS.
- Vercel Preview: PASS.

## Production

- touched: no
- migration status: BANK V2 NOT APPLIED
- deployment status: pending the Production gate

## Safety / Do Not

- Do not modify validated financial logic or committed BANK V2 migrations during the closing sequence unless a newly discovered blocker requires a separate audited change.
- Production, Supabase, remote SQL, and Vercel Production actions must follow the documented closing sequence and the authorization available in the current session/environment.
- Do not create test or junk Production data.
- Do not rewrite commits, reset, clean, force push, expose secrets, change billing, or perform unrelated/destructive work.
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

- Agent: OpenCode
- Date: 2026-08-25
- Summary: finalized the semantic handoff after continuity commit `ae39d96...`;
  the validated financial checkpoint remains `b859522...`.
