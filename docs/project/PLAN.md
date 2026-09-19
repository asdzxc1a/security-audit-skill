# Project Plan

The CURRENT_GATE block is the only implementation gate authorized by this roadmap without explicit reprioritization.

## Completed gates

- Gate 0 — Durable GitHub memory and upstream baseline. Merged in 707d2e7305212bc76045217b4bdf6f36acf44fb3.
- Gate 1 deterministic evaluation foundation. Merged in 5b3421034420bd205c142acd3d92ae19bd9fbd42.

<!-- CURRENT_GATE_START -->
## Gate 1 — Pinned baseline and evaluation harness

Status: Source-only Claude adapter ready for review; real baseline pending
Issue: #3
Upstream baseline: c1c8a8c1471069fb0e188eeaff69b8e8db6564a8

### Goal

Measure the unmodified upstream workflow before refactoring its methodology.

### Scope

Current bounded subtask:

- make incomplete/refused/failed runs durable without fake artifacts;
- add a Claude Code host adapter with dry-run by default;
- require explicit `--execute` plus positive budget cap for model execution;
- construct a clean model workspace that excludes answer keys;
- restrict the Gate 1 adapter to source inspection and agent delegation, with no Bash/target execution;
- capture host stdout/stderr, usage telemetry when available, structured artifacts when valid, and deterministic score for complete runs;
- test all command-building/failure-record semantics without calling the model.

After this adapter is accepted, run the unchanged skill on the pre-registered corpus using an explicitly budget-authorized baseline matrix.

### Acceptance

- incomplete/refused/failed run records validate without fake findings/coverage paths;
- dry-run exposes the exact host/model/profile/source-only invocation;
- execution cannot start without an explicit positive budget cap;
- model workspace contains target + skill but not the answer key;
- arbitrary Bash/target execution is not exposed by this adapter;
- npm run check:evals and npm run check pass;
- CI is green;
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
