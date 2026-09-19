import type { JsonValue } from "../domain/contracts";

export const CONTEXT_SCHEMA_VERSION = 1 as const;
export type ContextSchemaVersion = typeof CONTEXT_SCHEMA_VERSION;

export interface SourceFileInput {
  readonly path: string;
  readonly content: string;
}

export interface SourceFile {
  readonly path: string;
  readonly sha256: string;
  readonly bytes: number;
  readonly content: string;
}

export interface SourceSnapshot {
  readonly schemaVersion: ContextSchemaVersion;
  readonly snapshotId: string;
  readonly files: readonly SourceFile[];
  readonly totalBytes: number;
}

interface ScopeBase {
  readonly includeProjectMemory?: boolean;
}

export interface PathAuditScope extends ScopeBase {
  readonly mode: "paths";
  readonly roots: readonly string[];
}

export interface DiffAuditScope extends ScopeBase {
  readonly mode: "diff";
  readonly baseRef: string;
  readonly headRef: string;
  readonly changedPaths: readonly string[];
  readonly roots: readonly string[];
}

export interface RepositoryAuditScope extends ScopeBase {
  readonly mode: "repository";
  readonly explicit: true;
}

export type AuditScope = PathAuditScope | DiffAuditScope | RepositoryAuditScope;

export interface ResolvedAuditScope {
  readonly mode: AuditScope["mode"];
  readonly roots: readonly string[];
  readonly changedPaths: readonly string[];
  readonly selectedPaths: readonly string[];
  readonly excludedPaths: readonly string[];
  readonly unavailableChangedPaths: readonly string[];
  readonly includeProjectMemory: boolean;
}

export interface MethodologyBlock {
  readonly ref: string;
  readonly file: string;
  readonly heading: string;
  readonly level: number;
  readonly sha256: string;
  readonly bytes: number;
  readonly content: string;
}

export interface MethodologyCatalog {
  readonly blocks: ReadonlyMap<string, MethodologyBlock>;
}

export interface ContextCompilerLimits {
  readonly maxFiles: number;
  readonly maxFileBytes: number;
  readonly maxSourceBytes: number;
  readonly maxMethodologyBlocks: number;
  readonly maxMethodologyBlockBytes: number;
  readonly maxMethodologyBytes: number;
  readonly maxTaskMetadataBytes: number;
  readonly maxBundleBytes: number;
}

export interface ContextTaskMetadata {
  readonly kind: string;
  readonly data: JsonValue;
}

export interface ContextCompileRequest {
  readonly snapshot: SourceSnapshot;
  readonly scope: AuditScope;
  readonly methodologyCatalog: MethodologyCatalog;
  readonly methodologyRefs: readonly string[];
  readonly task: ContextTaskMetadata;
  readonly limits?: Partial<ContextCompilerLimits>;
}

export interface WorkerContextBundle {
  readonly schemaVersion: ContextSchemaVersion;
  readonly bundleId: string;
  readonly sourceSnapshotId: string;
  readonly scope: ResolvedAuditScope;
  readonly task: ContextTaskMetadata;
  readonly sourceFiles: readonly SourceFile[];
  readonly methodologyBlocks: readonly MethodologyBlock[];
  readonly metrics: {
    readonly sourceBytes: number;
    readonly methodologyBytes: number;
    readonly taskMetadataBytes: number;
  };
}
