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


## D-010 — Coverage critics and final verifiers have bounded non-mutating authority

Status: Accepted  
Date: 2026-09-19

### Context

The portable Cloudflare workflow depends on coverage critics to discover omitted/review-worthy work and fresh final verifiers to challenge retained records. In a hosted system those workers must remain observation sources, not state authorities.

A critic limited to existing IDs would miss its central purpose: discovering unmapped work. An unbounded critic loop, however, creates cost and termination risk. Final verifiers likewise must not silently rewrite a finding.

### Decision

Coverage critics operate on bounded canonical coverage snapshots containing status, reviewed paths, checks, candidate IDs, and unresolved blockers.

A critic result contains:

- an explicit `stop` boolean;
- bounded new coverage IDs;
- bounded covered-unit reassignment IDs.

The parser requires the stop decision to be self-consistent: `stop=true` means no requested work; `stop=false` requires work.

Canonical mutations occur only through owned events:

- `coverage_unit_added_by_critic` requires a successful critic;
- `coverage_reopened` requires a successful critic independent from the prior hunter;
- reopened current-attempt evidence is cleared; prior evidence remains in immutable event history;
- any subsequent hunter must be fresh by reducer policy.

Profile behavior is bounded:

- `quick`: one critic; any requested new/reopened work becomes explicit deferred coverage and the run is incomplete;
- `standard/deep`: one post-wave critic, at most one additional hunter wave over new/reopened work, then a different final-clean critic;
- any work still requested by final-clean becomes deferred and the run is incomplete.

Final record verifiers receive the canonical candidate claim, linked coverage IDs, retained verdict, and open finding-handoff requirements. Their authority is limited to `verified` or `needs_revision`.

- `verified` permits the owned `candidate_final_verified` event;
- `needs_revision` cannot mutate the record and instead keeps the run incomplete until a future explicit replacement/revalidation contract exists.

### Consequences

- coverage gaps may be discovered without granting critics direct state mutation;
- critic work is finite and profile-aware;
- partial audits can preserve useful fully verified records while remaining explicitly incomplete;
- final record changes require a later provenance-preserving replacement flow;
- Gate 3d must add crash/restart resumability without weakening these authority bounds.


## D-011 — Assignments are durable two-sided checkpoints and full orchestration is resumable

Status: Accepted  
Date: 2026-09-19

### Context

The event stream made canonical audit state durable, but Gate 3c still had a process-crash window around worker calls.

A crash after assignment creation could lose the exact task snapshot. A crash after a successful worker response but before semantic translation could lose the normalized result and force either duplicate provider work or an unrecoverable active assignment. Process-local incomplete-reason arrays also disappeared across restart.

Inferring missing task context from current projected state is unsafe for critic rounds and other state-sensitive tasks.

### Decision

Domain schema version 3 treats every worker assignment as a durable two-sided checkpoint.

At assignment creation, the canonical event persists a bounded, versioned provider-neutral `taskReceipt` containing the exact owned task sent to the adapter.

At successful completion, the canonical completion event atomically persists the typed worker outcome and a bounded, versioned normalized `resultReceipt`. Failed, cancelled, or internally interrupted assignments must carry no result receipt.

The full `runToTerminal` path delegates to a phase-driven `resumeToTerminal` engine.

On restart:

- planned assignments execute from their stored task receipt without spending another assignment budget slot;
- successful completed assignments consume their stored result receipt without re-calling the worker;
- result receipts are re-validated through the task-specific parser before semantic use;
- in-progress assignments are not assumed successful; they receive the internal `orchestrator_interrupted` outcome and are retried with a fresh assignment/worker;
- task receipts must match run ID, source snapshot, profile, assignment ID, worker ID, kind, and candidate/coverage ownership;
- nonterminal incomplete reasons are canonical owned state and survive restart;
- reducer-level completion rejects any run carrying persisted incomplete reasons.

### Consequences

- provider/model calls are not repeated after a successful normalized result has been durably committed;
- critic round identity survives restart exactly rather than being inferred from attempt counts;
- crash recovery is deterministic across the full hosted audit lifecycle;
- retry after ambiguous in-progress work is explicit and consumes fresh budget/worker identity;
- the current reference implementation assumes one active orchestrator per run; distributed concurrency/leases remain a later scaling concern;
- Gate 4 context compilation must compile into these durable owned task receipts rather than directly into provider-specific requests.

## D-012 — Domain schema upgrades preserve historical event readability

Status: Accepted  
Date: 2026-09-19

### Context

Gate 3d introduced domain schema version 3 task/result checkpoints. Delayed review of the merged PR correctly identified that the file event store had begun rejecting existing schema-v2 history.

D-007 requires persistence migrations/upgrades to preserve event order and meaning. Historical bytes must not become unreadable simply because the current writer schema changes.

Schema-v2 assignment history also lacks the exact task/result checkpoint data required by Gate 3d for safe resume. Fabricating those missing checkpoints would create false provenance.

### Decision

The file event store remains a version-aware compatibility boundary.

For schema-v2 stored events:

- validate the checksum against the original schema-v2 event before upcast;
- preserve the original on-disk envelope and checksum chain unchanged;
- deterministically upcast only the in-memory replay representation to the current domain schema;
- synthesize explicitly marked non-resumable legacy receipt envelopes only so current reducer replay can reconstruct historical state;
- never present those placeholders as real worker task/result provenance.

Terminal schema-v2 histories remain readable as terminal history.

A nonterminal schema-v2 run containing legacy assignments is readable, but `resumeToTerminal` must fail closed by recording a durable incomplete reason and terminalizing the run as `incomplete` without invoking a worker. Current-schema events may then extend the original checksum chain.

New writes remain current-schema only.

### Consequences

- historical schema-v2 event stores remain readable after the v3 upgrade;
- historical files are not rewritten merely to read them;
- mixed v2→v3 streams are supported for explicit fail-closed terminalization;
- no model/provider work is repeated or invented to fill missing legacy checkpoints;
- future domain schema upgrades must include backward replay/upcast or an explicit tested migration path before the writer version changes.


## D-013 — Worker context is a bounded content-addressed owned artifact

Status: Accepted  
Date: 2026-09-19

### Context

Gate 3 made worker tasks durable and resumable, but tasks still lacked an owned source/methodology context artifact. Passing ambient repository state, chat history, or ad-hoc prompt concatenation directly to providers would make runs non-reproducible and could reintroduce context exhaustion that Cloudflare's larger harness explicitly learned to avoid.

The Cloudflare skill also references methodology at finer granularity than Markdown headings alone: concrete attack classes are often bold labels such as `ATTACK-CLASSES.md#Access control` or `WEB-PROTOCOL-AND-AUTH.md#Host and forwarded-header trust`.

### Decision

Gate 4 uses an owned deterministic context compiler.

Source input is an immutable text snapshot whose `snapshotId` is derived from a canonical sorted manifest of repository-relative path, file content hash, and byte count. The compiler revalidates file contents, hashes, byte counts, ordering, and snapshot identity at runtime.

Scope is explicit:

- `paths` selects only files under named roots;
- `diff` selects only changed files intersecting optional allowed roots and retains base/head refs plus unavailable changed paths;
- `repository` requires an explicit full-repository choice.

Project-memory/history paths are excluded from worker source context by default and require explicit opt-in.

Methodology is selected only by explicit block refs from the existing Cloudflare markdown corpus. The catalog recognizes both heading blocks and Cloudflare's top-level bold attack-class labels. Selected block content/hash/bytes are revalidated.

The compiler sorts paths and refs with locale-independent ordering, canonicalizes bounded task metadata, and emits a provider-neutral `WorkerContextBundle`. Its `bundleId` is SHA-256 over the canonical bundle payload.

Context is never silently truncated. File count/size, source total, methodology block/count/total, task metadata, canonical depth/node count, and final serialized bundle size are hard fail-closed limits.

### Consequences

- equal owned inputs yield byte-identical serialized context and bundle identity;
- chat history, GitHub project-memory history, and ambient host context are not implicit worker inputs;
- diff/subsystem audits can be smaller and reproducible without weakening audit-state authority;
- Gate 4b must bind durable worker task receipts to these context bundles rather than provider-specific prompt strings;
- provider adapters may render a bundle into their own request format, but cannot change its source/methodology contents without changing the bundle identity.
