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
