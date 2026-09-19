# Project State

Updated: 2026-09-19

## Current truth

- Repository: asdzxc1a/security-audit-skill
- Upstream: cloudflare/security-audit-skill
- Pinned methodology baseline: c1c8a8c1471069fb0e188eeaff69b8e8db6564a8
- Gate 0 merged as 707d2e7305212bc76045217b4bdf6f36acf44fb3.
- Product direction: preserve the portable Cloudflare skill while building a persistent hosted security-research service exposed through MCP/plugin interfaces.
- Durable memory: GitHub repository docs, issues, PRs, code, and test evidence. Chat is not project state.
- Upstream audit methodology has not been intentionally changed in this fork.

## Current gate

- Gate: 1 — Pinned baseline and evaluation harness
- Active issue: #3
- Branch: gate-1/eval-harness
- PR: #4
- Current bounded subtask: deterministic provider-neutral eval corpus/scorer
- Status: deterministic foundation ready for review; Gate 1 remains open

## Blockers

- None for the deterministic eval foundation.
- Repeated external model/provider baseline runs may incur billing and require explicit authorization before execution.

## Verified evidence

- Gate 0 memory/CI infrastructure is merged.
- The fork remains pinned to the upstream methodology baseline.
- No prompt, companion, finding-schema, or coverage-schema behavior change is part of this subtask.
- Fresh-clone npm run check: PASS. Upstream validators 65/65 PASS; eval corpus 3 cases valid; eval tests 5/5 PASS.

## Next action

Review/merge PR #4. Then define the first real provider/model baseline matrix; obtain explicit authorization before any run that can incur external model billing.
