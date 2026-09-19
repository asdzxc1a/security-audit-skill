# Gate 3e Delayed Review Hardening — 2026-09-19

## Trigger

PR #17 merged before its delayed Codex review arrived.

The review identified:

1. P1 — schema-v3 writer made schema-v2 event stores unreadable;
2. P2 — reason 129+ could wedge a run instead of allowing incomplete terminalization;
3. P2 — duplicate D-011 durable decision.

A manual memory review also found a duplicate L-007 lesson identifier.

## Compatibility fix

The file event store now treats domain event versioning separately from the storage envelope version.

For a schema-v2 stored event:

1. parse the original stored JSON;
2. validate its checksum over the original v2 event;
3. preserve the stored checksum/previous-checksum chain;
4. deterministically upcast only the in-memory replay event to schema v3;
5. synthesize clearly marked non-resumable legacy task/result receipt envelopes where v3 reducer shape requires them.

The historical file is not rewritten during read.

Terminal v2 history therefore remains readable.

A nonterminal v2 run containing an assignment cannot safely resume because v2 never persisted exact Gate-3d task/result checkpoints. Resume records a durable incomplete reason and appends current-schema incomplete terminalization events, with zero worker calls. The mixed history remains readable on restart.

## Incomplete-reason overflow

Canonical state keeps at most 128 reasons. The first 127 unique reasons are retained. Once capacity is reached, the final slot becomes `additional incomplete reasons omitted`. Further unique reasons are ignored rather than rejected, so the run can still transition to explicit incomplete.

## Memory repair

- duplicate D-011 was consolidated into one canonical checkpoint/resume decision;
- schema upgrade compatibility is D-012;
- duplicate resumability lesson was renumbered to L-009;
- `scripts/check-memory.cjs` now rejects duplicate Decision/Lesson IDs.

## Evidence

Before memory-only edits, full repository check:

- upstream validators: 65/65 PASS;
- eval/adapter tests: 13/13 PASS;
- domain/storage/orchestrator tests: 71/71 PASS;
- strict TypeScript compile: PASS;
- npm audit: 0 vulnerabilities;
- diff whitespace check: PASS.

New regression tests cover terminal schema-v2 replay with a historical successful assignment and no file rewrite, active schema-v2 fail-closed terminalization with zero worker calls, mixed v2/v3 restart readability, tampered v2 checksum rejection before upcast, unsupported historical schema rejection, and 260 distinct incomplete reasons summarized without wedging.
