import type {
  AdapterRef,
  EvidenceRequirementKind,
  WorkerOutcome,
} from "../domain/contracts";
import type {
  CandidateEvidenceNeed,
  CandidateValidationResult,
  CoverageCriticResult,
  CoverageCriticWorkerTask,
  FailureWorkerOutcomeKind,
  HunterWorkerResult,
  RecordVerificationResult,
  ParsedWorkerObservation,
  ReconWorkerResult,
  WorkerResult,
  WorkerTask,
} from "./contracts";

const FAILURE_KINDS = new Set<FailureWorkerOutcomeKind>([
  "malformed_result",
  "model_refusal",
  "provider_error",
  "timeout",
  "permission_denied",
  "sandbox_failure",
  "cancelled",
]);

const EVIDENCE_KINDS = new Set<EvidenceRequirementKind>([
  "sandbox_capability",
  "deployment_fact",
  "runtime_fact",
  "identity_fact",
  "advisory_fact",
  "provider_readiness",
  "artifact_integrity",
]);

const FINGERPRINT = /^[A-Za-z0-9][A-Za-z0-9._:/@+-]*$/;

export class ObservationParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ObservationParseError";
  }
}

function fail(message: string): never {
  throw new ObservationParseError(message);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() !== value || value.length === 0) {
    fail(label + " must be non-empty trimmed text");
  }
  return value;
}

function nullableText(value: unknown, label: string): string | null {
  if (value === null || value === undefined) return null;
  return text(value, label);
}

function uniqueTextArray(value: unknown, label: string, allowEmpty: boolean): string[] {
  if (!Array.isArray(value)) fail(label + " must be an array");
  const result = value.map((entry, index) => text(entry, label + "[" + index + "]"));
  if (!allowEmpty && result.length === 0) fail(label + " must not be empty");
  if (new Set(result).size !== result.length) fail(label + " must contain unique values");
  return result;
}

function parseEvidenceNeeds(value: unknown): CandidateEvidenceNeed[] {
  if (!Array.isArray(value)) fail("evidenceRequirements must be an array");
  return value.map((entry, index) => {
    if (!isObject(entry)) fail("evidenceRequirements[" + index + "] must be an object");
    if (typeof entry.kind !== "string" || !EVIDENCE_KINDS.has(entry.kind as EvidenceRequirementKind)) {
      fail("evidenceRequirements[" + index + "].kind is invalid");
    }
    return {
      kind: entry.kind as EvidenceRequirementKind,
      description: text(entry.description, "evidenceRequirements[" + index + "].description"),
    };
  });
}

function parseReconResult(value: unknown): ReconWorkerResult {
  if (!isObject(value) || value.kind !== "recon_result") fail("expected recon_result");
  return {
    kind: "recon_result",
    coverageIds: uniqueTextArray(value.coverageIds, "coverageIds", true),
  };
}

function parseHunterResult(value: unknown): HunterWorkerResult {
  if (!isObject(value) || value.kind !== "hunter_result") fail("expected hunter_result");
  if (value.resolution === "covered") {
    return { kind: "hunter_result", resolution: "covered" };
  }
  if (value.resolution === "candidate") {
    const fingerprints = uniqueTextArray(value.candidateFingerprints, "candidateFingerprints", false);
    for (const fingerprint of fingerprints) {
      if (!FINGERPRINT.test(fingerprint)) fail("candidate fingerprint is not canonical");
    }
    return {
      kind: "hunter_result",
      resolution: "candidate",
      candidateFingerprints: fingerprints,
    };
  }
  if (value.resolution === "blocked") {
    return {
      kind: "hunter_result",
      resolution: "blocked",
      unresolved: uniqueTextArray(value.unresolved, "unresolved", false),
    };
  }
  return fail("hunter_result resolution is invalid");
}

function parseCandidateResult(value: unknown): CandidateValidationResult {
  if (!isObject(value) || value.kind !== "candidate_validation_result") {
    fail("expected candidate_validation_result");
  }
  if (
    value.verdict !== "confirmed" &&
    value.verdict !== "needs_validation" &&
    value.verdict !== "rejected"
  ) {
    fail("candidate verdict is invalid");
  }
  const evidenceRequirements = parseEvidenceNeeds(value.evidenceRequirements ?? []);
  if (value.verdict === "needs_validation" && evidenceRequirements.length === 0) {
    fail("needs_validation requires evidenceRequirements");
  }
  if (value.verdict !== "needs_validation" && evidenceRequirements.length !== 0) {
    fail("only needs_validation may carry evidenceRequirements");
  }
  return {
    kind: "candidate_validation_result",
    verdict: value.verdict,
    evidenceRequirements,
  };
}

function parseCoverageCriticResult(
  task: CoverageCriticWorkerTask,
  value: unknown,
): CoverageCriticResult {
  if (!isObject(value) || value.kind !== "coverage_critic_result") {
    fail("expected coverage_critic_result");
  }
  const reassignCoverageIds = uniqueTextArray(
    value.reassignCoverageIds,
    "reassignCoverageIds",
    true,
  );
  const available = new Map(task.coverage.map((unit) => [unit.coverageId, unit.status]));
  for (const coverageId of reassignCoverageIds) {
    const status = available.get(coverageId);
    if (status === undefined) {
      fail("critic requested unknown coverageId " + coverageId);
    }
    if (status !== "covered") {
      fail("critic may reassign only covered coverage units");
    }
  }
  return {
    kind: "coverage_critic_result",
    reassignCoverageIds,
  };
}

function parseRecordVerificationResult(value: unknown): RecordVerificationResult {
  if (!isObject(value) || value.kind !== "record_verification_result") {
    fail("expected record_verification_result");
  }
  if (value.verdict !== "verified" && value.verdict !== "needs_revision") {
    fail("record verification verdict is invalid");
  }
  const reason = nullableText(value.reason, "reason");
  if (value.verdict === "needs_revision" && reason === null) {
    fail("needs_revision requires a reason");
  }
  return {
    kind: "record_verification_result",
    verdict: value.verdict,
    reason,
  };
}

function resultForTask(task: WorkerTask, value: unknown): WorkerResult {
  switch (task.kind) {
    case "recon":
      return parseReconResult(value);
    case "hunter":
      return parseHunterResult(value);
    case "candidate_verifier":
      return parseCandidateResult(value);
    case "coverage_critic":
      return parseCoverageCriticResult(task, value);
    case "record_verifier":
      return parseRecordVerificationResult(value);
  }
}

export function parseWorkerObservation(
  task: WorkerTask,
  value: unknown,
  adapter: AdapterRef,
): ParsedWorkerObservation {
  if (!isObject(value)) fail("worker observation must be an object");

  if (value.status === "error") {
    if (typeof value.kind !== "string" || !FAILURE_KINDS.has(value.kind as FailureWorkerOutcomeKind)) {
      fail("worker error kind is invalid");
    }
    return {
      outcome: {
        kind: value.kind as FailureWorkerOutcomeKind,
        detail: nullableText(value.detail, "detail"),
        adapter,
      },
      result: null,
    };
  }

  if (value.status !== "ok") fail("worker observation status must be ok or error");
  return {
    outcome: { kind: "valid_result", detail: null, adapter },
    result: resultForTask(task, value.result),
  };
}

export function malformedOutcome(adapter: AdapterRef, error: unknown): WorkerOutcome {
  return {
    kind: "malformed_result",
    detail: error instanceof Error ? error.message : "worker returned malformed output",
    adapter,
  };
}

export function providerErrorOutcome(adapter: AdapterRef, error: unknown): WorkerOutcome {
  return {
    kind: "provider_error",
    detail: error instanceof Error ? error.message : "worker adapter threw",
    adapter,
  };
}
