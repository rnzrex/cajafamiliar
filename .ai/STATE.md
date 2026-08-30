# Project State

## Objective

Complete the final implementation and PostgreSQL 17 validation gate for
DOCUMENT-FIRST DEBT ONBOARDING V1 on `feat/debt-document-first-onboarding-v1`,
then publish the validated checkpoint as OPEN/DRAFT PR #68 and stop before
Production SQL, merge, deploy, secrets, or real-document actions.

## Repository

- Branch: `feat/debt-document-first-onboarding-v1`.
- Base: `288fd3b7d648078d7aa3660f231705226b1b100c` from `origin/main`.
- Starting remote HEAD: `40e1166cc6afac190b99c955572f8b5f95ab001e`.
- PR: #68, expected OPEN/DRAFT/MERGEABLE.
- Implementation checkpoint is published at the branch HEAD; Git is the
  authority for the exact SHA and the final Preview must match it.

## Constraints

- No Production SQL, frontend deploy, merge, environment writes, Gemini key,
  real document upload, or financial test data outside disposable local DBs.
- Do not alter historical/applied migrations or weaken released BANK and
  Universal behavior.
- Local PostgreSQL 17 fixture data is synthetic and must not be committed.

## Completed

- Audited the document-first UI, parser/default extraction, service RPC payload,
  existing generic/BANK onboarding paths, and the new onboarding migration.
- Added explicit history modes for no rows paid, down-payment-only, and
  consecutive fully paid contractual rows; partial/non-consecutive history is
  rejected from the last-paid boundary path.
- Preserved financed-principal semantics so the down payment is not subtracted
  twice; added utility regressions for the 129-row real-estate fixture,
  down-payment-only state, non-consecutive history, and null/zero taxes.
- Hardened `create_debt_from_document_v1` with strict schedule validation,
  sanitized persisted evidence, authority/source checks, full-fingerprint
  idempotency with a UUID advisory lock, conflict rejection, and no movement or
  debt-event creation.
- Added the document-first entry regression and updated legacy/BANK UX tests to
  exercise `DebtFormLegacy` directly now that the public `DebtForm` starts at
  the document/manual choice screen.
- Regenerated `supabase/schema.sql` from the local PostgreSQL 17 schema-only
  dump after applying the current schema plus Universal and document-first
  migrations. Historical `pg_catalog.integer` compatibility was only a
  transient local load workaround; no historical migration was changed.

## Validation

- Full Vitest: PASS — 77 files, 1,088 tests.
- Typecheck: PASS (`npm run typecheck:api`). Build: PASS; only existing Vite
  dynamic-import and large-chunk warnings.
- `git diff --check`: PASS. Node syntax checks for all `scripts/*.mjs`: PASS.
- Universal targeted suite: PASS — 2 files, 42 tests; migration hygiene PASS.
- BANK reconstruction: PASS — 1 file, 11 tests.
- BANK prepayment simulation: PASS — 1 file, 18 tests.
- BANK External AI/import: PASS — 3 files, 29 tests.
- BANK Document V5: PASS — 6 files, 26 tests.
- Disposable `bank_lifecycle_clean_pg17`: PostgreSQL 17.6. BANK V2, BANK V3,
  BANK prepayment lifecycle scenarios 1–30, DEBT2B2, and Universal SQL smoke
  passed using temporary local role grants only.
- Document-first SQL smoke passed with the 129-row synthetic fixture:
  NEW_DEBT opening/live principal 76500, 129 installments, official_noncontractual
  + reconstructed + non-authoritative, zero movements/events; separate
  EXISTING_DEBT history 1–9 passed with opening/live principal 68000, nine
  pretracking rows, 120 pending rows, and zero movements/events.
- Negative SQL guards passed for BANK kind, invalid authority/source,
  malformed schedule, and cross-household access.
- Migration SHA-256: `304E7E155EF934782F735749A7059AAFEFFDEA4DA0D984D859F95D47DE2771A5`.
- Schema snapshot SHA-256: `3D7EB08AC6E6D0B79AE66DFF2B05573DCEB1BF3390715921F386D03D4F32A80C`.

## Next Step

- Final implementation checkpoint is pushed and the exact-SHA Preview is
  READY/HTTP 200. Report the completed gate and stop. Do not merge or touch
  Production.

## Production

- Production untouched. No Production SQL/schema/data mutation, real upload,
  Vercel env change, Gemini key, frontend deploy, or merge occurred.

## Relevant Files

- `src/components/DebtForm.tsx` — public document-first/manual entry chooser.
- `src/components/DebtDocumentFirstOnboarding.tsx` — review, history choice,
  down-payment handling, and final atomic create action.
- `src/utils/debtDocumentFirstOnboarding.ts` — parser defaults, principal
  derivation, history validation, and pretracking.
- `src/services/debtDocumentFirstOnboarding.ts` — typed RPC request.
- `supabase/migrations/20260830214500_debt_document_first_onboarding_v1.sql` —
  atomic sanitized onboarding RPC.
- `supabase/schema.sql` — regenerated PostgreSQL 17 schema snapshot.
