import type { JsonValue } from "../domain/contracts";
import { canonicalJson, normalizeJson, sha256Hex } from "./canonical";
import {
  CONTEXT_SCHEMA_VERSION,
  type ContextCompileRequest,
  type ContextCompilerLimits,
  type ContextTaskMetadata,
  type MethodologyBlock,
  type SourceFile,
  type WorkerContextBundle,
} from "./contracts";
import { selectMethodologyBlocks } from "./methodology";
import { resolveAuditScope } from "./scope";
import { validateSourceSnapshot } from "./source-snapshot";

export type ContextCompileErrorCode =
  | "invalid_task"
  | "too_many_files"
  | "file_too_large"
  | "source_too_large"
  | "too_many_methodology_blocks"
  | "methodology_block_too_large"
  | "methodology_too_large"
  | "task_metadata_too_large"
  | "bundle_too_large";

export class ContextCompileError extends Error {
  readonly code: ContextCompileErrorCode;

  constructor(code: ContextCompileErrorCode, message: string) {
    super(message);
    this.name = "ContextCompileError";
    this.code = code;
  }
}

export const DEFAULT_CONTEXT_LIMITS: ContextCompilerLimits = Object.freeze({
  maxFiles: 64,
  maxFileBytes: 64 * 1024,
  maxSourceBytes: 256 * 1024,
  maxMethodologyBlocks: 16,
  maxMethodologyBlockBytes: 128 * 1024,
  maxMethodologyBytes: 192 * 1024,
  maxTaskMetadataBytes: 64 * 1024,
  maxBundleBytes: 512 * 1024,
});

function resolveLimits(overrides?: Partial<ContextCompilerLimits>): ContextCompilerLimits {
  const limits = { ...DEFAULT_CONTEXT_LIMITS, ...(overrides ?? {}) };
  for (const [key, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new ContextCompileError("bundle_too_large", "invalid context limit " + key);
    }
  }
  return Object.freeze(limits);
}

function cloneSource(file: SourceFile): SourceFile {
  return Object.freeze({ ...file });
}

function cloneMethodology(block: MethodologyBlock): MethodologyBlock {
  return Object.freeze({ ...block });
}

function normalizeTask(task: ContextTaskMetadata): ContextTaskMetadata {
  if (typeof task.kind !== "string" || task.kind.trim() !== task.kind || task.kind.length === 0) {
    throw new ContextCompileError("invalid_task", "task kind must be non-empty trimmed text");
  }
  return Object.freeze({
    kind: task.kind,
    data: normalizeJson(task.data) as JsonValue,
  });
}

export function serializeContextBundle(bundle: WorkerContextBundle): string {
  return canonicalJson(bundle as unknown as JsonValue);
}

export function compileWorkerContext(request: ContextCompileRequest): WorkerContextBundle {
  validateSourceSnapshot(request.snapshot);
  const limits = resolveLimits(request.limits);
  const scope = resolveAuditScope(request.snapshot, request.scope);
  const selectedPathSet = new Set(scope.selectedPaths);
  const sourceFiles = request.snapshot.files
    .filter((file) => selectedPathSet.has(file.path))
    .map(cloneSource)
    .sort((left, right) => left.path.localeCompare(right.path));

  if (sourceFiles.length > limits.maxFiles) {
    throw new ContextCompileError(
      "too_many_files",
      "selected source file count " + sourceFiles.length + " exceeds " + limits.maxFiles,
    );
  }

  let sourceBytes = 0;
  for (const file of sourceFiles) {
    if (file.bytes > limits.maxFileBytes) {
      throw new ContextCompileError("file_too_large", "source file exceeds byte limit: " + file.path);
    }
    sourceBytes += file.bytes;
  }
  if (sourceBytes > limits.maxSourceBytes) {
    throw new ContextCompileError("source_too_large", "selected source exceeds byte limit");
  }

  const methodologyBlocks = selectMethodologyBlocks(
    request.methodologyCatalog,
    request.methodologyRefs,
  )
    .map(cloneMethodology)
    .sort((left, right) => left.ref.localeCompare(right.ref));

  if (methodologyBlocks.length > limits.maxMethodologyBlocks) {
    throw new ContextCompileError(
      "too_many_methodology_blocks",
      "methodology block count exceeds limit",
    );
  }

  let methodologyBytes = 0;
  for (const block of methodologyBlocks) {
    if (block.bytes > limits.maxMethodologyBlockBytes) {
      throw new ContextCompileError(
        "methodology_block_too_large",
        "methodology block exceeds byte limit: " + block.ref,
      );
    }
    methodologyBytes += block.bytes;
  }
  if (methodologyBytes > limits.maxMethodologyBytes) {
    throw new ContextCompileError(
      "methodology_too_large",
      "selected methodology exceeds byte limit",
    );
  }

  const task = normalizeTask(request.task);
  const taskMetadataBytes = Buffer.byteLength(canonicalJson(task.data), "utf8");
  if (taskMetadataBytes > limits.maxTaskMetadataBytes) {
    throw new ContextCompileError("task_metadata_too_large", "task metadata exceeds byte limit");
  }

  const withoutId = Object.freeze({
    schemaVersion: CONTEXT_SCHEMA_VERSION,
    sourceSnapshotId: request.snapshot.snapshotId,
    scope,
    task,
    sourceFiles: Object.freeze(sourceFiles),
    methodologyBlocks: Object.freeze(methodologyBlocks),
    metrics: Object.freeze({
      sourceBytes,
      methodologyBytes,
      taskMetadataBytes,
    }),
  });

  const payloadJson = canonicalJson(withoutId as unknown as JsonValue);
  if (Buffer.byteLength(payloadJson, "utf8") > limits.maxBundleBytes) {
    throw new ContextCompileError("bundle_too_large", "compiled context bundle exceeds byte limit");
  }

  const bundle = Object.freeze({
    ...withoutId,
    bundleId: "ctx1_" + sha256Hex(payloadJson),
  });
  if (Buffer.byteLength(serializeContextBundle(bundle), "utf8") > limits.maxBundleBytes) {
    throw new ContextCompileError("bundle_too_large", "compiled context bundle exceeds byte limit");
  }
  return bundle;
}
