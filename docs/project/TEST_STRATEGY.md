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

### Full repository
`npm run check`

## Future layers

Add only in their gate: owned contract tests, state-machine property tests, worker failure fixtures, integration tests, sandbox adversarial tests, and MCP contract tests.

## Evidence discipline

- Record exact relevant commands/results in the PR.
- Archive verbose accepted benchmark evidence under history.
- Do not bloat STATE with repeated green logs.
- Do not use retries to hide deterministic failures.
