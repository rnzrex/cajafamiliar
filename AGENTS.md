# Agent Instructions

This repository uses one shared continuity layer for OpenCode, AntiGravity,
Codex, and any other coding agent. Keep this file short. The detailed shared
state lives in `.ai/`.

## Mandatory Bootstrap

Before making any change:

1. Run `git status -sb`.
2. Run `git rev-parse --abbrev-ref HEAD`.
3. Run `git rev-parse HEAD`.
4. Run `git log -5 --oneline`.
5. If network access is available, run `git fetch origin --prune`.
6. Read `.ai/STATE.md`, `.ai/DECISIONS.md`, and `.ai/RUNBOOK.md`.
7. Compare Git's actual state with `STATE.md`.

Git is authoritative for objective repository facts. `STATE.md` is
authoritative for intent, durable context, pending decisions, and the next
step. Never use `reset`, `checkout`, or `clean` to force a match.

Before work starts, identify the active objective, branch, PR, constraints,
completed work, pending work, required tests, and Production status.

## Handoff

Before ending a session, changing agents, or exhausting quota, update
`.ai/STATE.md` with the objective, completed and incomplete work, key files,
decisions, tests, blockers, next command, commit/push status, Production
status, and current restrictions. Keep it operational; do not paste logs or
conversation transcripts.

When a significant block changes the objective, branch/PR, blockers, gates,
Production status, or next move, update `STATE.md` at that checkpoint.

## Shared Worktrees

When agents use the same local worktree, no commit is required just to change
agents. Read this file and `.ai/STATE.md`, inspect Git, and continue existing
local changes. Never discard uncommitted work only because it is uncommitted.

Changes going to another machine or remote workspace travel through Git:
make a coherent checkpoint, commit, push, and update `STATE.md` when possible.
This is repository synchronization, not an agent migration.

## Safety

- Do not touch Production, remote SQL, or deployment state without explicit authorization.
- Do not modify applied Supabase migrations; use a new CLI migration for new SQL.
- Never use `git reset --hard`, `git clean -fd`, or force push without explicit extraordinary authorization.
- Do not create provider-specific instruction files that duplicate this layer.
- Never store secrets, tokens, keys, cookies, or sensitive user data in `.ai/`.
