import assert from "node:assert/strict";
import test from "node:test";

import {
  DOMAIN_SCHEMA_VERSION,
  type AuditEvent,
  type AuditRunState,
  type CandidateClaim,
  type CoverageCheck,
  type WorkerOutcome,
} from "./contracts";
import { DomainTransitionError, reduceAuditState, type TransitionErrorCode } from "./reducer";

const VALID: WorkerOutcome = { kind: "valid_result", detail: null, adapter: null };

const CLAIM: CandidateClaim = {
  title: "Cross-boundary document read",
  description: "The document lookup crosses the tenant boundary.",
  claimedRootCause: "The final lookup omits tenant ownership.",
  intendedBehavior: "Document reads must remain tenant-scoped.",
  trace: [
    {
      file: "src/documents.ts",
      line: 10,
      scope: "getDocument",
      description: "Caller-controlled id reaches the document lookup.",
    },
  ],
  evidence: [
    {
      file: "src/documents.ts",
      line: 11,
      scope: "getDocument",
      description: "Lookup compares document id without tenant id.",
    },
  ],
  conditions: ["Attacker has an authenticated tenant account."],
};

const COVERAGE_CHECKS: readonly CoverageCheck[] = [
  {
    invariant: "Document access must remain tenant-scoped.",
    method: "source",
    result: "Reviewed the final lookup and tenant binding.",
    artifactRef: null,
  },
];

const REVIEWED_PATHS = ["src/documents.ts"] as const;

class Scenario {
  state: AuditRunState | null = null;
  private eventCounter = 0;

  apply(payload: { type: AuditEvent["type"] } & Record<string, unknown>): AuditRunState {
    const event = this.build(payload);
    this.state = reduceAuditState(this.state, event);
    return this.state;
  }

  attempt(payload: { type: AuditEvent["type"] } & Record<string, unknown>): AuditRunState {
    return reduceAuditState(this.state, this.build(payload));
  }

  private build(payload: { type: AuditEvent["type"] } & Record<string, unknown>): AuditEvent {
    this.eventCounter += 1;
    return {
      schemaVersion: DOMAIN_SCHEMA_VERSION,
      eventId: "event-" + this.eventCounter,
      runId: "run-1",
      sequence: (this.state?.sequence ?? 0) + 1,
      ...payload,
    } as AuditEvent;
  }
}

function expectCode(fn: () => unknown, code: TransitionErrorCode): void {
  assert.throws(
    fn,
    (error: unknown) => error instanceof DomainTransitionError && error.code === code,
  );
}

function createRun(scenario: Scenario, maxWorkerInvocations: number | null = 20): void {
  scenario.apply({
    type: "run_created",
    sourceSnapshotId: "snapshot-1",
    profile: "standard",
    scopePaths: ["src"],
    maxWorkerInvocations,
  });
}

function advanceToHunting(scenario: Scenario, coverageId = "coverage-1"): void {
  createRun(scenario);
  scenario.apply({ type: "phase_advanced", to: "reconnaissance" });
  scenario.apply({ type: "phase_advanced", to: "coverage_planning" });
  scenario.apply({ type: "coverage_unit_registered", coverageId });
  scenario.apply({ type: "phase_advanced", to: "hunting" });
}

function createCandidate(scenario: Scenario): void {
  advanceToHunting(scenario);
  scenario.apply({
    type: "assignment_created",
    assignmentId: "hunt-1",
    kind: "hunter",
    workerId: "hunter-a",
    coverageIds: ["coverage-1"],
    candidateId: null,
  });
  scenario.apply({ type: "assignment_started", assignmentId: "hunt-1" });
  scenario.apply({ type: "assignment_completed", assignmentId: "hunt-1", outcome: VALID });
  scenario.apply({
    type: "candidate_registered",
    candidateId: "candidate-1",
    fingerprint: "root-cause-1",
    coverageId: "coverage-1",
    originAssignmentId: "hunt-1",
    claim: CLAIM,
  });
  scenario.apply({
    type: "coverage_resolved",
    coverageId: "coverage-1",
    assignmentId: "hunt-1",
    resolution: "candidate",
    candidateIds: ["candidate-1"],
    reviewedPaths: REVIEWED_PATHS,
    checks: COVERAGE_CHECKS,
    unresolved: [],
  });
  scenario.apply({ type: "phase_advanced", to: "candidate_validation" });
}

function verifyCandidate(
  scenario: Scenario,
  verdict: "confirmed" | "needs_validation" | "rejected",
  workerId = "verifier-a",
): void {
  scenario.apply({
    type: "assignment_created",
    assignmentId: "candidate-verify-1",
    kind: "candidate_verifier",
    workerId,
    coverageIds: [],
    candidateId: "candidate-1",
  });
  scenario.apply({ type: "assignment_started", assignmentId: "candidate-verify-1" });
  scenario.apply({
    type: "assignment_completed",
    assignmentId: "candidate-verify-1",
    outcome: VALID,
  });
  scenario.apply({
    type: "candidate_disposition_recorded",
    candidateId: "candidate-1",
    verdict,
    verifierAssignmentId: "candidate-verify-1",
  });
}

test("valid confirmed-finding lifecycle reaches complete", () => {
  const scenario = new Scenario();
  createCandidate(scenario);
  verifyCandidate(scenario, "confirmed");

  scenario.apply({ type: "phase_advanced", to: "record_verification" });
  scenario.apply({
    type: "assignment_created",
    assignmentId: "record-verify-1",
    kind: "record_verifier",
    workerId: "verifier-b",
    coverageIds: [],
    candidateId: "candidate-1",
  });
  scenario.apply({ type: "assignment_started", assignmentId: "record-verify-1" });
  scenario.apply({
    type: "assignment_completed",
    assignmentId: "record-verify-1",
    outcome: VALID,
  });
  scenario.apply({
    type: "candidate_final_verified",
    candidateId: "candidate-1",
    verifierAssignmentId: "record-verify-1",
  });
  scenario.apply({ type: "phase_advanced", to: "reporting" });
  const complete = scenario.apply({ type: "run_completed" });

  assert.equal(complete.status, "complete");
  assert.equal(complete.candidates["candidate-1"].verdict, "confirmed");
  assert.equal(complete.budget.spentWorkerInvocations, 3);
});



test("evidence-free covered resolution is rejected by the reducer itself", () => {
  const scenario = new Scenario();
  advanceToHunting(scenario);
  scenario.apply({
    type: "assignment_created",
    assignmentId: "hunt-1",
    kind: "hunter",
    workerId: "hunter-a",
    coverageIds: ["coverage-1"],
    candidateId: null,
  });
  scenario.apply({ type: "assignment_started", assignmentId: "hunt-1" });
  scenario.apply({ type: "assignment_completed", assignmentId: "hunt-1", outcome: VALID });

  expectCode(
    () =>
      scenario.attempt({
        type: "coverage_resolved",
        coverageId: "coverage-1",
        assignmentId: "hunt-1",
        resolution: "covered",
        candidateIds: [],
        reviewedPaths: [],
        checks: [],
        unresolved: [],
      }),
    "invalid_evidence",
  );
});

test("provider error cannot resolve coverage as clean", () => {
  const scenario = new Scenario();
  advanceToHunting(scenario);
  scenario.apply({
    type: "assignment_created",
    assignmentId: "hunt-1",
    kind: "hunter",
    workerId: "hunter-a",
    coverageIds: ["coverage-1"],
    candidateId: null,
  });
  scenario.apply({ type: "assignment_started", assignmentId: "hunt-1" });
  scenario.apply({
    type: "assignment_completed",
    assignmentId: "hunt-1",
    outcome: { kind: "provider_error", detail: "401", adapter: null },
  });

  expectCode(
    () =>
      scenario.attempt({
        type: "coverage_resolved",
        coverageId: "coverage-1",
        assignmentId: "hunt-1",
        resolution: "covered",
        candidateIds: [],
        unresolved: [],
      }),
    "invalid_assignment",
  );

  const requeued = scenario.apply({
    type: "coverage_requeued",
    coverageId: "coverage-1",
    assignmentId: "hunt-1",
    reason: "provider error",
  });
  assert.equal(requeued.coverageUnits["coverage-1"].status, "planned");
  assert.equal(requeued.coverageUnits["coverage-1"].assignmentId, null);
});

test("hunter cannot be assigned to validate its own candidate", () => {
  const scenario = new Scenario();
  createCandidate(scenario);

  expectCode(
    () =>
      scenario.attempt({
        type: "assignment_created",
        assignmentId: "candidate-verify-1",
        kind: "candidate_verifier",
        workerId: "hunter-a",
        coverageIds: [],
        candidateId: "candidate-1",
      }),
    "independence_violation",
  );
});

test("needs_validation requires a durable open handoff requirement", () => {
  const scenario = new Scenario();
  createCandidate(scenario);

  scenario.apply({
    type: "assignment_created",
    assignmentId: "candidate-verify-1",
    kind: "candidate_verifier",
    workerId: "verifier-a",
    coverageIds: [],
    candidateId: "candidate-1",
  });
  scenario.apply({ type: "assignment_started", assignmentId: "candidate-verify-1" });
  scenario.apply({
    type: "assignment_completed",
    assignmentId: "candidate-verify-1",
    outcome: VALID,
  });

  expectCode(
    () =>
      scenario.attempt({
        type: "candidate_disposition_recorded",
        candidateId: "candidate-1",
        verdict: "needs_validation",
        verifierAssignmentId: "candidate-verify-1",
      }),
    "invalid_evidence",
  );

  scenario.apply({
    type: "evidence_requirement_opened",
    requirementId: "requirement-1",
    kind: "deployment_fact",
    scope: "finding_handoff",
    candidateId: "candidate-1",
    description: "Confirm production proxy header stripping.",
  });
  const state = scenario.apply({
    type: "candidate_disposition_recorded",
    candidateId: "candidate-1",
    verdict: "needs_validation",
    verifierAssignmentId: "candidate-verify-1",
  });
  assert.equal(state.candidates["candidate-1"].verdict, "needs_validation");
});

test("run-blocking evidence prevents completion", () => {
  const scenario = new Scenario();
  createRun(scenario);
  scenario.apply({ type: "phase_advanced", to: "reconnaissance" });
  scenario.apply({ type: "phase_advanced", to: "coverage_planning" });
  scenario.apply({ type: "phase_advanced", to: "hunting" });
  scenario.apply({ type: "phase_advanced", to: "candidate_validation" });
  scenario.apply({ type: "phase_advanced", to: "record_verification" });
  scenario.apply({ type: "phase_advanced", to: "reporting" });
  scenario.apply({
    type: "evidence_requirement_opened",
    requirementId: "provider-ready",
    kind: "provider_readiness",
    scope: "run_blocking",
    candidateId: null,
    description: "Provider must pass authenticated readiness probe.",
  });

  expectCode(() => scenario.attempt({ type: "run_completed" }), "unresolved_work");

  scenario.apply({
    type: "evidence_requirement_resolved",
    requirementId: "provider-ready",
    resolution: "Authenticated readiness probe passed.",
  });
  assert.equal(scenario.apply({ type: "run_completed" }).status, "complete");
});

test("strict budget is enforced before assignment creation", () => {
  const scenario = new Scenario();
  createRun(scenario, 0);
  scenario.apply({ type: "phase_advanced", to: "reconnaissance" });

  expectCode(
    () =>
      scenario.attempt({
        type: "assignment_created",
        assignmentId: "recon-1",
        kind: "recon",
        workerId: "worker-a",
        coverageIds: [],
        candidateId: null,
      }),
    "budget_exhausted",
  );
});

test("unvalidated candidate blocks phase advancement", () => {
  const scenario = new Scenario();
  createCandidate(scenario);
  expectCode(
    () => scenario.attempt({ type: "phase_advanced", to: "record_verification" }),
    "unresolved_work",
  );
});

test("final verifier assignment must use a fresh worker", () => {
  const scenario = new Scenario();
  createCandidate(scenario);
  verifyCandidate(scenario, "confirmed", "verifier-a");
  scenario.apply({ type: "phase_advanced", to: "record_verification" });

  expectCode(
    () =>
      scenario.attempt({
        type: "assignment_created",
        assignmentId: "record-verify-1",
        kind: "record_verifier",
        workerId: "verifier-a",
        coverageIds: [],
        candidateId: "candidate-1",
      }),
    "independence_violation",
  );
});



test("only hunters may own coverage units", () => {
  const scenario = new Scenario();
  advanceToHunting(scenario);

  expectCode(
    () =>
      scenario.attempt({
        type: "assignment_created",
        assignmentId: "critic-1",
        kind: "coverage_critic",
        workerId: "critic-a",
        coverageIds: ["coverage-1"],
        candidateId: null,
      }),
    "invalid_assignment",
  );
});

test("assignment coverage ids must be unique", () => {
  const scenario = new Scenario();
  advanceToHunting(scenario);

  expectCode(
    () =>
      scenario.attempt({
        type: "assignment_created",
        assignmentId: "hunt-1",
        kind: "hunter",
        workerId: "hunter-a",
        coverageIds: ["coverage-1", "coverage-1"],
        candidateId: null,
      }),
    "invalid_assignment",
  );
});

test("requeued coverage requires a fresh hunter worker", () => {
  const scenario = new Scenario();
  advanceToHunting(scenario);
  scenario.apply({
    type: "assignment_created",
    assignmentId: "hunt-1",
    kind: "hunter",
    workerId: "hunter-a",
    coverageIds: ["coverage-1"],
    candidateId: null,
  });
  scenario.apply({ type: "assignment_started", assignmentId: "hunt-1" });
  scenario.apply({
    type: "assignment_completed",
    assignmentId: "hunt-1",
    outcome: { kind: "provider_error", detail: "provider unavailable", adapter: null },
  });
  scenario.apply({
    type: "coverage_requeued",
    coverageId: "coverage-1",
    assignmentId: "hunt-1",
    reason: "provider error",
  });

  expectCode(
    () =>
      scenario.attempt({
        type: "assignment_created",
        assignmentId: "hunt-2",
        kind: "hunter",
        workerId: "hunter-a",
        coverageIds: ["coverage-1"],
        candidateId: null,
      }),
    "independence_violation",
  );

  const state = scenario.apply({
    type: "assignment_created",
    assignmentId: "hunt-3",
    kind: "hunter",
    workerId: "hunter-b",
    coverageIds: ["coverage-1"],
    candidateId: null,
  });
  assert.equal(state.assignments["hunt-3"].workerId, "hunter-b");
});

test("coverage candidate ids must be unique", () => {
  const scenario = new Scenario();
  advanceToHunting(scenario);
  scenario.apply({
    type: "assignment_created",
    assignmentId: "hunt-1",
    kind: "hunter",
    workerId: "hunter-a",
    coverageIds: ["coverage-1"],
    candidateId: null,
  });
  scenario.apply({ type: "assignment_started", assignmentId: "hunt-1" });
  scenario.apply({ type: "assignment_completed", assignmentId: "hunt-1", outcome: VALID });
  scenario.apply({
    type: "candidate_registered",
    candidateId: "candidate-1",
    fingerprint: "root-cause-1",
    coverageId: "coverage-1",
    originAssignmentId: "hunt-1",
    claim: CLAIM,
  });

  expectCode(
    () =>
      scenario.attempt({
        type: "coverage_resolved",
        coverageId: "coverage-1",
        assignmentId: "hunt-1",
        resolution: "candidate",
        candidateIds: ["candidate-1", "candidate-1"],
        reviewedPaths: REVIEWED_PATHS,
        checks: COVERAGE_CHECKS,
        unresolved: [],
      }),
    "invalid_coverage",
  );
});

test("needs_validation handoff remains open until an explicit revalidation transition exists", () => {
  const scenario = new Scenario();
  createCandidate(scenario);
  scenario.apply({
    type: "assignment_created",
    assignmentId: "candidate-verify-1",
    kind: "candidate_verifier",
    workerId: "verifier-a",
    coverageIds: [],
    candidateId: "candidate-1",
  });
  scenario.apply({ type: "assignment_started", assignmentId: "candidate-verify-1" });
  scenario.apply({
    type: "assignment_completed",
    assignmentId: "candidate-verify-1",
    outcome: VALID,
  });
  scenario.apply({
    type: "evidence_requirement_opened",
    requirementId: "requirement-1",
    kind: "deployment_fact",
    scope: "finding_handoff",
    candidateId: "candidate-1",
    description: "Confirm production proxy header stripping.",
  });
  scenario.apply({
    type: "candidate_disposition_recorded",
    candidateId: "candidate-1",
    verdict: "needs_validation",
    verifierAssignmentId: "candidate-verify-1",
  });

  expectCode(
    () =>
      scenario.attempt({
        type: "evidence_requirement_resolved",
        requirementId: "requirement-1",
        resolution: "Production proxy strips the header.",
      }),
    "invalid_evidence",
  );
});



test("blocked and deferred coverage prevent final completion", () => {
  for (const mode of ["blocked", "deferred"] as const) {
    const scenario = new Scenario();
    advanceToHunting(scenario);

    if (mode === "blocked") {
      scenario.apply({
        type: "assignment_created",
        assignmentId: "hunt-1",
        kind: "hunter",
        workerId: "hunter-a",
        coverageIds: ["coverage-1"],
        candidateId: null,
      });
      scenario.apply({ type: "assignment_started", assignmentId: "hunt-1" });
      scenario.apply({ type: "assignment_completed", assignmentId: "hunt-1", outcome: VALID });
      scenario.apply({
        type: "coverage_resolved",
        coverageId: "coverage-1",
        assignmentId: "hunt-1",
        resolution: "blocked",
        candidateIds: [],
        reviewedPaths: REVIEWED_PATHS,
        checks: COVERAGE_CHECKS,
        unresolved: ["deployment fact missing"],
      });
    } else {
      scenario.apply({
        type: "coverage_classified",
        coverageId: "coverage-1",
        status: "deferred",
        reason: "budget exhausted",
      });
    }

    scenario.apply({ type: "phase_advanced", to: "candidate_validation" });
    scenario.apply({ type: "phase_advanced", to: "record_verification" });
    scenario.apply({ type: "phase_advanced", to: "reporting" });
    expectCode(() => scenario.attempt({ type: "run_completed" }), "unresolved_work");
  }
});

test("incomplete run can terminate with unresolved work, then rejects later events", () => {
  const scenario = new Scenario();
  advanceToHunting(scenario);
  const terminal = scenario.apply({
    type: "run_marked_incomplete",
    reason: "external provider unavailable",
  });
  assert.equal(terminal.status, "incomplete");
  assert.equal(terminal.terminalReason, "external provider unavailable");

  expectCode(
    () => scenario.attempt({ type: "run_cancelled", reason: "too late" }),
    "terminal_run",
  );
});

test("event sequences are strict and run-scoped", () => {
  const scenario = new Scenario();
  createRun(scenario);

  const badSequence = {
    schemaVersion: DOMAIN_SCHEMA_VERSION,
    eventId: "manual",
    runId: "run-1",
    sequence: 99,
    type: "phase_advanced",
    to: "reconnaissance",
  } as const;
  expectCode(() => reduceAuditState(scenario.state, badSequence), "invalid_sequence");

  const wrongRun = { ...badSequence, sequence: 2, runId: "other-run" };
  expectCode(() => reduceAuditState(scenario.state, wrongRun), "run_mismatch");
});
