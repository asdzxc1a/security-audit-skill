# AGENTS.md — Security Audit Platform

## Mission

Build the smallest reliable hosted security-research platform from Cloudflare's security-audit skill, one evidence-backed gate at a time.

- Upstream methodology: cloudflare/security-audit-skill remains the reference portable skill.
- Product: a persistent security-audit service exposed through MCP/plugin interfaces.
- GitHub is durable project memory; chat is context, not project state.
- We own product contracts, orchestration, persistence, evidence, and integrations; models, source providers, and execution providers remain replaceable adapters.
- Preserve upstream behavior until measurements justify a change.

Full memory protocol: docs/project/PROJECT_MEMORY_SYSTEM.md. Read it only when maintaining or porting project memory.

## Authority

When guidance conflicts:

1. user's explicit current instruction;
2. passing tests and current code;
3. docs/project/STATE.md;
4. accepted docs/project/DECISIONS.md;
5. current gate in docs/project/PLAN.md;
6. active GitHub issue;
7. docs/project/history/ and old conversations.

Resolve conflicts using the strongest source. Do not blend incompatible instructions. Update stale durable memory when the stronger source changes project truth.

## Boot with minimum context

After this file, read:

1. docs/project/STATE.md;
2. current gate only in docs/project/PLAN.md;
3. docs/project/TEST_STRATEGY.md;
4. active gate/subtask issue, if any;
5. relevant code and tests.

Only as needed: relevant decisions, lessons, charter, then history.

Do not preload all project docs, historical evidence, or old conversations.

## Work

- Infer the intended outcome and carry actionable requests to completion.
- Small/reversible task: act directly. Multi-step/risky task: give a short plan, then continue.
- Ask only when a missing choice is genuinely blocking, unsafe to assume, or irreversible.
- Work on one gate or bounded subtask at a time.
- Keep diffs focused; avoid unrelated cleanup.
- Repository reads/searches, focused branches/PRs, and non-production validation are authorized.
- Do not perform production, credential, billing, destructive, or externally irreversible actions without explicit authorization.
- Do not store scratch reasoning as project memory.

## Architecture guardrails

- The current portable skill remains Markdown + zero-dependency CommonJS unless a measured blocker requires changing that contract.
- New hosted application components are TypeScript-first unless an accepted decision says otherwise.
- Provider-specific model, Git host, sandbox, and MCP types stay in adapters; application code uses owned contracts.
- Do not fork or rewrite upstream methodology without a measured blocker and accepted decision.
- Do not jump ahead of the evidence-backed roadmap.
- Authorization, capabilities, budgets, state transitions, and evidence acceptance live outside model prompts.
- Chat history and model context are never authoritative storage.
- Source snapshots used for an audit are immutable and identifiable.
- Target-controlled execution is hostile by default and must not inherit ambient credentials or unrestricted network/filesystem access.
- Finding validity, evidence strength, production applicability, and priority are distinct concepts.
- Prefer the smallest architecture that passes the current gate acceptance.

## Verify

- Run the smallest meaningful checks that prove the change, plus gate-required acceptance tests.
- Run npm run check:memory when project-memory files or invariants change.
- Run npm run check when full-repository validation is warranted.
- Fix deterministic failures caused by the change; do not hide them with retries.
- Do not repeat expensive green checks without a new reason.
- Do not claim completion while required evidence is red.

Tests/current code outrank prose.

## Write memory once

- current truth / blocker / next action → docs/project/STATE.md
- future gate scope / acceptance → docs/project/PLAN.md
- current implementation work → active GitHub issue
- durable rationale → docs/project/DECISIONS.md
- reusable learning → docs/project/LESSONS.md
- detailed completed evidence → docs/project/history/
- transient reasoning → discard

Chat is context, not project state.

## Done

A meaningful task is done when the requested change is complete, relevant evidence is green, durable memory reflects changed truth, and the PR/handoff records the next concrete action.

Update decisions and lessons only when genuinely durable. Archive verbose evidence instead of bloating STATE.md.

If unsure what to do next, read docs/project/STATE.md.
