export const DOMAIN_SCHEMA_VERSION = 3 as const;

export type DomainSchemaVersion = typeof DOMAIN_SCHEMA_VERSION;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export type AuditProfile = "quick" | "standard" | "deep";

export type ActiveRunStatus =
  | "created"
  | "reconnaissance"
  | "coverage_planning"
  | "hunting"
  | "candidate_validation"
  | "record_verification"
  | "reporting";

export type TerminalRunStatus = "complete" | "incomplete" | "cancelled" | "failed";
export type RunStatus = ActiveRunStatus | TerminalRunStatus;

export type WorkerOutcomeKind =
  | "valid_result"
  | "malformed_result"
  | "model_refusal"
  | "provider_error"
  | "timeout"
  | "permission_denied"
  | "sandbox_failure"
  | "orchestrator_interrupted"
  | "cancelled";

export interface AdapterRef {
  readonly adapter: string;
  readonly model: string | null;
  readonly metadata: Readonly<Record<string, JsonValue>>;
}

export interface WorkerOutcome {
  readonly kind: WorkerOutcomeKind;
  readonly detail: string | null;
  readonly adapter: AdapterRef | null;
}

export type AssignmentKind =
  | "recon"
  | "hunter"
  | "coverage_critic"
  | "candidate_verifier"
  | "record_verifier";

export type AssignmentStatus = "planned" | "in_progress" | "succeeded" | "failed" | "cancelled";

export interface WorkerAssignment {
  readonly assignmentId: string;
  readonly kind: AssignmentKind;
  readonly workerId: string;
  readonly coverageIds: readonly string[];
  readonly candidateId: string | null;
  readonly status: AssignmentStatus;
  readonly taskReceipt: JsonValue;
  readonly outcome: WorkerOutcome | null;
  readonly resultReceipt: JsonValue | null;
  readonly createdSequence: number;
  readonly completedSequence: number | null;
}

export type CoverageStatus =
  | "planned"
  | "in_progress"
  | "covered"
  | "candidate"
  | "blocked"
  | "deferred"
  | "out_of_scope"
  | "not_applicable";

export type CoverageCheckMethod = "source" | "local";

export interface CoverageCheck {
  readonly invariant: string;
  readonly method: CoverageCheckMethod;
  readonly result: string;
  readonly artifactRef: string | null;
}

export interface CoverageUnit {
  readonly coverageId: string;
  readonly status: CoverageStatus;
  readonly assignmentId: string | null;
  readonly candidateIds: readonly string[];
  readonly reviewedPaths: readonly string[];
  readonly checks: readonly CoverageCheck[];
  readonly unresolved: readonly string[];
}

export interface SourceReference {
  readonly file: string;
  readonly line: number | null;
  readonly scope: string;
  readonly description: string;
}

export interface CandidateClaim {
  readonly title: string;
  readonly description: string;
  readonly claimedRootCause: string;
  readonly intendedBehavior: string;
  readonly trace: readonly SourceReference[];
  readonly evidence: readonly SourceReference[];
  readonly conditions: readonly string[];
}

export type CandidateVerdict = "unvalidated" | "confirmed" | "needs_validation" | "rejected";

export interface Candidate {
  readonly candidateId: string;
  readonly fingerprint: string;
  readonly originCoverageId: string;
  readonly coverageIds: readonly string[];
  readonly originAssignmentId: string;
  readonly originWorkerId: string;
  readonly claim: CandidateClaim;
  readonly verdict: CandidateVerdict;
  readonly candidateVerifierAssignmentId: string | null;
  readonly finalVerifierAssignmentId: string | null;
}

export type EvidenceRequirementKind =
  | "sandbox_capability"
  | "deployment_fact"
  | "runtime_fact"
  | "identity_fact"
  | "advisory_fact"
  | "provider_readiness"
  | "artifact_integrity";

export type EvidenceRequirementScope = "run_blocking" | "finding_handoff";
export type EvidenceRequirementStatus = "open" | "resolved";

export interface EvidenceRequirement {
  readonly requirementId: string;
  readonly kind: EvidenceRequirementKind;
  readonly scope: EvidenceRequirementScope;
  readonly status: EvidenceRequirementStatus;
  readonly candidateId: string | null;
  readonly description: string;
  readonly resolution: string | null;
}

export interface AuditBudget {
  readonly maxWorkerInvocations: number | null;
  readonly spentWorkerInvocations: number;
}

export interface AuditRunState {
  schemaVersion: DomainSchemaVersion;
  runId: string;
  sourceSnapshotId: string;
  profile: AuditProfile;
  scopePaths: readonly string[];
  status: RunStatus;
  sequence: number;
  budget: AuditBudget;
  assignments: Record<string, WorkerAssignment>;
  coverageUnits: Record<string, CoverageUnit>;
  candidates: Record<string, Candidate>;
  evidenceRequirements: Record<string, EvidenceRequirement>;
  incompleteReasons: readonly string[];
  terminalReason: string | null;
}

interface EventBase<T extends string> {
  readonly schemaVersion: DomainSchemaVersion;
  readonly eventId: string;
  readonly runId: string;
  readonly sequence: number;
  readonly type: T;
}

export interface RunCreatedEvent extends EventBase<"run_created"> {
  readonly sourceSnapshotId: string;
  readonly profile: AuditProfile;
  readonly scopePaths: readonly string[];
  readonly maxWorkerInvocations: number | null;
}

export interface PhaseAdvancedEvent extends EventBase<"phase_advanced"> {
  readonly to: ActiveRunStatus;
}

export interface CoverageUnitRegisteredEvent extends EventBase<"coverage_unit_registered"> {
  readonly coverageId: string;
}

export interface AssignmentCreatedEvent extends EventBase<"assignment_created"> {
  readonly assignmentId: string;
  readonly kind: AssignmentKind;
  readonly workerId: string;
  readonly coverageIds: readonly string[];
  readonly candidateId: string | null;
  readonly taskReceipt: JsonValue;
}

export interface AssignmentStartedEvent extends EventBase<"assignment_started"> {
  readonly assignmentId: string;
}

export interface AssignmentCompletedEvent extends EventBase<"assignment_completed"> {
  readonly assignmentId: string;
  readonly outcome: WorkerOutcome;
  readonly resultReceipt: JsonValue | null;
}

export interface CoverageResolvedEvent extends EventBase<"coverage_resolved"> {
  readonly coverageId: string;
  readonly assignmentId: string;
  readonly resolution: "covered" | "candidate" | "blocked";
  readonly candidateIds: readonly string[];
  readonly reviewedPaths: readonly string[];
  readonly checks: readonly CoverageCheck[];
  readonly unresolved: readonly string[];
}

export interface CoverageRequeuedEvent extends EventBase<"coverage_requeued"> {
  readonly coverageId: string;
  readonly assignmentId: string;
  readonly reason: string;
}

export interface CoverageReopenedEvent extends EventBase<"coverage_reopened"> {
  readonly coverageId: string;
  readonly criticAssignmentId: string;
  readonly reason: string;
}

export interface CoverageUnitAddedByCriticEvent
  extends EventBase<"coverage_unit_added_by_critic"> {
  readonly coverageId: string;
  readonly criticAssignmentId: string;
  readonly reason: string;
}

export interface CoverageClassifiedEvent extends EventBase<"coverage_classified"> {
  readonly coverageId: string;
  readonly status: "deferred" | "out_of_scope" | "not_applicable";
  readonly reason: string;
}

export interface CandidateRegisteredEvent extends EventBase<"candidate_registered"> {
  readonly candidateId: string;
  readonly fingerprint: string;
  readonly coverageId: string;
  readonly originAssignmentId: string;
  readonly claim: CandidateClaim;
}

export interface CandidateLinkedToCoverageEvent extends EventBase<"candidate_linked_to_coverage"> {
  readonly candidateId: string;
  readonly coverageId: string;
  readonly assignmentId: string;
}

export interface CandidateDispositionRecordedEvent extends EventBase<"candidate_disposition_recorded"> {
  readonly candidateId: string;
  readonly verdict: Exclude<CandidateVerdict, "unvalidated">;
  readonly verifierAssignmentId: string;
}

export interface CandidateFinalVerifiedEvent extends EventBase<"candidate_final_verified"> {
  readonly candidateId: string;
  readonly verifierAssignmentId: string;
}

export interface EvidenceRequirementOpenedEvent extends EventBase<"evidence_requirement_opened"> {
  readonly requirementId: string;
  readonly kind: EvidenceRequirementKind;
  readonly scope: EvidenceRequirementScope;
  readonly candidateId: string | null;
  readonly description: string;
}

export interface EvidenceRequirementResolvedEvent extends EventBase<"evidence_requirement_resolved"> {
  readonly requirementId: string;
  readonly resolution: string;
}

export interface RunIncompleteReasonRecordedEvent
  extends EventBase<"run_incomplete_reason_recorded"> {
  readonly reason: string;
}

export interface RunCompletedEvent extends EventBase<"run_completed"> {}

export interface RunMarkedIncompleteEvent extends EventBase<"run_marked_incomplete"> {
  readonly reason: string;
}

export interface RunFailedEvent extends EventBase<"run_failed"> {
  readonly reason: string;
}

export interface RunCancelledEvent extends EventBase<"run_cancelled"> {
  readonly reason: string;
}

export type AuditEvent =
  | RunCreatedEvent
  | PhaseAdvancedEvent
  | CoverageUnitRegisteredEvent
  | AssignmentCreatedEvent
  | AssignmentStartedEvent
  | AssignmentCompletedEvent
  | CoverageResolvedEvent
  | CoverageRequeuedEvent
  | CoverageReopenedEvent
  | CoverageUnitAddedByCriticEvent
  | CoverageClassifiedEvent
  | CandidateRegisteredEvent
  | CandidateLinkedToCoverageEvent
  | CandidateDispositionRecordedEvent
  | CandidateFinalVerifiedEvent
  | EvidenceRequirementOpenedEvent
  | EvidenceRequirementResolvedEvent
  | RunIncompleteReasonRecordedEvent
  | RunCompletedEvent
  | RunMarkedIncompleteEvent
  | RunFailedEvent
  | RunCancelledEvent;
