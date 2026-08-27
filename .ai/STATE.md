# Project State

## Objective

Close the final pre-Gemini audit blockers for BANK CONTRACT RECONSTRUCTION V4 + BANK DOCUMENT INTELLIGENCE V5 on `feat/bank-contract-reconstruction-v4-document-intelligence-v5`, then stop at the Gemini API integration gate. Do not merge, apply Supabase Production migrations, deploy Production manually, add secrets, or create Production/financial test data.

## Repository

- Branch: `feat/bank-contract-reconstruction-v4-document-intelligence-v5`.
- Baseline/published parent: `09b53be06bafff8a0a8d682fe2aab80a74ab144c`.
- Current commit: final audit checkpoint `fix(bank): close pre-Gemini audit blockers`; verify its immutable SHA with `git rev-parse HEAD`. Working tree is clean; no new migration file was created and the existing V4/V5 migration identity is unchanged.
- Target PR: [#64](https://github.com/rnzrex/cajafamiliar/pull/64), DRAFT to `main`, title `BANK V4/V5 — reconstrucción contractual e importación inteligente de documentos`.

## Completed

- Closed reconstruction/reconciliation gaps: actual/360 and actual/365 candidates, due-date adjustment, total semantics, insurance modes, evidence/conflict handling, strict null/insufficient-data behavior, and safe contractual-versus-estimated schedule provenance.
- Closed Document Intelligence gaps: neutral provider aliases, PDF/image/XLS/XLSX/CSV/TSV/TXT handling, bounded workbook text conversion, private temporary Storage/File API lifecycle, no original filename/PII leakage at the provider boundary, explicit thinking/output-token controls, truncation guards, and one bounded repair pass.
- Closed billing/config gaps: Gemini model/pricing registry, dynamic output allowance, Paid Tier decision recorded in `.ai/DECISIONS.md`, authoritative billable output tokens including thinking tokens, soft USD 0.05 and hard USD 0.10 guards, and additive `billable_output_tokens` persistence.
- Closed onboarding gaps: imported null amounts remain missing, save is blocked for incomplete/conflicting/insufficient schedules, live schedule-derived opening principal is tracked separately from user/imported principal, and pledge fields remain isolated from bank-loan logic.
- Kept `supabase/migrations/20260826204418_bank_contract_reconstruction_v4_document_intelligence_v5.sql` as the only V4/V5 migration; added the idempotent `billable_output_tokens` column guard for partially existing local/job tables and exact four-component Storage path policies.

## Validation

- Focused Document Intelligence suite: PASS — 6 files / 25 tests.
- Reconstruction suite: PASS — 1 file / 10 tests.
- `npm run typecheck:api`: PASS.
- Full suite with `--testTimeout=15000`: PASS — 63 files / 931 tests. A default-timeout run had one known slow UI test timeout while reaching 930/931; the same suite passed with the repository's heavy UI test given 15 seconds.
- `npm run build`: PASS — 2417 modules; only existing dynamic-import and large-chunk warnings.
- `git diff --check`: PASS.
- Previously passed local SQL checks: BANK V2 smoke, DEBT-2B.2, and the DEBT-5F-A sequence that applied all repository migrations including V4/V5. The initial standalone BANK V3 check was run against a stale/dirty local database before the supported DEBT-5F-A reset/apply sequence and failed on absent V3 columns; no Production state was involved.
- Local Storage/RLS integration passed with own-user/own-household access and rejected cross-household, cross-user, and anonymous access; own job was visible, another user's job was hidden, and cleanup passed.
- Local Auth was restored to `enabled = false`; temporary local Supabase containers were stopped. No Production data was created.

## Production / Remote

- No linked/remote Supabase migration, SQL, data, Vercel env write, Gemini key, or manual Production deployment was executed.
- Existing BANK V2/V3 Production migrations remain immutable.
- GitHub CLI remains authenticated as `rnzrex` via keyring over HTTPS; the same branch will be pushed normally, never force-pushed.
- PR #64 must remain DRAFT. The prior Preview for `09b53be06bafff8a0a8d682fe2aab80a74ab144c` was READY; after the audit-fix push, verify a new automatic Preview against the final pushed SHA.

## Next Move

1. Push the current final checkpoint to the same branch normally, verify remote SHA and PR #64 draft status, and wait for the automatic Vercel Preview.
2. Report the final SHA, Preview deployment/status, validation, and untouched Production state.
3. Stop for orchestrator review at the Gemini API integration gate; only the orchestrator may later configure a Preview-only Paid Tier key.

## Relevant Files

- `src/utils/bankContractReconstruction.ts` — V4 reconstruction engine.
- `src/utils/bankContractReconciliation.ts` — reconciliation, balance classifier, and baseline derivation.
- `src/utils/bankDocumentExtraction.ts` — allowlisted extraction schema, normalization, conflict merge, and review statuses.
- `src/components/DebtForm.tsx` — onboarding import/review/save safeguards and balance provenance.
- `api/bank-document/` and `api/_lib/bankDocument*.ts` — secure server pipeline, provider, cost guard, and cleanup.
- `supabase/migrations/20260826204418_bank_contract_reconstruction_v4_document_intelligence_v5.sql` — additive V4/V5 persistence, Storage, RLS, and RPC changes.
- `.ai/DECISIONS.md` — Paid Tier boundary decision for real bank documents.


