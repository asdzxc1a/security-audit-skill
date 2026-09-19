# Project Plan

The CURRENT_GATE block is the only implementation gate authorized by this roadmap without explicit reprioritization.

## Completed gates

- Gate 0 — Durable GitHub memory and upstream baseline.
- Gate 1 — Pinned eval harness + host-readiness measurement. Closed `incomplete_external_environment`; no model-quality precision/recall claim is made.
- Gate 2 — Provider-neutral contracts + deterministic fail-closed reducer.
- Gate 2b — Durable accepted-event store + replay projections.
- Gate 3a — Straight-through Recon → Hunt → candidate Validate orchestration. Merged as 5765eedfecffcce84b77794876186bc097106e15.

<!-- CURRENT_GATE_START -->
## Gate 3b — Orchestration trust hardening

Status: Implementation/local evidence green; ready for review  
Issue: #12

### Goal

Close the post-merge trust defects from Gate 3a before adding more orchestration complexity.

### Scope

- bump owned domain/orchestration contracts to version 2;
- persist bounded coverage evidence for covered/candidate/blocked resolutions;
- persist bounded substantive candidate claims;
- pass canonical candidate claim + all linked coverage IDs into candidate verification;
- consolidate repeated fingerprints into one canonical candidate with explicit coverage links;
- bound complete untrusted observations, strings, arrays, paths, checks, claims, and adapter metadata;
- bound provider/malformed error detail;
- reject oversized durable event envelopes before publication;
- deep-copy evidence-bearing projections;
- explicit runtime rejection of unknown event types.

### Acceptance

- candidate verifier receives the substantive persisted claim;
- evidence-free `covered` cannot become canonical coverage;
- oversized observation cannot poison the durable event stream;
- duplicate fingerprint across multiple coverage units creates one candidate linked to all units;
- reducer independently enforces coverage evidence requirements;
- event store independently rejects oversized envelopes before write;
- all existing upstream/eval/domain/storage/orchestrator tests remain green;
- GitHub CI is green.

### Non-goals

- No coverage-critic/reassignment orchestration in this slice.
- No final record-verification/reporting orchestration in this slice.
- No provider SDK.
- No context compiler.
- No MCP server.
- No sandbox.
- No prompt/attack-class changes.

### Exit

Gate 3b exits when the focused hardening PR is CI-green and merged.

Next bounded Gate 3 slice: coverage-critic/reassignment waves and final record-verification/reporting orchestration, using the evidence-bearing v2 contracts.
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
