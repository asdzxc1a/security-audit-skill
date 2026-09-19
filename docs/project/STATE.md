# Project State

Updated: 2026-09-19

## Current truth

- Repository: asdzxc1a/security-audit-skill
- Upstream: cloudflare/security-audit-skill
- Pinned methodology baseline: c1c8a8c1471069fb0e188eeaff69b8e8db6564a8
- Gate 0 merged as 707d2e7305212bc76045217b4bdf6f36acf44fb3.
- Gate 1 deterministic eval foundation merged as 5b3421034420bd205c142acd3d92ae19bd9fbd42.
- Gate 1 source-only Claude baseline adapter merged as 44bf520d2b67099012c3c4313438536f253c40aa.
- Product direction: preserve the portable Cloudflare skill while building a persistent hosted security-research service exposed through MCP/plugin interfaces.
- Durable memory: GitHub repository docs, issues, PRs, code, and test evidence. Chat is not project state.
- Upstream audit methodology has not been intentionally changed in this fork.

## Current gate

- Gate: 1 — Pinned baseline and evaluation harness
- Active issue: #3
- Branch: gate-1/host-isolation-hardening
- PR: not opened yet
- Current bounded subtask: harden Claude baseline host isolation before retrying the first real baseline
- Status: in progress

## Blockers

- The first real baseline was cancelled because Claude Code loaded ambient user MCP configuration despite the source-only tool list.
- This is a host-isolation defect in our adapter, not an upstream Cloudflare audit result.
- The real baseline must not be retried until the isolation regression tests are green.

## Verified evidence

- The cancelled run produced no accepted audit artifacts and no score.
- The offending run spawned an ambient user MCP child process before completion.
- A non-model Claude probe with project-only settings + strict empty MCP config + slash commands disabled exposed only built-in agents.
- The adapter now needs those controls made mandatory and tested.

## Next action

Finish the host-isolation patch, run the full repository checks, open/merge the focused hardening PR, then retry exactly one capped unchanged-skill baseline.
