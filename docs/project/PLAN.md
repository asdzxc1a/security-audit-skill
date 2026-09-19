# Project Plan

The CURRENT_GATE block is the only implementation gate authorized by this roadmap without explicit reprioritization.

## Completed gates

- Gate 0 — Durable GitHub memory and upstream baseline.
- Gate 1 — Pinned eval harness + host-readiness measurement. Closed `incomplete_external_environment`; no model-quality precision/recall claim is made.
- Gate 2 — Provider-neutral contracts + deterministic fail-closed reducer. Merged as 6d1c154c2c4253970dd9a2e7813e428f0950f695.

<!-- CURRENT_GATE_START -->
## Gate 2b — Minimum durable event store and projections

Status: Implementation/local evidence green; ready for review  
Issue: #8

### Goal

Persist accepted audit history durably and reconstruct current run/coverage/candidate state without changing reducer semantics.

### Scope

Current bounded subtask:

- replaceable `AuditEventStore` interface;
- file-backed durable reference adapter;
- only reducer-accepted events may publish;
- immutable one-event-per-sequence history;
- checksum chain and durable tail witness;
- exact append retry idempotency;
- restart replay through the existing reducer;
- deterministic rebuildable projections;
- tests for rejection, corruption, truncation, recovery, and replay equivalence.

### Acceptance

- reducer-rejected events never persist;
- restart/replay reconstructs state identical to direct reduction;
- exact event retries do not duplicate history;
- event corruption and sequence gaps/tail loss fail closed;
- crash before `HEAD` publication is recoverable from valid events;
- projections are derived only from replayed canonical state;
- all existing upstream, eval, reducer, and memory tests remain green;
- GitHub CI is green.

### Non-goals

- No production database technology commitment.
- No worker/provider SDK.
- No orchestration loop yet.
- No MCP server.
- No sandbox.
- No prompt/attack-class changes.
- No automated fixes.

### Exit

Gate 2b exits when the focused PR is CI-green and merged. Issue #8 then closes.

Next gate: Gate 3 — minimal hosted Recon → Hunt → Validate harness using these owned event-store/reducer contracts.
<!-- CURRENT_GATE_END -->

## Queued roadmap

### Gate 3 — Minimal hosted Recon → Hunt → Validate harness
Implement stateless workers behind the deterministic orchestrator. Worker/provider observations become owned events; the orchestrator does not mutate projected state directly.

### Gate 4 — Scoped/PR audit path and context compiler
Make diff/subsystem review the default cost-effective path.

### Gate 5 — Sandboxed local validation and immutable evidence
Add hostile-target execution isolation and proof provenance.

### Gate 6 — MCP/plugin interface
Expose user-intent audit tools while keeping privileged internals private.

### Gate 7 — Evidence requests, advisory data, and contextual judgment
Resolve external facts without weakening target sandbox isolation.

### Gate 8 — ChatGPT UI and reporting
Add coverage/finding/evidence UI and exports.

### Gate 9 — Scale only when measured
Add gapfill, dedup, fleet scheduling, cross-repository tracing, provider strategies, and fixing only after measured need.
