# Project State

## Objective

Complete the Document-First real proforma parsing fix V1 on
`fix/debt-document-first-real-proforma-v1`, publish it as a DRAFT PR, verify
the exact-SHA Vercel Preview, and stop before Production, SQL, merge, secrets,
or real-document actions.

## Repository

- Repository: `rnzrex/cajafamiliar`.
- Base: `a0e430f297a6e9a4603ee8c6afb7ef87eac7110e` from `origin/main`.
- Branch: `fix/debt-document-first-real-proforma-v1`.
- Current local HEAD is the base; implementation changes are uncommitted.
- Remote branch exists at the same base; no force push is permitted.
- PR/Preview must be checked after the final push; keep PR DRAFT.

## Constraints

- Do not modify Production, apply SQL, create financial records, upload or
  commit the user's real PDF, add PII to fixtures, deploy Production, add
  Gemini secrets, or merge.
- Do not modify migrations or the existing document-first RPC.
- Change only prompt, parsing/normalization, semantic validation, review UX,
  and regression tests.

## Completed

- Hardened `DOCUMENT_FIRST_EXTERNAL_AI_PROMPT` so contractual numbers come
  only from an identified installment-number column and CI/LS/internal codes
  cannot become contractual numbers; documented CASH/down-payment, asset vs
  financed principal, introductory rows, scheduled principal, and term
  semantics.
- Added Document-First-only semantic normalization. It may map duplicate or
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

- Before this checkpoint: full Vitest PASS — 78 files, 1,093 tests.
- Before this checkpoint: `npm run typecheck:api` PASS; `npm run build` PASS
  with only existing Vite dynamic-import/large-chunk warnings.
- Before this checkpoint: Node syntax, `git diff --check`, Universal Contract
  Engine, BANK reconstruction, BANK prepayment, BANK External AI/import, and
  BANK Document V5 targeted suites PASS.
- After the final UI/test polish, rerun the required full and targeted checks
  before commit/push.

## Next Step

- Rerun validation, inspect the diff, commit the implementation plus this
  state checkpoint, push without force, create/update the DRAFT PR, and verify
  the Preview is READY/HTTP 200 with the exact final SHA and no unexplained
  error/fatal logs.

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
