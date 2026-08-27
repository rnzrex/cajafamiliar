# Project State

## Objective

BANK CONTRACT RECONSTRUCTION V4 + BANK DOCUMENT INTELLIGENCE V5 + the permanent External AI Import Bridge are CLOSED IN PRODUCTION. Integrated Gemini API support is implemented but configuration is intentionally deferred until a future explicit `GEMINI_API_KEY` / billing gate.

## Repository

- PR: #64 — merged to `main`.
- Final feature head: `3e0925590b16b840f6042e86f74aa1b5e25f14d0`.
- Functional merge commit: `6eda80b2d4fd6239b1b471faa870dd0fd67e8138`.
- V4/V5 migration: `20260826204418_bank_contract_reconstruction_v4_document_intelligence_v5.sql` — applied in Production and immutable.

## Completed

- BANK V4 deterministic contract reconstruction supports actual/360 and actual/365, due-date adjustments, total-installment semantics, insurance inference, reconciliation, balance classification, and `contractual` / `reconstructed` / `estimated` provenance.
- The anonymized 18-row regression fixture reconciles exactly: principal 4100.00, interest 2003.41, insurance 154.79, contractual total 6258.20; paidBefore=5 derives current principal 3294.39 and next contractual installment 6.
- BANK V5 adds secure PDF/image/spreadsheet document intelligence architecture, private temporary Storage, metadata-only import jobs, cost guards, provider abstraction, deterministic structured-file parsing, and user review before persistence.
- Integrated Gemini provider remains dormant without `GEMINI_API_KEY`; no real key or billing configuration is required for the released feature.
- Permanent External AI Import Bridge is available with protocol `CAJA_FAMILIAR_BANK_DOCUMENT_V1`: copy the official prompt, analyze the document in an external AI, paste the structured JSON back into Caja Familiar, then run the same V4/V5 normalization, reconciliation, review, and save gates locally.
- External responses are size/version checked, parsed with `JSON.parse`, normalized through the allowlisted `BankDocumentExtraction` domain, preserve null as unknown, ignore unknown fields, filter PII metadata, surface conflicts, and never save directly without review.
- Four bank onboarding paths are supported: external AI, integrated AI, reconstruction from contract terms, and manual entry. Structured XLS/XLSX/CSV/TSV/TXT can still be parsed deterministically without AI when possible.

## Validation

- Full suite reported PASS: 65 files / 953 tests with 15s UI timeout allowance.
- External bridge: 2 files / 17 tests PASS.
- Document Intelligence V5: 6 files / 26 tests PASS.
- Reconstruction V4: 1 file / 11 tests PASS.
- BANK V3 local SQL: PASS.
- BANK V2 local SQL: PASS.
- DEBT-2B.2: PASS.
- API typecheck: PASS.
- Build: PASS.
- `git diff --check`: PASS.
- DEBT-5F-A and RECON-1A destructive local harnesses were intentionally not rerun in the bridge checkpoint; no workaround or Production data mutation was used.

## Production

- Supabase Production migration history independently confirms `20260826204418 bank_contract_reconstruction_v4_document_intelligence_v5`.
- Read-only Production verification confirms the new V4/V5 bank-loan columns, `debt_installments.reported_balance`, `bank_document_import_jobs`, private `bank-document-imports` bucket, and RLS on import jobs.
- Functional Production deployment: `dpl_4z2AWGcSfW6jvfsSK8ZSWrYoPaCc`, Git SHA `6eda80b2d4fd6239b1b471faa870dd0fd67e8138`, state READY.
- Public `https://cajafamiliar.vercel.app` returned HTTP 200 after the deployment.
- No error/fatal runtime logs were found for the functional Production deployment at closeout.
- No real Gemini key, OpenAI key, AI billing change, real contract upload, or financial test data was introduced during the closeout.

## Deferred Integrated AI Gate

- `GEMINI_API_KEY` remains intentionally unconfigured.
- The API path is already implemented; a future enablement should configure a Paid Tier server-side key, begin in Vercel Preview, verify quality/cost on real redacted documents, and only then enable Production.
- The External AI Import Bridge remains a permanent supported fallback even after integrated AI is enabled.

## Next Planned Domain Scope

- Broader Peru debt taxonomy remains the next planned debt-domain objective unless a concrete Production regression or explicit new priority is reported.

## Reopen Criteria

Reopen BANK V4/V5 only for a concrete Production regression, an explicit integrated-AI configuration request, or new bank-document capability scope.
