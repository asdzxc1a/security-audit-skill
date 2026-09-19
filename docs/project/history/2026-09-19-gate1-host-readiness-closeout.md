# Gate 1 closeout — host readiness matrix

Date: 2026-09-19

## Gate objective

Measure the unmodified Cloudflare security-audit workflow before changing its methodology.

Gate 1 produced:

- a pinned synthetic evaluation corpus;
- deterministic scoring;
- failure-preserving run records;
- a source-only Claude host adapter;
- host-isolation regression tests;
- real provider-readiness attempts.

No prompt, companion, finding schema, or coverage schema was changed.

## Claude Code

Observed version: 2.1.92.

### Static capability

The CLI supports:

- non-interactive JSON output;
- custom agents;
- tool restriction;
- explicit max-budget flag;
- settings-source selection;
- strict MCP configuration.

### Host isolation

The first real attempt was cancelled because Claude loaded ambient user MCP configuration despite the source-only model tool list.

The adapter was hardened to use:

- project-only settings;
- strict empty MCP config;
- disabled slash commands;
- disabled Chrome integration;
- no Bash;
- a temporary workspace outside the repository.

A follow-up non-model agent listing exposed only built-in agents.

### Live readiness

The isolated real baseline then failed before inference with:

`401 authentication_error: OAuth access token is invalid.`

Recorded usage:

- input tokens: 0
- output tokens: 0
- total tokens: 0
- reported cost: USD 0

No findings/coverage artifacts were produced or scored.

Conclusion: host isolation is adequate for the source-only Gate 1 adapter, but the configured Claude provider is not operational without a credential/authentication action outside repository authority.

## Codex CLI

Observed version: 0.154.0.

### Static capability

The CLI reports ChatGPT authentication and exposes:

- non-interactive `exec`;
- read-only/workspace-write sandbox modes;
- ephemeral sessions;
- `--ignore-user-config`;
- `--ignore-rules`;
- JSONL events;
- output schema support;
- stable multi-agent feature.

### Live readiness

A minimal inference probe succeeded and returned `READY`.

One observed probe reported:

- input tokens: 15462
- cached input tokens: 10624
- output tokens: 5

This proved provider inference readiness.

### Host isolation blocker

Despite `--ignore-user-config`, `--ignore-rules`, disabled apps/plugins/memories, and an attempted `skip_host_skill_discovery` feature, Codex still discovered a user skill under the normal `CODEX_HOME`.

The prompt contamination was visible before the inference result.

A clean temporary `CODEX_HOME` removed the ambient host state but also reported `Not logged in`.

Conclusion: Codex is inference-ready, but a clean host baseline would require credential isolation/transfer or another authentication arrangement. That is a credential action and was not performed silently.

## Why Gate 1 closes incomplete

The repository has now measured two distinct external host blockers:

1. Claude: clean host, unusable live token.
2. Codex: usable provider, contaminated host discovery; clean home loses auth.

Forcing either provider to become a clean baseline host now requires credential-level or user-account actions, not more repository code.

Continuing to tune the benchmark harness would not answer the product question that Gate 1 was created for. It would turn the roadmap into provider-account repair.

## Evidence-backed consequence

Gate 1 is closed as **incomplete due external host conditions**.

This does **not** mean:

- the Cloudflare methodology passed the corpus;
- the methodology failed the corpus;
- model precision/recall was measured.

It means the product now has concrete requirements for its owned host/provider layer:

- static capability probe;
- authenticated inference readiness probe;
- ambient MCP/plugin/skill/memory isolation;
- credential handling separated from project memory;
- typed provider/readiness failures;
- failure-preserving run records.

Those are direct inputs to Gate 2 contracts.

## Next gate

Gate 2 builds provider-neutral owned contracts and deterministic audit state transitions before persistence or provider SDK integration.
