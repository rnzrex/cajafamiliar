# Project State

## Objective

Fix the Document-First real-history principal recalculation bug on
`fix/debt-document-first-history-recalc-v1`, publish a DRAFT PR and verify an
exact-SHA Preview, then stop before Production, SQL, merge, secrets, or real
debt/document actions.

## Repository

- Repository: `rnzrex/cajafamiliar`.
- Base/current main: `bdbe13b7698435bd5187203df61479b67b866505`.
- Branch: `fix/debt-document-first-history-recalc-v1`.
- Branch was created locally from the requested current main commit and the
  implementation commit is `1d28e8627154e5865aae3b5be7705e29d7e823cc`.
- PR #72 is OPEN/DRAFT against `main`; no force push is permitted.

## Constraints

- No SQL, migration, schema, RPC, RLS, grant, Production write, real debt
  creation, real PDF upload/commit, PII fixture, Production deployment,
  Gemini secret, or merge.
- Change only client-side history calculation/semantics, prompt wording,
  review UI, and regression tests.
- Preserve manual creditor-balance override as highest priority.

## Discovered bug

`deriveOpeningPrincipalFromDocument` returns documentary
`explicitCurrentPrincipal` before calculating user-confirmed paid rows. A
stale AI-reported 76,500 therefore freezes the history result and ignores a
changed last-paid installment.

## Completed implementation

- Removed the documentary-current-principal early return so NEW_DEBT and
  user-confirmed existing-debt history derive from financed principal and paid
  ordinary rows; down-payment rows remain excluded.
- Preserved manual creditor-balance override as the highest-priority value in
  the review component.
- Return null, not stale documentary principal, when a paid ordinary row has
  unknown principal; future unknown rows do not block a known past boundary.
- Clarified `currentPrincipalAmount` as dated CURRENT/VIGENTE documentary
  evidence and `openingPrincipalAmount` as financing opening principal; neither
  substitutes for user-confirmed payment history.
- Added stale-76,500 utility fixtures, unknown-paid/future-unknown regressions,
  reactive jsdom 8 -> 9 coverage, and a save-payload assertion for 68,000.

## Validation

All validation currently passes:

- Full Vitest with one worker — 78 files, 1,097 tests.
- Document-First utility/jsdom targeted — 2 files, 17 tests.
- Universal Contract Engine — 2 files, 42 tests; migration hygiene
  additive-only, 13 required symbols, 0 forbidden terms.
- BANK reconstruction — 1 file, 11 tests.
- BANK prepayment — 1 file, 18 tests.
- BANK External AI/import — 3 files, 29 tests.
- BANK Document V5 — 6 files, 26 tests.
- `npm run typecheck:api`, `npm run build`, `git diff --check`, and all
  `scripts/*.mjs` Node syntax checks pass. Build has only existing Vite
  dynamic-import/large-chunk warnings.

## Next Step

Gate complete. Keep PR #72 DRAFT and stop. Do not modify Production, SQL,
secrets, real debt/document data, or merge.

## Production

Production untouched. No SQL/schema/data mutation, real upload, Vercel env
change, Gemini key, frontend deployment, financial operation, or merge.

## Relevant Files

- `src/utils/debtDocumentFirstOnboarding.ts` — history principal derivation.
- `src/components/DebtDocumentFirstOnboarding.tsx` — reactive history UI and
  RPC payload construction.
- `src/utils/debtDocumentFirstOnboarding.test.ts` — utility regressions.
- `src/components/DebtDocumentFirstOnboarding.test.tsx` — jsdom UI regressions.
- `.ai/STATE.md` — current handoff and safety state.

## Published validation

- Remote branch SHA: `1d28e8627154e5865aae3b5be7705e29d7e823cc`.
- Exact Preview: `dpl_5CyAp6gLa79U1foLJD3AY2dZivnD`,
  `https://cajafamiliar-cp4zb5ejp-renzorex.vercel.app/`, READY, HTTP 200.
- Preview build logs contain only the existing ineffective dynamic-import and
  large-chunk warnings; no fatal/error build event.
- No Production deployment or Vercel environment mutation was performed.
