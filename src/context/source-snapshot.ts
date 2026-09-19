import type { JsonValue } from "../domain/contracts";
import { canonicalJson, sha256Hex } from "./canonical";
import {
  CONTEXT_SCHEMA_VERSION,
  type SourceFile,
  type SourceFileInput,
  type SourceSnapshot,
} from "./contracts";

const MAX_SNAPSHOT_FILES = 50_000;
const MAX_SNAPSHOT_BYTES = 64 * 1024 * 1024;

export class SourceSnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SourceSnapshotError";
  }
}

export function isSafeRepositoryPath(value: string): boolean {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.trim() === value &&
    !value.startsWith("/") &&
    !value.includes("\\") &&
    !/^[A-Za-z]:/.test(value) &&
    !value.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  );
}

function hasLoneSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function validateContent(content: string, filePath: string): void {
  if (typeof content !== "string") throw new SourceSnapshotError("source content must be text: " + filePath);
  if (content.includes("\0")) throw new SourceSnapshotError("source file contains NUL byte: " + filePath);
  if (hasLoneSurrogate(content)) {
    throw new SourceSnapshotError("source file contains invalid Unicode scalar: " + filePath);
  }
}

export function createSourceSnapshot(inputs: readonly SourceFileInput[]): SourceSnapshot {
  if (!Array.isArray(inputs) || inputs.length > MAX_SNAPSHOT_FILES) {
    throw new SourceSnapshotError("snapshot file count exceeds limit");
  }

  const byPath = new Map<string, SourceFile>();
  let totalBytes = 0;

  for (const input of inputs) {
    if (!input || !isSafeRepositoryPath(input.path)) {
      throw new SourceSnapshotError("unsafe repository path: " + String(input?.path));
    }
    if (byPath.has(input.path)) {
      throw new SourceSnapshotError("duplicate repository path: " + input.path);
    }
    validateContent(input.content, input.path);
    const bytes = Buffer.byteLength(input.content, "utf8");
    totalBytes += bytes;
    if (totalBytes > MAX_SNAPSHOT_BYTES) {
      throw new SourceSnapshotError("snapshot byte limit exceeded");
    }
    byPath.set(
      input.path,
      Object.freeze({
        path: input.path,
        sha256: sha256Hex(Buffer.from(input.content, "utf8")),
        bytes,
        content: input.content,
      }),
    );
  }

  const files = [...byPath.values()].sort((left, right) => left.path.localeCompare(right.path));
  const manifest: JsonValue = {
    schemaVersion: CONTEXT_SCHEMA_VERSION,
    files: files.map((file) => ({
      path: file.path,
      sha256: file.sha256,
      bytes: file.bytes,
    })),
  };
  const snapshotId = "src1_" + sha256Hex(canonicalJson(manifest));

  return Object.freeze({
    schemaVersion: CONTEXT_SCHEMA_VERSION,
    snapshotId,
    files: Object.freeze(files),
    totalBytes,
  });
}

export function validateSourceSnapshot(snapshot: SourceSnapshot): void {
  if (!snapshot || snapshot.schemaVersion !== CONTEXT_SCHEMA_VERSION) {
    throw new SourceSnapshotError("unsupported source snapshot schema");
  }
  if (!Array.isArray(snapshot.files) || snapshot.files.length > MAX_SNAPSHOT_FILES) {
    throw new SourceSnapshotError("snapshot file count exceeds limit");
  }

  const seen = new Set<string>();
  let totalBytes = 0;
  let previousPath: string | null = null;

  for (const file of snapshot.files) {
    if (!isSafeRepositoryPath(file.path)) {
      throw new SourceSnapshotError("unsafe repository path: " + file.path);
    }
    if (seen.has(file.path)) throw new SourceSnapshotError("duplicate repository path: " + file.path);
    if (previousPath !== null && previousPath.localeCompare(file.path) >= 0) {
      throw new SourceSnapshotError("snapshot files must be strictly sorted by path");
    }
    validateContent(file.content, file.path);
    const bytes = Buffer.byteLength(file.content, "utf8");
    const sha256 = sha256Hex(Buffer.from(file.content, "utf8"));
    if (file.bytes !== bytes || file.sha256 !== sha256) {
      throw new SourceSnapshotError("source file metadata mismatch: " + file.path);
    }
    seen.add(file.path);
    previousPath = file.path;
    totalBytes += bytes;
  }

  if (totalBytes !== snapshot.totalBytes || totalBytes > MAX_SNAPSHOT_BYTES) {
    throw new SourceSnapshotError("snapshot total byte count mismatch");
  }

  const manifest: JsonValue = {
    schemaVersion: CONTEXT_SCHEMA_VERSION,
    files: snapshot.files.map((file) => ({
      path: file.path,
      sha256: file.sha256,
      bytes: file.bytes,
    })),
  };
  const expected = "src1_" + sha256Hex(canonicalJson(manifest));
  if (snapshot.snapshotId !== expected) {
    throw new SourceSnapshotError("source snapshot id mismatch");
  }
}
