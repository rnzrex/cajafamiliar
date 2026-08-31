# Shared Agent State

## Objective

Implement, validate, and publish the Document-First Production RPC runtime fix
on `fix/document-first-production-rpc-runtime-v1`. Keep the PR OPEN/DRAFT and
stop before Production SQL, real financial/document writes, secrets, frontend
Production deployment, or merge.

## Repository

- Repository: `rnzrex/cajafamiliar`.
- Requested base/current main: `52f4103f43ba75e81294c0d0a70c9fb931000b95`.
- Branch: `fix/document-first-production-rpc-runtime-v1`.
- Implementation commit `04cf26dcba7dbff92cdeb207d382f6dbb2301bae` is pushed to origin; PR #74 is OPEN/DRAFT against `main`.
- Production Supabase ref: `dxogrdvgdbvbdyoepqtx`.
- Latest applied Production migration before this task: `20260830214500`
  (`debt_document_first_onboarding_v1`).

## Constraints

- No Production SQL, migration apply, real debt/payment/movement/document data,
  PII, fake financial data, Gemini/API key, Vercel env change, Production
  frontend deployment, merge, force push, reset, or clean.
- Add exactly one additive migration after `20260830214500`; never edit an
  applied migration.
- Preserve existing Document-First history semantics: lastPaid=8 gives
  `69062.50`, lastPaid=9 gives `68000`, down payment is excluded, manual
  override wins, and future unknown rows do not block a known boundary.

## Completed implementation

- Added `supabase/migrations/20260831073542_document_first_production_rpc_runtime_fix_v1.sql`.
  It targets the exact extended `public.create_debt_v1` regprocedure, requires
  the audited source fingerprint and exactly one bad
  `(v_elem->>'installment_number')::pg_catalog.integer` token, dynamically
  replaces only that token with `::pg_catalog.int4`, preserves owner/ACL/
  security/config metadata, and asserts the postcondition.
- Fixed optional `debt_financing_contracts` loading to order by
  `created_at, debt_id` and paginate with `pkField: "debt_id"`; refinancing
  links retain `created_at, id`.
- Added safe Supabase/PostgREST error normalization with known Spanish
  messages and sanitized unknown reference codes; Document-First RPC errors
  now pass through it before reaching the UI.
- Added regression coverage for financing-contract loading and safe errors.
- Added `scripts/test-document-first-production-rpc-runtime-local.mjs` and the
  `test:document-first-production-rpc-runtime:local` package script. The smoke
  uses deterministic sanitized fixtures, verifies the 129-row acceptance,
  zero financial effects, and atomic rollback for an invalid contract.

## Validation completed

- Full Vitest, one worker: **79 files, 1,101 tests passed**.
- Document-First targeted suite: **4 files, 25 tests passed**.
- BANK reconstruction: **1 file, 11 tests passed**.
- BANK prepayment simulation: **1 file, 18 tests passed**.
- BANK External AI/import: **3 files, 29 tests passed**.
- BANK Document V5: **6 files, 26 tests passed**.
- Universal Debt unit/hygiene: **2 files, 42 tests passed**; additive-only,
  13 required symbols, 0 forbidden terms.
- `npm run typecheck:api`: passed.
- `npm run build`: passed; only existing dynamic-import and large-chunk
  warnings were emitted.
- `git diff --check`: passed with only existing CRLF normalization warnings.
- `node --check scripts/test-document-first-production-rpc-runtime-local.mjs`:
  passed.
- Disposable PG17 smoke (`document_first_clean_pg17`, PostgreSQL `170006`):
  migration applied, corrected cast present/bad cast absent, 129 rows and
  `69062.50` opening principal accepted, rows 1..8 paid and row 9 unpaid,
  zero events/movements/allocations, and invalid-contract rollback left no
  partial rows.
- BANK lifecycle local smoke: all 30 sections passed.
- Universal SQL local smoke: all 17 listed cases passed.
- DEBT2B2 local smoke: passed with concurrency protection result
  `1 success, 1 DEBT_MOVEMENT_ALREADY_LINKED, 1 effective event`.

## Local harness limitation

The repository's normal local reset cannot complete from the committed
migration chain because legacy base tables such as `public.households` are not
included before a later migration. The disposable PG17 harness therefore used
the repository's legacy bootstrap fixture plus temporary Storage catalog tables
and compatibility columns only inside `document_first_clean_pg17`; no
Production or repository schema was changed by this setup.

## Publish gate remaining

- Run final status/diff audit, push branch,
  and create or update the OPEN/DRAFT PR against `main`.
- Verify the automatic Vercel Preview corresponds exactly to the final remote
  SHA, is READY/HTTP 200, and has no unexplained fatal/error logs. Perform only
  authenticated read-only loading; do not create a real debt.
- Do not use Production Supabase ref, apply SQL, add Gemini secrets, deploy
  frontend Production, mark PR ready, or merge.

## Production

Production remains untouched at main
`52f4103f43ba75e81294c0d0a70c9fb931000b95`.

## Relevant files

- `supabase/migrations/20260831073542_document_first_production_rpc_runtime_fix_v1.sql` — guarded RPC cast fix.
- `src/services/dataRepository.ts` — financing contract load ordering/key.
- `src/services/debtDocumentFirstOnboarding.ts` — safe RPC error boundary.
- `src/components/DebtDocumentFirstOnboarding.tsx` — safe user-facing save error.
- `src/utils/supabaseError.ts` and `.test.ts` — error normalizer and tests.
- `src/services/dataRepository.authoritativeLoad.test.ts` — load regression.
- `scripts/test-document-first-production-rpc-runtime-local.mjs` — PG17 smoke.
- `.ai/STATE.md` — operational handoff.


