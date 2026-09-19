# Evaluation Harness

This harness measures the pinned, unmodified Cloudflare methodology before this fork changes audit behavior.

Pinned baseline: `c1c8a8c1471069fb0e188eeaff69b8e8db6564a8`.

## Corpus

- `tenant-documents`: real cross-tenant read plus a safe sibling decoy.
- `clean-documents`: clean look-alike paths for false-positive resistance.
- `trusted-proxy-identity`: source-grounded identity trust whose decisive ingress facts are external, so the expected verdict is `needs_validation`.

Each `case.json` is a pre-registered answer key. Controlled fixture recall is not a universal real-world recall claim.

## Run records

A complete run contains `run-record.json`, `findings.json`, and `coverage-ledger.json`.

An incomplete/failed run still has a valid `run-record.json`, but its structured artifact paths may be `null`. This is deliberate: refusal, timeout, provider failure, or malformed output must be recordable without manufacturing clean findings.

Usage telemetry remains `null` when unavailable.

Worker/host outcomes are explicit: valid result, malformed result, model refusal, provider error, timeout, permission denial, sandbox failure, and cancellation.

## Deterministic scoring

`node evals/harness.cjs check`

`node evals/harness.cjs score evals/cases/tenant-documents evals/reference-runs/tenant-documents-demo`

The scorer keeps detection recall, correct-verdict recall, confirmed precision, decoy hits, verdict calibration, and coverage resolution separate.

Only complete runs with validated structured artifacts are scored. Incomplete runs remain durable operational evidence.

## Claude Code baseline adapter

Dry-run (default, no model call):

`node evals/run-baseline.cjs --case tenant-documents --model sonnet --dry-run`

Real execution requires an explicit positive budget cap:

`node evals/run-baseline.cjs --case tenant-documents --model sonnet --execute --max-budget-usd 1.00`

The adapter creates an isolated workspace containing only:

- the selected synthetic target;
- an exact copy of `skills/security-audit`;
- an empty output directory.

The answer key is not copied into the model workspace.

The adapter is intentionally **source-only** in Gate 1. Claude receives Read/Glob/Grep/Write/Agent tools but not Bash, because this host does not provide the OS-enforced target-execution sandbox required by the Cloudflare skill. If local execution is decisive, the unchanged skill should preserve the blocker rather than execute unsafely.

External model execution can consume subscription/API quota. The runner never executes unless `--execute` and `--max-budget-usd` are both provided.
