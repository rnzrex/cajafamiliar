# Project State

## Objective

BANK CREDIT CONTRACT V2 is functionally audited, its four migrations are applied in Production, and the cross-agent continuity layer is installed. The remaining closing work is PR merge and Production deployment verification.

## Active Work

- No functional change is pending.
- Supabase Production migration gate is complete.
- Accidental temporary Edge Function cleanup is complete and the prior Edge Function baseline is restored.
- Next work: merge PR #61 and verify Vercel Production plus non-destructive runtime regressions.

## Repository

- Expected branch: `feat/bank-credit-contract-v2`
- PR: `#61` (DRAFT until final merge gate)
- Validated financial code checkpoint: `b859522b0bba761a5e1950305422d487b4bb4575`
- Remote base before merge: `origin/main` = `82a3c8871a801324b32a5fc1c8d2c945ace8010a`
- Worktree expectation: clean.
- Code checkpoint commit: `b859522...` is the last validated financial code; continuity/state commits and push status must be read from Git.
- The actual HEAD must always be obtained from Git; do not store a circular claim that this file is in the same commit as the current HEAD.
- Local `main` may be stale relative to `origin/main`; do not reconcile it with reset as part of a handoff.

## Completed

- Bank-loan onboarding and profile validation.
- Insurance terms and contractual or estimated schedules.
- Payment plus extra principal as one movement.
- Principal prepayment, installment advance, payoff, and reversal.
- Append-only schedule versioning and contractual schedule updates.
- `pending_bank_schedule` lifecycle and planning guards.
- QAPAQ `open_ended` regression preservation with no synthetic persisted installments.
- BANK CREDIT CONTRACT V2 functional audit and validation at the checkpoint above.
- Cross-agent continuity layer installed:
  - `AGENTS.md`
  - `.ai/README.md`
  - `.ai/STATE.md`
  - `.ai/DECISIONS.md`
  - `.ai/RUNBOOK.md`
- Production preflight verified before migration.
- Supabase Production migrations applied in exact repository order:
  - `20260824225428_bank_credit_contract_v2.sql`
  - `20260825010000_bank_credit_contract_v2_audit_fix.sql`
  - `20260825071034_bank_credit_contract_v2_finalization.sql`
  - `20260825165854_bank_credit_contract_v2_schedule_state_guard.sql`
- Independent remote audit confirmed BANK V2 tables, columns, constraints, triggers, RPC signatures, RLS/policies, and zero BANK V2 test/junk rows.
- Supabase advisor findings reviewed; BANK V2 SECURITY DEFINER warnings are intentional and performance findings are non-blocking.
- Temporary accidental `noop` Edge Function removed; `reset-commercial-password` remains ACTIVE as the restored baseline.

## Active

- No functional or database blocker is known.
- PR #61 is ready for final merge gate after docs-only state checkpoint and Preview verification.

## Blocked

- No known blocker.

## Next Move

1. Verify PR head/mergeability and Vercel Preview for the current docs-only HEAD.
2. Mark PR #61 ready if required by GitHub and merge using the verified expected head SHA.
3. Verify `main` advanced to the merge result and Vercel Production deploys successfully.
4. Verify the public Production app responds successfully and inspect recent Production runtime errors.
5. Run only non-destructive Production regression checks; do not create test/junk financial data.
6. Record the final closed state after the merge/deployment verification.

## Validation

- `npm test`: PASS, 50 files / 855 tests.
- `npm run typecheck:api`: PASS.
- `npm run build`: PASS.
- `npm run test:bank-v2-local`: PASS.
- `npm run test:debt2b2`: PASS.
- `npm run test:debt5fa:local`: PASS.
- `git diff --check`: PASS.
- Vercel Preview at the validated financial/documentation checkpoint: PASS.

## Production

- Supabase migration status: BANK V2 APPLIED.
- BANK V2 schema/RLS/RPC verification: PASS.
- BANK V2 test/junk data: none created.
- Edge Function cleanup: PASS; accidental `noop` removed.
- Frontend deployment status: pending PR merge and Vercel Production verification.

## Safety / Do Not

- Do not modify validated financial logic or committed BANK V2 migrations during closing unless a newly discovered blocker requires a separate audited change.
- Do not create test or junk Production financial data.
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

- Agent: ChatGPT orchestrator
- Date: 2026-08-25
- Summary: BANK V2 migrations are applied and independently verified in Production, accidental Edge Function cleanup is complete, and the next step is PR merge plus Vercel Production verification.
