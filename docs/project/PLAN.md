# Project Plan

The CURRENT_GATE block is the only implementation gate authorized by this roadmap without explicit reprioritization.

## Completed gates

- Gate 0 — Durable GitHub memory and upstream baseline.
- Gate 1 — Pinned eval harness + host-readiness measurement. Closed `incomplete_external_environment`; no model-quality precision/recall claim is made.
- Gate 2 — Provider-neutral contracts + deterministic fail-closed reducer.
- Gate 2b — Durable accepted-event store + replay projections.
- Gate 3a — Straight-through Recon → Hunt → candidate Validate orchestration. Merged as 5765eedfecffcce84b77794876186bc097106e15.
- Gate 3b — Evidence-bearing/bounded orchestration hardening. Merged as 8f3dee2cd3a71fe7db52081a3194a5c3885f2d63.

<!-- CURRENT_GATE_START -->
## Gate 3c — Coverage critics, final verification, reporting, and terminalization

Status: Implementation/local evidence green; ready for review  
Issue: #12

### Goal

Complete the bounded audit lifecycle while preserving the observation → owned event → reducer/event-store authority chain.

### Scope

- successful independent coverage critics;
- explicit critic `stop` decision;
- critic task snapshots include canonical reviewed paths/checks/candidate IDs/unresolved state;
- critic may add bounded missing coverage IDs or request reassignment of covered units;
- owned `coverage_unit_added_by_critic` and `coverage_reopened` transitions;
- fresh critic workers and fresh reassigned hunters;
- profile-aware behavior:
  - `quick`: one critic; requested work becomes deferred/incomplete;
  - `standard/deep`: one post-wave critic, one bounded additional hunter wave, then a fresh final-clean critic;
  - remaining final-clean work becomes deferred/incomplete;
- fingerprint consolidation only when substantive claims match;
- retained confirmed/needs-validation records receive fresh record verification;
- record verifier receives canonical claim, linked coverage IDs, and open handoff requirements;
- final verifier returns only `verified` or `needs_revision`;
- reporting phase + deterministic complete/incomplete terminalization;
- partial coverage may preserve fully verified findings but cannot become complete.

### Acceptance

- critic-added missing coverage requires successful critic provenance;
- critic-reopened coverage requires successful independent critic provenance and clears current-attempt evidence before fresh hunting;
- reassigned hunters are fresh;
- critic clean-stop is explicit and contradictory stop/work output is malformed;
- quick profile does not launch extra hunter work;
- standard/deep can hunt both new and reopened critic work once;
- final-clean critic is fresh and any remaining work becomes deferred/incomplete;
- critic tasks contain canonical coverage evidence;
- same fingerprint/different claim cannot silently merge;
- retained records require fresh record verification;
- needs-validation final verifier sees open handoff requirements;
- `needs_revision` leaves canonical record unchanged and run incomplete;
- rejected candidates skip final verification;
- partial audits preserve useful final-verified records but end incomplete;
- blocked/deferred coverage cannot produce `run_completed`;
- all existing upstream/eval/domain/storage/orchestrator tests remain green;
- GitHub CI and review are green.

### Non-goals

- No real provider SDK.
- No context compiler.
- No unbounded critic loop.
- No material final-record replacement/revalidation flow.
- No crash/restart resume engine in this slice.
- No MCP server.
- No sandbox.
- No prompt/attack-class changes.

### Exit

Gate 3c exits when its focused PR is CI/review-green and merged.

Next bounded slice: Gate 3d — durable normalized worker-result receipts/checkpoints and resumable orchestration after process restart. Gate 3 remains open until that slice is accepted.
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
Add fleet scheduling, cross-repository tracing, provider strategies, and fixing only after measured need.
