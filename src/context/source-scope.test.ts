import assert from "node:assert/strict";
import test from "node:test";

import type { AuditScope, SourceSnapshot } from "./contracts";
import { resolveAuditScope, AuditScopeError } from "./scope";
import {
  createSourceSnapshot,
  SourceSnapshotError,
  validateSourceSnapshot,
} from "./source-snapshot";

test("source snapshot identity is deterministic and content-sensitive", () => {
  const first = createSourceSnapshot([
    { path: "src/b.ts", content: "export const b = 2;\n" },
    { path: "src/a.ts", content: "export const a = 1;\n" },
  ]);
  const second = createSourceSnapshot([
    { path: "src/a.ts", content: "export const a = 1;\n" },
    { path: "src/b.ts", content: "export const b = 2;\n" },
  ]);
  const changed = createSourceSnapshot([
    { path: "src/a.ts", content: "export const a = 9;\n" },
    { path: "src/b.ts", content: "export const b = 2;\n" },
  ]);

  assert.equal(first.snapshotId, second.snapshotId);
  assert.deepEqual(first.files.map((file) => file.path), ["src/a.ts", "src/b.ts"]);
  assert.notEqual(first.snapshotId, changed.snapshotId);
  assert.doesNotThrow(() => validateSourceSnapshot(first));
});

test("source snapshot rejects unsafe paths, duplicates, and forged metadata", () => {
  assert.throws(
    () => createSourceSnapshot([{ path: "../secret", content: "x" }]),
    SourceSnapshotError,
  );
  assert.throws(
    () => createSourceSnapshot([{ path: "a".repeat(5000), content: "x" }]),
    SourceSnapshotError,
  );
  assert.throws(
    () => createSourceSnapshot([{ path: "src/evil\u202Ets.txt", content: "x" }]),
    SourceSnapshotError,
  );
  assert.throws(
    () => createSourceSnapshot([{ path: "src/zero\u200Bwidth.ts", content: "x" }]),
    SourceSnapshotError,
  );
  assert.throws(
    () =>
      createSourceSnapshot([
        { path: "src/a.ts", content: "a" },
        { path: "src/a.ts", content: "b" },
      ]),
    SourceSnapshotError,
  );

  const snapshot = createSourceSnapshot([{ path: "src/a.ts", content: "safe" }]);
  const forged = {
    ...snapshot,
    files: [{ ...snapshot.files[0], content: "tampered" }],
  } as SourceSnapshot;
  assert.throws(() => validateSourceSnapshot(forged), SourceSnapshotError);
});

test("path scope stays within explicit roots", () => {
  const snapshot = createSourceSnapshot([
    { path: "src/auth/login.ts", content: "login\n" },
    { path: "src/payments/pay.ts", content: "pay\n" },
    { path: "tests/auth.test.ts", content: "test\n" },
  ]);
  const resolved = resolveAuditScope(snapshot, {
    mode: "paths",
    roots: ["src/auth"],
  });

  assert.deepEqual(resolved.selectedPaths, ["src/auth/login.ts"]);
  assert.deepEqual(resolved.roots, ["src/auth"]);
});

test("diff scope selects only changed files intersecting allowed roots", () => {
  const snapshot = createSourceSnapshot([
    { path: "src/a.ts", content: "a\n" },
    { path: "src/b.ts", content: "b\n" },
    { path: "tests/a.test.ts", content: "t\n" },
  ]);
  const resolved = resolveAuditScope(snapshot, {
    mode: "diff",
    baseRef: "base",
    headRef: "head",
    changedPaths: ["tests/a.test.ts", "src/deleted.ts", "src/b.ts"],
    roots: ["src"],
  });

  assert.deepEqual(resolved.selectedPaths, ["src/b.ts"]);
  assert.equal(resolved.baseRef, "base");
  assert.equal(resolved.headRef, "head");
  assert.deepEqual(resolved.unavailableChangedPaths, ["src/deleted.ts"]);
  assert.deepEqual(resolved.changedPaths, [
    "src/b.ts",
    "src/deleted.ts",
    "tests/a.test.ts",
  ]);
});

test("repository scope requires explicit mode and excludes project memory by default", () => {
  const snapshot = createSourceSnapshot([
    { path: "AGENTS.md", content: "memory\n" },
    { path: "docs/project/STATE.md", content: "state\n" },
    { path: "src/a.ts", content: "a\n" },
  ]);

  assert.throws(
    () =>
      resolveAuditScope(
        snapshot,
        { mode: "repository", explicit: false } as unknown as AuditScope,
      ),
    AuditScopeError,
  );

  const normal = resolveAuditScope(snapshot, { mode: "repository", explicit: true });
  assert.deepEqual(normal.selectedPaths, ["src/a.ts"]);
  assert.deepEqual(normal.excludedPaths, ["AGENTS.md", "docs/project/STATE.md"]);

  const explicitMemory = resolveAuditScope(snapshot, {
    mode: "repository",
    explicit: true,
    includeProjectMemory: true,
  });
  assert.deepEqual(explicitMemory.selectedPaths, [
    "AGENTS.md",
    "docs/project/STATE.md",
    "src/a.ts",
  ]);
});

test("scope path traversal is rejected", () => {
  const snapshot = createSourceSnapshot([{ path: "src/a.ts", content: "a" }]);
  assert.throws(
    () => resolveAuditScope(snapshot, { mode: "paths", roots: ["src/../secret"] }),
    AuditScopeError,
  );
});
