# Project Plan

The CURRENT_GATE block is the only implementation gate authorized by this roadmap without explicit reprioritization.

## Completed gates

- Gate 0 — Durable GitHub memory and upstream baseline.
- Gate 1 — Pinned eval harness + host-readiness measurement.
- Gate 2 — Provider-neutral contracts + deterministic fail-closed reducer.
- Gate 2b — Durable accepted-event store + replay projections.
- Gate 3a — Straight-through Recon → Hunt → candidate Validate orchestration.
- Gate 3b — Evidence-bearing/bounded orchestration hardening.
- Gate 3c — Coverage critics, final verification, reporting, and terminalization.
- Gate 3d — Resumable orchestration checkpoints.
- Gate 3e — Schema-v2 replay and incomplete-state hardening.

<!-- CURRENT_GATE_START -->
## Gate 3f — Historical schema semantic validation

Status: Implementation/full local evidence green; ready for review
Issue: #12

### Goal

Close the remaining delayed schema-compatibility findings before declaring Gate 3 complete.

### Scope

- track each stored event's raw domain schema version separately from its upcast replay event;
- require raw schema versions to be monotonic within a stream;
- allow supported v2 prefix → v3 suffix only;
- reject any v3 → v2 downgrade even when checksums are valid;
- validate schema-v2-specific worker outcome kinds before adding v3 receipt placeholders;
- keep all Gate 3e raw-checksum/upcast/readability behavior unchanged.

### Acceptance

- checksum-valid v3→v2 stream fails closed before replay;
- schema-v2 event using v3-only worker outcome fails before upcast;
- valid v2 terminal/active/mixed-v3 compatibility tests remain green;
- current v3 replay remains unchanged;
- all upstream/eval/domain/storage/orchestrator tests remain green;
- GitHub CI and review are green.

### Non-goals

- No new domain write schema.
- No general migration framework beyond current v2→v3 support.
- No provider SDK.
- No context compiler.
- No sandbox.
- No MCP server.
- No Cloudflare prompt/attack-class changes.

### Exit

Gate 3f exits when its PR is CI/review-green and merged. Issue #12 then closes and Gate 3 is complete.

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
