import type {
  AdapterRef,
  AuditProfile,
  CandidateClaim,
  CoverageCheck,
  EvidenceRequirementKind,
  WorkerOutcome,
  WorkerOutcomeKind,
} from "../domain/contracts";

export const ORCHESTRATION_SCHEMA_VERSION = 2 as const;
export type OrchestrationSchemaVersion = typeof ORCHESTRATION_SCHEMA_VERSION;

export interface AuditRunRequest {
  readonly runId: string;
  readonly sourceSnapshotId: string;
  readonly profile: AuditProfile;
  readonly scopePaths: readonly string[];
  readonly maxWorkerInvocations: number | null;
}

export interface IdSource {
  next(prefix: string): string;
}

interface WorkerTaskBase<T extends string> {
  readonly schemaVersion: OrchestrationSchemaVersion;
  readonly kind: T;
  readonly runId: string;
  readonly assignmentId: string;
  readonly workerId: string;
  readonly sourceSnapshotId: string;
  readonly profile: AuditProfile;
}

export interface ReconWorkerTask extends WorkerTaskBase<"recon"> {
  readonly scopePaths: readonly string[];
}

export interface HunterWorkerTask extends WorkerTaskBase<"hunter"> {
  readonly coverageId: string;
}

export interface CandidateVerifierWorkerTask extends WorkerTaskBase<"candidate_verifier"> {
  readonly candidateId: string;
  readonly fingerprint: string;
  readonly coverageIds: readonly string[];
  readonly claim: CandidateClaim;
}

export type WorkerTask =
  | ReconWorkerTask
  | HunterWorkerTask
  | CandidateVerifierWorkerTask;

export interface WorkerAdapter {
  readonly ref: AdapterRef;
  execute(task: WorkerTask): Promise<unknown>;
}

export interface ReconWorkerResult {
  readonly kind: "recon_result";
  readonly coverageIds: readonly string[];
}

export interface HunterEvidence {
  readonly reviewedPaths: readonly string[];
  readonly checks: readonly CoverageCheck[];
}

export interface CandidateDraft {
  readonly fingerprint: string;
  readonly claim: CandidateClaim;
}

export type HunterWorkerResult =
  | (HunterEvidence & {
      readonly kind: "hunter_result";
      readonly resolution: "covered";
    })
  | (HunterEvidence & {
      readonly kind: "hunter_result";
      readonly resolution: "candidate";
      readonly candidates: readonly CandidateDraft[];
    })
  | (HunterEvidence & {
      readonly kind: "hunter_result";
      readonly resolution: "blocked";
      readonly unresolved: readonly string[];
    });

export interface CandidateEvidenceNeed {
  readonly kind: EvidenceRequirementKind;
  readonly description: string;
}

export interface CandidateValidationResult {
  readonly kind: "candidate_validation_result";
  readonly verdict: "confirmed" | "needs_validation" | "rejected";
  readonly evidenceRequirements: readonly CandidateEvidenceNeed[];
}

export type WorkerResult =
  | ReconWorkerResult
  | HunterWorkerResult
  | CandidateValidationResult;

export type FailureWorkerOutcomeKind = Exclude<WorkerOutcomeKind, "valid_result">;

export type ParsedWorkerObservation =
  | {
      readonly outcome: WorkerOutcome & { readonly kind: "valid_result" };
      readonly result: WorkerResult;
    }
  | {
      readonly outcome: WorkerOutcome & { readonly kind: FailureWorkerOutcomeKind };
      readonly result: null;
    };
