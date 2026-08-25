# Project Runbook

## Standard Validation

```text
npm test
npm run typecheck:api
npm run build
git diff --check
```

## Debt Validation

```text
npm run test:bank-v2-local
npm run test:debt2b2
npm run test:debt5fa:local
```

The BANK V2 smoke suite is local and must not be pointed at Production.

## Local Supabase

- Project ID: `caja-familiar`
- Expected Postgres container: `supabase_db_caja-familiar`
- Auth is normally disabled in `supabase/config.toml`.
- If a local test requires Auth temporarily, restore the configuration and stop
  the temporary Auth container afterward.
- Never leave Auth enabled accidentally and never use service-role secrets in
  this continuity layer.

## Git Safety

Before work, run the bootstrap commands in `AGENTS.md` and inspect status,
diff, and recent history. Never run these without extraordinary explicit
authorization:

```text
git reset --hard
git clean -fd
git push --force
```

For a same-worktree agent handoff, keep valid local changes. For another
machine or remote workspace, use a coherent Git checkpoint, commit, push, and
the handoff state file.

## Migration Safety

- Do not modify historical or already-applied migrations.
- Create new SQL only through a new Supabase CLI migration when authorized.
- Do not run remote SQL or Production migrations during ordinary validation.

## Production Order

For frontend changes that depend on new tables or RPCs:

1. Validate migrations locally.
2. Apply compatible schema to Production only after explicit authorization.
3. Verify schema, RLS, and advisors.
4. Merge the frontend change.
5. Wait for deployment.
6. Run Production smoke and regression checks.

This sequence is documented only; do not execute it for the continuity commit.

## Handoff Checkpoint

Update `.ai/STATE.md` before ending a session or changing agents. Record the
next command, tests, blockers, commit and push status, and Production status,
without copying large logs.
