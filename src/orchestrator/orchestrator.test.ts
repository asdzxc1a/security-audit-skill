import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import type { AdapterRef, CandidateClaim } from "../domain/contracts";
import { FileAuditEventStore } from "../storage/file-event-store";
import type {
  AuditRunRequest,
  CandidateVerifierWorkerTask,
  IdSource,
  WorkerAdapter,
  WorkerTask,
} from "./contracts";
import { AuditOrchestrator } from "./orchestrator";

class DeterministicIds implements IdSource {
  private sequence = 0;

  next(prefix: string): string {
    this.sequence += 1;
    return prefix + "-" + this.sequence;
  }
}

class ScriptedWorker implements WorkerAdapter {
  readonly ref: AdapterRef = {
    adapter: "scripted-worker",
    model: "test",
    metadata: {},
  };

  readonly tasks: WorkerTask[] = [];

  constructor(private readonly responses: unknown[]) {}

  async execute(task: WorkerTask): Promise<unknown> {
    this.tasks.push(structuredClone(task));
    if (this.responses.length === 0) throw new Error("no scripted response");
    const response = this.responses.shift();
    if (response instanceof Error) throw response;
    return response;
  }
}

function request(maxWorkerInvocations: number | null = 10): AuditRunRequest {
  return {
    runId: "run-1",
    sourceSnapshotId: "snapshot-1",
    profile: "standard",
    scopePaths: ["src"],
    maxWorkerInvocations,
  };
}

function tempStore(): { root: string; store: FileAuditEventStore } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "audit-orchestrator-"));
  return { root, store: new FileAuditEventStore(root) };
}

const CLAIM: CandidateClaim = {
  title: "Cross-tenant document read",
  description: "The read path can return another tenant's document.",
  claimedRootCause: "The final lookup omits tenant ownership.",
  intendedBehavior: "Document reads must remain scoped to the authenticated tenant.",
  trace: [
    {
      file: "src/documents.ts",
      line: 10,
      scope: "getDocument",
      description: "Caller-controlled document id enters the lookup.",
    },
  ],
  evidence: [
    {
      file: "src/documents.ts",
      line: 11,
      scope: "getDocument",
      description: "Lookup filters by id without tenant id.",
    },
  ],
  conditions: ["Attacker has an authenticated tenant account."],
};

const HUNTER_EVIDENCE = {
  reviewedPaths: ["src/documents.ts"],
  checks: [
    {
      invariant: "Document access must remain tenant-scoped.",
      method: "source",
      result: "Reviewed the final lookup and tenant ownership predicate.",
      artifactRef: null,
    },
  ],
};

const RECON_ONE = {
  status: "ok",
  result: {
    kind: "recon_result",
    coverageIds: ["coverage-1"],
  },
};

const RECON_TWO = {
  status: "ok",
  result: {
    kind: "recon_result",
    coverageIds: ["coverage-1", "coverage-2"],
  },
};

const HUNTER_CANDIDATE = {
  status: "ok",
  result: {
    kind: "hunter_result",
    resolution: "candidate",
    ...HUNTER_EVIDENCE,
    candidates: [{ fingerprint: "root-cause-1", claim: CLAIM }],
  },
};

const HUNTER_COVERED = {
  status: "ok",
  result: {
    kind: "hunter_result",
    resolution: "covered",
    ...HUNTER_EVIDENCE,
  },
};

const CONFIRMED = {
  status: "ok",
  result: {
    kind: "candidate_validation_result",
    verdict: "confirmed",
    evidenceRequirements: [],
  },
};

test("valid candidate path reaches record_verification through persisted evidence", async () => {
  const { root, store } = tempStore();
  try {
    const worker = new ScriptedWorker([RECON_ONE, HUNTER_CANDIDATE, CONFIRMED]);
    const orchestrator = new AuditOrchestrator(store, worker, new DeterministicIds());
    const state = await orchestrator.runThroughCandidateValidation(request(3));

    assert.equal(state.status, "record_verification");
    assert.equal(state.budget.spentWorkerInvocations, 3);
    assert.equal(state.coverageUnits["coverage-1"].status, "candidate");
    assert.deepEqual(state.coverageUnits["coverage-1"].reviewedPaths, ["src/documents.ts"]);
    assert.equal(state.coverageUnits["coverage-1"].checks.length, 1);

    const candidates = Object.values(state.candidates);
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].verdict, "confirmed");
    assert.deepEqual(candidates[0].claim, CLAIM);

    const verifierTask = worker.tasks.find(
      (task): task is CandidateVerifierWorkerTask => task.kind === "candidate_verifier",
    );
    assert(verifierTask);
    assert.deepEqual(verifierTask.claim, CLAIM);
    assert.deepEqual(verifierTask.coverageIds, ["coverage-1"]);

    const restarted = new FileAuditEventStore(root);
    assert.deepEqual(restarted.loadState("run-1"), state);
    assert.equal(restarted.loadProjection("run-1")?.status, "record_verification");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("clean covered path requires and persists evidence", async () => {
  const { root, store } = tempStore();
  try {
    const worker = new ScriptedWorker([RECON_ONE, HUNTER_COVERED]);
    const state = await new AuditOrchestrator(
      store,
      worker,
      new DeterministicIds(),
    ).runThroughCandidateValidation(request(2));

    assert.equal(state.status, "record_verification");
    assert.equal(state.coverageUnits["coverage-1"].status, "covered");
    assert.deepEqual(state.coverageUnits["coverage-1"].reviewedPaths, ["src/documents.ts"]);
    assert.equal(state.coverageUnits["coverage-1"].checks.length, 1);
    assert.deepEqual(Object.keys(state.candidates), []);
    assert.equal(state.budget.spentWorkerInvocations, 2);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("evidence-free covered result is malformed and cannot become clean coverage", async () => {
  const { root, store } = tempStore();
  try {
    const worker = new ScriptedWorker([
      RECON_ONE,
      { status: "ok", result: { kind: "hunter_result", resolution: "covered" } },
    ]);
    const state = await new AuditOrchestrator(
      store,
      worker,
      new DeterministicIds(),
    ).runThroughCandidateValidation(request());

    assert.equal(state.status, "incomplete");
    assert.equal(state.coverageUnits["coverage-1"].status, "deferred");
    const hunter = Object.values(state.assignments).find((assignment) => assignment.kind === "hunter");
    assert.equal(hunter?.outcome?.kind, "malformed_result");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("duplicate fingerprint across coverage units consolidates one candidate and links both", async () => {
  const { root, store } = tempStore();
  try {
    const worker = new ScriptedWorker([
      RECON_TWO,
      HUNTER_CANDIDATE,
      HUNTER_CANDIDATE,
      CONFIRMED,
    ]);
    const state = await new AuditOrchestrator(
      store,
      worker,
      new DeterministicIds(),
    ).runThroughCandidateValidation(request(4));

    assert.equal(state.status, "record_verification");
    const candidates = Object.values(state.candidates);
    assert.equal(candidates.length, 1);
    assert.deepEqual(candidates[0].coverageIds, ["coverage-1", "coverage-2"]);
    assert.deepEqual(state.coverageUnits["coverage-1"].candidateIds, [candidates[0].candidateId]);
    assert.deepEqual(state.coverageUnits["coverage-2"].candidateIds, [candidates[0].candidateId]);

    const verifierTask = worker.tasks.find(
      (task): task is CandidateVerifierWorkerTask => task.kind === "candidate_verifier",
    );
    assert.deepEqual(verifierTask?.coverageIds, ["coverage-1", "coverage-2"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("oversized worker observation becomes malformed without poisoning durable state", async () => {
  const { root, store } = tempStore();
  try {
    const worker = new ScriptedWorker([
      RECON_ONE,
      {
        status: "error",
        kind: "provider_error",
        detail: "x".repeat(300 * 1024),
      },
    ]);
    const state = await new AuditOrchestrator(
      store,
      worker,
      new DeterministicIds(),
    ).runThroughCandidateValidation(request());

    assert.equal(state.status, "incomplete");
    const hunter = Object.values(state.assignments).find((assignment) => assignment.kind === "hunter");
    assert.equal(hunter?.outcome?.kind, "malformed_result");

    const restarted = new FileAuditEventStore(root);
    assert.deepEqual(restarted.loadState("run-1"), state);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("thrown recon provider failure is persisted and run becomes incomplete", async () => {
  const { root, store } = tempStore();
  try {
    const worker = new ScriptedWorker([new Error("provider unavailable")]);
    const state = await new AuditOrchestrator(
      store,
      worker,
      new DeterministicIds(),
    ).runThroughCandidateValidation(request());

    assert.equal(state.status, "incomplete");
    const assignment = Object.values(state.assignments)[0];
    assert.equal(assignment.status, "failed");
    assert.equal(assignment.outcome?.kind, "provider_error");
    assert.match(state.terminalReason ?? "", /recon worker ended with provider_error/);
    assert.equal(worker.tasks.length, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("hunter refusal defers coverage and produces incomplete run, never clean coverage", async () => {
  const { root, store } = tempStore();
  try {
    const worker = new ScriptedWorker([
      RECON_ONE,
      { status: "error", kind: "model_refusal", detail: "refused" },
    ]);
    const state = await new AuditOrchestrator(
      store,
      worker,
      new DeterministicIds(),
    ).runThroughCandidateValidation(request());

    assert.equal(state.status, "incomplete");
    assert.equal(state.coverageUnits["coverage-1"].status, "deferred");
    assert.deepEqual(Object.keys(state.candidates), []);
    const hunter = Object.values(state.assignments).find((assignment) => assignment.kind === "hunter");
    assert.equal(hunter?.outcome?.kind, "model_refusal");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("malformed worker result becomes malformed_result and incomplete run", async () => {
  const { root, store } = tempStore();
  try {
    const worker = new ScriptedWorker([
      { status: "ok", result: { kind: "not-a-recon-result" } },
    ]);
    const state = await new AuditOrchestrator(
      store,
      worker,
      new DeterministicIds(),
    ).runThroughCandidateValidation(request());

    assert.equal(state.status, "incomplete");
    const assignment = Object.values(state.assignments)[0];
    assert.equal(assignment.outcome?.kind, "malformed_result");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("candidate verifier failure leaves candidate unvalidated and run incomplete", async () => {
  const { root, store } = tempStore();
  try {
    const worker = new ScriptedWorker([
      RECON_ONE,
      HUNTER_CANDIDATE,
      { status: "error", kind: "timeout", detail: "deadline" },
    ]);
    const state = await new AuditOrchestrator(
      store,
      worker,
      new DeterministicIds(),
    ).runThroughCandidateValidation(request());

    assert.equal(state.status, "incomplete");
    const candidate = Object.values(state.candidates)[0];
    assert.equal(candidate.verdict, "unvalidated");
    const verifier = Object.values(state.assignments).find(
      (assignment) => assignment.kind === "candidate_verifier",
    );
    assert.equal(verifier?.outcome?.kind, "timeout");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("needs_validation opens durable finding handoff before disposition", async () => {
  const { root, store } = tempStore();
  try {
    const worker = new ScriptedWorker([
      RECON_ONE,
      HUNTER_CANDIDATE,
      {
        status: "ok",
        result: {
          kind: "candidate_validation_result",
          verdict: "needs_validation",
          evidenceRequirements: [
            {
              kind: "deployment_fact",
              description: "Confirm production ingress header stripping.",
            },
          ],
        },
      },
    ]);
    const state = await new AuditOrchestrator(
      store,
      worker,
      new DeterministicIds(),
    ).runThroughCandidateValidation(request());

    assert.equal(state.status, "record_verification");
    const candidate = Object.values(state.candidates)[0];
    assert.equal(candidate.verdict, "needs_validation");
    const requirement = Object.values(state.evidenceRequirements)[0];
    assert.equal(requirement.scope, "finding_handoff");
    assert.equal(requirement.status, "open");
    assert.equal(requirement.candidateId, candidate.candidateId);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("blocked hunter result remains unresolved and run becomes incomplete", async () => {
  const { root, store } = tempStore();
  try {
    const worker = new ScriptedWorker([
      RECON_ONE,
      {
        status: "ok",
        result: {
          kind: "hunter_result",
          resolution: "blocked",
          ...HUNTER_EVIDENCE,
          unresolved: ["deployment fact missing"],
        },
      },
    ]);
    const state = await new AuditOrchestrator(
      store,
      worker,
      new DeterministicIds(),
    ).runThroughCandidateValidation(request());

    assert.equal(state.status, "incomplete");
    assert.equal(state.coverageUnits["coverage-1"].status, "blocked");
    assert.deepEqual(state.coverageUnits["coverage-1"].unresolved, ["deployment fact missing"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("budget exhaustion becomes explicit incomplete state without invoking worker", async () => {
  const { root, store } = tempStore();
  try {
    const worker = new ScriptedWorker([]);
    const state = await new AuditOrchestrator(
      store,
      worker,
      new DeterministicIds(),
    ).runThroughCandidateValidation(request(0));

    assert.equal(state.status, "incomplete");
    assert.equal(state.budget.spentWorkerInvocations, 0);
    assert.match(state.terminalReason ?? "", /budget exhausted/);
    assert.equal(worker.tasks.length, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
