# Project Plan

The CURRENT_GATE block is the only implementation gate authorized by this roadmap without explicit reprioritization.

## Completed gates

- Gate 0 — Durable GitHub memory and upstream baseline. Merged in 707d2e7305212bc76045217b4bdf6f36acf44fb3.

<!-- CURRENT_GATE_START -->
## Gate 1 — Pinned baseline and evaluation harness

Status: In progress — deterministic provider-neutral foundation
Issue: #3
Upstream baseline: c1c8a8c1471069fb0e188eeaff69b8e8db6564a8

### Goal

Measure the unmodified upstream workflow before refactoring its methodology.

### Scope

- Three synthetic pre-registered cases: vulnerable+decoy, clean/decoy, and deployment-fact needs-validation.
- Provider-neutral run records.
- Deterministic scoring for detection, verdict correctness, confirmed precision, decoy hits, coverage, and optional usage telemetry.
- Tests and CI.
- Real provider/model baseline runs only after explicit authorization for any external billing.

### Acceptance

Deterministic foundation:
- at least three cases exist and validate;
- npm run check:evals passes;
- a synthetic scoring run proves TP/FP/decoy/coverage semantics;
- npm run check preserves upstream validator and memory checks;
- CI is green;
- upstream audit methodology remains unchanged.

Full Gate 1 exit:
- an explicitly authorized provider/model matrix is defined;
- unchanged-skill runs are captured and scored;
- baseline evidence is archived under history;
- Gate 2 requirements are derived from evidence.

### Non-goals

- No prompt/attack-class refactor.
- No server/database/orchestrator.
- No sandbox or MCP server.
- No automated fixes.
- No universal recall claims from seeded fixtures.

### Exit

Gate 1 exits only after the deterministic foundation is green and at least one explicitly authorized real provider/model baseline is archived.
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
