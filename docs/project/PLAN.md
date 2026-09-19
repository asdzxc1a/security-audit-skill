# Project Plan

The CURRENT_GATE block is the only implementation gate authorized by this roadmap without explicit reprioritization.

## Completed gates

- Gate 0 — Durable GitHub memory and upstream baseline.
- Gate 1 — Pinned eval harness + host-readiness measurement. Closed `incomplete_external_environment`; no model-quality precision/recall claim is made.
- Gate 2 — Provider-neutral contracts + deterministic fail-closed reducer.
- Gate 2b — Durable accepted-event store + replay projections.
- Gate 3a — Straight-through Recon → Hunt → candidate Validate orchestration. Merged as 5765eedfecffcce84b77794876186bc097106e15.
- Gate 3b — Evidence-bearing bounded orchestration contracts. Merged as 8f3dee2cd3a71fe7db52081a3194a5c3885f2d63.

<!-- CURRENT_GATE_START -->
## Gate 3c — Critic convergence and final verification/reporting

Status: Implementation/local evidence green; ready for review  
Issue: #12

### Goal

Close the full in-process audit lifecycle with owned semantic coverage, iterative coverage criticism/reassignment, independent final record verification, and reducer-gated terminal completion.

### Scope

- bump domain/orchestration contracts to schema version 3;
- recon returns semantic coverage definitions, never canonical IDs;
- orchestrator assigns coverage IDs;
- persist bounded surface/boundary/subsystem/attack-class/lifecycle/starting-path/methodology semantics;
- reject semantic coverage aliases;
- coverage critic receives immutable coverage snapshots;
- quick requires one clean critic; standard/deep require two consecutive clean fresh critics;
- critic can explicitly reopen covered/candidate/blocked/deferred units;
- reopened work must use a fresh hunter;
- candidate verifier persists a validated replacement claim + rationale for retained records;
- final record verifier receives canonical validated claim, rationale, linked coverage, verdict, and open evidence handoffs;
- final verifier can accept or reject with durable reason;
- rejected needs_validation candidates close obsolete handoff requirements;
- reporting transition + run completion remain reducer-gated.

### Acceptance

- semantic coverage identity is persisted and hunter-visible;
- recon cannot choose canonical coverage IDs;
- semantic alias coverage is rejected;
- standard/deep cannot close without two clean fresh critics;
- reassignment resets clean convergence and uses fresh hunters;
- candidate coverage can be re-reviewed without duplicating an existing root cause;
- blocked/deferred coverage cannot be hidden by a clean critic;
- critic failure/budget exhaustion produces incomplete state;
- retained candidate uses candidate-verifier-authored canonical claim/rationale;
- final verifier is independent and receives the canonical record;
- final accept/reject is persisted;
- final rejection of needs_validation resolves obsolete handoff evidence;
- reporting cannot complete while reducer invariants remain unresolved;
- all existing upstream/eval/domain/storage/orchestrator tests remain green;
- GitHub CI and review feedback are green.

### Non-goals

- No provider SDK.
- No context compiler.
- No process-resume/recovery entrypoint in this slice.
- No MCP server.
- No sandbox.
- No Cloudflare prompt/attack-class changes.

### Exit

Gate 3c exits when the focused PR is CI-green, review-clean, and merged.

Next bounded Gate 3 slice: Gate 3d — resumable orchestration/recovery from durable event history, including interrupted assignment reconciliation without introducing alternate state semantics.
<!-- CURRENT_GATE_END -->

## Queued roadmap

### Gate 3d — Resumable orchestration and recovery
Resume a nonterminal run from accepted event history. Reconcile interrupted assignments explicitly, preserve idempotency, and continue the correct workflow stage without replaying successful work.

### Gate 4 — Scoped/PR audit path and context compiler
Make diff/subsystem review the default cost-effective path and compile bounded worker context from owned semantic coverage.

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
