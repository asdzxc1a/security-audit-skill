# Project Decisions

Only Accepted decisions are active architectural authority.

## D-001 — GitHub is durable project memory

Status: Accepted  
Date: 2026-09-19

### Context

The project must survive chat boundaries and be understandable by future agents without loading old conversations.

### Decision

Use repository docs for durable truth/rationale/lessons/history, GitHub Issues for active implementation work, branches/PRs for changes and evidence, and code/tests as stronger authority than prose.

Chat, local scratch, and model context are not project state.

### Consequences

Every meaningful completed change must update stale durable memory in the same handoff. Duplicate memory is avoided through the routing rules in PROJECT_MEMORY_SYSTEM.md.

## D-002 — Preserve upstream lineage and portable methodology

Status: Accepted  
Date: 2026-09-19

### Context

The fork exists to build a server/plugin product from cloudflare/security-audit-skill, not to erase the upstream research methodology.

### Decision

Keep the GitHub fork relationship and pin the initial working baseline to c1c8a8c1471069fb0e188eeaff69b8e8db6564a8. Preserve the current portable skill while hosted capabilities are added alongside it.

### Consequences

Methodology changes require measured evidence and a focused decision. Upstream changes can be compared and selectively incorporated rather than copied blindly.

## D-003 — Measure before refactoring the audit methodology

Status: Accepted  
Date: 2026-09-19

### Context

The upstream project's evolution shows many unusual constraints are responses to real agent and host failures. External users also report cost, malformed-output, and coverage failure modes.

### Decision

Gate 1 must establish a pinned baseline/eval harness before we restructure prompts, attack companions, verdict semantics, or coverage behavior.

### Consequences

Architecture cleanup that could change audit behavior waits for measurement. Infrastructure that does not alter behavior may proceed only through the current gate.

## D-004 — Hosted state and authority live outside model prompts

Status: Accepted  
Date: 2026-09-19

### Context

The target product must run as a durable server/MCP/plugin system. Model contexts are finite and unreliable as transaction/state stores.

### Decision

The hosted engine will own persistent state, authorization, budgets, transitions, worker independence, retries, and evidence acceptance. Model workers will be treated as replaceable reasoning compute.

### Consequences

Public MCP tools operate on user intent and stable identifiers; they do not expose internal privileged transitions or a generic shell.

## D-005 — Evidence gates may close incomplete on external-environment blockers

Status: Accepted  
Date: 2026-09-19

### Context

Gate 1 required at least one clean real provider/model baseline. Bounded real attempts showed that the available Claude host is blocked by invalid OAuth credentials, while the available Codex host is inference-ready but cannot suppress ambient user skill discovery without moving to a clean authentication home. Resolving either condition requires credential/account actions outside ordinary repository work.

### Decision

A project gate may close as `incomplete_external_environment` when all of the following hold:

1. the repository-controlled implementation and deterministic evidence for the gate are green;
2. bounded real attempts establish the external blocker precisely;
3. continuing requires credential, production, billing, or other externally authorized action;
4. the blocker is persisted without converting it into a success claim;
5. the next gate can use the measured blocker as an owned contract requirement.

This is an exception path, not permission to bypass red repository tests.

### Consequences

Gate 1 closes incomplete without claiming a model-quality baseline. Gate 2 must model provider readiness, ambient capability isolation, and typed host failures explicitly. Future gates use the same pattern rather than silently weakening acceptance or waiting indefinitely on external account state.

## D-006 — Owned events and reducer govern audit truth

Status: Accepted  
Date: 2026-09-19

### Context

Gate 1 showed that model/provider hosts vary in authentication, ambient capabilities, refusal/error behavior, and available telemetry. Those differences cannot be allowed to define the application's state machine.

### Decision

The hosted product owns versioned provider-neutral audit contracts. External workers/providers do not mutate canonical audit state directly.

They produce adapter observations that are translated into typed audit events. A deterministic reducer is the authority that accepts or rejects state transitions.

The reducer enforces, at minimum:

- strict run/event sequencing;
- phase order;
- worker invocation budget;
- fresh-worker verification boundaries;
- failure/refusal/provider-error outcomes cannot close coverage as clean;
- `needs_validation` has durable handoff evidence;
- run-blocking evidence prevents completion;
- unresolved candidates prevent completion;
- terminal runs reject later mutations.

Persistence added later must store/replay these accepted events without changing reducer semantics.

### Consequences

Provider-specific SDK/result types remain outside the domain layer. Database schemas and MCP tools will project owned state rather than become alternate authorities. Event-store work in the next slice must prove replay equivalence against the reducer.


## D-007 — Accepted event history is canonical persisted state; projections are rebuildable

Status: Accepted  
Date: 2026-09-19

### Context

D-006 makes owned audit events plus the deterministic reducer authoritative for audit truth. Gate 2b needs durable restart/replay without allowing a database schema, cached snapshot, or provider response to become a second state machine.

### Decision

Persistence stores immutable reducer-accepted events in strict run sequence.

Canonical current state is reconstructed by replaying those events through the domain reducer. Read projections may reshape that state for consumers, but they are disposable and rebuildable.

The first reference persistence adapter uses one atomically published event file per sequence, a checksum chain, and a durable `HEAD` witness so restart can detect corruption, gaps, and tail truncation. Exact append retries are idempotent.

This file-backed adapter proves semantics; it is not a commitment to the eventual production database technology.

### Consequences

- reducer-rejected events must never be persisted;
- storage integrity failures fail closed;
- persistence migrations must preserve event order and payload meaning;
- future database tables, caches, and projectors may optimize reads but cannot introduce alternate transition rules;
- Gate 3 orchestration writes owned events through an event-store interface rather than mutating projected state directly.


## D-008 — Worker adapters are observation sources, not state authorities

Status: Accepted  
Date: 2026-09-19

### Context

Gate 1 showed provider hosts can refuse, fail authentication, leak ambient capabilities, emit malformed data, or expose different telemetry. Gate 2 established that canonical audit truth is reducer-owned event state.

Gate 3 introduces actual worker execution. Allowing workers or provider SDK objects to mutate coverage/candidate/run state would bypass the reducer and recreate host-specific authority.

### Decision

Worker adapters receive owned, immutable tasks and return untrusted observations.

The orchestrator is the only component that:

1. runtime-validates/classifies those observations;
2. translates them into owned audit events;
3. appends those events through `AuditEventStore`.

Workers never receive mutable canonical state handles, never mutate projections, and never choose event sequence/IDs or terminal run state.

Provider throws and malformed observations become typed worker outcomes rather than escaping state accounting.

### Consequences

- provider SDK/result types remain behind adapters;
- orchestrator tests use fake/scripted workers without provider dependencies;
- retries, critic waves, final verification, and future MCP actions must preserve the same observation → owned event boundary;
- projections are read models only;
- a provider feature may improve reasoning but cannot weaken reducer/event-store invariants.


## D-009 — Canonical coverage and candidates are evidence-bearing bounded records

Status: Accepted  
Date: 2026-09-19

### Context

The first Gate 3 orchestration slice correctly separated worker observations from canonical events, but post-merge review found four trust failures:

1. candidate verification received only an opaque fingerprint rather than the hunter's substantive claim;
2. an unsupported worker assertion could become `covered` without reviewed paths/check evidence;
3. unbounded observation fields could produce an event larger than the store's read limit and poison future replay;
4. the same root-cause fingerprint reported by multiple coverage units could trigger a duplicate-candidate transition failure.

These are contract defects, not provider-specific bugs.

### Decision

Owned domain schema version 2 and orchestration schema version 2 make evidence a first-class bounded part of canonical state.

Coverage resolutions for `covered`, `candidate`, and `blocked` require bounded reviewed paths and structured checks.

Candidates persist a bounded substantive claim: title, description, claimed root cause, intended behavior, trace, evidence, and conditions. Candidate verifier tasks receive that persisted claim and every linked coverage ID.

A repeated fingerprint reuses the existing canonical candidate through an explicit `candidate_linked_to_coverage` event rather than registering a duplicate.

Observation parsing bounds total serialized bytes, field sizes, array cardinality, paths, claims, checks, evidence requirements, and adapter metadata. The event store independently rejects an envelope exceeding its durable read limit before publication.

### Consequences

- a bare model assertion cannot create clean coverage;
- independent verification has the actual claim/evidence to challenge;
- one root cause can span multiple coverage units without duplicate findings;
- untrusted output cannot make a run unreadable by exceeding persistence bounds;
- read projections deep-copy evidence-bearing records;
- future critic/final-verification/reporting orchestration must use these v2 contracts;
- there is no supported production v1 event history to migrate; v2 is the current pre-production owned contract.
