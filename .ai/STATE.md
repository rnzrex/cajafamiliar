# Project State

## Objective

CREDIT CARDS SEPARATION Phase 1 and SYNC DRAFT PRESERVATION are CLOSED in Production.

Credit cards are now separated from generic debt management at the UX/application-routing layer while preserving the existing credit-card ledger. Eligible active PEN cards can be used as spending sources. Authoritative background refreshes preserve active unsaved MovementForm drafts.

BANK CREDIT CONTRACT V2 remains a closed Production baseline.

## Active Work

- No Credit Cards Phase 1 or sync-draft work is pending.
- Treat PR #62 as a closed Production baseline unless a concrete regression is observed.
- No BANK V2 work is pending.

## Repository

- Default branch: `main`
- Credit Cards PR: `#62` — MERGED
- Credit Cards merge commit: `563c67bde79b58d266135e61b826655c935a43e7`
- Credit Cards validated branch head before merge: `22f7c2aa252ec6493ed71820b92a943d22616465`
- BANK V2 PR: `#61` — MERGED
- BANK V2 merge commit: `54d26fcce957cf425067b7e18f8a9eb67c45e69e`
- BANK V2 validated financial checkpoint: `b859522b0bba761a5e1950305422d487b4bb4575`
- The actual current HEAD must always be read from Git; do not assume this file's commit is the repository HEAD.

## Completed — Credit Cards Separation

- Added top-level `Tarjetas` navigation and a dedicated cards manager.
- Added independent credit-card onboarding instead of creating cards from the generic debt form.
- Removed `credit_card` from generic debt onboarding while preserving `DebtKind = credit_card` internally for historical/model compatibility.
- Filtered cards out of generic debt manager, planning, strategy, portfolio, and attention views.
- Preserved cards in global financial intelligence where their liability is economically relevant without double counting.
- Added active, non-archived PEN cards as explicit spending sources in `MovementForm`.
- Recurring-payment flows do not allow cards as payment sources.
- USD cards remain operable from the Tarjetas domain and are intentionally not exposed in the PEN-oriented generic movement form.
- Routed card purchases through the existing atomic credit-card operation dispatcher with stable retry IDs.
- Preserved correct accounting semantics: card purchase counts as the consumption expense once; later card payment reduces cash/account and liability without re-counting the original consumption expense.
- Protected credit-card movement contexts from generic movement edit/delete flows.
- Preserved card deep links and routed them to Tarjetas.
- Moved card-specific statement alerts into Tarjetas.
- Fixed movement Excel export so card currencies/economics resolve using card entries and debts.
- Added optional TEA/TCEA capture to card onboarding with non-negative validation and numeric-or-`null` payload semantics.

## Completed — Sync Draft Preservation

- Changed `MovementForm` hydration to use logical form identity rather than authoritative array/object references.
- Equivalent remote refreshes no longer reset amount, description, date, category, person, or selected source while the user is editing.
- Existing movement edits are preserved when the same movement ID returns as a new remote object.
- Explicit transition to a different movement ID or recurring draft identity still rehydrates correctly.
- If a selected account/card/category becomes unavailable during a new draft, the draft and original selection remain visible, fallback is not performed silently, and submit is blocked until explicit reselection.
- Historical archived accounts and inactive categories remain valid when they are the original references of an existing movement, avoiding forced rewriting of financial history.
- Membership revalidation now keeps an already-authorized App mounted during transient remote failures and exposes retry, while an explicit successful membership lookup with no membership still revokes access.

## Validation

- `npm test`: PASS — 54 files / 877 tests.
- Focused final audit suites: PASS — 3 files / 17 tests.
- `npm run typecheck:api`: PASS.
- `npm run build`: PASS.
- `npm run test:bank-v2-local`: PASS.
- `npm run test:debt2b2`: PASS.
- `npm run test:debt5fa:local`: PASS.
- `git diff --check`: PASS.
- Real Chrome local smoke: PASS for expense, income, and PEN-card drafts after more than 21 seconds of periodic refresh; expense/card cases also survived tab visibility changes.
- Temporary local Auth used for smoke was restored to `auth.enabled = false` and the temporary container was stopped.
- Final branch Vercel Preview: READY for exact head `22f7c2aa252ec6493ed71820b92a943d22616465`; HTTP 200.

## Production

- PR #62 merged to `main` as `563c67bde79b58d266135e61b826655c935a43e7`.
- Vercel Production deployment: `dpl_9zhKhd8wcdVpG6cP4LeGbEm3cZvZ`.
- Deployment target: Production.
- Deployment Git SHA: `563c67bde79b58d266135e61b826655c935a43e7`.
- Deployment state: READY.
- Production aliases include `cajafamiliar.vercel.app`.
- Public Production URL returned HTTP 200 after the merge deployment.
- Production runtime error/fatal log check after deployment returned no entries.
- Credit Cards Phase 1 added NO SQL, migration, RPC, or Supabase schema change.
- Historical/applied BANK V2 migrations remain unchanged.
- No Production test/junk financial data was created.

## BANK V2 Baseline

- Bank-loan onboarding/profile validation, insurance terms, contractual/estimated schedules, lifecycle operations, append-only schedule versioning, `pending_bank_schedule` guards, and QAPAQ regression preservation remain the validated baseline.
- Supabase Production BANK V2 migration sequence remains:
  - `20260824225428_bank_credit_contract_v2.sql`
  - `20260825010000_bank_credit_contract_v2_audit_fix.sql`
  - `20260825071034_bank_credit_contract_v2_finalization.sql`
  - `20260825165854_bank_credit_contract_v2_schedule_state_guard.sql`
- Temporary accidental `noop` Edge Function remains removed; `reset-commercial-password` remains the intended active baseline.

## Known Non-Blocking Note

- The pre-existing statement-close RPC does not independently reject archived/non-active cards. This historical behavior was intentionally not altered because PR #62 was an application/UX separation with no SQL scope. Revisit only if a concrete card statement-close regression or security requirement demands a new migration.

## Blocked

- None known.

## Next Move

1. Start the next product objective from current `main`.
2. Before new work, run the mandatory bootstrap from `AGENTS.md` and read `.ai/STATE.md`, `.ai/DECISIONS.md`, and `.ai/RUNBOOK.md`.
3. Reopen Credit Cards Phase 1, sync-draft preservation, or BANK V2 only for a concrete regression or explicit new scope.

## Safety / Do Not

- Do not edit historical/applied BANK V2 migrations; future SQL changes require a new migration.
- Do not create test or junk Production financial data.
- Do not rewrite history, reset destructively, force push, expose secrets, change billing, or perform unrelated destructive work.
- Preserve legacy non-bank behavior plus validated QAPAQ, bank-loan, card, account, reconciliation, and movement semantics.

## Key Files

- `AGENTS.md`
- `.ai/README.md`
- `.ai/STATE.md`
- `.ai/DECISIONS.md`
- `.ai/RUNBOOK.md`
- `src/App.tsx`
- `src/components/CreditCardForm.tsx`
- `src/components/CreditCardsManager.tsx`
- `src/components/MovementForm.tsx`
- `src/components/AuthGate.tsx`
- `src/components/MovementsList.tsx`
- `src/utils/creditCardSpending.ts`
- `src/components/CreditCardForm.test.tsx`
- `src/components/MovementFormSync.test.tsx`
- `src/components/AuthGate.test.tsx`

## Last Handoff

- Agent: ChatGPT orchestrator
- Date: 2026-08-26
- Summary: final audit of PR #62 passed; blockers were verified resolved; PR #62 was marked ready and merged. The exact merge deployment reached READY in Vercel Production, the public site returned HTTP 200, and recent Production runtime error/fatal logs were clean. Credit Cards Separation Phase 1 and sync-draft preservation are now closed Production baselines.