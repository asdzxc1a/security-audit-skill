import type {
  AuditBudget,
  AuditEvent,
  AuditProfile,
  AuditRunState,
  Candidate,
  CoverageUnit,
  EvidenceRequirement,
  RunStatus,
  WorkerAssignment,
} from "../domain/contracts";

export const EVENT_STORE_SCHEMA_VERSION = 1 as const;
export type EventStoreSchemaVersion = typeof EVENT_STORE_SCHEMA_VERSION;

export interface AuditProjection {
  readonly schemaVersion: EventStoreSchemaVersion;
  readonly runId: string;
  readonly sourceSnapshotId: string;
  readonly profile: AuditProfile;
  readonly scopePaths: readonly string[];
  readonly status: RunStatus;
  readonly sequence: number;
  readonly budget: AuditBudget;
  readonly terminalReason: string | null;
  readonly assignments: readonly WorkerAssignment[];
  readonly coverageUnits: readonly CoverageUnit[];
  readonly candidates: readonly Candidate[];
  readonly evidenceRequirements: readonly EvidenceRequirement[];
}

export interface AuditEventStore {
  append(event: AuditEvent): AuditRunState;
  readEvents(runId: string): readonly AuditEvent[];
  loadState(runId: string): AuditRunState | null;
  loadProjection(runId: string): AuditProjection | null;
}
