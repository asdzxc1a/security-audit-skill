import type {
  AdapterRef,
  AuditProfile,
  CandidateVerdict,
  CoverageStatus,
  EvidenceRequirementKind,
  WorkerOutcome,
  WorkerOutcomeKind,
} from "../domain/contracts";

export const ORCHESTRATION_SCHEMA_VERSION = 1 as const;
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
}

export interface CoverageCriticWorkerTask extends WorkerTaskBase<"coverage_critic"> {
  readonly round: "post_wave" | "final_clean";
  readonly coverage: readonly {
    readonly coverageId: string;
    readonly status: CoverageStatus;
  }[];
}

export interface RecordVerifierWorkerTask extends WorkerTaskBase<"record_verifier"> {
  readonly candidateId: string;
  readonly fingerprint: string;
  readonly verdict: Exclude<CandidateVerdict, "unvalidated" | "rejected">;
}

export type WorkerTask =
  | ReconWorkerTask
  | HunterWorkerTask
  | CandidateVerifierWorkerTask
  | CoverageCriticWorkerTask
  | RecordVerifierWorkerTask;

export interface WorkerAdapter {
  readonly ref: AdapterRef;
  execute(task: WorkerTask): Promise<unknown>;
}

export interface ReconWorkerResult {
  readonly kind: "recon_result";
  readonly coverageIds: readonly string[];
}

export type HunterWorkerResult =
  | {
      readonly kind: "hunter_result";
      readonly resolution: "covered";
    }
  | {
      readonly kind: "hunter_result";
      readonly resolution: "candidate";
      readonly candidateFingerprints: readonly string[];
    }
  | {
      readonly kind: "hunter_result";
      readonly resolution: "blocked";
      readonly unresolved: readonly string[];
    };

export interface CandidateEvidenceNeed {
  readonly kind: EvidenceRequirementKind;
  readonly description: string;
}

export interface CandidateValidationResult {
  readonly kind: "candidate_validation_result";
  readonly verdict: "confirmed" | "needs_validation" | "rejected";
  readonly evidenceRequirements: readonly CandidateEvidenceNeed[];
}

export interface CoverageCriticResult {
  readonly kind: "coverage_critic_result";
  readonly reassignCoverageIds: readonly string[];
}

export interface RecordVerificationResult {
  readonly kind: "record_verification_result";
  readonly verdict: "verified" | "needs_revision";
  readonly reason: string | null;
}

export type WorkerResult =
  | ReconWorkerResult
  | HunterWorkerResult
  | CandidateValidationResult
  | CoverageCriticResult
  | RecordVerificationResult;

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
