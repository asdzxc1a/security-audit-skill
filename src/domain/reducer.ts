import {
  DOMAIN_SCHEMA_VERSION,
  type ActiveRunStatus,
  type AssignmentKind,
  type AuditEvent,
  type AuditRunState,
  type Candidate,
  type CoverageUnit,
  type EvidenceRequirement,
  type WorkerAssignment,
} from "./contracts";

export type TransitionErrorCode =
  | "invalid_event"
  | "invalid_sequence"
  | "run_mismatch"
  | "terminal_run"
  | "invalid_phase"
  | "invalid_assignment"
  | "budget_exhausted"
  | "invalid_coverage"
  | "invalid_candidate"
  | "independence_violation"
  | "unresolved_work"
  | "invalid_evidence";

export class DomainTransitionError extends Error {
  readonly code: TransitionErrorCode;

  constructor(code: TransitionErrorCode, message: string) {
    super(message);
    this.name = "DomainTransitionError";
    this.code = code;
  }
}

const TERMINAL = new Set(["complete", "incomplete", "cancelled", "failed"] as const);

const NEXT_PHASE: Partial<Record<ActiveRunStatus, ActiveRunStatus>> = {
  created: "reconnaissance",
  reconnaissance: "coverage_planning",
  coverage_planning: "hunting",
  hunting: "candidate_validation",
  candidate_validation: "record_verification",
  record_verification: "reporting",
};

const ASSIGNMENT_PHASE: Record<AssignmentKind, ActiveRunStatus> = {
  recon: "reconnaissance",
  hunter: "hunting",
  coverage_critic: "hunting",
  candidate_verifier: "candidate_validation",
  record_verifier: "record_verification",
};

function fail(code: TransitionErrorCode, message: string): never {
  throw new DomainTransitionError(code, message);
}

function requireText(value: string, label: string): void {
  if (typeof value !== "string" || value.trim() !== value || value.length === 0) {
    fail("invalid_event", label + " must be non-empty trimmed text");
  }
}

function isTerminal(state: AuditRunState): boolean {
  return TERMINAL.has(state.status as "complete" | "incomplete" | "cancelled" | "failed");
}

function hasOpenAssignments(state: AuditRunState): boolean {
  return Object.values(state.assignments).some(
    (assignment) => assignment.status === "planned" || assignment.status === "in_progress",
  );
}

function cloneState(state: AuditRunState): AuditRunState {
  return {
    ...state,
    budget: { ...state.budget },
    assignments: { ...state.assignments },
    coverageUnits: { ...state.coverageUnits },
    candidates: { ...state.candidates },
    evidenceRequirements: { ...state.evidenceRequirements },
  };
}

function assignmentOrFail(state: AuditRunState, assignmentId: string): WorkerAssignment {
  const assignment = state.assignments[assignmentId];
  if (!assignment) fail("invalid_assignment", "unknown assignment " + assignmentId);
  return assignment;
}

function coverageOrFail(state: AuditRunState, coverageId: string): CoverageUnit {
  const coverage = state.coverageUnits[coverageId];
  if (!coverage) fail("invalid_coverage", "unknown coverage unit " + coverageId);
  return coverage;
}

function candidateOrFail(state: AuditRunState, candidateId: string): Candidate {
  const candidate = state.candidates[candidateId];
  if (!candidate) fail("invalid_candidate", "unknown candidate " + candidateId);
  return candidate;
}

function requirementOrFail(state: AuditRunState, requirementId: string): EvidenceRequirement {
  const requirement = state.evidenceRequirements[requirementId];
  if (!requirement) fail("invalid_evidence", "unknown evidence requirement " + requirementId);
  return requirement;
}

function requireSucceededValidAssignment(assignment: WorkerAssignment): void {
  if (assignment.status !== "succeeded" || assignment.outcome?.kind !== "valid_result") {
    fail(
      "invalid_assignment",
      "assignment " + assignment.assignmentId + " did not finish with a valid structured result",
    );
  }
}

function verifyPhaseAdvance(state: AuditRunState, to: ActiveRunStatus): void {
  const expected = NEXT_PHASE[state.status as ActiveRunStatus];
  if (expected !== to) {
    fail("invalid_phase", "cannot advance from " + state.status + " to " + to);
  }
  if (hasOpenAssignments(state)) {
    fail("unresolved_work", "cannot advance phase while assignments remain open");
  }

  if (state.status === "hunting") {
    const unresolvedCoverage = Object.values(state.coverageUnits).filter(
      (unit) => unit.status === "planned" || unit.status === "in_progress",
    );
    if (unresolvedCoverage.length > 0) {
      fail("unresolved_work", "cannot leave hunting with unresolved coverage units");
    }
  }

  if (state.status === "candidate_validation") {
    for (const candidate of Object.values(state.candidates)) {
      if (candidate.verdict === "unvalidated") {
        fail("unresolved_work", "cannot leave candidate validation with unvalidated candidates");
      }
      if (candidate.verdict === "needs_validation") {
        const hasOpenHandoff = Object.values(state.evidenceRequirements).some(
          (requirement) =>
            requirement.candidateId === candidate.candidateId &&
            requirement.scope === "finding_handoff" &&
            requirement.status === "open",
        );
        if (!hasOpenHandoff) {
          fail(
            "invalid_evidence",
            "needs_validation candidate " + candidate.candidateId + " requires an open handoff requirement",
          );
        }
      }
    }
  }

  if (state.status === "record_verification") {
    for (const candidate of Object.values(state.candidates)) {
      if (
        (candidate.verdict === "confirmed" || candidate.verdict === "needs_validation") &&
        candidate.finalVerifierAssignmentId === null
      ) {
        fail(
          "unresolved_work",
          "candidate " + candidate.candidateId + " has not passed final record verification",
        );
      }
    }
  }
}

function verifyCompletion(state: AuditRunState): void {
  if (state.status !== "reporting") {
    fail("invalid_phase", "run can complete only from reporting");
  }
  if (hasOpenAssignments(state)) {
    fail("unresolved_work", "run cannot complete with open assignments");
  }
  for (const coverage of Object.values(state.coverageUnits)) {
    if (coverage.status === "planned" || coverage.status === "in_progress") {
      fail("unresolved_work", "run cannot complete with unresolved coverage " + coverage.coverageId);
    }
  }
  for (const candidate of Object.values(state.candidates)) {
    if (candidate.verdict === "unvalidated") {
      fail("unresolved_work", "run cannot complete with unvalidated candidate " + candidate.candidateId);
    }
    if (
      (candidate.verdict === "confirmed" || candidate.verdict === "needs_validation") &&
      candidate.finalVerifierAssignmentId === null
    ) {
      fail("unresolved_work", "run cannot complete before final verification of " + candidate.candidateId);
    }
  }
  const openRunBlocker = Object.values(state.evidenceRequirements).find(
    (requirement) => requirement.scope === "run_blocking" && requirement.status === "open",
  );
  if (openRunBlocker) {
    fail("unresolved_work", "run cannot complete with open run blocker " + openRunBlocker.requirementId);
  }
}

function createRun(event: Extract<AuditEvent, { type: "run_created" }>): AuditRunState {
  if (event.schemaVersion !== DOMAIN_SCHEMA_VERSION) fail("invalid_event", "unsupported event schema version");
  if (event.sequence !== 1) fail("invalid_sequence", "run_created must have sequence 1");
  requireText(event.eventId, "eventId");
  requireText(event.runId, "runId");
  requireText(event.sourceSnapshotId, "sourceSnapshotId");
  if (
    event.maxWorkerInvocations !== null &&
    (!Number.isInteger(event.maxWorkerInvocations) || event.maxWorkerInvocations < 0)
  ) {
    fail("invalid_event", "maxWorkerInvocations must be null or a non-negative integer");
  }

  return {
    schemaVersion: DOMAIN_SCHEMA_VERSION,
    runId: event.runId,
    sourceSnapshotId: event.sourceSnapshotId,
    profile: event.profile,
    scopePaths: [...event.scopePaths],
    status: "created",
    sequence: 1,
    budget: {
      maxWorkerInvocations: event.maxWorkerInvocations,
      spentWorkerInvocations: 0,
    },
    assignments: {},
    coverageUnits: {},
    candidates: {},
    evidenceRequirements: {},
    terminalReason: null,
  };
}

export function reduceAuditState(state: AuditRunState | null, event: AuditEvent): AuditRunState {
  if (state === null) {
    if (event.type !== "run_created") fail("invalid_event", "first event must be run_created");
    return createRun(event);
  }

  if (event.schemaVersion !== DOMAIN_SCHEMA_VERSION) fail("invalid_event", "unsupported event schema version");
  requireText(event.eventId, "eventId");
  if (event.runId !== state.runId) fail("run_mismatch", "event runId does not match state");
  if (isTerminal(state)) fail("terminal_run", "terminal run cannot accept more events");
  if (event.sequence !== state.sequence + 1) {
    fail(
      "invalid_sequence",
      "expected event sequence " + (state.sequence + 1) + ", got " + event.sequence,
    );
  }

  const next = cloneState(state);
  next.sequence = event.sequence;

  switch (event.type) {
    case "run_created":
      return fail("invalid_event", "run_created may only be the first event");

    case "phase_advanced": {
      verifyPhaseAdvance(state, event.to);
      next.status = event.to;
      return next;
    }

    case "coverage_unit_registered": {
      if (state.status !== "coverage_planning") fail("invalid_phase", "coverage units register during coverage planning");
      requireText(event.coverageId, "coverageId");
      if (state.coverageUnits[event.coverageId]) fail("invalid_coverage", "duplicate coverage unit");
      next.coverageUnits[event.coverageId] = {
        coverageId: event.coverageId,
        status: "planned",
        assignmentId: null,
        candidateIds: [],
        unresolved: [],
      };
      return next;
    }

    case "assignment_created": {
      if (ASSIGNMENT_PHASE[event.kind] !== state.status) {
        fail("invalid_phase", event.kind + " assignment is not allowed during " + state.status);
      }
      requireText(event.assignmentId, "assignmentId");
      requireText(event.workerId, "workerId");
      if (state.assignments[event.assignmentId]) fail("invalid_assignment", "duplicate assignment");

      if (event.kind === "hunter" && event.coverageIds.length === 0) {
        fail("invalid_assignment", "hunter assignment requires coverage units");
      }
      if (event.kind === "candidate_verifier" || event.kind === "record_verifier") {
        if (event.coverageIds.length !== 0) fail("invalid_assignment", "verifier assignment must not own coverage");
        if (event.candidateId === null) fail("invalid_assignment", "verifier assignment requires candidateId");
        const candidate = candidateOrFail(state, event.candidateId);
        if (event.kind === "candidate_verifier" && candidate.verdict !== "unvalidated") {
          fail("invalid_candidate", "candidate verifier requires unvalidated candidate");
        }
        if (
          event.kind === "record_verifier" &&
          candidate.verdict !== "confirmed" &&
          candidate.verdict !== "needs_validation"
        ) {
          fail("invalid_candidate", "record verifier requires a retained final record");
        }
      } else if (event.candidateId !== null) {
        fail("invalid_assignment", event.kind + " assignment must not carry candidateId");
      }

      for (const coverageId of event.coverageIds) {
        const coverage = coverageOrFail(state, coverageId);
        if (coverage.status !== "planned" || coverage.assignmentId !== null) {
          fail("invalid_coverage", "coverage unit " + coverageId + " is not available for assignment");
        }
      }

      const spent = state.budget.spentWorkerInvocations + 1;
      const limit = state.budget.maxWorkerInvocations;
      if (limit !== null && spent > limit) {
        fail("budget_exhausted", "worker invocation budget exhausted");
      }
      next.budget = { ...state.budget, spentWorkerInvocations: spent };
      next.assignments[event.assignmentId] = {
        assignmentId: event.assignmentId,
        kind: event.kind,
        workerId: event.workerId,
        coverageIds: [...event.coverageIds],
        candidateId: event.candidateId,
        status: "planned",
        outcome: null,
        createdSequence: event.sequence,
        completedSequence: null,
      };
      return next;
    }

    case "assignment_started": {
      const assignment = assignmentOrFail(state, event.assignmentId);
      if (assignment.status !== "planned") fail("invalid_assignment", "assignment is not planned");
      next.assignments[event.assignmentId] = { ...assignment, status: "in_progress" };
      for (const coverageId of assignment.coverageIds) {
        const coverage = coverageOrFail(state, coverageId);
        if (coverage.status !== "planned" || coverage.assignmentId !== null) {
          fail("invalid_coverage", "coverage unit is not ready to start");
        }
        next.coverageUnits[coverageId] = {
          ...coverage,
          status: "in_progress",
          assignmentId: assignment.assignmentId,
        };
      }
      return next;
    }

    case "assignment_completed": {
      const assignment = assignmentOrFail(state, event.assignmentId);
      if (assignment.status !== "in_progress") fail("invalid_assignment", "assignment is not in progress");
      const status =
        event.outcome.kind === "valid_result"
          ? "succeeded"
          : event.outcome.kind === "cancelled"
            ? "cancelled"
            : "failed";
      next.assignments[event.assignmentId] = {
        ...assignment,
        status,
        outcome: event.outcome,
        completedSequence: event.sequence,
      };
      return next;
    }

    case "candidate_registered": {
      if (state.status !== "hunting") fail("invalid_phase", "candidates register during hunting");
      requireText(event.candidateId, "candidateId");
      requireText(event.fingerprint, "fingerprint");
      if (state.candidates[event.candidateId]) fail("invalid_candidate", "duplicate candidateId");
      if (Object.values(state.candidates).some((candidate) => candidate.fingerprint === event.fingerprint)) {
        fail("invalid_candidate", "duplicate candidate fingerprint");
      }
      const assignment = assignmentOrFail(state, event.originAssignmentId);
      requireSucceededValidAssignment(assignment);
      if (assignment.kind !== "hunter") fail("invalid_assignment", "candidate origin must be a hunter");
      if (!assignment.coverageIds.includes(event.coverageId)) {
        fail("invalid_candidate", "candidate coverage is not owned by origin assignment");
      }
      const coverage = coverageOrFail(state, event.coverageId);
      if (coverage.assignmentId !== assignment.assignmentId || coverage.status !== "in_progress") {
        fail("invalid_coverage", "candidate coverage is not active under origin assignment");
      }
      next.candidates[event.candidateId] = {
        candidateId: event.candidateId,
        fingerprint: event.fingerprint,
        coverageId: event.coverageId,
        originAssignmentId: assignment.assignmentId,
        originWorkerId: assignment.workerId,
        verdict: "unvalidated",
        candidateVerifierAssignmentId: null,
        finalVerifierAssignmentId: null,
      };
      return next;
    }

    case "coverage_resolved": {
      if (state.status !== "hunting") fail("invalid_phase", "coverage resolves during hunting");
      const coverage = coverageOrFail(state, event.coverageId);
      const assignment = assignmentOrFail(state, event.assignmentId);
      requireSucceededValidAssignment(assignment);
      if (coverage.assignmentId !== assignment.assignmentId || coverage.status !== "in_progress") {
        fail("invalid_coverage", "coverage is not active under assignment");
      }
      if (event.resolution === "covered") {
        if (event.candidateIds.length !== 0 || event.unresolved.length !== 0) {
          fail("invalid_coverage", "covered unit cannot carry candidates or unresolved blockers");
        }
      } else if (event.resolution === "candidate") {
        if (event.candidateIds.length === 0) fail("invalid_coverage", "candidate coverage needs candidate ids");
        for (const candidateId of event.candidateIds) {
          const candidate = candidateOrFail(state, candidateId);
          if (candidate.coverageId !== event.coverageId) {
            fail("invalid_candidate", "candidate belongs to different coverage unit");
          }
        }
      } else if (event.candidateIds.length !== 0 || event.unresolved.length === 0) {
        fail("invalid_coverage", "blocked coverage needs unresolved reasons and no candidates");
      }
      next.coverageUnits[event.coverageId] = {
        ...coverage,
        status: event.resolution,
        candidateIds: [...event.candidateIds],
        unresolved: [...event.unresolved],
      };
      return next;
    }

    case "coverage_requeued": {
      if (state.status !== "hunting") fail("invalid_phase", "coverage requeues during hunting");
      requireText(event.reason, "reason");
      const coverage = coverageOrFail(state, event.coverageId);
      const assignment = assignmentOrFail(state, event.assignmentId);
      if (coverage.assignmentId !== assignment.assignmentId || coverage.status !== "in_progress") {
        fail("invalid_coverage", "coverage is not active under failed assignment");
      }
      if (assignment.status !== "failed" && assignment.status !== "cancelled") {
        fail("invalid_assignment", "only failed/cancelled assignment may requeue coverage");
      }
      next.coverageUnits[event.coverageId] = {
        ...coverage,
        status: "planned",
        assignmentId: null,
        candidateIds: [],
        unresolved: [],
      };
      return next;
    }

    case "coverage_classified": {
      requireText(event.reason, "reason");
      const coverage = coverageOrFail(state, event.coverageId);
      if (coverage.status === "in_progress") {
        const assignment = coverage.assignmentId ? assignmentOrFail(state, coverage.assignmentId) : null;
        if (!assignment || (assignment.status !== "failed" && assignment.status !== "cancelled")) {
          fail("invalid_coverage", "active coverage may classify only after failed/cancelled assignment");
        }
      } else if (coverage.status !== "planned") {
        fail("invalid_coverage", "coverage unit is already terminal");
      }
      next.coverageUnits[event.coverageId] = {
        ...coverage,
        status: event.status,
        assignmentId: null,
        candidateIds: [],
        unresolved: [event.reason],
      };
      return next;
    }

    case "evidence_requirement_opened": {
      requireText(event.requirementId, "requirementId");
      requireText(event.description, "description");
      if (state.evidenceRequirements[event.requirementId]) fail("invalid_evidence", "duplicate evidence requirement");
      if (event.candidateId !== null) candidateOrFail(state, event.candidateId);
      if (event.scope === "finding_handoff" && event.candidateId === null) {
        fail("invalid_evidence", "finding_handoff requirement must reference a candidate");
      }
      next.evidenceRequirements[event.requirementId] = {
        requirementId: event.requirementId,
        kind: event.kind,
        scope: event.scope,
        status: "open",
        candidateId: event.candidateId,
        description: event.description,
        resolution: null,
      };
      return next;
    }

    case "evidence_requirement_resolved": {
      requireText(event.resolution, "resolution");
      const requirement = requirementOrFail(state, event.requirementId);
      if (requirement.status !== "open") fail("invalid_evidence", "evidence requirement is already resolved");
      next.evidenceRequirements[event.requirementId] = {
        ...requirement,
        status: "resolved",
        resolution: event.resolution,
      };
      return next;
    }

    case "candidate_disposition_recorded": {
      if (state.status !== "candidate_validation") {
        fail("invalid_phase", "candidate dispositions record during candidate validation");
      }
      const candidate = candidateOrFail(state, event.candidateId);
      if (candidate.verdict !== "unvalidated") fail("invalid_candidate", "candidate already has disposition");
      const verifier = assignmentOrFail(state, event.verifierAssignmentId);
      requireSucceededValidAssignment(verifier);
      if (verifier.kind !== "candidate_verifier" || verifier.candidateId !== candidate.candidateId) {
        fail("invalid_assignment", "candidate disposition requires matching candidate verifier");
      }
      if (verifier.workerId === candidate.originWorkerId) {
        fail("independence_violation", "hunter cannot validate its own candidate");
      }
      if (event.verdict === "needs_validation") {
        const blocker = Object.values(state.evidenceRequirements).find(
          (requirement) =>
            requirement.candidateId === candidate.candidateId &&
            requirement.scope === "finding_handoff" &&
            requirement.status === "open",
        );
        if (!blocker) fail("invalid_evidence", "needs_validation disposition requires open handoff evidence");
      }
      next.candidates[event.candidateId] = {
        ...candidate,
        verdict: event.verdict,
        candidateVerifierAssignmentId: verifier.assignmentId,
      };
      return next;
    }

    case "candidate_final_verified": {
      if (state.status !== "record_verification") {
        fail("invalid_phase", "final verification occurs during record verification");
      }
      const candidate = candidateOrFail(state, event.candidateId);
      if (candidate.verdict !== "confirmed" && candidate.verdict !== "needs_validation") {
        fail("invalid_candidate", "only retained final records receive final verification");
      }
      if (candidate.finalVerifierAssignmentId !== null) {
        fail("invalid_candidate", "candidate already passed final verification");
      }
      const verifier = assignmentOrFail(state, event.verifierAssignmentId);
      requireSucceededValidAssignment(verifier);
      if (verifier.kind !== "record_verifier" || verifier.candidateId !== candidate.candidateId) {
        fail("invalid_assignment", "final verification requires matching record verifier");
      }
      const candidateVerifier = candidate.candidateVerifierAssignmentId
        ? assignmentOrFail(state, candidate.candidateVerifierAssignmentId)
        : null;
      if (
        verifier.workerId === candidate.originWorkerId ||
        (candidateVerifier && verifier.workerId === candidateVerifier.workerId)
      ) {
        fail("independence_violation", "final verifier must be fresh");
      }
      next.candidates[event.candidateId] = {
        ...candidate,
        finalVerifierAssignmentId: verifier.assignmentId,
      };
      return next;
    }

    case "run_completed": {
      verifyCompletion(state);
      next.status = "complete";
      next.terminalReason = null;
      return next;
    }

    case "run_marked_incomplete": {
      requireText(event.reason, "reason");
      next.status = "incomplete";
      next.terminalReason = event.reason;
      return next;
    }

    case "run_failed": {
      requireText(event.reason, "reason");
      next.status = "failed";
      next.terminalReason = event.reason;
      return next;
    }

    case "run_cancelled": {
      requireText(event.reason, "reason");
      next.status = "cancelled";
      next.terminalReason = event.reason;
      return next;
    }
  }
}
