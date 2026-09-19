import type { AuditScope, ResolvedAuditScope, SourceSnapshot } from "./contracts";
import { isSafeRepositoryPath } from "./source-snapshot";

export class AuditScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuditScopeError";
  }
}

const PROJECT_MEMORY_PREFIXES = ["docs/project/", ".eval-runs/", ".eval-work/"] as const;
const PROJECT_MEMORY_FILES = new Set(["AGENTS.md"]);

function uniqueSortedPaths(
  values: readonly string[],
  label: string,
  maxItems: number,
): string[] {
  if (!Array.isArray(values)) throw new AuditScopeError(label + " must be an array");
  if (values.length > maxItems) throw new AuditScopeError(label + " exceeds item limit");
  const result = [...values];
  for (const value of result) {
    if (!isSafeRepositoryPath(value)) {
      throw new AuditScopeError("unsafe " + label + " path: " + String(value));
    }
  }
  result.sort();
  return [...new Set(result)];
}

function matchesRoot(filePath: string, root: string): boolean {
  return filePath === root || filePath.startsWith(root + "/");
}

function isProjectMemoryPath(filePath: string): boolean {
  return (
    PROJECT_MEMORY_FILES.has(filePath) ||
    PROJECT_MEMORY_PREFIXES.some((prefix) => filePath.startsWith(prefix))
  );
}

export function resolveAuditScope(snapshot: SourceSnapshot, scope: AuditScope): ResolvedAuditScope {
  const allPaths = snapshot.files.map((file) => file.path);
  const includeProjectMemory = scope.includeProjectMemory === true;

  let roots: string[] = [];
  let baseRef: string | null = null;
  let headRef: string | null = null;
  let changedPaths: string[] = [];
  let candidates: string[] = [];

  switch (scope.mode) {
    case "paths":
      roots = uniqueSortedPaths(scope.roots, "scope root", 1024);
      if (roots.length === 0) throw new AuditScopeError("paths scope requires at least one root");
      candidates = allPaths.filter((filePath) => roots.some((root) => matchesRoot(filePath, root)));
      break;
    case "diff": {
      if (
        typeof scope.baseRef !== "string" ||
        scope.baseRef.trim() !== scope.baseRef ||
        scope.baseRef.length === 0 ||
        Buffer.byteLength(scope.baseRef, "utf8") > 1024 ||
        /[\u0000-\u001f\u007f]/.test(scope.baseRef)
      ) {
        throw new AuditScopeError("diff scope requires bounded trimmed baseRef");
      }
      if (
        typeof scope.headRef !== "string" ||
        scope.headRef.trim() !== scope.headRef ||
        scope.headRef.length === 0 ||
        Buffer.byteLength(scope.headRef, "utf8") > 1024 ||
        /[\u0000-\u001f\u007f]/.test(scope.headRef)
      ) {
        throw new AuditScopeError("diff scope requires bounded trimmed headRef");
      }
      baseRef = scope.baseRef;
      headRef = scope.headRef;
      roots = uniqueSortedPaths(scope.roots, "scope root", 1024);
      changedPaths = uniqueSortedPaths(scope.changedPaths, "changed", 50_000);
      const changed = new Set(changedPaths);
      candidates = allPaths.filter(
        (filePath) =>
          changed.has(filePath) &&
          (roots.length === 0 || roots.some((root) => matchesRoot(filePath, root))),
      );
      break;
    }
    case "repository":
      if (scope.explicit !== true) throw new AuditScopeError("repository scope must be explicitly selected");
      candidates = [...allPaths];
      break;
  }

  const excludedPaths = includeProjectMemory
    ? []
    : candidates.filter((filePath) => isProjectMemoryPath(filePath));
  const excluded = new Set(excludedPaths);
  const selectedPaths = candidates.filter((filePath) => !excluded.has(filePath)).sort();

  const available = new Set(allPaths);
  const unavailableChangedPaths =
    scope.mode === "diff"
      ? changedPaths
          .filter(
            (filePath) =>
              !available.has(filePath) &&
              (roots.length === 0 || roots.some((root) => matchesRoot(filePath, root))),
          )
          .sort()
      : [];

  return Object.freeze({
    mode: scope.mode,
    roots: Object.freeze(roots),
    baseRef,
    headRef,
    changedPaths: Object.freeze(changedPaths),
    selectedPaths: Object.freeze(selectedPaths),
    excludedPaths: Object.freeze(excludedPaths.sort()),
    unavailableChangedPaths: Object.freeze(unavailableChangedPaths),
    includeProjectMemory,
  });
}
