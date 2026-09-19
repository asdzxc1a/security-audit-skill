# Project Plan

The CURRENT_GATE block is the only implementation gate authorized by this roadmap without explicit reprioritization.

## Completed gates

- Gate 0 — Durable GitHub memory and upstream baseline. Merged in 707d2e7305212bc76045217b4bdf6f36acf44fb3.
- Gate 1 deterministic evaluation foundation. Merged in 5b3421034420bd205c142acd3d92ae19bd9fbd42.

<!-- CURRENT_GATE_START -->
## Gate 1 — Pinned baseline and evaluation harness

Status: In progress — Claude baseline blocked by provider auth; second host path required
Issue: #3
Upstream baseline: c1c8a8c1471069fb0e188eeaff69b8e8db6564a8

### Goal

Measure the unmodified upstream workflow before refactoring its methodology.

### Scope

Current bounded subtask:

- preserve the isolated Claude provider-auth failure as baseline operational evidence;
- do not repair credentials silently;
- add a second host adapter/probe only if it can preserve ambient-config isolation and the source-only boundary;
- require a minimal authenticated inference probe before any long baseline run;
- keep the upstream Cloudflare methodology unchanged.

Gate 1 still requires at least one completed real provider/model baseline before exit.

### Acceptance

- the Claude 401 run is stored as failed operational evidence with null artifacts and zero-token usage;
- raw transient session identifiers are not committed;
- a second host path must include static capability checks plus authenticated inference readiness;
- npm run check remains green;
- upstream audit methodology remains unchanged.

Full Gate 1 exit still requires at least one explicitly authorized real provider/model baseline to be captured and archived.

### Non-goals

- No prompt/attack-class refactor.
- No hosted server/database/orchestrator.
- No production-grade target sandbox.
- No MCP server.
- No automated fixes.
- No universal recall claims from seeded fixtures.

### Exit

Gate 1 exits only after the adapter is green and at least one explicit budget-authorized unchanged-skill baseline is archived.
<!-- CURRENT_GATE_END -->

## Queued roadmap

### Gate 2 — Owned contracts and durable persistence
Define versioned owned contracts and the minimum persistent state/event model.

### Gate 3 — Minimal hosted Recon → Hunt → Validate harness
Implement stateless workers behind a deterministic orchestrator.

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
