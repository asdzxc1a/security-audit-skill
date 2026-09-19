# Project Memory System

## Purpose

GitHub is the durable memory for this project. Conversations, model context, terminal sessions, and local scratch files are temporary execution context.

The memory system exists so a new agent can recover the current project truth with minimum context, act on one bounded gate, and leave the repository more accurate than it found it.

The system optimizes for:

- one authoritative home for each kind of information;
- current truth over conversational chronology;
- small boot context;
- explicit conflict resolution;
- testable memory invariants;
- resumable work through issues and PRs;
- historical evidence without bloating current state.

## Authority order

When sources disagree, use the strongest source:

1. user's explicit current instruction;
2. passing tests and current code;
3. STATE.md;
4. accepted DECISIONS.md entries;
5. current gate in PLAN.md;
6. active GitHub issue;
7. history and old conversations.

Do not average or merge contradictory claims. Resolve the conflict, then update the stale lower-authority memory if the truth changed.

A failing deterministic test blocks a prose claim of completion.

## Boot protocol

Read only enough to act:

1. root AGENTS.md;
2. docs/project/STATE.md;
3. the CURRENT_GATE block in docs/project/PLAN.md;
4. docs/project/TEST_STRATEGY.md;
5. the active gate/subtask issue;
6. relevant code and tests.

Read DECISIONS.md only for decisions relevant to the current change.
Read LESSONS.md only when a recurring failure mode or technique is relevant.
Read CHARTER.md when scope or product boundaries are unclear.
Read history only to recover detailed evidence or chronology.

Never preload the entire memory tree by default.

## Memory routing

### STATE.md

Contains current truth only:

- repository/upstream baseline;
- current product state;
- current gate and issue/PR;
- current blockers;
- last verified evidence;
- one next concrete action.

STATE is not a diary. Replace stale truth rather than appending chronology. Keep it short enough to read on every boot.

### PLAN.md

Contains the evidence-backed roadmap.

The CURRENT_GATE block is the only gate that may be implemented without reprioritization. It contains scope, acceptance, non-goals, and exit criteria.

Future gates may be summarized after the current block, but they are queued intentions, not authorization to jump ahead.

### Active GitHub issue

Contains implementation detail for current work:

- gate or bounded subtask;
- scope;
- acceptance checklist;
- investigation notes that matter to completing that task;
- links to related PRs.

Do not copy the entire issue into STATE.

### DECISIONS.md

Contains durable architecture/product decisions and rationale.

Each decision has:

- ID and title;
- Status: Proposed, Accepted, Superseded, or Rejected;
- Date;
- Context;
- Decision;
- Consequences;
- evidence/links when useful.

Only Accepted decisions outrank PLAN. Superseded decisions remain for history but are not active guidance.

### LESSONS.md

Contains reusable lessons learned from measured project work or reliable upstream evidence.

A lesson should change how future work is performed. It is not a place for speculative ideas, task notes, or quotations.

### history/

Contains verbose completed evidence:

- research baselines;
- benchmark results;
- completed gate evidence;
- migration notes;
- incident/postmortem detail.

History is append-oriented. Current operational truth must still live in STATE/PLAN/DECISIONS.

Suggested filename: YYYY-MM-DD-topic.md.

### CHARTER.md

Contains stable mission, product boundaries, principles, and explicit non-goals. It changes rarely.

## Update transaction

When work changes project truth:

1. change code/docs on a focused branch;
2. run the smallest meaningful evidence;
3. update STATE if current truth/blocker/next action changed;
4. update PLAN only when gate status or roadmap acceptance changed;
5. add/update a DECISION only for durable rationale;
6. add a LESSON only for reusable learning;
7. archive verbose evidence in history when it would bloat current memory;
8. update the active issue and PR with evidence and next action.

Do not update memory before the underlying evidence exists unless the memory explicitly says the state is proposed/in-progress.

## One-write rule

Every fact should have one primary durable home.

Examples:

- "Gate 2 is current" belongs in STATE and PLAN's current marker. The issue may link to it but should not redefine the roadmap.
- "Why we keep Cloudflare methodology intact while building a hosted harness" belongs in DECISIONS.
- "Validator test output from Gate 0" belongs in the PR and optionally history, not STATE.
- "The next action is merge PR #N" belongs in STATE.
- "A worker refusal must be a typed outcome" belongs in LESSONS until implemented, then the contract/code becomes authoritative.

Cross-link rather than duplicate.

## GitHub workflow

One meaningful gate normally has:

- one current PLAN gate;
- one active gate issue;
- one focused branch;
- one PR;
- deterministic evidence;
- memory updates in the same PR when truth changes.

Subtasks may use additional issues/PRs when they are independently reviewable, but STATE still points at one next action.

Prefer squash merge for memory/setup gates when many mechanical commits were needed.

## Secrets and sensitive data

Do not store:

- API tokens;
- credentials;
- private customer/source data;
- production secrets;
- raw ambient environment dumps;
- sensitive sandbox artifacts.

Project memory may store identifiers, hashes, safe synthetic fixtures, and links to access-controlled evidence where appropriate.

## Memory checker

scripts/check-memory.cjs enforces structural invariants such as:

- required memory files exist;
- PLAN has exactly one CURRENT_GATE block;
- STATE stays concise and exposes current gate, blockers, evidence, and next action;
- AGENTS links this protocol and states chat is not project state;
- obvious credential-shaped strings are absent from project-memory files;
- required workflow/templates remain present.

The checker does not prove that prose is factually true. Current code/tests and review do that.

## Porting or repairing memory

When moving this system:

1. copy AGENTS.md and docs/project/PROJECT_MEMORY_SYSTEM.md first;
2. reconstruct STATE from current code/tests, not old chat;
3. reconstruct current PLAN gate from active work;
4. import only accepted durable decisions;
5. import reusable lessons;
6. archive older material under history;
7. run the memory checker;
8. remove duplicated or contradictory stale memory.

When memory is inconsistent, repair the strongest current truth first and record a durable decision only if the resolution itself matters in the future.
