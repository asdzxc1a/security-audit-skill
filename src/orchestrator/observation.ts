import type {
  AdapterRef,
  CandidateClaim,
  CoverageCheck,
  CoverageDefinition,
  EvidenceRequirementKind,
  SourceReference,
  WorkerOutcome,
} from "../domain/contracts";
import type {
  CandidateDraft,
  CandidateEvidenceNeed,
  CandidateValidationResult,
  CoverageCriticResult,
  CoverageCriticWorkerTask,
  FailureWorkerOutcomeKind,
  HunterEvidence,
  HunterWorkerResult,
  ParsedWorkerObservation,
  ReconWorkerResult,
  RecordVerificationResult,
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
const MAX_OBSERVATION_BYTES = 256 * 1024;
const MAX_ADAPTER_BYTES = 32 * 1024;
const MAX_TEXT_BYTES = 8 * 1024;
const MAX_ERROR_BYTES = 4 * 1024;
const MAX_ID_BYTES = 512;
const MAX_ARRAY_ITEMS = 128;
const MAX_PATH_ITEMS = 256;
const MAX_REFERENCE_ITEMS = 64;
const MAX_CHECK_ITEMS = 64;
const MAX_CANDIDATE_ITEMS = 32;

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

function jsonBytes(value: unknown, label: string): number {
  try {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) fail(label + " is not JSON-serializable");
    return Buffer.byteLength(serialized, "utf8");
  } catch (error) {
    if (error instanceof ObservationParseError) throw error;
    fail(label + " is not JSON-serializable");
  }
}

function requireJsonLimit(value: unknown, label: string, maxBytes: number): void {
  if (jsonBytes(value, label) > maxBytes) fail(label + " exceeds byte limit");
}

function text(value: unknown, label: string, maxBytes: number = MAX_TEXT_BYTES): string {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    value.length === 0 ||
    Buffer.byteLength(value, "utf8") > maxBytes
  ) {
    fail(label + " must be bounded non-empty trimmed text");
  }
  return value;
}

function nullableText(
  value: unknown,
  label: string,
  maxBytes: number = MAX_TEXT_BYTES,
): string | null {
  if (value === null || value === undefined) return null;
  return text(value, label, maxBytes);
}

function array(value: unknown, label: string, maxItems: number = MAX_ARRAY_ITEMS): unknown[] {
  if (!Array.isArray(value) || value.length > maxItems) {
    fail(label + " must be a bounded array");
  }
  return value;
}

function uniqueTextArray(
  value: unknown,
  label: string,
  allowEmpty: boolean,
  maxItems: number = MAX_ARRAY_ITEMS,
): string[] {
  const entries = array(value, label, maxItems);
  const result = entries.map((entry, index) =>
    text(entry, label + "[" + index + "]", MAX_ID_BYTES),
  );
  if (!allowEmpty && result.length === 0) fail(label + " must not be empty");
  if (new Set(result).size !== result.length) fail(label + " must contain unique values");
  return result;
}

function safeRelativePath(value: unknown, label: string): string {
  const result = text(value, label, 4096);
  if (
    result.startsWith("/") ||
    result.includes("\\") ||
    /^[A-Za-z]:/.test(result) ||
    result.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    fail(label + " must be a safe repository-relative path");
  }
  return result;
}

function parseSourceReference(value: unknown, label: string): SourceReference {
  if (!isObject(value)) fail(label + " must be an object");
  let line: number | null = null;
  if (value.line !== null && value.line !== undefined) {
    if (
      typeof value.line !== "number" ||
      !Number.isInteger(value.line) ||
      value.line < 1 ||
      value.line > 10_000_000
    ) {
      fail(label + ".line is invalid");
    }
    line = value.line;
  }
  return {
    file: safeRelativePath(value.file, label + ".file"),
    line,
    scope: text(value.scope, label + ".scope", 4096),
    description: text(value.description, label + ".description"),
  };
}

function parseCandidateClaim(value: unknown): CandidateClaim {
  if (!isObject(value)) fail("candidate claim must be an object");
  const trace = array(value.trace, "claim.trace", MAX_REFERENCE_ITEMS).map((entry, index) =>
    parseSourceReference(entry, "claim.trace[" + index + "]"),
  );
  const evidence = array(value.evidence, "claim.evidence", MAX_REFERENCE_ITEMS).map(
    (entry, index) => parseSourceReference(entry, "claim.evidence[" + index + "]"),
  );
  if (trace.length === 0 || evidence.length === 0) {
    fail("candidate claim requires trace and evidence");
  }
  const conditions = array(value.conditions ?? [], "claim.conditions", MAX_REFERENCE_ITEMS).map(
    (entry, index) => text(entry, "claim.conditions[" + index + "]"),
  );
  return {
    title: text(value.title, "claim.title", 4096),
    description: text(value.description, "claim.description"),
    claimedRootCause: text(value.claimedRootCause, "claim.claimedRootCause"),
    intendedBehavior: text(value.intendedBehavior, "claim.intendedBehavior"),
    trace,
    evidence,
    conditions,
  };
}

function parseCoverageCheck(value: unknown, label: string): CoverageCheck {
  if (!isObject(value)) fail(label + " must be an object");
  if (value.method !== "source" && value.method !== "local") {
    fail(label + ".method is invalid");
  }
  const artifactRef = nullableText(value.artifactRef, label + ".artifactRef", 4096);
  if (value.method === "source" && artifactRef !== null) {
    fail(label + " source check must not carry artifactRef");
  }
  if (value.method === "local" && artifactRef === null) {
    fail(label + " local check requires artifactRef");
  }
  return {
    invariant: text(value.invariant, label + ".invariant"),
    method: value.method,
    result: text(value.result, label + ".result"),
    artifactRef,
  };
}

function parseHunterEvidence(value: Record<string, unknown>): HunterEvidence {
  const reviewedPaths = array(value.reviewedPaths, "reviewedPaths", MAX_PATH_ITEMS).map(
    (entry, index) => safeRelativePath(entry, "reviewedPaths[" + index + "]"),
  );
  if (reviewedPaths.length === 0) fail("reviewedPaths must not be empty");
  if (new Set(reviewedPaths).size !== reviewedPaths.length) {
    fail("reviewedPaths must contain unique values");
  }

  const checks = array(value.checks, "checks", MAX_CHECK_ITEMS).map((entry, index) =>
    parseCoverageCheck(entry, "checks[" + index + "]"),
  );
  if (checks.length === 0) fail("checks must not be empty");
  return { reviewedPaths, checks };
}

function parseCandidateDraft(value: unknown, index: number): CandidateDraft {
  if (!isObject(value)) fail("candidates[" + index + "] must be an object");
  const fingerprint = text(value.fingerprint, "candidates[" + index + "].fingerprint", 2048);
  if (!FINGERPRINT.test(fingerprint)) fail("candidate fingerprint is not canonical");
  return {
    fingerprint,
    claim: parseCandidateClaim(value.claim),
  };
}

function parseEvidenceNeeds(value: unknown): CandidateEvidenceNeed[] {
  return array(value, "evidenceRequirements", 32).map((entry, index) => {
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

function parseCoverageDefinition(value: unknown, label: string): CoverageDefinition {
  if (!isObject(value)) fail(label + " must be an object");
  const lifecycle =
    value.lifecycle === null || value.lifecycle === undefined
      ? null
      : text(value.lifecycle, label + ".lifecycle", 4096);
  const startingPaths = array(value.startingPaths, label + ".startingPaths", 128).map(
    (entry, index) => safeRelativePath(entry, label + ".startingPaths[" + index + "]"),
  );
  if (startingPaths.length === 0) fail(label + ".startingPaths must not be empty");
  if (new Set(startingPaths).size !== startingPaths.length) {
    fail(label + ".startingPaths must be unique");
  }
  const methodologyRefs = array(value.methodologyRefs, label + ".methodologyRefs", 64).map(
    (entry, index) => text(entry, label + ".methodologyRefs[" + index + "]", 4096),
  );
  if (methodologyRefs.length === 0) fail(label + ".methodologyRefs must not be empty");
  if (new Set(methodologyRefs).size !== methodologyRefs.length) {
    fail(label + ".methodologyRefs must be unique");
  }
  return {
    surface: text(value.surface, label + ".surface"),
    boundary: text(value.boundary, label + ".boundary"),
    subsystem: text(value.subsystem, label + ".subsystem"),
    attackClass: text(value.attackClass, label + ".attackClass"),
    lifecycle,
    startingPaths,
    methodologyRefs,
  };
}

function parseReconResult(value: unknown): ReconWorkerResult {
  if (!isObject(value) || value.kind !== "recon_result") fail("expected recon_result");
  const entries = array(value.coverageDefinitions, "coverageDefinitions", MAX_PATH_ITEMS);
  const coverageDefinitions = entries.map((entry, index) =>
    parseCoverageDefinition(entry, "coverageDefinitions[" + index + "]"),
  );

  const semanticKeys = coverageDefinitions.map((definition) =>
    JSON.stringify([
      definition.surface,
      definition.boundary,
      definition.subsystem,
      definition.attackClass,
      definition.lifecycle,
    ]),
  );
  if (new Set(semanticKeys).size !== semanticKeys.length) {
    fail("coverage definitions must have unique semantic identities");
  }

  return { kind: "recon_result", coverageDefinitions };
}

function parseHunterResult(value: unknown): HunterWorkerResult {
  if (!isObject(value) || value.kind !== "hunter_result") fail("expected hunter_result");
  const evidence = parseHunterEvidence(value);

  if (value.resolution === "covered") {
    return { kind: "hunter_result", resolution: "covered", ...evidence };
  }

  if (value.resolution === "candidate") {
    const candidates = array(value.candidates, "candidates", MAX_CANDIDATE_ITEMS).map(
      (entry, index) => parseCandidateDraft(entry, index),
    );
    if (candidates.length === 0) fail("candidates must not be empty");
    const fingerprints = candidates.map((candidate) => candidate.fingerprint);
    if (new Set(fingerprints).size !== fingerprints.length) {
      fail("candidate fingerprints must be unique within one hunter result");
    }
    return {
      kind: "hunter_result",
      resolution: "candidate",
      candidates,
      ...evidence,
    };
  }

  if (value.resolution === "blocked") {
    return {
      kind: "hunter_result",
      resolution: "blocked",
      unresolved: uniqueTextArray(value.unresolved, "unresolved", false, 64),
      ...evidence,
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
  const reason = text(value.reason, "candidate validation reason");
  const evidenceRequirements = parseEvidenceNeeds(value.evidenceRequirements ?? []);
  if (value.verdict === "needs_validation" && evidenceRequirements.length === 0) {
    fail("needs_validation requires evidenceRequirements");
  }
  if (value.verdict !== "needs_validation" && evidenceRequirements.length !== 0) {
    fail("only needs_validation may carry evidenceRequirements");
  }

  let validatedClaim: CandidateClaim | null = null;
  if (value.verdict === "confirmed" || value.verdict === "needs_validation") {
    if (value.validatedClaim === null || value.validatedClaim === undefined) {
      fail("retained candidate validation requires validatedClaim");
    }
    validatedClaim = parseCandidateClaim(value.validatedClaim);
  } else if (value.validatedClaim !== null && value.validatedClaim !== undefined) {
    fail("rejected candidate validation must not carry validatedClaim");
  }

  return {
    kind: "candidate_validation_result",
    verdict: value.verdict,
    reason,
    validatedClaim,
    evidenceRequirements,
  };
}



function parseCoverageCriticResult(
  value: unknown,
  task: CoverageCriticWorkerTask,
): CoverageCriticResult {
  if (!isObject(value) || value.kind !== "coverage_critic_result") {
    fail("expected coverage_critic_result");
  }
  if (typeof value.stop !== "boolean") fail("coverage critic stop must be boolean");

  const reviewedCoverageIds = uniqueTextArray(
    value.reviewedCoverageIds,
    "reviewedCoverageIds",
    true,
    MAX_PATH_ITEMS,
  );
  const expectedReviewed = task.coverageUnits.map((unit) => unit.coverageId).sort();
  const actualReviewed = [...reviewedCoverageIds].sort();
  if (
    expectedReviewed.length !== actualReviewed.length ||
    expectedReviewed.some((coverageId, index) => coverageId !== actualReviewed[index])
  ) {
    fail("coverage critic must account for every coverage unit exactly once");
  }

  const rawReassignments = array(value.reassignments, "reassignments", 64);
  const reassignments = rawReassignments.map((entry, index) => {
    if (!isObject(entry)) fail("reassignments[" + index + "] must be an object");
    return {
      coverageId: text(entry.coverageId, "reassignments[" + index + "].coverageId", MAX_ID_BYTES),
      reason: text(entry.reason, "reassignments[" + index + "].reason"),
    };
  });
  const reassignmentIds = reassignments.map((entry) => entry.coverageId);
  if (new Set(reassignmentIds).size !== reassignmentIds.length) {
    fail("coverage critic reassignments must contain unique coverage ids");
  }

  const reopenable = new Set(task.reopenableCoverageIds);
  for (const coverageId of reassignmentIds) {
    if (!reopenable.has(coverageId)) {
      fail("coverage critic may only reassign reopenable coverage units");
    }
  }

  const requiredReassignments = task.coverageUnits
    .filter((unit) => unit.status === "blocked" || unit.status === "deferred")
    .map((unit) => unit.coverageId);
  for (const coverageId of requiredReassignments) {
    if (!reassignmentIds.includes(coverageId)) {
      fail("coverage critic must reassign every blocked or deferred coverage unit");
    }
  }

  if (value.stop && reassignments.length !== 0) {
    fail("clean-stop coverage critic cannot request reassignment");
  }
  if (!value.stop && reassignments.length === 0) {
    fail("non-stop coverage critic must request reassignment");
  }

  return {
    kind: "coverage_critic_result",
    reviewedCoverageIds,
    reassignments,
    stop: value.stop,
  };
}

function parseRecordVerificationResult(value: unknown): RecordVerificationResult {
  if (!isObject(value) || value.kind !== "record_verification_result") {
    fail("expected record_verification_result");
  }
  if (value.disposition !== "accept" && value.disposition !== "reject") {
    fail("record verification disposition is invalid");
  }
  return {
    kind: "record_verification_result",
    disposition: value.disposition,
    reason: text(value.reason, "record verification reason"),
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
      return parseCoverageCriticResult(value, task);
    case "record_verifier":
      return parseRecordVerificationResult(value);
  }
}

function validateAdapter(adapter: AdapterRef): void {
  text(adapter.adapter, "adapter.adapter", MAX_ID_BYTES);
  if (adapter.model !== null) text(adapter.model, "adapter.model", MAX_ID_BYTES);
  requireJsonLimit(adapter.metadata, "adapter.metadata", MAX_ADAPTER_BYTES);
}

export function parseWorkerObservation(
  task: WorkerTask,
  value: unknown,
  adapter: AdapterRef,
): ParsedWorkerObservation {
  validateAdapter(adapter);
  requireJsonLimit(value, "worker observation", MAX_OBSERVATION_BYTES);
  if (!isObject(value)) fail("worker observation must be an object");

  if (value.status === "error") {
    if (typeof value.kind !== "string" || !FAILURE_KINDS.has(value.kind as FailureWorkerOutcomeKind)) {
      fail("worker error kind is invalid");
    }
    return {
      outcome: {
        kind: value.kind as FailureWorkerOutcomeKind,
        detail: nullableText(value.detail, "detail", MAX_ERROR_BYTES),
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

function boundedErrorDetail(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message : fallback;
  if (Buffer.byteLength(raw, "utf8") <= MAX_ERROR_BYTES) return raw;
  let result = raw;
  while (Buffer.byteLength(result, "utf8") > MAX_ERROR_BYTES && result.length > 0) {
    result = result.slice(0, Math.max(1, Math.floor(result.length * 0.9)));
  }
  return result || fallback;
}

export function malformedOutcome(adapter: AdapterRef, error: unknown): WorkerOutcome {
  validateAdapter(adapter);
  return {
    kind: "malformed_result",
    detail: boundedErrorDetail(error, "worker returned malformed output"),
    adapter,
  };
}

export function providerErrorOutcome(adapter: AdapterRef, error: unknown): WorkerOutcome {
  validateAdapter(adapter);
  return {
    kind: "provider_error",
    detail: boundedErrorDetail(error, "worker adapter threw"),
    adapter,
  };
}
