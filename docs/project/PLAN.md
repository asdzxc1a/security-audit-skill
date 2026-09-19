# Project Plan

The CURRENT_GATE block is the only implementation gate authorized by this roadmap without explicit reprioritization.

<!-- CURRENT_GATE_START -->
## Gate 0 — Durable GitHub memory and upstream baseline

Status: Ready for review; local checks green, GitHub CI pending  
Issue: #1  
Upstream baseline: c1c8a8c1471069fb0e188eeaff69b8e8db6564a8

### Goal

Make GitHub a reliable, low-context project memory before changing audit behavior or adding hosted infrastructure.

### Scope

- Root AGENTS.md adapted to this project.
- Full project-memory protocol.
- Concise state, plan, test strategy, charter, decisions, lessons, and history structure.
- Gate issue + focused branch/PR workflow.
- Zero-dependency memory invariant checker.
- CI running memory checks and existing upstream validator regressions.
- Detailed upstream/research baseline archived under history.

### Acceptance

- Required memory files exist and memory routing is documented.
- STATE exposes one current gate, blockers, evidence status, and one next action.
- PLAN exposes exactly one CURRENT_GATE block.
- npm run check:memory passes.
- npm run check passes, including the existing Cloudflare validator suites.
- CI runs the same full check.
- The Gate 0 PR records evidence and next concrete gate.
- No Cloudflare audit-methodology behavior change is included.

### Non-goals

- No prompt/attack-class refactor.
- No hosted server implementation.
- No database/event store.
- No sandbox provider.
- No MCP server.
- No dedup, cross-repo trace, contextual judgment, or fixer.

### Exit

Gate 0 exits only when required evidence is green and durable memory points to Gate 1.
<!-- CURRENT_GATE_END -->

## Queued roadmap

These gates are directional and may be revised by evidence. Do not implement them while Gate 0 is current.

### Gate 1 — Pinned baseline and eval harness

Measure the unmodified upstream workflow before refactoring it. Establish reproducible fixtures for finding precision, coverage behavior, malformed worker output, refusal/error handling, and cost/context telemetry where the host exposes it.

### Gate 2 — Owned contracts and durable persistence

Define versioned owned contracts for runs, assignments, coverage units, candidates, findings, evidence requirements, and worker outcomes. Add the minimum persistent state/event model. Preserve the portable skill as a supported interface.

### Gate 3 — Minimal hosted Recon → Hunt → Validate harness

Implement stateless workers behind an orchestrator. The service, not the model, owns transitions, budgets, independence rules, retries, and canonical state.

### Gate 4 — Scoped/PR audit path and context compiler

Make diff/subsystem review the default cost-effective product path. Compile minimal task context from architecture, assigned units, relevant source, selected methodology, and output contracts.

### Gate 5 — Sandboxed local validation and immutable evidence

Add a hostile-target execution boundary, immutable source snapshots, bounded execution, artifact promotion, evidence hashes, and explicit proof provenance.

### Gate 6 — MCP/plugin interface

Expose user-intent tools for creating, planning, advancing, inspecting, and cancelling audits. Keep privileged internal state transitions and generic shell execution private.

### Gate 7 — Evidence requests, external advisory data, and contextual judgment

Turn needs-validation blockers into resumable evidence requests. Add trusted external providers for deployment context and advisory/CVE evidence without giving target-controlled sandboxes Internet access.

### Gate 8 — ChatGPT UI and reporting

Add an MCP App/dashboard for coverage, findings, evidence traces, blockers, budget/cost, and report export while keeping the core usable without UI.

### Gate 9 — Scale only when measured

Add dedicated gapfill, dedup, fleet scheduling, cross-repository tracing, multiple provider strategies, and automated fixing only after measured need and an accepted decision.
