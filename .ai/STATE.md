# Shared Agent State

## Current Active Handoff — Financial Advisor 24/7 V1 Visual Gate Hotfix — 2026-09-01

- Objective: implement and publish the read-only deterministic `ASESOR` view
  and the extra-cash advisory UX hotfix on `feat/financial-advisor-v1`, based
  exactly on `388d3e679ca91efa1a6bcc3d09bcb792dc848a8f`.
- Constraints: no SQL, migrations, schema/RLS, Supabase Production writes,
  debts, payments, movements, prepayments, card/account changes, real financial
  or document data, PII, external AI/API keys, Vercel env writes, Production
  deployment, merge, reset, clean, or force push.
- Architecture: reuse the existing debt planning/intelligence/strategy,
  obligation projection, credit-card statement, account balance, date, and
  principal-prepayment engines. Add only pure advisor/question read-models and
  a responsive read-only panel; unknown values remain unknown.
- Branch state: implementation commits `c8e7a946232baad118be96e223c658f269c4b0b4`,
  `072b09033904a6856ba6448f713cb9c609ec6c44`, hotfix
  `9aec50d1310fcd8f3d35bf5ca571ed14d2ca4be2`, extra-cash hotfix
  `8814c20eca05e51e92204d226bbb4a41d57fdac6`, and metadata checkpoint
  `4b8ceaae31058b32655301bf38766845bf23bcdc` are pushed; PR #80 is
  OPEN/DRAFT against `main`.
- Hotfix completed in `src/utils/financialAdvisor.ts` and tests: explicit
  overdue/due-today/immediate/card/strategy ordering, human date and money
  copy, `Vencidas` label, and card statements included once in applicable
  obligation windows while unknown settlements remain unknown.
- Hotfix completed in `src/components/FinancialAdvisorPanel.tsx` and its test:
  internal recommendation enums are translated to human labels and are not
  exposed in visible recommendation metadata.
- Extra-cash UX hotfix completed in `src/utils/financialAdvisor.ts`,
  `src/utils/financialAdvisorQuestions.ts`, and
  `src/components/FinancialAdvisorPanel.tsx`: scenario exposes liquidity and
  shortfall before/after, exact coverage, surplus-only simulation, unknown
  requirement fail-closed status, and shared panel/question copy.
- Functional hotfix commit `8814c20eca05e51e92204d226bbb4a41d57fdac6` is
  pushed to origin; PR #80 remains OPEN/DRAFT.
- Validation so far: full `npm test -- --maxWorkers=1` (83 files, 1,166 tests),
  extra-cash directed suite (3 files, 34 tests),
  `npm run typecheck:api`, `npx tsc -b --pretty false`, `npm run build`, and
  `git diff --check` pass. Build emitted only existing dynamic-import and
  large-chunk warnings.
- Release gate completed for the functional code checkpoint: automatic Preview
  `dpl_BgXT6VD1fYWq1sCxt8G6pLU6dLDQ`
  (`https://cajafamiliar-1d7qmvm2s-renzorex.vercel.app/`) is READY, HTTP 200,
  matches functional SHA `8814c20eca05e51e92204d226bbb4a41d57fdac6`, and has no preview
  error/fatal runtime logs. The Preview app remains authentication-protected;
  manual authenticated Asesor acceptance is the next user-facing visual gate.
  Do not request or store credentials.
- GitHub CLI was reauthenticated through the web device flow on 2026-09-01;
  normal push and remote SHA verification succeeded.
- Production status: untouched. No SQL, migrations, financial writes, test
  data, external AI, secrets, Vercel env writes, merge, or Production deploy.

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



## Production Gate Attempt — 2026-08-31

- Linked Supabase CLI project confirmed as `dxogrdvgdbvbdyoepqtx` using
  `supabase/.temp/project-ref`; the pooler IPv4 link was required because the
  direct connection reported IPv6 unavailable.
- Migration SHA-256 at gate start:
  `C6F47915DCD7CAB042F32FB3B6873696E73A437F701AAA601868F9814DCF6030`.
- Preflight history matched through `20260830214500`; dry-run showed exactly
  one pending migration: `20260831073542_document_first_production_rpc_runtime_fix_v1.sql`.
- `npx supabase db push --linked` was attempted once and failed closed before
  the function replacement because Production `create_debt_v1` source MD5 is
  `67ef098b10d245ce4b22423c6a58b07e`, not the audited guard fingerprint
  `4b4e5de9d5c3757d0db3c969c450f7cf`. Production still has one bad cast and
  zero corrected casts.
- Remote migration history remains pending at `20260831073542`; no migration
  was recorded. The post-attempt financial counts exactly equal the baseline:
  debts=5, movements=1068, debt_events=0, debt_installments=18,
  debt_schedule_versions=1, debt_event_installment_allocations=0,
  debt_installment_carried_allocations=0, debt_financing_contracts=0,
  debt_refinancing_links=0, bank_document_import_jobs=0.
- Production `create_debt_from_document_v1` remains present with authenticated
  EXECUTE=true. Function metadata observed before failure: owner `postgres`,
  ACL `{postgres=X/postgres,authenticated=X/postgres}`, SECURITY DEFINER=true,
  proconfig `search_path=""`.
- PostgreSQL logs show the new fingerprint guard error at the attempt time;
  the old `pg_catalog.integer` and `debt_financing_contracts.id` errors are
  historical. No retry, migration edit, repair, reset, manual SQL, financial
  RPC, or data write was performed after the fail-closed stop.

## Current blocker

Do not rerun Production migration. Resolve the difference between the local
shortlisted audited function source and Production's source definition first;
any corrected migration must be re-audited and re-hashed before a new gate.
PR #74 remains OPEN/DRAFT, Production frontend remains on main, and all
financial/document/secrets restrictions remain active.

## Source Fingerprint EOL Correction — 2026-08-31

- Root cause confirmed: the audited function source is byte-equivalent after
  EOL normalization. Production raw LF MD5 is
  `67ef098b10d245ce4b22423c6a58b07e`; the equivalent local/raw CRLF form is
  `4b4e5de9d5c3757d0db3c969c450f7cf`; normalizing either to LF yields
  `67ef098b10d245ce4b22423c6a58b07e`.
- Changed only the pending migration guard to normalize CRLF and bare CR to LF
  before comparing the expected MD5. The exact signature, bad/good cast tokens,
  source replacement, metadata guards, and postconditions remain unchanged.
- Extended the disposable PG17 smoke with LF/CRLF equivalence, semantic
  mutation rejection, missing-cast rejection, and wrong-cast rejection.
- New migration SHA-256:
  `1372717D7DDE4386842AA9BC57ED348F124D32029ABB4C46D8B614BFD9BACDD6`.
- Local PG17 migration reapplication and 129-row Document-First acceptance
  passed; BANK lifecycle, Universal SQL, DEBT2B2, Document-First targeted
  tests (4 files / 25 tests), Universal targeted tests (2 files / 42 tests),
  typecheck, build, Node syntax, and diff checks passed.
- No Production SQL retry was made. Production remains at
  `20260830214500`; `20260831073542` remains pending. The next action requires
  a new Production SQL orchestration gate.
- Guard-correction files are modified locally and ready to commit/push; no
  application behavior was changed.

## BANK Document-First Zero-Rework / Ripley Regression — 2026-08-31

- Objective: implement the sanitized contractual-schedule regression fix on
  `fix/bank-document-first-zero-rework-ripley-v1`, based on
  `6cb4f26530d44df85b46427532c6471adf2e4626`; no SQL, migrations, schema/RLS,
  secrets, Gemini keys, Production writes, real debt, or merge.
- Implemented contractual authority separate from math reconciliation,
  row-K `reportedBalance` opening principal precedence, reactive existing-debt
  baseline, historical/future anomaly gating, final schedule-date precedence,
  insurance semantics, warning compaction, UI copy, and external-AI prompt
  rules.
- Added sanitized fixture `src/utils/bankRipleyRegressionFixture.ts` and
  utility/UI regression coverage. No real Ripley document or PII is present.
- Validation: full Vitest **80 files / 1120 tests passed**; targeted external
  import **29**, document V5 **26**, reconstruction **11**, prepayment
  simulation **18**, universal contract **42**, and Ripley utility/UI **34**
  tests passed. `npm run typecheck:api` and `npm run build` passed; build only
  emitted existing dynamic-import/large-chunk warnings; `git diff --check`
  passed.
- Local SQL smoke suites were attempted only against the local Docker
  container. They remain unavailable/not applicable because the container
  schema is missing legacy relations (`debt_event_installment_allocations` and
  bank V2 tables); no Production database was accessed or changed.
- Final code commit `e356733fa155d74c9677e97e11cfa8d57576a1f3` is pushed to
  origin without force. PR #76 is OPEN/DRAFT against `main` with the requested
  title. Automatic Vercel Preview is READY at
  `https://cajafamiliar-65k4tr806-renzorex.vercel.app/`, deployment
  `dpl_9qpWpSwqbYoWLYKYW5D7Lc921TAH`, and its Git SHA exactly matches the
  pushed commit; read-only fetch returned HTTP 200. Build logs contain only the
  known dynamic-import and large-chunk warnings.
- Remaining next step is the external release/orchestrator audit. Keep
  Production, secrets, merge, and frontend release untouched.
