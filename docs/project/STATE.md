# Project State

Updated: 2026-09-19

## Current truth

- Repository: asdzxc1a/security-audit-skill
- Upstream: cloudflare/security-audit-skill
- Pinned methodology baseline: c1c8a8c1471069fb0e188eeaff69b8e8db6564a8
- Gate 0 memory foundation is complete.
- Gate 1 deterministic eval, failure-preserving run records, and host-isolation evidence are complete.
- Gate 1 closes as incomplete_external_environment: no clean real model-quality baseline is claimed.
- Claude clean-host inference is blocked by invalid OAuth credentials.
- Codex inference is live, but ambient host skill discovery contaminates the normal auth home; a clean home is unauthenticated.
- Product direction: preserve the portable Cloudflare skill while building a persistent hosted security-research service exposed through MCP/plugin interfaces.
- Durable memory: GitHub repository docs, issues, PRs, code, and test evidence. Chat is not project state.
- Upstream audit methodology has not been intentionally changed in this fork.

## Current gate

- Gate: 2 — Owned contracts and durable audit state
- Active issue: #8
- Branch: not started until Gate 1 closeout merges
- PR: none
- Current bounded subtask: provider-neutral TypeScript contracts + deterministic event reducer
- Status: queued behind this closeout merge

## Blockers

None known for the first Gate 2 repository-controlled subtask.

External provider credentials/readiness remain adapter concerns and are not required to define the owned domain contracts.

## Verified evidence

- Gate 1 deterministic corpus/scorer is green.
- Cloudflare upstream validator regressions remain green through Gate 1 changes.
- Failure/refusal/provider-error runs are preserved without fake findings.
- Claude ambient MCP contamination was detected, fixed, and regression-tested.
- Isolated Claude inference failed with zero-token 401 provider error.
- Codex minimal inference succeeded, but ambient user skill discovery remained even when user config/rules were ignored.
- Clean temporary CODEX_HOME removes that ambient state but is not authenticated.
- Detailed host matrix is archived under history.
- Decision D-005 authorizes Gate 1 closeout as incomplete_external_environment without claiming a model-quality baseline.

## Next action

Merge the Gate 1 closeout, close issue #3 as incomplete_external_environment, then start Gate 2 issue #8 on a focused contracts/reducer branch and run the full repository check.
