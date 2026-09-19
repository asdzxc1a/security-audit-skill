# Project State

Updated: 2026-09-19

## Current truth

- Repository: asdzxc1a/security-audit-skill
- Upstream: cloudflare/security-audit-skill
- Pinned methodology baseline: c1c8a8c1471069fb0e188eeaff69b8e8db6564a8
- Gate 0 merged as 707d2e7305212bc76045217b4bdf6f36acf44fb3.
- Gate 1 deterministic eval foundation merged as 5b3421034420bd205c142acd3d92ae19bd9fbd42.
- Product direction: preserve the portable Cloudflare skill while building a persistent hosted security-research service exposed through MCP/plugin interfaces.
- Durable memory: GitHub repository docs, issues, PRs, code, and test evidence. Chat is not project state.
- Upstream audit methodology has not been intentionally changed in this fork.

## Current gate

- Gate: 1 — Pinned baseline and evaluation harness
- Active issue: #3
- Branch: gate-1/claude-baseline-runner
- PR: #5
- Current bounded subtask: source-only Claude Code baseline adapter and failure-preserving run records
- Status: source-only Claude adapter ready for review; real baseline still pending

## Blockers

- No blocker for adapter implementation/testing.
- Real external model execution can consume subscription/API quota and still requires an explicit execution budget when invoked.
- This Gate 1 adapter intentionally lacks the OS-enforced target-code sandbox required for confirmed dynamic evidence; it must preserve that limitation rather than execute target code.

## Verified evidence

- Gate 1 deterministic corpus/scorer is merged.
- Claude Code 2.1.92 is installed and authenticated on the connected development machine.
- Claude Code supports non-interactive JSON output, custom agents, tool restriction, and max-budget controls.
- No prompt, companion, findings-schema, or coverage-schema behavior change is part of this subtask.

Baseline-adapter checks have not yet run on this branch.

## Next action

Review/merge PR #5. Then execute the first unchanged-skill baseline with an explicitly approved model budget and archive the resulting complete or incomplete run record.
