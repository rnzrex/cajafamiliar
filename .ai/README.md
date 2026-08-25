# Cross-Agent Continuity

## PURPOSE

Allow any coding agent to continue the project without relying on provider-
specific memory.

## SOURCE OF TRUTH

- Code and objective Git facts: Git.
- Semantic project handoff state: `.ai/STATE.md`.
- Durable architectural decisions: `.ai/DECISIONS.md`.
- Stable commands and procedures: `.ai/RUNBOOK.md`.
- Bootstrap instructions: `AGENTS.md`.

`AGENTS.md` stays small and mandatory. `STATE.md` changes frequently at
handoff checkpoints. `DECISIONS.md` changes rarely and contains durable
choices only. `RUNBOOK.md` changes only when the stable process changes.

This layer is shared by OpenCode, AntiGravity, Codex, and other agents. Do not
create divergent vendor-specific copies.
