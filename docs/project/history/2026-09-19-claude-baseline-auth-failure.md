# Claude baseline 2 — isolated host, authentication failure

Date: 2026-09-19

## Purpose

Retry the first real `tenant-documents` baseline after fixing ambient Claude host configuration leakage.

The retry intentionally held constant:

- target case: `tenant-documents`
- model alias: `sonnet`
- profile: `quick`
- source-only tool policy
- USD 1 maximum budget
- no target-controlled execution
- no answer-key access

Only the host-isolation controls changed.

## Isolation result

The retry did **not** spawn the user-configured MCP child processes seen in the cancelled first attempt.

The Claude process ran with:

- project-only settings sources;
- strict empty MCP configuration;
- slash commands disabled;
- Chrome integration disabled;
- Read / Glob / Grep / Write / Agent tools only;
- no Bash.

This confirms the host-isolation fix changed the intended variable.

## Terminal result

The run finished as a provider error before any model tokens were used.

Observed provider response:

`401 authentication_error: OAuth access token is invalid.`

Recorded usage:

- input tokens: 0
- output tokens: 0
- total tokens: 0
- reported cost: USD 0

No `findings.json` or `coverage-ledger.json` was produced, and no score is claimed.

## Interpretation

This is a host/provider availability result, **not** a security-audit result.

The earlier non-model `claude auth status` command reported the CLI as logged in, but that status did not prove the token was usable for an actual inference request.

## Consequence

Provider adapters need two distinct probes:

1. static/config capability probe;
2. a minimal authenticated inference probe before launching a longer baseline.

Do not treat "configured/logged in" as proof that the model provider is operational.

The next Gate 1 path should either:

- repair Claude authentication through an explicit user credential flow; or
- use another already-authenticated host adapter while preserving the same source-only baseline controls.

Raw host stdout is intentionally not committed because it contains transient session identifiers. The sanitized run record and invocation metadata are retained.
