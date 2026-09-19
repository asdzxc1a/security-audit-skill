# Project Lessons

These are reusable lessons supported by upstream history or measured external feedback. Detailed evidence lives in history.

## L-001 — The project's evolution is contract hardening, not a philosophy rewrite

The initial Cloudflare skill already had reconnaissance, narrow hunters, attack-oriented reasoning, adversarial validation, structured output, and fresh verification. Later work mainly converted informal promises into explicit states, provenance, safety rules, coverage accounting, and validators.

Implication: treat unusual current constraints as possible scars from real failures before simplifying them.

## L-002 — Keep workers narrow and state external

Cloudflare's larger harness evolved by making model workers narrower/stateless and moving persistence/orchestration outside model context.

Implication: do not make ChatGPT conversation or one giant worker the durable execution engine.

## L-003 — Scoped/PR review is a first-class product path

Cloudflare's own fleet economics and practitioner reports both point to full repository sweeps being expensive. Narrow assignments also preserve context quality.

Implication: measure and optimize diff/subsystem audits before treating deep full-repository scans as the default.

## L-004 — Worker failure is data

Malformed structured output, model refusal, provider error, timeout, permission denial, and sandbox failure have different recovery semantics.

Implication: model them as typed outcomes. None may silently become "covered" or "no finding."

## L-005 — An artifact path is not evidence provenance

A lexically safe path can still refer to missing or substituted evidence.

Implication: hosted evidence should eventually use immutable IDs/hashes tied to producer assignment and sandbox execution, not path strings alone.

## L-006 — Unknown external facts need resumable evidence requests

Deployment configuration and current dependency advisories may be decisive but unavailable to a source-only sandbox.

Implication: preserve the unresolved fact and a safe way to resolve it. Do not guess and do not give hostile target execution unrestricted Internet access.

## L-007 — Host ambient configuration is part of the audit trust boundary

The first real Claude baseline attempt used a source-only tool list but the host still auto-loaded user-configured MCP servers. The run was cancelled before accepting evidence.

Implication: a baseline/worker adapter must isolate not only model tools but also host-level MCP, plugins, skills, project/user settings, browser integrations, memory, and other ambient capability sources. Tool restriction alone is not a complete isolation boundary.

## L-008 — Configuration/auth status is not provider readiness

A Claude Code baseline host reported itself logged in during a static auth-status probe, but the first isolated inference attempt later failed with a 401 invalid OAuth token before using any model tokens.

Implication: host adapters need both a static capability/config probe and a minimal authenticated inference probe before launching a longer baseline. "Logged in" is not enough evidence that the provider is operational.


## L-009 — Durable state is not the same as resumable orchestration

An append-only event store can survive process restart while the workflow still cannot safely resume. If the exact task and normalized result around a worker call are not durable, a restart may duplicate completed work or lose task-specific context.

Implication: checkpoint both sides of external/agent work. Persist the exact owned task before execution and the normalized owned result atomically with successful completion; treat in-progress work at restart as ambiguous rather than successful.


## L-010 — Cloudflare methodology references are semantic blocks, not just headings

The portable skill refers to attack classes such as `ATTACK-CLASSES.md#Access control`, but many concrete classes are represented as top-level bold labels inside broader Markdown headings rather than as headings themselves. Companion files use the same pattern.

Implication: tooling that compiles methodology context must preserve the skill's semantic block references instead of assuming Markdown headings are the complete reference model.
