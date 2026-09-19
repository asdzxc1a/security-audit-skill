# Test Strategy

## Principle

Tests and current code outrank prose. Use the smallest meaningful evidence for the current change, and do not claim completion while required evidence is red.

## Gate 0 checks

### Memory invariants

Run:

npm run check:memory

This verifies the durable-memory structure and obvious safety invariants.

### Upstream regression

Run:

npm run check:validators

This executes the existing Cloudflare findings and coverage-ledger validator suites without changing their contracts.

### Full repository check

Run:

npm run check

Use this when a change touches project memory, shared validation infrastructure, or anything broad enough that both memory and upstream regressions matter.

## Future test layers

Add these only when their gate exists.

### Contract tests

Validate every owned public/internal schema, version transition, and rejected malformed shape.

### State-machine tests

Generate valid and invalid event sequences. Prove invariants such as:

- no covered unit without evidence;
- no finalized confirmed finding without required independent verification;
- a worker cannot validate its own candidate;
- strict budget cannot be silently exceeded;
- a failed/refused/malformed worker cannot become clean coverage.

### Worker protocol fixtures

Test valid result, malformed result, refusal, provider error, timeout, permission denial, sandbox failure, and cancellation as distinct outcomes.

### Integration tests

Exercise source snapshot → planning → assignment → result ingestion → validation → report on synthetic repositories.

### Sandbox adversarial tests

Test symlinks, FIFOs, special files, path races, oversized artifacts, network denial, environment isolation, resource caps, and immutable source behavior.

### MCP contract tests

Validate tool input/output schemas, authorization/resource scoping, idempotency, read/write annotations, cancellation, and resumable identifiers.

### Evaluation harness

Use seeded vulnerable and clean fixtures to measure:

- precision;
- recall on the controlled answer key;
- duplicate rate;
- severity/impact calibration;
- coverage-unit quality;
- critic recovery;
- needs-validation honesty;
- tokens/cost per resolved unit where measurable.

Do not generalize fixture recall into a universal real-world recall claim.

## Evidence discipline

- Record exact commands and relevant output in the PR.
- Store verbose completed benchmark/research evidence in docs/project/history when it has future value.
- Do not paste repeated green logs into STATE.
- Do not use retries to make deterministic red tests appear green.
