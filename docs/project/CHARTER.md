# Project Charter

## Mission

Turn Cloudflare's portable security-audit skill into a reliable hosted security-research platform while preserving the methodology that made the skill valuable.

The platform should let ChatGPT and other compatible clients request focused security research without making the conversation responsible for durable state, authorization, evidence, or workflow correctness.

## Product shape

The long-term product has three separable layers:

1. Portable methodology: security reasoning, attack disciplines, evidence bars, and reporting semantics.
2. Hosted engine: orchestration, persistent state, source snapshots, worker scheduling, evidence, sandboxing, budgets, and integrations.
3. Interfaces: MCP/plugin tools, ChatGPT UI, CLI/API, and exports.

Interfaces and providers are replaceable. Owned contracts and durable audit state are not provider-specific.

## Principles

- Security findings require real boundary reasoning, not checklist deviation.
- Unsupported uncertainty is represented explicitly rather than hidden in confidence prose.
- Models reason; deterministic code owns authority and state.
- Workers are disposable/stateless; the repository/service owns memory.
- Independent verification is an enforced relationship, not a prompt suggestion.
- Target code and target-produced evidence are hostile until admitted by trusted controls.
- Partial coverage is stated as partial coverage.
- Cost is a research constraint and must not silently reduce the evidence bar.
- Source-level claim validity and production applicability are separate questions.
- The smallest useful scoped audit is preferable to an unnecessarily expensive full-repository sweep.

## Near-term product

The first hosted product should make focused PR/diff or subsystem audits reliable before optimizing for fleet-wide full-repository scanning.

## Non-goals until evidence requires them

- replacing Cloudflare's methodology because a cleaner abstraction looks attractive;
- autonomous production penetration testing;
- generic unrestricted shell access through MCP;
- automatic production changes;
- auto-merging security fixes;
- a large microservice fleet before a minimal persistent harness works;
- cross-repository tracing or dedicated dedup before scale makes them necessary.
