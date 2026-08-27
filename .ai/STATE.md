# Project State

## Objective

Fix the imported-schedule state and Section 5 UX for the permanent `Analizar con IA externa` path on `feat/bank-external-ai-complete-dossier-v1`, then keep the work in a DRAFT PR for orchestrator audit before any real contract test.

## Repository

- Branch: `feat/bank-external-ai-complete-dossier-v1`.
- Base before this work: `776caaf03401f62701434d75f7881028ebbc40d6`.
- Feature implementation commit: `8caf5d902133e7d69a58653675896d7702aa5d0b` (`feat(bank): require complete external ai dossier extraction`).
- Current work started from the clean branch head `9aeae64c5fed78ac6c91b92c4e7845b63778ac4a`; the Section 5 fix is currently uncommitted and Git remains authoritative for the exact current SHA.
- No new migration; applied `supabase/migrations/20260826204418_bank_contract_reconstruction_v4_document_intelligence_v5.sql` is untouched and immutable.

## Constraints

- Preserve the no-network external bridge: external AI analyzes documents, the user pastes JSON, and Caja Familiar parses/normalizes/validates locally.
- Treat `installments` as the operational schedule source of truth; `tsvScheduleText` is only an explicit replacement editor.
- No `GEMINI_API_KEY`, provider call, billing change, real contract upload, Production write/deploy, migration change, merge, or test financial data.
- Keep protocol `CAJA_FAMILIAR_BANK_DOCUMENT_V1` backwards-compatible.

## Completed

- Expanded the official external prompt to treat all attached PDFs/images/pages/sheets as one dossier and require full contractual schedule extraction, multi-page continuation, multiple-photo ordering, null cell preservation, duplicate/conflict warnings, and `schedule=[]` only for a genuinely absent/unprovided schedule.
- Added deterministic `src/utils/bankDocumentCompleteness.ts` with complete/needs_review/missing_required_data statuses, full/partial/pending-only/not-found/unknown coverage, required/review/optional issue classes, schedule sequence/date/duplicate/cell checks, balance context, conflicts, and reconciliation review.
- Added `src/components/BankDocumentReviewPanel.tsx` and wired both external import and review summary to show found data, coverage banner, real responsive imported schedule preview, missing/review/optional issues, and accessible labels.
- Preserved manual schedule textarea as a manual tool; imported rows come from normalized external extraction and remain behind the review/save gate.
- Added a shared `BankSchedulePreview` for the compact review panel and full Section 5 desktop/mobile schedule views.
- Section 5 now derives loaded state from `installments`, shows automatic/imported coverage and provenance, hides manual tools by default, and only opens them through explicit replacement.
- Manual cancel, empty/invalid replacement, and invalid spreadsheet input preserve the loaded rows; valid manual/spreadsheet replacement clears stale external review state and updates provenance.
- `reportedBalance` is carried through imported and replacement rows, and save continues to pass the operational `installments` array.
- Extended prompt, completeness, and UI regression coverage; anonymized ALFIN fixture remains 18/18 with principal 4100.00, interest 2003.41, insurance 154.79, total 6258.20, and paidBefore=5 derives 3294.39 with next contractual installment 6.

## Validation

- Full Vitest suite: PASS, 66 files / 965 tests with `--testTimeout=15000`.
- Focused UI suite: PASS, 1 file / 11 tests; external parser suite: PASS, 2 files / 21 tests.
- `npm run test:bank-external-ai-import`: PASS, 3 files / 25 tests.
- `npm run test:bank-reconstruction-v4`: PASS, 1 file / 11 tests.
- `npm run test:bank-document-v5-local`: PASS, 6 files / 26 tests.
- BANK V3 local SQL, BANK V2 local SQL, and DEBT-2B.2 local SQL: PASS after Docker-local approval; no Production access used.
- `npm run typecheck:api`: PASS.
- `npm run build`: PASS; only existing dynamic-import and large-chunk warnings.
- `git diff --check`: PASS before metadata checkpoint.
- Destructive local reset harnesses `test:debt5fa:local` and `test:recon1a:local` were not run, per safety constraints.

## Delivery

- Feature fix commit and normal push are still pending; no force push is permitted.
- PR #65 is open against `main`, title `BANK External AI — extracción completa de expediente y cronograma`, and remains `isDraft: true`.
- Automatic Vercel Preview was generated from the final pushed branch head and verified READY with HTTP 200; the exact final deployment/SHA are recorded in the handoff report and must match Git/PR metadata.

## Production

- Production remains untouched by this task. No Supabase write, Vercel Production deployment, Gemini key, billing change, or real bank document was used.

## Next Step

- Next command: commit the Section 5 fix, push normally, verify PR #65 remains DRAFT, then verify the automatic Preview matches the new SHA. The orchestrator may then audit the DRAFT PR and later run the real redacted external-AI contract test; do not merge or deploy Production from this task.

## Relevant Files

- `src/utils/bankExternalAiImport.ts` — official V1 prompt and external JSON bridge.
- `src/utils/bankDocumentCompleteness.ts` — deterministic dossier completeness evaluator.
- `src/components/BankDocumentReviewPanel.tsx` — analysis, coverage, issues, and imported schedule preview.
- `src/components/BankExternalAiImportPanel.tsx` — external copy/paste flow and immediate review.
- `src/components/BankSchedulePreview.tsx` — shared responsive schedule preview.
- `src/components/DebtForm.tsx` — completeness context and save gate integration.
- `src/utils/bankDocumentCompleteness.test.ts`, `src/utils/bankExternalAiImport.test.ts`, `src/components/BankLoanFormUX.test.tsx` — focused coverage.
