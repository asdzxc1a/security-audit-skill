# Project Plan

The CURRENT_GATE block is the only implementation gate authorized by this roadmap without explicit reprioritization.

## Completed gates

- Gate 0 — Durable GitHub memory and upstream baseline.
- Gate 1 — Pinned eval harness + host-readiness measurement. Closed `incomplete_external_environment`; no model-quality precision/recall claim is made.
- Gate 2 — Provider-neutral contracts + deterministic fail-closed reducer.
- Gate 2b — Durable accepted-event store + replay projections.
- Gate 3a — Straight-through Recon → Hunt → candidate Validate orchestration.
- Gate 3b — Evidence-bearing/bounded orchestration hardening.
- Gate 3c — Bounded coverage critics, final verification, reporting, and terminalization.
- Gate 3d — Resumable orchestration checkpoints. Merged as f88982a0bbb15f782fbd806c2ccbfdfdfd4fa171.

<!-- CURRENT_GATE_START -->
## Gate 3e — Delayed-review compatibility and memory hardening

Status: Implementation/local evidence green; ready for review  
Issue: #12

### Goal

Close all delayed trust/reliability findings from merged PR #17 before declaring Gate 3 complete.

### Scope

- preserve schema-v2 event-store readability after the schema-v3 writer upgrade;
- checksum historical events in their original schema before in-memory upcast;
- leave historical event bytes/checksum chain unchanged during reads;
- mark synthesized legacy checkpoint receipts explicitly non-resumable;
- safely terminalize nonterminal schema-v2 runs with legacy assignments as incomplete without worker calls;
- allow current-schema terminalization events to extend a legacy checksum chain;
- summarize incomplete-reason overflow instead of rejecting reason 129+;
- consolidate duplicate D-011 and duplicate Lesson ID;
- make memory CI reject duplicate Decision/Lesson IDs.

### Acceptance

- terminal schema-v2 store reads under current code without rewriting original files;
- active schema-v2 store with an assignment reads and terminalizes incomplete without provider invocation;
- mixed v2/v3 stream remains readable after terminalization;
- original v2 checksum validation occurs before upcast;
- unsupported schema versions still fail closed;
- >128 unique incomplete reasons do not wedge the reducer and can still terminalize incomplete;
- D-011 exists exactly once;
- all Decision IDs and Lesson IDs are unique and checked by `check:memory`;
- all upstream/eval/domain/storage/orchestrator tests remain green;
- GitHub CI is green;
- review has no unresolved trust-critical findings.

### Non-goals

- No general multi-version migration framework beyond v2→v3 compatibility required by existing history.
- No distributed locking/leader election.
- No provider SDK.
- No context compiler.
- No sandbox.
- No MCP server.
- No Cloudflare prompt/attack-class changes.

### Exit

Gate 3e exits when its PR is CI/review-green and merged. Issue #12 then closes and Gate 3 is complete.

Next gate: Gate 4 — scoped/PR audit path and deterministic context compiler.
<!-- CURRENT_GATE_END -->

## Queued roadmap

### Gate 4 — Scoped/PR audit path and deterministic context compiler
Make diff/subsystem review the default cost-effective path. Build bounded deterministic worker context from immutable source/scope, canonical audit state, and selected methodology blocks.

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
