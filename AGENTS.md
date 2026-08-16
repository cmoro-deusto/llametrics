# Repository Guidelines

> **Status: empty repository.** No code has landed yet. This is a starter scaffold — re-run the `init-dordo` skill once the first substantive code lands to regenerate this document from the actual codebase.

## Project Overview

No code exists yet. By name, this project appears intended as metrics/monitoring tooling for LLM workloads. Update this section once the purpose is pinned down.

## Architecture & Data Flow

None yet — the repository contains only this file.

## Key Directories

The repository root contains only `AGENTS.md`. No source directories exist.

## Development Commands

No build/test/lint/run toolchain is set up yet. Once a manifest lands (`package.json`, `Cargo.toml`, `go.mod`, `pyproject.toml`, …), document the canonical commands here.

## Code Conventions & Common Patterns

Nothing to document yet. When code lands, record here: formatting, naming, error handling, async patterns, dependency injection, state management.

## Important Files

- `AGENTS.md` — this document (the only file in the repository).

## Runtime/Tooling Preferences

Unpinned. Record the required runtime (e.g., Node vs Bun, Python version) and package manager here as soon as they are chosen.

## Testing & QA

No test framework is set up yet.

## Git & PR Workflow

Note: no git repository is initialized yet (`git init` not run).

- Commits: allowed. Always on a feature branch — **never commit directly to `main`**.
- Pushing and opening PRs: only with **explicit user consent** in the current session. Never assume or infer consent.
- Never merge a PR — not even when CI is green or the PR looks ready. Merging into `main` is always the user's action.
- Flow: create branch → commit → (with consent) push + open PR → watch CI → notify the user that the PR is ready to merge. Stop there.
