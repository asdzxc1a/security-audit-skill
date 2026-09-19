# Evaluation Harness

This harness measures the pinned, unmodified Cloudflare methodology before this fork changes audit behavior.

Pinned baseline: `c1c8a8c1471069fb0e188eeaff69b8e8db6564a8`.

## Corpus

- `tenant-documents`: real cross-tenant read plus a safe sibling decoy.
- `clean-documents`: clean look-alike paths for false-positive resistance.
- `trusted-proxy-identity`: source-grounded identity trust whose decisive ingress facts are external, so the expected verdict is `needs_validation`.

Each `case.json` is a pre-registered answer key. Controlled fixture recall is not a universal real-world recall claim.

## Captured runs

A run directory contains:

- `run-record.json`
- `findings.json`
- `coverage-ledger.json`

Unavailable usage telemetry stays `null`; never invent token/cost values.

Worker outcomes are explicit: valid result, malformed result, model refusal, provider error, timeout, permission denial, sandbox failure, and cancellation.

## Commands

`node evals/harness.cjs check`

`node evals/harness.cjs score evals/cases/tenant-documents evals/reference-runs/tenant-documents-demo`

The scorer keeps detection recall, correct-verdict recall, confirmed precision, decoy hits, verdict calibration, and coverage resolution separate.

External provider/model runs may incur billing and require explicit authorization; this harness does not invoke them automatically.
