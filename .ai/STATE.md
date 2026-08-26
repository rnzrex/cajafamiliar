# Project State

## Objective

Implement BANK CONTRACT RECONSTRUCTION V4 + BANK DOCUMENT INTELLIGENCE V5 on `feat/bank-contract-reconstruction-v4-document-intelligence-v5`, based on `9b55742f6c73057034f5203175822395a11e9061`, and stop at the Gemini API integration gate. Do not merge, apply Supabase Production migrations, deploy manually, add secrets, or create financial test data.

## Repository

- Branch: `feat/bank-contract-reconstruction-v4-document-intelligence-v5`.
- Baseline: `9b55742f6c73057034f5203175822395a11e9061`.
- Current implementation commit: `6a7e165a6eebd166bc0aba69bcde5b4c32ecf590` (`feat(bank): add contract reconstruction and document intelligence`).
- Working tree: clean after the implementation commit; no applied migration was edited.
- Target PR: DRAFT to `main`, title `BANK V4/V5 — reconstrucción contractual e importación inteligente de documentos`; not created yet.

## Completed

- Added isolated V4 reconstruction with actual-days/360 and actual-days/365 candidates, due-date rules, total-installment semantics, insurance-rate inference, and `contractual`/`reconstructed`/`estimated` provenance.
- Added reconciliation and reported-balance classification. The anonymized fixture reconstructs 18/18 rows, infers actual-days/360, Sunday-to-Monday adjustment, approximately 0.35% outstanding-balance insurance, totals 4100.00 principal / 2003.41 interest / 154.79 insurance / 6258.20 total, and derives 3294.39 after five paid installments.
- Added V4/V5 persistence mappers and one additive migration: `supabase/migrations/20260826204418_bank_contract_reconstruction_v4_document_intelligence_v5.sql`.
- Added private temporary Supabase Storage uploads, metadata-only `bank_document_import_jobs`, RLS/path ownership checks, cleanup cron, deterministic spreadsheet parsing, structured extraction normalization/merge, Gemini REST provider abstraction, fake provider, countTokens cost guard, one bounded repair pass, and review-only API output.
- Added bank onboarding import panel with multi-file support, image quality guard, progress/cancel states, review statuses, balance choices, auto-fill, and manual fallback. The UI never saves AI output without the existing user review/submit step.
- Added server-only `.env.example` configuration; no real key or client-side `VITE_` secret.

## Validation

- `npm test -- --reporter=dot`: PASS — 63 files / 916 tests.
- Focused reconstruction/document/security/UI tests: PASS — reconstruction 5, document V5 15, server/UI authorization 7; the prescribed focused suite also passed 11 tests.
- `npm run typecheck:api`: PASS.
- `npm run build`: PASS; only existing ineffective dynamic-import and large-chunk warnings.
- `git diff --check`: PASS.
- Client bundle search: no `GEMINI_API_KEY`, Gemini model, or Generative Language API reference found.
- Local BANK V3 SQL smoke: PASS. Local BANK V2 SQL smoke: PASS. DEBT-2B.2: PASS.
- DEBT-5F-A local smoke reached and applied the repository migration sequence, including the new migration's relational DDL, but reported the local Storage tables missing and then failed its pre-existing auth-user assertion; no repository file or Production state was changed.
- `npx supabase db push --local --dry-run`: PASS; local history is empty, so every local migration is listed pending.
- `npx supabase db lint --local --fail-on error`: blocked by pre-existing unrelated local errors; no V4/V5 error was reported.
- Transactional local SQL smoke reached the new ALTER TABLE statements, then stopped because this local database lacks `storage.buckets`; transaction rolled back. Production was untouched.

## Production / Remote

- No linked/remote Supabase command, migration, SQL, data, Vercel env write, or manual deployment was executed.
- Existing BANK V2/V3 Production migrations remain immutable.
- Remote is `https://github.com/rnzrex/cajafamiliar.git`. GitHub CLI authentication is invalid (`gh auth status`: requires `gh auth login`).
- Push was not performed: the elevated push request was rejected by the safety reviewer because remote ownership/trust and explicit authorization were not established in the approved context. No workaround was attempted. DRAFT PR creation therefore remains pending.

## Next Move

1. If explicitly authorized for this trusted remote, push `6a7e165...` without force after GitHub authentication is restored.
2. Create the requested DRAFT PR to `main`; otherwise report the exact authentication/safety blocker.
3. Stop with `READY FOR GEMINI API INTEGRATION GATE`; do not merge or apply Production.

## Relevant Files

- `src/utils/bankContractReconstruction.ts` — V4 reconstruction engine.
- `src/utils/bankContractReconciliation.ts` — reconciliation, balance classifier, baseline derivation.
- `src/utils/bankDocumentExtraction.ts` — allowlisted extraction schema, normalization, conflict merge, review statuses.
- `src/components/BankDocumentImportPanel.tsx` — recommended multi-document upload UX.
- `api/bank-document/` and `api/_lib/bankDocument*.ts` — secure server pipeline/provider/cost/cleanup.
- `supabase/migrations/20260826204418_bank_contract_reconstruction_v4_document_intelligence_v5.sql` — additive persistence/storage/RPC changes.
