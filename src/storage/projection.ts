import type {
  Candidate,
  CoverageUnit,
  EvidenceRequirement,
  WorkerAssignment,
  AuditRunState,
} from "../domain/contracts";
import { EVENT_STORE_SCHEMA_VERSION, type AuditProjection } from "./contracts";

function cloneAssignment(value: WorkerAssignment): WorkerAssignment {
  return {
    ...value,
    coverageIds: [...value.coverageIds],
    outcome:
      value.outcome === null
        ? null
        : {
            ...value.outcome,
            adapter:
              value.outcome.adapter === null
                ? null
                : {
                    ...value.outcome.adapter,
                    metadata: structuredClone(value.outcome.adapter.metadata),
                  },
          },
  };
}

function cloneCoverage(value: CoverageUnit): CoverageUnit {
  return {
    ...value,
    definition: {
      ...value.definition,
      startingPaths: [...value.definition.startingPaths],
      methodologyRefs: [...value.definition.methodologyRefs],
    },
    candidateIds: [...value.candidateIds],
    reviewedPaths: [...value.reviewedPaths],
    checks: value.checks.map((check) => ({ ...check })),
    unresolved: [...value.unresolved],
  };
}

function cloneCandidate(value: Candidate): Candidate {
  return {
    ...value,
    coverageIds: [...value.coverageIds],
    claim: {
      ...value.claim,
      trace: value.claim.trace.map((reference) => ({ ...reference })),
      evidence: value.claim.evidence.map((reference) => ({ ...reference })),
      conditions: [...value.claim.conditions],
    },
  };
}

function cloneEvidence(value: EvidenceRequirement): EvidenceRequirement {
  return { ...value };
}

export function projectAuditState(state: AuditRunState): AuditProjection {
  return {
    schemaVersion: EVENT_STORE_SCHEMA_VERSION,
    runId: state.runId,
    sourceSnapshotId: state.sourceSnapshotId,
    profile: state.profile,
    scopePaths: [...state.scopePaths],
    status: state.status,
    sequence: state.sequence,
    budget: { ...state.budget },
    terminalReason: state.terminalReason,
    assignments: Object.values(state.assignments)
      .map(cloneAssignment)
      .sort((left, right) => left.assignmentId.localeCompare(right.assignmentId)),
    coverageUnits: Object.values(state.coverageUnits)
      .map(cloneCoverage)
      .sort((left, right) => left.coverageId.localeCompare(right.coverageId)),
    candidates: Object.values(state.candidates)
      .map(cloneCandidate)
      .sort((left, right) => left.candidateId.localeCompare(right.candidateId)),
    evidenceRequirements: Object.values(state.evidenceRequirements)
      .map(cloneEvidence)
      .sort((left, right) => left.requirementId.localeCompare(right.requirementId)),
  };
}
