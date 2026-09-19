# Upstream Research Baseline — 2026-09-19

## Purpose

This is the verbose research evidence supporting the fork's initial architecture and roadmap. Current operational truth belongs in STATE.md; durable conclusions belong in DECISIONS.md and LESSONS.md.

## Memory protocol source

The project-memory structure was adapted from the user-provided "AGENTS.md — Astra" protocol. The transferred principles are:

- explicit authority order;
- minimum-context boot;
- one bounded gate at a time;
- tests/current code outrank prose;
- write each kind of memory once;
- current truth in STATE, future acceptance in PLAN, current work in issues, durable rationale in DECISIONS, reusable learning in LESSONS, verbose evidence in history;
- chat is context, not project state.

Project-specific technology choices from the Astra file were not copied blindly.

## Upstream identity

Repository: https://github.com/cloudflare/security-audit-skill

Fork baseline:
c1c8a8c1471069fb0e188eeaff69b8e8db6564a8
"Clarify guidance and full audit modes"
2026-09-14

Initial commit:
4de1ac80123057dd73c586cd3862a6c85a2b8a5e
"Initial commit"
2026-06-18

The current fork retains the GitHub parent relationship.

## What existed in the initial commit

The first commit already contained:

- reconnaissance before hunting;
- multiple narrow general/research agents;
- architecture/trust-boundary/input-surface mapping;
- attack classes including business logic, access control, injection, feature abuse, chained attacks, wildcard, and obvious exposures;
- an explicit requirement for concrete attacker impact;
- adversarial validation by a separate agent whose job was to disprove a finding;
- structured findings JSON;
- a zero-dependency validator;
- fresh final verification against source;
- repeated runs as a way to improve coverage.

Interpretation: the core philosophy was present on day one. Later evolution primarily hardened the contracts around state, evidence, coverage, execution, and uncertainty.

## Important evolution points

### Repository packaging

Issue/PR #1/#2 moved the skill into skills/security-audit so resource-linked installation works with the Skills CLI.

Lesson: current folder layout includes interoperability constraints; it is not the server architecture.

### Native/binary companion

PR #3 added MEMORY-SAFETY-AND-BINARY.md because a web-shaped generic taxonomy did not transfer to native targets.

Lesson: keep domain-specific validation discipline and allow target-specific classes rather than forcing all work through one universal checklist.

### Trace semantic validation

PR #4 tightened entrypoint → propagation → sink ordering.

Lesson: prose constraints gradually became executable invariants as concrete malformed-output cases were found.

### Domain expansion and consistency

July changes added AI/LLM, HTTP/auth, client-side, and native domains and aligned terminology/severity/validation language.

Lesson: wording consistency in an agent system is behavioral consistency, not cosmetic documentation.

### Major workflow rework

PR #12 / commit 158eb448 reworked the system end to end and was merged as d24bc269.

Major changes:

- confirmed / needs_validation / rejected verdict branches;
- deterministic coverage ledger;
- canonical collision-checked coverage IDs;
- append-only reassignment attempts;
- prior-run carry/revalidation rules;
- coverage critics and explicit incomplete runs;
- strict budget reservation for critics/validation;
- OS-enforced sandbox requirements;
- parent-only artifact promotion with race/path/type checks;
- hardened hostile-input validators;
- 65 adversarial validator tests;
- explicit malformed-result handling and terminal states.

The PR reports two live internal end-to-end audits with validators passing and honest budget-limited partial coverage.

Interpretation: this is a trust-model hardening pass, not simply a feature release.

### Latest main commit

c1c8a8 introduced guidance versus full audit modes and clarified variant searching after important findings.

Lesson: invoking security guidance is not equivalent to authorizing a side-effecting full audit workflow.

## Cloudflare's larger harness

Primary source:
https://blog.cloudflare.com/build-your-own-vulnerability-harness/

Cloudflare states the public skill seeded a larger internal multi-stage fleet-wide system.

Key reported lessons:

- one run of the early skill found only roughly half of what repeated runs later found;
- context exhaustion, persistence, and cross-repository reasoning became major walls;
- they treated model agents increasingly as narrow/stateless compute;
- persistence and orchestration moved outside the model;
- Recon/Hunt/Validate became independently persisted work;
- a Gapfill stage examines coverage gaps iteratively;
- a Wishlist records unavailable environments/facts needed to resume work;
- execution/sandbox capability materially improved validation quality;
- agents can modify source, create tautological tests, or demonstrate nonsense threat models if execution boundaries are weak;
- their later validation system separates source defect validation from production contextual judgment;
- models/providers are replaceable; the durable harness is the long-lived asset;
- Cloudflare recommends starting with Recon/Hunt/Validate in a database before adding fleet-scale features.

These lessons directly support Gates 1–3.

## Related Cloudflare model research

Primary source:
https://blog.cloudflare.com/cyber-frontier-models/

Relevant observations:

- narrow scopes outperform one broad "audit everything" prompt;
- adversarial review materially reduces noise;
- separating code defect reasoning from attacker-reachability reasoning improves quality;
- semantically similar security tasks can be accepted/refused inconsistently by model hosts.

Implication: host/model refusal must be an explicit worker outcome, not interpreted as an empty result.

## External GitHub pressure signals

### Issue #20 — small blind benchmark

https://github.com/cloudflare/security-audit-skill/issues/20

Caveats: one seeded target, small n, author has a competing pipeline. Treat as measured signal, not universal ranking.

Reported useful signals:

- high precision and no hits on deliberate decoys;
- dependency/CVE facts can be unreachable by design under the no-network/source-first boundary;
- domain-specific correctness defects may not map into security coverage units;
- quick mode can lose coverage when a hunter returns malformed output;
- deployment-dependent reachability may be represented too weakly as a hardening note;
- quick-profile spend did not buy additional recall on that target;
- weaker model tier retained precision better than recall.

Implication: add controlled evals, typed failure outcomes, trusted external evidence providers, and separate production applicability from source claim validity.

### Issue #21 — phantom artifact evidence

https://github.com/cloudflare/security-audit-skill/issues/21

Current main validates local artifact path ownership/shape but does not prove the retained file actually exists.

Several open PRs propose on-disk validation.

Implication: the hosted product should use immutable evidence objects/hashes tied to producer assignment/execution rather than treating a path string as provenance.

### PR #13 — provider refusal handling

https://github.com/cloudflare/security-audit-skill/pull/13

Proposes adapting subagent role mapping/concurrency and recording model safety refusals as explicit deferrals after bounded retry.

Implication: model refusal is a typed operational outcome.

### PR #32 — malformed quick hunter output

https://github.com/cloudflare/security-audit-skill/pull/32

Proposes a bounded fresh-owner retry within quick mode, then explicit malformed_hunter_return deferral.

Implication: malformed output cannot silently become clean coverage.

### PR #43 — advisory/CVE scope disclosure

https://github.com/cloudflare/security-audit-skill/pull/43

Proposes explicitly documenting that live advisory lookup is outside the current source-only skill.

Implication: our product can supply advisory evidence through a trusted external provider without weakening target sandbox isolation.

## Hacker News / practitioner feedback

Discussion around the release includes reports of very large token consumption on broad audits and stronger usefulness on targeted/PR scopes. Some comments criticize large prompt/schema injection and skill-selection/context pollution.

These reports are anecdotal, but they align with Cloudflare's own internal conclusion that workers should receive narrow scopes and bounded relevant context.

Implication: context compilation and PR/diff-first product flows are product requirements, not late optimization.

## Reddit signal

Specific architecture discussion around this repository is sparse. Some users recommend the skill among security tools for AI-built software, but Reddit currently provides less reliable design evidence than upstream engineering writeups, GitHub issues/PRs, and HN practitioner reports.

## Initial architecture implications for this fork

1. Preserve the upstream methodology until Gate 1 measures it.
2. Move hosted durable state/authority outside model context.
3. Start with the smallest persistent Recon → Hunt → Validate harness.
4. Make worker outcomes typed and resumable.
5. Optimize scoped/PR audits before defaulting to full-repository sweeps.
6. Build a context compiler rather than blindly concatenating all possible knowledge.
7. Keep target execution isolated and evidence promotion trusted.
8. Model unresolved external facts as resumable evidence requests.
9. Add trusted external knowledge/context providers outside target sandboxes.
10. Delay dedicated dedup, cross-repo trace, fleet scheduling, and automated fixing until measured scale requires them.

## Evidence weighting used

Highest confidence:
1. current code/tests and merged history;
2. Cloudflare's own engineering writeups.

Useful but secondary:
3. current GitHub issues and open PR experiments;
4. practitioner HN reports.

Low weight:
5. sparse Reddit mentions and third-party summaries.

This file is historical research evidence. Do not boot with it unless a current question needs the detailed reasoning.
