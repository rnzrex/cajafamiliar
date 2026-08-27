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

## D-011 - Deterministic-first document intelligence

Date: 2026-08-26
Status: active
Decision: Parse clearly structured XLS/XLSX/CSV/TSV/TXT schedules locally before considering the server-side AI provider.
Reason: Avoid unnecessary cost and keep contractual schedule rows reproducible and testable.

## D-012 - Reconstructed schedules are non-authoritative

Date: 2026-08-26
Status: active
Decision: A mathematically reconciled reconstruction is stored as `reconstructed`, while official imported rows remain `contractual`; only user confirmation can create the loan.
Reason: AI or inferred terms must never silently replace bank-provided amounts or write financial data without review.

## D-013 - Temporary document privacy boundary

Date: 2026-08-26
Status: active
Decision: Store uploads only in the private `bank-document-imports` bucket during analysis, keep operating metadata without raw documents/OCR, and delete objects in success and error paths.
Reason: Contract scans and photographs may contain sensitive financial or personal information.

## D-014 - Paid-tier boundary for real bank documents

Date: 2026-08-26
Status: active
Decision: Real bank-document AI analysis must use the Gemini Paid Tier; the free tier is not permitted for documents containing PII or financial information, and this feature does not configure billing or a real API key.
Reason: Preserve the privacy and operational boundary until the orchestrator explicitly configures a Preview-only paid-tier key.

## D-015 - Permanent external AI import bridge

Date: 2026-08-27
Status: active
Decision: Keep `Analizar con IA externa` as a permanent no-API bank-document path using the versioned `CAJA_FAMILIAR_BANK_DOCUMENT_V1` wrapper, local strict parsing/normalization, and the same V4/V5 financial validation and review gates; keep integrated Gemini available only when its server-side configuration is present.
Reason: Let users analyze documents with a provider of their choice without consuming Caja Familiar AI credits, while preserving provider independence, PII/unknown-field filtering, mathematical validation, and explicit user confirmation before persistence.

## D-016 - Complete dossier extraction with deterministic completeness

Date: 2026-08-27
Status: active
Decision: Treat every externally analyzed attachment as one credit dossier, require the external prompt to inspect all pages and transcribe every located contractual schedule row, preserve unreadable cells as null, and evaluate completeness locally with full/partial/pending-only/not-found coverage before save.
Reason: A term, regular payment, or first due date is not proof that the contractual schedule was received; users need an auditable distinction between complete data, required blockers, review items, and optional omissions without adding provider calls or changing the V1 bridge schema.
