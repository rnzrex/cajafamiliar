# Project State

## Objective

Complete the Document-First real proforma parsing fix V1 on
`fix/debt-document-first-real-proforma-v1`, publish it as DRAFT PR #70, verify
what the exact-SHA Vercel Preview permits, and stop before Production, SQL,
merge, secrets, or real-document actions.

## Repository

- Repository: `rnzrex/cajafamiliar`.
- Base: `a0e430f297a6e9a4603ee8c6afb7ef87eac7110e` from `origin/main`.
- Branch: `fix/debt-document-first-real-proforma-v1`.
- Implementation and operational-state checkpoints are published to the
  remote branch without force push; Git and PR #70 are authoritative for the
  exact final HEAD.
- PR #70 is OPEN/DRAFT against `main` and must remain DRAFT.

## Constraints

- Do not modify Production, apply SQL, create financial records, upload or
  commit the user's real PDF, add PII to fixtures, deploy Production, add
  Gemini secrets, or merge.
- Do not modify migrations or the existing document-first RPC.
- Change only prompt, parsing/normalization, semantic validation, review UX,
  regression tests, and operational state documentation.

## Completed

- Hardened `DOCUMENT_FIRST_EXTERNAL_AI_PROMPT` so contractual numbers come
  only from an identified installment-number column and CI/LS/internal codes
  cannot become contractual numbers; documented CASH/down-payment, asset vs
  financed principal, introductory rows, scheduled principal, and term
  semantics.
- Added Document-First-only semantic normalization. It maps duplicate or
  invalid contractual numbers to a contiguous source-row sequence only when
  source rows are valid contiguous 1..N, ordered, dated/non-decreasing, and
  free of summary rows or contradictory explicit numbering; otherwise it
  blocks persistence. Source contract evidence stays unchanged and warnings
  expose every correction.
- Added independent down-payment and scheduled-principal cross-checks,
  principal-basis invariants, multiple-down-payment and incomplete-row
  blockers, structural reconciliation after canonicalization, and disabled
  create behavior when blockers exist.
- Updated review UX to separate 129 total rows from 128 later obligations,
  distinguish documentary authority from structural reconciliation, show
  corrected values/warnings, and keep proforma authority non-contractual.
- Added sanitized real-proforma regressions for safe duplicate repair, unsafe
  source order, contradictory explicit order, corrected PEN 8,500/PEN 85,000
  semantics, and last-paid 8/9 balances.

## Validation

- Full Vitest PASS — 78 files, 1,094 tests.
- Document-First targeted PASS — 2 files, 14 tests.
- Universal Contract Engine PASS — 2 files, 42 tests; migration hygiene
  additive-only, 13 required symbols, 0 forbidden terms.
- BANK reconstruction PASS — 1 file, 11 tests.
- BANK prepayment PASS — 1 file, 18 tests.
- BANK External AI/import PASS — 3 files, 29 tests.
- BANK Document V5 PASS — 6 files, 26 tests.
- `npm run typecheck:api`, `npm run build`, `git diff --check`, and all
  `scripts/*.mjs` Node syntax checks pass. Build has only existing Vite
  dynamic-import/large-chunk warnings.

## Next Step

- Report the completed implementation gate and stop. The final pushed branch
  has been verified with an exact-SHA READY Preview and HTTP 200. Do not make
  further engineering, Production, SQL, merge, secret, or real-document
  changes in this task.

## Production

- Production untouched. No SQL/schema/data mutation, real upload, Vercel env
  change, Gemini key, frontend deployment, financial operation, or merge.

## Relevant Files

- `src/utils/universalDebtDocument.ts` — preserves source-row-number validity
  metadata for safe fallback decisions.
- `src/utils/debtDocumentFirstOnboarding.ts` — prompt, canonical semantics,
  blockers/warnings, defaults, and history principal derivation.
- `src/components/DebtDocumentFirstOnboarding.tsx` — review cards, warnings,
  blocker gate, history UX, and create-button safety.
- `src/utils/debtDocumentFirstOnboarding.test.ts` — sanitized parser,
  normalization, semantic, and history regressions.
- `src/components/DebtDocumentFirstOnboarding.test.tsx` — jsdom review UX and
  disabled-create regression.
- `.ai/STATE.md` — current handoff/production safety state.
