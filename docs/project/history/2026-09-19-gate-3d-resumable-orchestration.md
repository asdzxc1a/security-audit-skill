# Gate 3d Resumable Orchestration Evidence — 2026-09-19

## Scope

Gate 3d closes the gap between durable event replay and durable orchestration progress.

Base: `016139cefd603efa48551fa051f41df028411734` (Gate 3c).

Implementation head before memory-only updates: `87828cf8ded79d6ad44fb72a6af2bcaa6f233a61`.

Cloudflare audit prompts/companions remain unchanged.

## Contract change

Domain schema: v3.

Orchestration receipt schema: v3.

Each assignment now persists:

- bounded versioned task receipt at assignment creation;
- typed outcome at completion;
- bounded normalized result receipt only for successful `valid_result` completion.

Canonical run state also persists nonterminal incomplete reasons.

## Crash windows exercised

The test suite injects simulated process crashes **after durable event append** so the restart path sees realistic persisted intermediate state.

Covered windows:

1. crash after hunter `assignment_completed`, before `coverage_resolved`;
2. crash after hunter `assignment_created`, before start;
3. crash after hunter `assignment_started`, before completion;
4. crash after post-wave critic completion, before applying new coverage;
5. crash after candidate-verifier completion, before candidate disposition;
6. crash after final-verifier completion, before `candidate_final_verified`;
7. crash during a critic assignment, proving the retry preserves the exact original critic round;
8. crash after a permanent critic failure completion but before the incomplete reason event.

## Observed invariants

- completed worker results are consumed from receipt without re-calling the completed worker;
- planned assignments execute the originally persisted task;
- ambiguous in-progress work is never assumed successful;
- interrupted retries use a fresh assignment/worker;
- critic round survives restart through the task receipt;
- normalized receipts are re-parsed semantically before use;
- task receipt identity is tied to run/source/profile plus assignment ownership;
- incomplete reasons are reconstructed/persisted and block false completion;
- restart/replay preserves task and result receipts in projections.

## Verification

Full repository check on the Gate 3d worktree:

- project-memory invariants: PASS;
- upstream Cloudflare validator tests: 65/65 PASS;
- Gate 1 eval/adapter tests: 13/13 PASS;
- strict TypeScript compile: PASS;
- domain/storage/orchestrator tests: 66/66 PASS;
- npm dependency audit: 0 vulnerabilities;
- `git diff --check`: PASS.

## Deliberate non-goal

Gate 3d provides single-active-orchestrator restart safety.

It does not implement distributed leases, leader election, or concurrent multi-orchestrator write coordination. Those require a later production storage/runtime decision.
