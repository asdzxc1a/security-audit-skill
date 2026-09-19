# Project State

Updated: 2026-09-19

## Current truth

- Repository: asdzxc1a/security-audit-skill
- Upstream: cloudflare/security-audit-skill
- Pinned methodology baseline: c1c8a8c1471069fb0e188eeaff69b8e8db6564a8
- Gate 0 memory foundation merged as 707d2e7305212bc76045217b4bdf6f36acf44fb3.
- Gate 1 deterministic eval foundation merged as 5b3421034420bd205c142acd3d92ae19bd9fbd42.
- Gate 1 source-only Claude baseline adapter merged as 44bf520d2b67099012c3c4313438536f253c40aa.
- Gate 1 Claude ambient-host isolation hardening merged as f075eb5f87c080871db1f61e98d5b6f753d08f27.
- Product direction: preserve the portable Cloudflare skill while building a persistent hosted security-research service exposed through MCP/plugin interfaces.
- Durable memory: GitHub repository docs, issues, PRs, code, and test evidence. Chat is not project state.
- Upstream audit methodology has not been intentionally changed in this fork.

## Current gate

- Gate: 1 — Pinned baseline and evaluation harness
- Active issue: #3
- Branch: gate-1/claude-auth-failure-evidence
- PR: not opened yet
- Current bounded subtask: preserve the first isolated real-run provider failure and select the next operational host path
- Status: in progress

## Blockers

- Claude Code host isolation is now acceptable for the source-only baseline.
- The isolated Claude baseline failed before inference with 401 invalid OAuth token; input/output tokens and reported cost were zero.
- Claude credential repair would require an explicit credential/authentication flow.
- Gate 1 still has no completed real model baseline.

## Verified evidence

- The earlier ambient-MCP contamination is fixed: the isolated retry spawned no ambient MCP child process.
- The isolated retry produced a valid failed run record with null artifacts and provider_error=1.
- No findings/coverage result or score is claimed from the provider-auth failure.
- Static Claude auth status was insufficient to prove provider readiness.
- Codex CLI is installed and reports ChatGPT authentication; its multi-agent feature is stable/enabled, but its source-only capability boundary still needs an owned adapter/probe before use.

## Next action

Persist this failed-run evidence, then implement/test a second host path with explicit ambient-config isolation and a minimal authenticated inference probe before attempting another full baseline.
