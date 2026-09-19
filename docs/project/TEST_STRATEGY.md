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

### Gate 3c critic/finalization orchestration

Covered by `npm run check:domain`.

Tests must prove:

- successful independent critics can add missing coverage and reopen covered work;
- critic workers and reassigned hunters are fresh;
- critic tasks contain canonical coverage evidence;
- critic `stop` decisions are explicit and contradictory outputs are malformed;
- quick mode defers new/reopened critic work instead of launching another hunter wave;
- standard/deep perform one bounded additional hunter wave plus a fresh final-clean critic;
- final-clean requested work becomes deferred/incomplete;
- identical fingerprint claims can consolidate while conflicting claims block coverage;
- retained confirmed/needs-validation records require fresh final verification;
- record-verifier tasks contain canonical claims, linked coverage IDs, and open handoff requirements;
- `needs_revision` leaves canonical record unchanged and run incomplete;
- rejected candidates skip final verification;
- partial coverage can preserve final-verified findings but cannot become complete;
- blocked/deferred coverage cannot produce `run_completed`.

### Gate 3d restart/resume orchestration

Covered by `npm run check:domain`.

Tests must prove:

- assignment creation rejects malformed/oversized task receipts;
- assignment completion rejects missing/oversized result receipts and result receipts on failed outcomes;
- task and result receipts survive event-store restart/projection;
- a completed hunter receipt resumes without a second hunter invocation;
- a planned assignment executes its original durable task receipt;
- an in-progress assignment becomes `orchestrator_interrupted` and retries with a fresh worker;
- a completed critic receipt resumes without rerunning that critic;
- interrupted critic retry preserves its original `post_wave`/ `final_clean` round;
- completed candidate-verifier and final-verifier receipts resume without duplicate verification;
- a durable critic failure reconstructs/preserves an incomplete reason after restart;
- persisted incomplete reasons prevent `run_completed` at the reducer boundary;
- full fresh and resumed runs use the same phase-driven engine.

### Full repository
`npm run check`

## Future layers

Add only in their gate: owned contract tests, state-machine property tests, worker failure fixtures, integration tests, sandbox adversarial tests, and MCP contract tests.

## Evidence discipline

- Record exact relevant commands/results in the PR.
- Archive verbose accepted benchmark evidence under history.
- Do not bloat STATE with repeated green logs.
- Do not use retries to hide deterministic failures.
