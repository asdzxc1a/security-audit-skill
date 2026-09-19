# Project Plan

The CURRENT_GATE block is the only implementation gate authorized by this roadmap without explicit reprioritization.

## Completed gates

- Gate 0 — Durable GitHub memory and upstream baseline.
- Gate 1 — Pinned eval harness + host-readiness measurement. Closed `incomplete_external_environment`; no model-quality precision/recall claim is made.
- Gate 2 — Provider-neutral contracts + deterministic fail-closed reducer.
- Gate 2b — Durable accepted-event store + replay projections. Merged as 23541f83213b900e566aa65570064bf0b1414459.

<!-- CURRENT_GATE_START -->
## Gate 3 — Minimal hosted Recon → Hunt → Validate harness

Status: Straight-through orchestration slice green; ready for review  
Issue: #12

### Goal

Execute the first hosted provider-neutral audit workflow with stateless workers while keeping canonical state, authority, budgets, and evidence transitions in the owned reducer/event-store layer.

### Scope

Current bounded subtask:

- provider-neutral `WorkerAdapter`;
- owned stateless recon, hunter, and candidate-verifier tasks;
- runtime validation of untrusted worker observations;
- orchestrator-only translation from observations to owned audit events;
- all state mutation through `AuditEventStore.append`;
- deterministic injectable IDs;
- typed handling for refusal, malformed output, provider error, timeout, permission denial, sandbox failure, and cancellation;
- straight-through Recon → coverage registration → Hunt → candidate Validate;
- durable `needs_validation` evidence handoff;
- explicit incomplete outcomes for worker failures, unresolved coverage/candidates, and budget exhaustion;
- stop at `record_verification` handoff.

### Acceptance

- valid candidate flow reaches `record_verification` through persisted events;
- clean covered flow reaches `record_verification`;
- recon/provider failure is persisted and run becomes incomplete;
- hunter failure/refusal cannot become clean coverage;
- malformed output becomes `malformed_result`;
- candidate-verifier failure cannot disposition the candidate;
- `needs_validation` opens durable handoff evidence before disposition;
- blocked/deferred coverage prevents final completion;
- budget exhaustion becomes explicit incomplete state;
- restart event replay reproduces orchestrator state;
- all existing upstream/eval/domain/storage tests remain green;
- GitHub CI is green.

### Non-goals

- No real model/provider SDK.
- No context compiler yet.
- No coverage-critic/reassignment waves in this first slice.
- No final record-verification/reporting orchestration yet.
- No MCP server.
- No sandbox.
- No prompt/attack-class changes.

### Exit

This first Gate 3 slice exits when its focused PR is CI-green and merged.

Next bounded Gate 3 slice: add coverage-critic/reassignment waves and final record-verification/reporting orchestration while preserving the same observation → owned event → reducer/event-store authority chain.
<!-- CURRENT_GATE_END -->

## Queued roadmap

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
Add fleet scheduling, cross-repository tracing, provider strategies, and fixing only after measured need.
