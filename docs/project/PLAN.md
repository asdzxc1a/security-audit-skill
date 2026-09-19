# Project Plan

The CURRENT_GATE block is the only implementation gate authorized by this roadmap without explicit reprioritization.

## Completed gates

- Gate 0 — Durable GitHub memory and upstream baseline.
- Gate 1 — Pinned eval harness + host-readiness measurement. Closed `incomplete_external_environment`; no model-quality precision/recall claim is made.
- Gate 2 — Provider-neutral contracts + deterministic fail-closed reducer.
- Gate 2b — Durable accepted-event store + replay projections.
- Gate 3a — Provider-neutral straight-through Recon → Hunt → candidate Validate orchestrator. Merged as 5765eedfecffcce84b77794876186bc097106e15.

<!-- CURRENT_GATE_START -->
## Gate 3b — Coverage critics, final verification, reporting, and terminalization

Status: Implementation/local evidence green; ready for review  
Issue: #12

### Goal

Complete the minimal hosted audit lifecycle without weakening the observation → owned event → reducer/event-store authority chain.

### Scope

- owned `coverage_reopened` transition tied to a successful independent critic;
- coverage-critic worker task/result contract with task-snapshot validation;
- fresh critic workers;
- profile-aware critic behavior:
  - `quick`: one critic; requested rework becomes explicit deferred coverage;
  - `standard/deep`: post-wave critic, at most one fresh-hunter reassignment wave, then a different final-clean critic;
  - remaining final-clean rework becomes deferred/incomplete;
- record-verifier task/result contract;
- final verifier may return `verified` or `needs_revision`;
- `needs_revision` never silently rewrites a candidate;
- reporting phase and final `complete` vs `incomplete` terminalization;
- partial coverage may still validate/final-verify useful findings before ending incomplete.

### Acceptance

- critic-requested covered work reopens only through a successful independent critic;
- reassigned coverage uses a fresh hunter;
- final-clean critic uses a fresh critic worker;
- quick profile does not launch a reassignment hunter wave;
- malformed critic requests become typed malformed results;
- retained confirmed/needs-validation records require fresh final verification;
- revision request leaves run incomplete rather than mutating canonical record;
- rejected candidates skip final verification;
- partial coverage still preserves useful fully verified findings and ends incomplete;
- blocked/deferred coverage cannot produce `run_completed`;
- all existing upstream/eval/domain/storage/orchestrator tests remain green;
- GitHub CI is green.

### Non-goals

- No real provider SDK.
- No context compiler.
- No unbounded gapfill/new coverage discovery yet.
- No material record replacement/revalidation flow yet.
- No MCP server.
- No sandbox.
- No prompt/attack-class changes.

### Exit

Gate 3 exits when this finalization PR is CI-green and merged. Issue #12 then closes.

Next gate: Gate 4 — scoped/PR audit path and context compiler.
<!-- CURRENT_GATE_END -->

## Queued roadmap

### Gate 4 — Scoped/PR audit path and context compiler
Make diff/subsystem review the default cost-effective path. Build deterministic source/coverage/methodology context bundles for worker tasks without stuffing unrelated project memory/history into model context.

### Gate 5 — Sandboxed local validation and immutable evidence
Add hostile-target execution isolation and proof provenance.

### Gate 6 — MCP/plugin interface
Expose user-intent audit tools while keeping privileged internals private.

### Gate 7 — Evidence requests, advisory data, and contextual judgment
Resolve external facts without weakening target sandbox isolation.

### Gate 8 — ChatGPT UI and reporting
Add coverage/finding/evidence UI and exports.

### Gate 9 — Scale only when measured
Add unbounded gapfill/new-unit discovery, fleet scheduling, cross-repository tracing, provider strategies, and fixing only after measured need.
