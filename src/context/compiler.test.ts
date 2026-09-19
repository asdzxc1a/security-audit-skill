import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  compileWorkerContext,
  ContextCompileError,
  serializeContextBundle,
} from "./compiler";
import { loadMethodologyCatalog, MethodologyCatalogError } from "./methodology";
import { createSourceSnapshot } from "./source-snapshot";

const skillRoot = path.resolve(__dirname, "../../skills/security-audit");

function snapshot() {
  return createSourceSnapshot([
    { path: "src/b.ts", content: "export const b = 2;\n" },
    { path: "src/a.ts", content: "export const a = 1;\n" },
    { path: "docs/project/STATE.md", content: "project memory\n" },
  ]);
}

test("methodology catalog preserves Cloudflare heading and attack-class refs", () => {
  const catalog = loadMethodologyCatalog(skillRoot);
  assert(catalog.blocks.has("ATTACK-CLASSES.md#Access control"));
  assert(catalog.blocks.has("WEB-PROTOCOL-AND-AUTH.md#Host and forwarded-header trust"));
  assert(
    catalog.blocks.has(
      "AI-AND-LLM.md#Core discipline (include in every agent prompt for this domain)",
    ),
  );
});

test("context bundle and hash are byte-identical across input ordering", () => {
  const catalog = loadMethodologyCatalog(skillRoot);
  const common = {
    snapshot: snapshot(),
    scope: { mode: "paths", roots: ["src"] } as const,
    methodologyCatalog: catalog,
  };

  const first = compileWorkerContext({
    ...common,
    methodologyRefs: [
      "WEB-PROTOCOL-AND-AUTH.md#Host and forwarded-header trust",
      "ATTACK-CLASSES.md#Access control",
    ],
    task: {
      kind: "hunter",
      data: { coverageId: "cov-1", nested: { z: 2, a: 1 } },
    },
  });

  const second = compileWorkerContext({
    ...common,
    methodologyRefs: [
      "ATTACK-CLASSES.md#Access control",
      "WEB-PROTOCOL-AND-AUTH.md#Host and forwarded-header trust",
    ],
    task: {
      kind: "hunter",
      data: { nested: { a: 1, z: 2 }, coverageId: "cov-1" },
    },
  });

  assert.equal(first.bundleId, second.bundleId);
  assert.equal(serializeContextBundle(first), serializeContextBundle(second));
  assert.deepEqual(first.sourceFiles.map((file) => file.path), ["src/a.ts", "src/b.ts"]);
  assert.deepEqual(
    first.methodologyBlocks.map((block) => block.ref),
    [
      "ATTACK-CLASSES.md#Access control",
      "WEB-PROTOCOL-AND-AUTH.md#Host and forwarded-header trust",
    ],
  );
});

test("compiler includes only explicitly selected methodology blocks", () => {
  const catalog = loadMethodologyCatalog(skillRoot);
  const bundle = compileWorkerContext({
    snapshot: snapshot(),
    scope: { mode: "paths", roots: ["src"] },
    methodologyCatalog: catalog,
    methodologyRefs: ["ATTACK-CLASSES.md#Access control"],
    task: { kind: "hunter", data: { coverageId: "cov-1" } },
  });

  assert.deepEqual(bundle.methodologyBlocks.map((block) => block.ref), [
    "ATTACK-CLASSES.md#Access control",
  ]);
  assert.equal(bundle.methodologyBlocks.length, 1);
});

test("unknown or duplicate methodology refs are rejected", () => {
  const catalog = loadMethodologyCatalog(skillRoot);
  const base = {
    snapshot: snapshot(),
    scope: { mode: "paths", roots: ["src"] } as const,
    methodologyCatalog: catalog,
    task: { kind: "hunter", data: {} } as const,
  };

  assert.throws(
    () =>
      compileWorkerContext({
        ...base,
        methodologyRefs: ["ATTACK-CLASSES.md#Does not exist"],
      }),
    MethodologyCatalogError,
  );
  assert.throws(
    () =>
      compileWorkerContext({
        ...base,
        methodologyRefs: [
          "ATTACK-CLASSES.md#Access control",
          "ATTACK-CLASSES.md#Access control",
        ],
      }),
    MethodologyCatalogError,
  );
});

test("compiler excludes project memory unless explicitly requested", () => {
  const catalog = loadMethodologyCatalog(skillRoot);
  const bundle = compileWorkerContext({
    snapshot: snapshot(),
    scope: { mode: "repository", explicit: true },
    methodologyCatalog: catalog,
    methodologyRefs: [],
    task: { kind: "recon", data: {} },
  });

  assert.deepEqual(bundle.sourceFiles.map((file) => file.path), ["src/a.ts", "src/b.ts"]);
  assert.deepEqual(bundle.scope.excludedPaths, ["docs/project/STATE.md"]);
});

test("compiler rejects source and methodology limits deterministically", () => {
  const catalog = loadMethodologyCatalog(skillRoot);
  const base = {
    snapshot: snapshot(),
    scope: { mode: "paths", roots: ["src"] } as const,
    methodologyCatalog: catalog,
    task: { kind: "hunter", data: { coverageId: "cov-1" } } as const,
  };

  assert.throws(
    () =>
      compileWorkerContext({
        ...base,
        methodologyRefs: [],
        limits: { maxFiles: 1 },
      }),
    (error: unknown) =>
      error instanceof ContextCompileError && error.code === "too_many_files",
  );

  assert.throws(
    () =>
      compileWorkerContext({
        ...base,
        methodologyRefs: [],
        limits: { maxFileBytes: 5 },
      }),
    (error: unknown) =>
      error instanceof ContextCompileError && error.code === "file_too_large",
  );

  assert.throws(
    () =>
      compileWorkerContext({
        ...base,
        methodologyRefs: [],
        limits: { maxSourceBytes: 10 },
      }),
    (error: unknown) =>
      error instanceof ContextCompileError && error.code === "source_too_large",
  );

  assert.throws(
    () =>
      compileWorkerContext({
        ...base,
        methodologyRefs: [
          "ATTACK-CLASSES.md#Access control",
          "WEB-PROTOCOL-AND-AUTH.md#Host and forwarded-header trust",
        ],
        limits: { maxMethodologyBlocks: 1 },
      }),
    (error: unknown) =>
      error instanceof ContextCompileError &&
      error.code === "too_many_methodology_blocks",
  );

  assert.throws(
    () =>
      compileWorkerContext({
        ...base,
        methodologyRefs: ["ATTACK-CLASSES.md#Access control"],
        limits: { maxMethodologyBlockBytes: 10 },
      }),
    (error: unknown) =>
      error instanceof ContextCompileError &&
      error.code === "methodology_block_too_large",
  );

  assert.throws(
    () =>
      compileWorkerContext({
        ...base,
        methodologyRefs: [
          "ATTACK-CLASSES.md#Access control",
          "WEB-PROTOCOL-AND-AUTH.md#Host and forwarded-header trust",
        ],
        limits: { maxMethodologyBytes: 20 },
      }),
    (error: unknown) =>
      error instanceof ContextCompileError &&
      error.code === "methodology_too_large",
  );

  assert.throws(
    () =>
      compileWorkerContext({
        ...base,
        methodologyRefs: [],
        limits: { maxTaskMetadataBytes: 4 },
      }),
    (error: unknown) =>
      error instanceof ContextCompileError &&
      error.code === "task_metadata_too_large",
  );

  assert.throws(
    () =>
      compileWorkerContext({
        ...base,
        methodologyRefs: [],
        limits: { maxBundleBytes: 100 },
      }),
    (error: unknown) =>
      error instanceof ContextCompileError &&
      error.code === "bundle_too_large",
  );
});

test("compiler detects forged source snapshots", () => {
  const catalog = loadMethodologyCatalog(skillRoot);
  const good = snapshot();
  const forged = {
    ...good,
    files: [{ ...good.files[0], content: "tampered" }, ...good.files.slice(1)],
  };

  assert.throws(() =>
    compileWorkerContext({
      snapshot: forged,
      scope: { mode: "paths", roots: ["src"] },
      methodologyCatalog: catalog,
      methodologyRefs: [],
      task: { kind: "recon", data: {} },
    }),
  );
});


test("deep task metadata fails before unbounded canonical traversal", () => {
  const catalog = loadMethodologyCatalog(skillRoot);
  let deep: unknown = "leaf";
  for (let index = 0; index < 80; index++) deep = { child: deep };

  assert.throws(
    () =>
      compileWorkerContext({
        snapshot: snapshot(),
        scope: { mode: "paths", roots: ["src"] },
        methodologyCatalog: catalog,
        methodologyRefs: [],
        task: { kind: "recon", data: deep as never },
      }),
    (error: unknown) =>
      error instanceof ContextCompileError && error.code === "invalid_task",
  );
});

test("compiler rejects methodology blocks whose content no longer matches their hash", () => {
  const catalog = loadMethodologyCatalog(skillRoot);
  const original = catalog.blocks.get("ATTACK-CLASSES.md#Access control");
  assert(original);
  const forged = new Map(catalog.blocks);
  forged.set(original.ref, { ...original, content: original.content + "tampered\n" });

  assert.throws(() =>
    compileWorkerContext({
      snapshot: snapshot(),
      scope: { mode: "paths", roots: ["src"] },
      methodologyCatalog: { blocks: forged },
      methodologyRefs: [original.ref],
      task: { kind: "hunter", data: {} },
    }),
  );
});


test("diff base/head identity participates in context bundle identity", () => {
  const catalog = loadMethodologyCatalog(skillRoot);
  const common = {
    snapshot: snapshot(),
    methodologyCatalog: catalog,
    methodologyRefs: [] as const,
    task: { kind: "recon", data: {} } as const,
  };

  const first = compileWorkerContext({
    ...common,
    scope: {
      mode: "diff",
      baseRef: "base-a",
      headRef: "head",
      changedPaths: ["src/a.ts"],
      roots: ["src"],
    },
  });
  const second = compileWorkerContext({
    ...common,
    scope: {
      mode: "diff",
      baseRef: "base-b",
      headRef: "head",
      changedPaths: ["src/a.ts"],
      roots: ["src"],
    },
  });

  assert.notEqual(first.bundleId, second.bundleId);
  assert.equal(first.scope.baseRef, "base-a");
  assert.equal(second.scope.baseRef, "base-b");
});
