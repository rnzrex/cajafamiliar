# Project State

## Objective

Implement and publish the permanent no-API External AI Import Bridge for BANK V4/V5 on `feat/bank-contract-reconstruction-v4-document-intelligence-v5`, then stop for orchestrator audit. Keep integrated Gemini dormant until an explicit server-side `GEMINI_API_KEY` configuration gate; do not merge, change Production again, write Vercel env vars, call real AI providers, or create financial test data.

## Repository

- Branch: `feat/bank-contract-reconstruction-v4-document-intelligence-v5`.
- Baseline before this block: `b0ae19b6b85e634fc888c6f999724802402f17b8`.
- Published bridge commit: `5136ed6b5decdc5302ac344f292a373bdff72885`, pushed normally to the same remote branch; working tree is clean after the metadata checkpoint below.
- Target PR: [#64](https://github.com/rnzrex/cajafamiliar/pull/64), expected to remain OPEN/DRAFT against `main`.
- Migration `supabase/migrations/20260826204418_bank_contract_reconstruction_v4_document_intelligence_v5.sql` was already applied by the previous Production gate and is immutable. This block must not edit it or add a migration.

## Completed

- Added permanent versioned protocol `CAJA_FAMILIAR_BANK_DOCUMENT_V1` with the official prompt, strict JSON/fenced-JSON parser, 1 MB limit, version validation, malformed/ambiguous rejection, and no executable/HTML parsing.
- Added safe normalization through the existing `BankDocumentExtraction` domain: unknown properties are ignored, null remains null, document aliases are sanitized, and PII metadata fields are filtered before review or persistence.
- Extracted pure shared `financialValidation` for integrated and external paths, preserving pending-only official schedule rules, V4 reconciliation, reconstruction, reported-balance classification, and schedule provenance.
- Added `BankExternalAiImportPanel` with privacy warning, copy-prompt button/toast, paste textarea, local-only interpretation, explicit review messaging, and no automatic save or external navigation.
- Added `/api/bank-document/capabilities`, returning only integrated-AI availability/provider/model and never exposing secrets. Integrated upload UI now reports the no-key dormant state while retaining the option.
- Added the four bank paths in onboarding: external AI, integrated AI, reconstruction from contract terms, and manual entry. Existing structured XLS/XLSX/CSV/TSV/TXT deterministic import continues to use the shared validator.
- Added an anonymized 18-row ALFIN fixture covering actual/360, due-date adjustment, insurance, exact totals, paidBefore=5 => current principal 3294.39, and contractual next installment 6.
- Added focused bridge/capabilities/UI coverage and a `test:bank-external-ai-import` script.

## Validation

- `npm run test:bank-external-ai-import`: PASS — 2 files / 17 tests.
- `npm run test:bank-document-v5-local`: PASS — 6 files / 26 tests.
- `npm run test:bank-reconstruction-v4`: PASS — 1 file / 11 tests.
- `npx vitest run src/components/BankLoanFormUX.test.tsx --reporter=verbose --testTimeout=15000`: PASS — 1 file / 7 tests, including external fixture import without provider calls.
- `npm test -- --testTimeout=15000`: PASS — 65 files / 953 tests.
- `npm run test:bank-loan-v3:local`: PASS — local SQL smoke suite.
- `npm run test:bank-v2-local`: PASS — local SQL smoke suite, including security/RLS checks.
- `npm run test:debt2b2`: PASS — local SQL payment/replay/prepayment/concurrency checks.
- `npm run typecheck:api`: PASS.
- `npm run build`: PASS — Vite build completed with only existing dynamic-import and large-chunk warnings.
- `git diff --check`: PASS at last check.
- `npm run test:debt5fa:local` and `npm run test:recon1a:local` were not run because their harnesses explicitly drop/recreate the local Docker public schema; the safety reviewer rejected that broad destructive reset. No workaround or destructive reset was attempted.
- Automatic Vercel Preview: READY — deployment `dpl_7wZznRGvQLj9ojLkR56rf392A93U`, URL `https://cajafamiliar-pcajmd9g9-renzorex.vercel.app`, Git branch `feat/bank-contract-reconstruction-v4-document-intelligence-v5`, SHA `5136ed6b5decdc5302ac344f292a373bdff72885`.

## Production / Remote

- Production migration status from the previous gate is unchanged: exactly `20260826204418_bank_contract_reconstruction_v4_document_intelligence_v5` was applied with `npx supabase db push --linked`; no manual SQL, repair, `--include-all`, reset, or new migration in this block.
- Previous read-only Production verification confirmed the requested V4/V5 columns, `bank_document_import_jobs`, and private `bank-document-imports` bucket. No new Production operation is authorized for this block.
- No `GEMINI_API_KEY`, Vercel env write, real Gemini/OpenAI call, real document upload, financial test data, merge, or frontend Production deployment.
- PR #64 is OPEN/DRAFT, targets `main`, and head SHA is `5136ed6b5decdc5302ac344f292a373bdff72885`.

## Next Move

1. Stop for orchestrator audit. Do not add Gemini secrets, change Production, mark PR ready, or merge.

## Relevant Files

- `src/utils/bankExternalAiImport.ts` — versioned prompt, strict parser, and external normalization/validation bridge.
- `src/utils/bankDocumentFinancialValidation.ts` — shared pure V4/V5 financial validation pipeline.
- `src/components/BankExternalAiImportPanel.tsx` — external AI prompt/paste/review UX.
- `src/components/DebtForm.tsx` — four bank entry paths, source badge, review/save integration.
- `api/bank-document/capabilities.ts` — safe integrated-AI capability endpoint.
- `src/services/bankDocumentCapabilities.ts` — safe client capability read with unavailable fallback.
- `src/utils/bankDocumentExtraction.ts` — allowlisted normalization and PII metadata filtering.
- `src/utils/bankExternalAiFixture.ts` and `src/utils/bankExternalAiImport.test.ts` — anonymized financial fixture and bridge tests.
- `.ai/DECISIONS.md` — D-015 permanent external AI bridge decision.
