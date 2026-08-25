# Project State

## Objective

BANK CREDIT CONTRACT V2 is functionally audited and prepared for the
Production closing sequence. This handoff adds only shared cross-agent
continuity documentation. It must not change financial behavior.

## Active Work

- Add and publish the continuity layer in a separate documentation-only commit.
- After this handoff, the next agent must perform the brief orchestrator audit
  before any Production or merge action.

## Repository

- Expected branch: `feat/bank-credit-contract-v2`
- PR: `#61` (DRAFT)
- Validated code checkpoint: `b859522b0bba761a5e1950305422d487b4bb4575`
- Remote base: `origin/main` = `82a3c8871a801324b32a5fc1c8d2c945ace8010a`
- Worktree expectation: clean after the continuity commit.
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

## Active

- No financial, SQL, Supabase, Production, or merge work is authorized in this
  continuity session.
- The files in this layer are the only intended changes.

## Blocked

- Production migration is intentionally pending the orchestrator audit.
- PR `#61` remains DRAFT.
- The stale local `main` is not a blocker and must not be fixed with reset.

## Next Move

1. Complete and push this continuity-only commit.
2. Perform a brief orchestrator audit.
3. Only after explicit approval, apply BANK V2 migrations to Production in
   order, validate schema/RLS/advisors, and verify deployment.
4. Merge PR `#61` only after the Production and Vercel checks are complete.
5. Run the final smoke and regression checks.

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
- deployment status: pending orchestrator audit and explicit Production approval

## Safety / Do Not

- Do not modify financial logic.
- Do not modify committed BANK V2 SQL or create a migration.
- Do not touch Supabase, remote SQL, Production, or Vercel Production.
- Do not merge, rewrite commits, reset, clean, or force push.
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

## Last Handoff

- Agent: OpenCode
- Date: 2026-08-25
- Summary: prepared the shared continuity layer on validated code checkpoint
  `b859522...`; Git determines the resulting documentation commit and remote
  status.
