import {
  DOMAIN_SCHEMA_VERSION,
  type ActiveRunStatus,
  type AssignmentKind,
  type AuditEvent,
  type AuditRunState,
  type Candidate,
  type CandidateClaim,
  type CoverageCheck,
  type CoverageUnit,
  type EvidenceRequirement,
  type SourceReference,
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

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

const MAX_TEXT_BYTES = 16 * 1024;
const MAX_ID_BYTES = 512;
const MAX_LIST_ITEMS = 256;
const MAX_SOURCE_REFERENCES = 64;
const MAX_COVERAGE_CHECKS = 64;
const MAX_INCOMPLETE_REASONS = 128;
const INCOMPLETE_REASON_OVERFLOW = "additional incomplete reasons omitted";

function utf8Bytes(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function requireText(
  value: string,
  label: string,
  maxBytes: number = MAX_TEXT_BYTES,
): void {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    value.length === 0 ||
    utf8Bytes(value) > maxBytes
  ) {
    fail("invalid_event", label + " must be bounded non-empty trimmed text");
  }
}

function requireId(value: string, label: string): void {
  requireText(value, label, MAX_ID_BYTES);
}

function requireBoundedList<T>(
  value: readonly T[],
  label: string,
  maxItems: number = MAX_LIST_ITEMS,
): void {
  if (!Array.isArray(value) || value.length > maxItems) {
    fail("invalid_event", label + " exceeds item limit");
  }
}

function requireSafeRelativePath(value: string, label: string): void {
  requireText(value, label, 4096);
  if (
    value.startsWith("/") ||
    value.includes("\\") ||
    /^[A-Za-z]:/.test(value) ||
    value.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    fail("invalid_event", label + " must be a safe repository-relative path");
  }
}

function validateSourceReference(reference: SourceReference, label: string): void {
  if (!isObject(reference)) fail("invalid_candidate", label + " must be an object");
  requireSafeRelativePath(reference.file, label + ".file");
  if (
    reference.line !== null &&
    (!Number.isInteger(reference.line) || reference.line < 1 || reference.line > 10_000_000)
  ) {
    fail("invalid_event", label + ".line must be null or a positive bounded integer");
  }
  requireText(reference.scope, label + ".scope", 4096);
  requireText(reference.description, label + ".description");
}

function validateCandidateClaim(claim: CandidateClaim): void {
  if (!isObject(claim)) fail("invalid_candidate", "candidate claim must be an object");
  requireText(claim.title, "claim.title", 4096);
  requireText(claim.description, "claim.description");
  requireText(claim.claimedRootCause, "claim.claimedRootCause");
  requireText(claim.intendedBehavior, "claim.intendedBehavior");
  requireBoundedList(claim.trace, "claim.trace", MAX_SOURCE_REFERENCES);
  requireBoundedList(claim.evidence, "claim.evidence", MAX_SOURCE_REFERENCES);
  requireBoundedList(claim.conditions, "claim.conditions", 64);
  if (claim.trace.length === 0 || claim.evidence.length === 0) {
    fail("invalid_candidate", "candidate claim requires trace and evidence");
  }
  claim.trace.forEach((entry, index) =>
    validateSourceReference(entry, "claim.trace[" + index + "]"),
  );
  claim.evidence.forEach((entry, index) =>
    validateSourceReference(entry, "claim.evidence[" + index + "]"),
  );
  claim.conditions.forEach((condition, index) =>
    requireText(condition, "claim.conditions[" + index + "]"),
  );
}

function validateCoverageEvidence(
  reviewedPaths: readonly string[],
  checks: readonly CoverageCheck[],
): void {
  requireBoundedList(reviewedPaths, "reviewedPaths", MAX_LIST_ITEMS);
  requireBoundedList(checks, "checks", MAX_COVERAGE_CHECKS);
  if (reviewedPaths.length === 0 || checks.length === 0) {
    fail("invalid_evidence", "resolved coverage requires reviewed paths and checks");
  }
  if (new Set(reviewedPaths).size !== reviewedPaths.length) {
    fail("invalid_evidence", "reviewedPaths must be unique");
  }
  reviewedPaths.forEach((reviewedPath, index) =>
    requireSafeRelativePath(reviewedPath, "reviewedPaths[" + index + "]"),
  );
  checks.forEach((check, index) => {
    if (!isObject(check)) fail("invalid_evidence", "coverage check must be an object");
    requireText(check.invariant, "checks[" + index + "].invariant");
    requireText(check.result, "checks[" + index + "].result");
    if (check.method !== "source" && check.method !== "local") {
      fail("invalid_evidence", "coverage check method is invalid");
    }
    if (check.method === "source" && check.artifactRef !== null) {
      fail("invalid_evidence", "source coverage check must not carry artifactRef");
    }
    if (check.method === "local") {
      if (check.artifactRef === null) {
        fail("invalid_evidence", "local coverage check requires artifactRef");
      }
      requireText(check.artifactRef, "checks[" + index + "].artifactRef", 4096);
    }
  });
}

function validateWorkerOutcome(outcome: WorkerAssignment["outcome"]): void {
  if (!isObject(outcome)) fail("invalid_assignment", "assignment outcome must be an object");
  const kinds = new Set([
    "valid_result",
    "malformed_result",
    "model_refusal",
    "provider_error",
    "timeout",
    "permission_denied",
    "sandbox_failure",
    "orchestrator_interrupted",
    "cancelled",
  ]);
  if (typeof outcome.kind !== "string" || !kinds.has(outcome.kind)) {
    fail("invalid_assignment", "assignment outcome kind is invalid");
  }
  if (outcome.detail !== null) requireText(outcome.detail, "outcome.detail", 4096);
  if (outcome.adapter !== null) {
    if (!isObject(outcome.adapter)) fail("invalid_assignment", "outcome adapter must be an object");
    requireText(outcome.adapter.adapter, "outcome.adapter.adapter", MAX_ID_BYTES);
    if (outcome.adapter.model !== null) {
      requireText(outcome.adapter.model, "outcome.adapter.model", MAX_ID_BYTES);
    }
    let serialized: string;
    try {
      serialized = JSON.stringify(outcome.adapter.metadata);
    } catch {
      fail("invalid_assignment", "outcome adapter metadata must be JSON-serializable");
    }
    if (serialized === undefined || Buffer.byteLength(serialized, "utf8") > 32 * 1024) {
      fail("invalid_assignment", "outcome adapter metadata exceeds byte limit");
    }
  }
}

function validateBoundedJsonReceipt(value: unknown, label: string): void {
  if (!isObject(value)) {
    fail("invalid_assignment", label + " must be an object");
  }
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    fail("invalid_assignment", label + " must be JSON-serializable");
  }
  if (
    serialized === undefined ||
    Buffer.byteLength(serialized, "utf8") > 256 * 1024
  ) {
    fail("invalid_assignment", label + " exceeds byte limit");
  }
}

function validateReceiptEnvelope(
  value: unknown,
  payloadKey: "task" | "result",
  label: string,
): void {
  validateBoundedJsonReceipt(value, label);
  if (
    !isObject(value) ||
    typeof value.schemaVersion !== "number" ||
    !Number.isSafeInteger(value.schemaVersion) ||
    value.schemaVersion < 1 ||
    !Object.prototype.hasOwnProperty.call(value, payloadKey) ||
    !isObject(value[payloadKey])
  ) {
    fail("invalid_assignment", label + " has invalid envelope shape");
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

function hasOpenFindingHandoff(state: AuditRunState, candidateId: string): boolean {
  return Object.values(state.evidenceRequirements).some(
    (requirement) =>
      requirement.candidateId === candidateId &&
      requirement.scope === "finding_handoff" &&
      requirement.status === "open",
  );
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
      if (candidate.verdict === "needs_validation" && !hasOpenFindingHandoff(state, candidate.candidateId)) {
        fail(
          "invalid_evidence",
          "needs_validation candidate " + candidate.candidateId + " requires an open handoff requirement",
        );
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
      if (candidate.verdict === "needs_validation" && !hasOpenFindingHandoff(state, candidate.candidateId)) {
        fail(
          "invalid_evidence",
          "needs_validation candidate " + candidate.candidateId + " lost its open handoff requirement",
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
  if (state.incompleteReasons.length > 0) {
    fail("unresolved_work", "run cannot complete with persisted incomplete reasons");
  }
  for (const coverage of Object.values(state.coverageUnits)) {
    if (
      coverage.status === "planned" ||
      coverage.status === "in_progress" ||
      coverage.status === "blocked" ||
      coverage.status === "deferred"
    ) {
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
    if (candidate.verdict === "needs_validation" && !hasOpenFindingHandoff(state, candidate.candidateId)) {
      fail(
        "invalid_evidence",
        "run cannot complete after needs_validation handoff evidence is closed without revalidation",
      );
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
  requireId(event.eventId, "eventId");
  requireId(event.runId, "runId");
  requireId(event.sourceSnapshotId, "sourceSnapshotId");
  if (event.profile !== "quick" && event.profile !== "standard" && event.profile !== "deep") {
    fail("invalid_event", "profile is invalid");
  }
  requireBoundedList(event.scopePaths, "scopePaths", 128);
  if (new Set(event.scopePaths).size !== event.scopePaths.length) {
    fail("invalid_event", "scopePaths must be unique");
  }
  event.scopePaths.forEach((scopePath, index) =>
    requireSafeRelativePath(scopePath, "scopePaths[" + index + "]"),
  );
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
    incompleteReasons: [],
    terminalReason: null,
  };
}

export function reduceAuditState(state: AuditRunState | null, event: AuditEvent): AuditRunState {
  if (state === null) {
    if (event.type !== "run_created") fail("invalid_event", "first event must be run_created");
    return createRun(event);
  }

  if (event.schemaVersion !== DOMAIN_SCHEMA_VERSION) fail("invalid_event", "unsupported event schema version");
  requireId(event.eventId, "eventId");
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
      requireId(event.coverageId, "coverageId");
      if (state.coverageUnits[event.coverageId]) fail("invalid_coverage", "duplicate coverage unit");
      next.coverageUnits[event.coverageId] = {
        coverageId: event.coverageId,
        status: "planned",
        assignmentId: null,
        candidateIds: [],
        reviewedPaths: [],
        checks: [],
        unresolved: [],
      };
      return next;
    }

    case "assignment_created": {
      if (ASSIGNMENT_PHASE[event.kind] !== state.status) {
        fail("invalid_phase", event.kind + " assignment is not allowed during " + state.status);
      }
      requireId(event.assignmentId, "assignmentId");
      requireId(event.workerId, "workerId");
      if (state.assignments[event.assignmentId]) fail("invalid_assignment", "duplicate assignment");
      validateReceiptEnvelope(
        event.taskReceipt,
        "task",
        "normalized worker task receipt",
      );
      if (new Set(event.coverageIds).size !== event.coverageIds.length) {
        fail("invalid_assignment", "assignment coverageIds must be unique");
      }

      if (event.kind === "hunter" && event.coverageIds.length === 0) {
        fail("invalid_assignment", "hunter assignment requires coverage units");
      }
      if (
        event.kind === "coverage_critic" &&
        Object.values(state.assignments).some(
          (assignment) =>
            assignment.kind === "coverage_critic" &&
            assignment.workerId === event.workerId,
        )
      ) {
        fail("independence_violation", "each coverage critic assignment requires a fresh worker");
      }
      if (event.kind !== "hunter" && event.coverageIds.length !== 0) {
        fail("invalid_assignment", event.kind + " assignment must not own coverage units");
      }
      if (event.kind === "candidate_verifier" || event.kind === "record_verifier") {
        if (event.coverageIds.length !== 0) fail("invalid_assignment", "verifier assignment must not own coverage");
        if (event.candidateId === null) fail("invalid_assignment", "verifier assignment requires candidateId");
        const candidate = candidateOrFail(state, event.candidateId);
        if (event.kind === "candidate_verifier") {
          if (candidate.verdict !== "unvalidated") {
            fail("invalid_candidate", "candidate verifier requires unvalidated candidate");
          }
          if (event.workerId === candidate.originWorkerId) {
            fail("independence_violation", "hunter cannot be assigned to validate its own candidate");
          }
        }
        if (event.kind === "record_verifier") {
          if (candidate.verdict !== "confirmed" && candidate.verdict !== "needs_validation") {
            fail("invalid_candidate", "record verifier requires a retained final record");
          }
          const candidateVerifier = candidate.candidateVerifierAssignmentId
            ? assignmentOrFail(state, candidate.candidateVerifierAssignmentId)
            : null;
          if (
            event.workerId === candidate.originWorkerId ||
            (candidateVerifier && event.workerId === candidateVerifier.workerId)
          ) {
            fail("independence_violation", "final verifier assignment must use a fresh worker");
          }
        }
      } else if (event.candidateId !== null) {
        fail("invalid_assignment", event.kind + " assignment must not carry candidateId");
      }

      for (const coverageId of event.coverageIds) {
        const coverage = coverageOrFail(state, coverageId);
        if (coverage.status !== "planned" || coverage.assignmentId !== null) {
          fail("invalid_coverage", "coverage unit " + coverageId + " is not available for assignment");
        }
        if (
          event.kind === "hunter" &&
          Object.values(state.assignments).some(
            (assignment) =>
              assignment.kind === "hunter" &&
              assignment.workerId === event.workerId &&
              assignment.coverageIds.includes(coverageId),
          )
        ) {
          fail(
            "independence_violation",
            "reassigned coverage " + coverageId + " requires a fresh hunter worker",
          );
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
        taskReceipt: structuredClone(event.taskReceipt),
        outcome: null,
        resultReceipt: null,
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
      validateWorkerOutcome(event.outcome);
      if (event.outcome.kind === "valid_result") {
        if (event.resultReceipt === null) {
          fail("invalid_assignment", "valid_result assignment requires normalized result receipt");
        }
        validateReceiptEnvelope(
          event.resultReceipt,
          "result",
          "normalized worker result receipt",
        );
      } else if (event.resultReceipt !== null) {
        fail("invalid_assignment", "failed/cancelled assignment must not carry result receipt");
      }
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
        resultReceipt:
          event.resultReceipt === null ? null : structuredClone(event.resultReceipt),
        completedSequence: event.sequence,
      };
      return next;
    }

    case "candidate_registered": {
      if (state.status !== "hunting") fail("invalid_phase", "candidates register during hunting");
      requireId(event.candidateId, "candidateId");
      requireText(event.fingerprint, "fingerprint", 2048);
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
      validateCandidateClaim(event.claim);
      next.candidates[event.candidateId] = {
        candidateId: event.candidateId,
        fingerprint: event.fingerprint,
        originCoverageId: event.coverageId,
        coverageIds: [event.coverageId],
        originAssignmentId: assignment.assignmentId,
        originWorkerId: assignment.workerId,
        claim: structuredClone(event.claim),
        verdict: "unvalidated",
        candidateVerifierAssignmentId: null,
        finalVerifierAssignmentId: null,
      };
      return next;
    }

    case "candidate_linked_to_coverage": {
      if (state.status !== "hunting") fail("invalid_phase", "candidate links occur during hunting");
      const candidate = candidateOrFail(state, event.candidateId);
      const coverage = coverageOrFail(state, event.coverageId);
      const assignment = assignmentOrFail(state, event.assignmentId);
      requireSucceededValidAssignment(assignment);
      if (assignment.kind !== "hunter" || !assignment.coverageIds.includes(event.coverageId)) {
        fail("invalid_assignment", "candidate coverage link requires owning hunter assignment");
      }
      if (coverage.assignmentId !== assignment.assignmentId || coverage.status !== "in_progress") {
        fail("invalid_coverage", "candidate link coverage is not active under assignment");
      }
      if (candidate.coverageIds.includes(event.coverageId)) {
        fail("invalid_candidate", "candidate is already linked to coverage unit");
      }
      next.candidates[event.candidateId] = {
        ...candidate,
        coverageIds: [...candidate.coverageIds, event.coverageId],
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
      if (new Set(event.candidateIds).size !== event.candidateIds.length) {
        fail("invalid_coverage", "coverage candidateIds must be unique");
      }
      validateCoverageEvidence(event.reviewedPaths, event.checks);
      requireBoundedList(event.unresolved, "unresolved", 64);
      event.unresolved.forEach((reason, index) =>
        requireText(reason, "unresolved[" + index + "]"),
      );
      if (event.resolution === "covered") {
        if (event.candidateIds.length !== 0 || event.unresolved.length !== 0) {
          fail("invalid_coverage", "covered unit cannot carry candidates or unresolved blockers");
        }
      } else if (event.resolution === "candidate") {
        if (event.candidateIds.length === 0) fail("invalid_coverage", "candidate coverage needs candidate ids");
        for (const candidateId of event.candidateIds) {
          const candidate = candidateOrFail(state, candidateId);
          if (!candidate.coverageIds.includes(event.coverageId)) {
            fail("invalid_candidate", "candidate is not linked to coverage unit");
          }
        }
      } else if (event.candidateIds.length !== 0 || event.unresolved.length === 0) {
        fail("invalid_coverage", "blocked coverage needs unresolved reasons and no candidates");
      }
      next.coverageUnits[event.coverageId] = {
        ...coverage,
        status: event.resolution,
        candidateIds: [...event.candidateIds],
        reviewedPaths: [...event.reviewedPaths],
        checks: event.checks.map((check) => ({ ...check })),
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
        reviewedPaths: [],
        checks: [],
        unresolved: [],
      };
      return next;
    }

    case "coverage_unit_added_by_critic": {
      if (state.status !== "hunting") {
        fail("invalid_phase", "critic coverage units add during hunting");
      }
      requireId(event.coverageId, "coverageId");
      requireText(event.reason, "reason");
      if (state.coverageUnits[event.coverageId]) {
        fail("invalid_coverage", "critic cannot add duplicate coverage unit");
      }
      const critic = assignmentOrFail(state, event.criticAssignmentId);
      requireSucceededValidAssignment(critic);
      if (critic.kind !== "coverage_critic") {
        fail("invalid_assignment", "coverage addition requires a successful coverage critic");
      }
      next.coverageUnits[event.coverageId] = {
        coverageId: event.coverageId,
        status: "planned",
        assignmentId: null,
        candidateIds: [],
        reviewedPaths: [],
        checks: [],
        unresolved: [],
      };
      return next;
    }

    case "coverage_reopened": {
      if (state.status !== "hunting") fail("invalid_phase", "coverage reopens during hunting");
      requireText(event.reason, "reason");
      const coverage = coverageOrFail(state, event.coverageId);
      if (coverage.status !== "covered" || coverage.assignmentId === null) {
        fail("invalid_coverage", "only covered assigned coverage may be reopened");
      }
      const critic = assignmentOrFail(state, event.criticAssignmentId);
      requireSucceededValidAssignment(critic);
      if (critic.kind !== "coverage_critic") {
        fail("invalid_assignment", "coverage reopen requires a successful coverage critic");
      }
      const priorHunter = assignmentOrFail(state, coverage.assignmentId);
      if (priorHunter.kind !== "hunter") {
        fail("invalid_assignment", "reopened coverage must have been produced by a hunter");
      }
      if (critic.workerId === priorHunter.workerId) {
        fail("independence_violation", "coverage critic must be independent from the prior hunter");
      }
      next.coverageUnits[event.coverageId] = {
        ...coverage,
        status: "planned",
        assignmentId: null,
        candidateIds: [],
        reviewedPaths: [],
        checks: [],
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
        reviewedPaths: [],
        checks: [],
        unresolved: [event.reason],
      };
      return next;
    }

    case "evidence_requirement_opened": {
      requireId(event.requirementId, "requirementId");
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
      if (requirement.scope === "finding_handoff" && requirement.candidateId !== null) {
        const candidate = candidateOrFail(state, requirement.candidateId);
        if (candidate.verdict === "needs_validation") {
          fail(
            "invalid_evidence",
            "needs_validation handoff evidence cannot resolve without a candidate revalidation transition",
          );
        }
      }
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
      if (event.verdict === "needs_validation" && !hasOpenFindingHandoff(state, candidate.candidateId)) {
        fail("invalid_evidence", "needs_validation disposition requires open handoff evidence");
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
      if (candidate.verdict === "needs_validation" && !hasOpenFindingHandoff(state, candidate.candidateId)) {
        fail("invalid_evidence", "needs_validation final verification requires an open handoff requirement");
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

    case "run_incomplete_reason_recorded": {
      requireText(event.reason, "reason");
      if (state.incompleteReasons.includes(event.reason)) return next;

      if (state.incompleteReasons.length < MAX_INCOMPLETE_REASONS - 1) {
        next.incompleteReasons = [...state.incompleteReasons, event.reason];
        return next;
      }

      if (!state.incompleteReasons.includes(INCOMPLETE_REASON_OVERFLOW)) {
        next.incompleteReasons = [
          ...state.incompleteReasons.slice(0, MAX_INCOMPLETE_REASONS - 1),
          INCOMPLETE_REASON_OVERFLOW,
        ];
      }
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

    default: {
      const unexpected: never = event;
      return fail(
        "invalid_event",
        "unsupported event type " + String((unexpected as { type?: unknown }).type),
      );
    }
  }
}


export function replayAuditEvents(events: readonly AuditEvent[]): AuditRunState | null {
  let state: AuditRunState | null = null;
  for (const event of events) {
    state = reduceAuditState(state, event);
  }
  return state;
}
