# Project Decisions

Only Accepted decisions are active architectural authority.

## D-001 — GitHub is durable project memory

Status: Accepted  
Date: 2026-09-19

### Context

The project must survive chat boundaries and be understandable by future agents without loading old conversations.

### Decision

Use repository docs for durable truth/rationale/lessons/history, GitHub Issues for active implementation work, branches/PRs for changes and evidence, and code/tests as stronger authority than prose.

Chat, local scratch, and model context are not project state.

### Consequences

Every meaningful completed change must update stale durable memory in the same handoff. Duplicate memory is avoided through the routing rules in PROJECT_MEMORY_SYSTEM.md.

## D-002 — Preserve upstream lineage and portable methodology

Status: Accepted  
Date: 2026-09-19

### Context

The fork exists to build a server/plugin product from cloudflare/security-audit-skill, not to erase the upstream research methodology.

### Decision

Keep the GitHub fork relationship and pin the initial working baseline to c1c8a8c1471069fb0e188eeaff69b8e8db6564a8. Preserve the current portable skill while hosted capabilities are added alongside it.

### Consequences

Methodology changes require measured evidence and a focused decision. Upstream changes can be compared and selectively incorporated rather than copied blindly.

## D-003 — Measure before refactoring the audit methodology

Status: Accepted  
Date: 2026-09-19

### Context

The upstream project's evolution shows many unusual constraints are responses to real agent and host failures. External users also report cost, malformed-output, and coverage failure modes.

### Decision

Gate 1 must establish a pinned baseline/eval harness before we restructure prompts, attack companions, verdict semantics, or coverage behavior.

### Consequences

Architecture cleanup that could change audit behavior waits for measurement. Infrastructure that does not alter behavior may proceed only through the current gate.

## D-004 — Hosted state and authority live outside model prompts

Status: Accepted  
Date: 2026-09-19

### Context

The target product must run as a durable server/MCP/plugin system. Model contexts are finite and unreliable as transaction/state stores.

### Decision

The hosted engine will own persistent state, authorization, budgets, transitions, worker independence, retries, and evidence acceptance. Model workers will be treated as replaceable reasoning compute.

### Consequences

Public MCP tools operate on user intent and stable identifiers; they do not expose internal privileged transitions or a generic shell.
