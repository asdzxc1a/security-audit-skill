import crypto from "node:crypto";

import type { JsonValue } from "../domain/contracts";

export class CanonicalJsonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CanonicalJsonError";
  }
}

export function normalizeJson(value: JsonValue): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new CanonicalJsonError("non-finite numbers are not canonical JSON");
    return value;
  }
  if (Array.isArray(value)) {
    return Object.freeze(value.map((entry) => normalizeJson(entry))) as readonly JsonValue[];
  }
  const objectValue = value as { readonly [key: string]: JsonValue };
  const normalized: Record<string, JsonValue> = {};
  for (const key of Object.keys(objectValue).sort()) {
    const entry = objectValue[key];
    if (entry === undefined) throw new CanonicalJsonError("undefined is not canonical JSON");
    normalized[key] = normalizeJson(entry);
  }
  return Object.freeze(normalized);
}

export function canonicalJson(value: JsonValue): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean" || typeof value === "number") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map((entry) => canonicalJson(entry)).join(",") + "]";
  }
  const objectValue = value as { readonly [key: string]: JsonValue };
  return (
    "{" +
    Object.keys(objectValue)
      .sort()
      .map((key) => JSON.stringify(key) + ":" + canonicalJson(objectValue[key] as JsonValue))
      .join(",") +
    "}"
  );
}

export function sha256Hex(value: string | Buffer): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}
