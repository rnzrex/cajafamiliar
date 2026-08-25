# Durable Decisions

## D-001 - Git is the code source of truth

Date: 2026-08-25
Status: active
Decision: Use Git for code, branch, commit, and remote facts.
Reason: Prevent semantic handoff state from contradicting the repository.

## D-002 - AGENTS.md is the shared instruction layer

Date: 2026-08-25
Status: active
Decision: Keep mandatory cross-agent bootstrap instructions in root `AGENTS.md`.
Reason: Avoid provider lock-in and duplicated rules.

## D-003 - STATE.md is the shared semantic handoff

Date: 2026-08-25
Status: active
Decision: Store intent, blockers, validation, Production status, and next move in `.ai/STATE.md`.
Reason: Preserve useful context without copying conversations or logs.

## D-004 - No divergent provider instructions

Date: 2026-08-25
Status: active
Decision: Do not create `CLAUDE.md`, `GEMINI.md`, `CODEX.md`, or `OPENCODE.md` copies.
Reason: Keep one source of shared operating rules.

## D-005 - Applied migrations are immutable

Date: 2026-08-25
Status: active
Decision: Never edit committed or applied Supabase migrations; use a new CLI migration for new SQL.
Reason: Preserve migration history and reproducible deployment order.

## D-006 - Contractual bank schedule is the SSOT

Date: 2026-08-25
Status: active
Decision: Treat an existing contractual bank schedule as the source of truth.
Reason: Do not replace bank-provided terms with estimates.

## D-007 - Estimates are never contractual

Date: 2026-08-25
Status: active
Decision: Estimated schedules remain explicitly estimated.
Reason: Preserve provenance and prevent invented contractual facts.

## D-008 - Principal is not household expense

Date: 2026-08-25
Status: active
Decision: Debt principal is balance reduction; interest, insurance, and fees are financial costs.
Reason: Preserve correct household accounting semantics.

## D-009 - QAPAQ open-ended has no synthetic persisted installments

Date: 2026-08-25
Status: active
Decision: Keep QAPAQ `open_ended` obligations derived and do not persist fake installments.
Reason: Preserve the validated next-payment and settlement regression.

## D-010 - Production actions require gates and verification

Date: 2026-08-25
Status: active
Decision: Production changes require orchestrator review, ordered migration, schema/RLS/advisor checks, deployment verification, and smoke tests.
Reason: Prevent applying audited code without operational verification.
