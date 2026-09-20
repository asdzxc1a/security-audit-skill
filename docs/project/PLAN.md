# Project Plan

The CURRENT_GATE block is the only implementation gate authorized by this roadmap without explicit reprioritization.

## Completed gates

- Gate 0 — Durable GitHub memory and upstream baseline.
- Gate 1 — Pinned eval harness + host-readiness measurement.
- Gate 2 — Provider-neutral contracts + deterministic fail-closed reducer.
- Gate 2b — Durable accepted-event store + replay projections.
- Gate 3 — Hosted provider-neutral audit lifecycle, evidence-bearing verification, critics/finalization, resumable checkpoints, and historical schema compatibility. Final hardening merged as cde946a63e89b1e6ead91c9eb52cda54542282be.

<!-- CURRENT_GATE_START -->
## Gate 4a — Deterministic context compiler foundation

Status: Full fresh-clone evidence green; ready for review  
Issue: #20

### Goal

Compile bounded provider-neutral worker context deterministically from immutable source/scope, owned task metadata, and explicitly selected Cloudflare methodology blocks.

### Scope

- content-addressed immutable text source snapshots;
- runtime snapshot integrity verification;
- explicit `paths`, `diff`, and `repository` scopes;
- repository scope requires explicit selection;
- diff scope retains base/head refs and changed-path identity;
- deterministic scope intersection and unavailable changed-path reporting;
- project memory/history excluded by default with explicit opt-in;
- methodology catalog loader over existing Cloudflare skill markdown;
- preserve both Markdown-heading refs and Cloudflare bold attack-class refs;
- explicit methodology block selection only;
- deterministic locale-independent file/block ordering;
- canonical task metadata;
- content-addressed worker context bundle;
- hard file/count/byte/block/task/bundle limits;
- bounded canonical JSON depth/node traversal.

### Acceptance

- same snapshot + scope + task metadata + methodology selection produces byte-identical bundle/hash;
- file/methodology ordering is independent of input/retrieval/locale order;
- unsafe/traversal/oversized repository paths are rejected;
- forged snapshot metadata/hash/ID is rejected;
- diff scope selects only changed files intersecting allowed roots;
- diff base/head refs participate in bundle identity;
- explicit subsystem/path scope cannot expand outside its roots;
- whole-repository scope requires explicit mode;
- project memory/history is not included by default;
- Cloudflare refs such as `ATTACK-CLASSES.md#Access control` resolve correctly;
- unknown/duplicate/forged methodology blocks are rejected;
- file/count/source/methodology/task/final-bundle overflow fails closed;
- deeply nested task metadata fails before unbounded traversal;
- all existing upstream/eval/domain/storage/orchestrator tests remain green;
- GitHub CI/review are green.

### Non-goals

- No real GitHub/GitLab source adapter in this slice.
- No provider/model SDK.
- No prompt optimization/tuning.
- No MCP server.
- No sandbox execution.
- No UI.
- No Cloudflare methodology behavior change.

### Exit

Gate 4a exits when its focused PR is CI/review-green and merged.

Next bounded slice: Gate 4b — wire compiled context bundles into durable worker task receipts and add the first real PR/diff source-provider adapter.
<!-- CURRENT_GATE_END -->

## Queued roadmap

### Gate 4b — Durable context-bound tasks + PR/diff source adapter
Bind each worker task receipt to a deterministic context bundle ID/content and add an immutable Git-based PR/diff snapshot adapter without changing reducer/event-store authority.

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
