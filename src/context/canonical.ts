import crypto from "node:crypto";

import type { JsonValue } from "../domain/contracts";

const MAX_CANONICAL_DEPTH = 64;
const MAX_CANONICAL_NODES = 10_000;

export class CanonicalJsonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CanonicalJsonError";
  }
}

interface WalkState {
  nodes: number;
}

function touch(depth: number, state: WalkState): void {
  if (depth > MAX_CANONICAL_DEPTH) {
    throw new CanonicalJsonError("canonical JSON nesting exceeds limit");
  }
  state.nodes += 1;
  if (state.nodes > MAX_CANONICAL_NODES) {
    throw new CanonicalJsonError("canonical JSON node count exceeds limit");
  }
}

function normalize(value: JsonValue, depth: number, state: WalkState): JsonValue {
  touch(depth, state);
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new CanonicalJsonError("non-finite numbers are not canonical JSON");
    return value;
  }
  if (Array.isArray(value)) {
    return Object.freeze(value.map((entry) => normalize(entry, depth + 1, state))) as readonly JsonValue[];
  }
  const objectValue = value as { readonly [key: string]: JsonValue };
  const normalized: Record<string, JsonValue> = {};
  for (const key of Object.keys(objectValue).sort()) {
    const entry = objectValue[key];
    if (entry === undefined) throw new CanonicalJsonError("undefined is not canonical JSON");
    normalized[key] = normalize(entry, depth + 1, state);
  }
  return Object.freeze(normalized);
}

export function normalizeJson(value: JsonValue): JsonValue {
  return normalize(value, 0, { nodes: 0 });
}

function serialize(value: JsonValue, depth: number, state: WalkState): string {
  touch(depth, state);
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean" || typeof value === "number") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map((entry) => serialize(entry, depth + 1, state)).join(",") + "]";
  }
  const objectValue = value as { readonly [key: string]: JsonValue };
  return (
    "{" +
    Object.keys(objectValue)
      .sort()
      .map((key) => JSON.stringify(key) + ":" + serialize(objectValue[key] as JsonValue, depth + 1, state))
      .join(",") +
    "}"
  );
}

export function canonicalJson(value: JsonValue): string {
  return serialize(value, 0, { nodes: 0 });
}

export function sha256Hex(value: string | Buffer): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}
