# Test Strategy

## Principle

Tests/current code outrank prose. Use the smallest meaningful evidence and do not claim completion while required evidence is red.

## Core checks

### Memory
`npm run check:memory`

### Upstream regression
`npm run check:validators`

### Gate 1 evaluation harness
`npm run check:evals`

The eval layer keeps these metrics distinct: detection recall, correct-verdict recall, confirmed precision, false-positive confirmed records, decoy hits, verdict overclaim/underclaim, mapped/evidence-attempted/resolved coverage, and actually observed usage telemetry.

Fixture metrics are not universal real-world recall claims.

### Gate 2 domain contracts/reducer
`npm run check:domain`

This performs strict TypeScript compilation and reducer tests. The reducer suite must prove at least:

- successful confirmed-finding lifecycle;
- provider failure cannot become clean coverage;
- hunter/verifier and candidate/final-verifier independence;
- durable evidence requirement for `needs_validation`;
- run-blocking evidence prevents completion;
- strict worker budget enforcement;
- unresolved candidates block phase progression;
- terminal state immutability;
- strict sequence/run scoping.

### Gate 2b durable event store

Covered by `npm run check:domain`.

Storage tests must prove:

- reducer-rejected events never persist;
- accepted streams replay to identical canonical state after restart;
- exact append retries are idempotent;
- duplicate event IDs with changed content fail;
- checksum corruption fails closed;
- `HEAD` detects tail truncation;
- missing `HEAD` recovers from a complete checksum-validated stream;
- unpublished temp files do not become history;
- projections are rebuilt from replayed reducer state.

### Gate 3 orchestrator core

Covered by `npm run check:domain`.

Orchestrator tests must prove:

- valid candidate and clean covered flows reach the record-verification handoff;
- thrown/provider failure and explicit refusal become typed outcomes;
- malformed observations become `malformed_result`;
- hunter failures cannot become clean coverage;
- candidate-verifier failure leaves candidates unvalidated;
- `needs_validation` opens durable finding-handoff evidence before disposition;
- blocked/deferred coverage makes the run incomplete and prevents final completion;
- budget exhaustion becomes an explicit incomplete run before worker invocation;
- persisted/restarted state is identical to orchestrator-returned state;
- workers mutate nothing directly; all state effects are owned events through the event store.

### Gate 3b post-merge trust hardening

Covered by `npm run check:domain`.

Regression tests must prove:

- verifier tasks contain the persisted substantive candidate claim and linked coverage IDs;
- evidence-free covered output becomes malformed and the reducer independently rejects evidence-free coverage;
- oversized observations become bounded failures without corrupting restart/replay;
- oversized event envelopes are rejected before durable publication;
- duplicate fingerprints across coverage units consolidate into one canonical candidate;
- canonical coverage persists reviewed paths/checks;
- candidate claims and coverage evidence survive restart/projection;
- runtime unknown event types fail closed.

### Gate 3c critic convergence and finalization

Covered by `npm run check:domain`.

Tests must prove:

- recon semantic definitions are bounded and semantic aliases are rejected;
- the orchestrator owns coverage IDs and hunters receive persisted coverage semantics;
- standard/deep require two consecutive clean fresh critic passes;
- critic reassignment reopens coverage and invokes a fresh hunter;
- candidate coverage may be re-reviewed without duplicating the canonical root cause;
- blocked/deferred coverage cannot be clean-stopped;
- critic failure and budget exhaustion produce incomplete state;
- retained candidate disposition persists a verifier-authored canonical claim and rationale;
- final verifier receives that canonical record and is independent of hunter/candidate verifier;
- final accept/reject reasons persist;
- rejected needs_validation records resolve obsolete handoff requirements;
- reporting/complete remain reducer-gated.

### Full repository
`npm run check`

## Future layers

Add only in their gate: owned contract tests, state-machine property tests, worker failure fixtures, integration tests, sandbox adversarial tests, and MCP contract tests.

## Evidence discipline

- Record exact relevant commands/results in the PR.
- Archive verbose accepted benchmark evidence under history.
- Do not bloat STATE with repeated green logs.
- Do not use retries to hide deterministic failures.
