# Project Plan

The CURRENT_GATE block is the only implementation gate authorized by this roadmap without explicit reprioritization.

## Completed gates

- Gate 0 — Durable GitHub memory and upstream baseline.
- Gate 1 — Pinned eval harness + host-readiness measurement. Closed `incomplete_external_environment`; no model-quality precision/recall claim is made.
- Gate 2 — Provider-neutral contracts + deterministic fail-closed reducer.
- Gate 2b — Durable accepted-event store + replay projections.
- Gate 3a — Straight-through Recon → Hunt → candidate Validate orchestration.
- Gate 3b — Evidence-bearing/bounded orchestration hardening.
- Gate 3c — Bounded coverage critics, final verification, reporting, and terminalization. Merged as 016139cefd603efa48551fa051f41df028411734.

<!-- CURRENT_GATE_START -->
## Gate 3d — Resumable orchestration checkpoints

Status: Implementation/local evidence green; ready for review  
Issue: #12

### Goal

Make the full hosted audit lifecycle restart-safe without re-calling workers whose normalized results are already durable or inferring lost task context from mutable current state.

### Scope

- owned domain schema version 3;
- orchestration receipt version 3;
- bounded versioned `taskReceipt` persisted atomically with assignment creation;
- bounded versioned `resultReceipt` persisted atomically with successful assignment completion;
- failures/cancellations/internal interruptions must carry no result receipt;
- durable nonterminal `incompleteReasons`;
- reducer prevents `run_completed` when incomplete reasons exist;
- `runToTerminal` delegates to the same phase-driven engine as `resumeToTerminal`;
- restart behavior for planned, in-progress, succeeded, failed, and cancelled assignments;
- completed receipts are re-validated through the task-specific parser before semantic use;
- planned tasks execute exactly from their durable task receipt;
- ambiguous in-progress work becomes `orchestrator_interrupted` and retries with a fresh worker;
- persisted critic task receipts preserve `post_wave` vs `final_clean`;
- bounded terminal incomplete summaries.

### Acceptance

- planned assignment resumes from original durable task receipt;
- completed hunter receipt resolves coverage without rerunning hunter;
- completed coverage-critic receipt applies missing/reopened work without rerunning that critic;
- completed candidate-verifier receipt dispositions candidate without rerunning verifier;
- completed final-verifier receipt finalizes record without rerunning verifier;
- in-progress assignment is explicitly interrupted and fresh retry is independent;
- interrupted critic retry preserves original round;
- permanent worker/critic failure remains a durable incomplete reason across restart;
- malformed/oversized task and result receipts are rejected;
- receipt task identity must match run/source/profile and assignment ownership;
- event-store restart/projection preserves checkpoint receipts;
- incomplete reasons independently block `run_completed`;
- fresh and resumed full runs share one orchestration implementation;
- all existing upstream/eval/domain/storage/orchestrator tests remain green;
- GitHub CI and review are green.

### Non-goals

- No distributed multi-orchestrator locking/leader election yet.
- No real provider SDK.
- No context compiler.
- No sandbox.
- No MCP server.
- No Cloudflare prompt/attack-class changes.

### Exit

Gate 3d exits when its focused PR is CI/review-green and merged. Issue #12 then closes.

Next gate: Gate 4 — scoped/PR audit path and deterministic context compiler.
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
