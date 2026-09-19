# Project Plan

The CURRENT_GATE block is the only implementation gate authorized by this roadmap without explicit reprioritization.

## Completed gates

- Gate 0 — Durable GitHub memory and upstream baseline.
- Gate 1 — Pinned eval harness + host-readiness measurement. Closed `incomplete_external_environment`: deterministic infrastructure is green; Claude was blocked by invalid OAuth, and Codex clean-host isolation requires credential-level action. No model-quality precision/recall claim is made.

<!-- CURRENT_GATE_START -->
## Gate 2 — Owned contracts and durable audit state

Status: Contracts/reducer implementation green; ready for review  
Issue: #8

### Goal

Move trust-critical audit state, authority, and transition rules out of model prompts into versioned provider-neutral application contracts.

### Scope

Current bounded subtask:

- TypeScript-first hosted-domain package;
- owned versioned contracts for audit runs, worker assignments/outcomes, audit events, coverage units, candidates/findings, and evidence requirements;
- provider/host details represented only as adapter metadata;
- deterministic event reducer;
- explicit complete/incomplete terminal semantics;
- invalid transitions fail closed;
- tests for worker failures, unresolved candidates, and evidence blockers.

No database in this first slice. Contract semantics come before persistence.

### Acceptance

- TypeScript compiles in CI;
- contracts are versioned and provider-neutral;
- reducer tests cover the valid lifecycle and reject invalid transitions;
- refusal/provider-error/malformed outcomes cannot become clean coverage;
- a run cannot become complete while unresolved candidate/evidence blockers remain;
- all existing Cloudflare validators and Gate 1 eval tests remain green;
- durable memory names the next persistence slice.

### Non-goals

- No prompt/attack-class refactor.
- No model/provider SDK.
- No production database in this first slice.
- No sandbox.
- No MCP server.
- No automated fixes.

### Exit

The contracts/reducer slice is ready to exit when the focused PR is CI-green and merged.

Next bounded slice: Gate 2b — minimum durable event store + projections. It must replay the same accepted event stream through the reducer and prove reconstructed state is identical; it may not introduce alternate transition semantics.
<!-- CURRENT_GATE_END -->

## Queued roadmap

### Gate 2b — Minimum durable event store and projections
Persist events and reconstruct current run/coverage/candidate state without changing reducer semantics.

### Gate 3 — Minimal hosted Recon → Hunt → Validate harness
Implement stateless workers behind the deterministic orchestrator.

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
Add gapfill, dedup, fleet scheduling, cross-repo tracing, provider strategies, and fixing only after measured need.
