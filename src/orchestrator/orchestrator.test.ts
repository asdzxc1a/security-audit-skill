import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import type {
  AdapterRef,
  CandidateClaim,
  CoverageDefinition,
} from "../domain/contracts";
import { FileAuditEventStore } from "../storage/file-event-store";
import type {
  AuditRunRequest,
  CandidateVerifierWorkerTask,
  CoverageCriticWorkerTask,
  HunterWorkerTask,
  IdSource,
  RecordVerifierWorkerTask,
  WorkerAdapter,
  WorkerTask,
} from "./contracts";
import { AuditOrchestrator } from "./orchestrator";

class DeterministicIds implements IdSource {
  private readonly sequences = new Map<string, number>();

  next(prefix: string): string {
    const sequence = (this.sequences.get(prefix) ?? 0) + 1;
    this.sequences.set(prefix, sequence);
    return prefix + "-" + sequence;
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

function request(
  maxWorkerInvocations: number | null = 10,
  profile: AuditRunRequest["profile"] = "standard",
): AuditRunRequest {
  return {
    runId: "run-1",
    sourceSnapshotId: "snapshot-1",
    profile,
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

const VALIDATED_CLAIM: CandidateClaim = {
  ...CLAIM,
  description: "Independent candidate verification reconstructed the cross-tenant read.",
  evidence: [
    ...CLAIM.evidence,
    {
      file: "src/routes.ts",
      line: 22,
      scope: "getDocumentRoute",
      description: "The route forwards the tenant actor and caller-selected document id.",
    },
  ],
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

const COVERAGE_DEFINITION: CoverageDefinition = {
  surface: "GET /documents/:id",
  boundary: "tenant ownership",
  subsystem: "documents",
  attackClass: "Access control",
  lifecycle: null,
  startingPaths: ["src/documents.ts"],
  methodologyRefs: ["ATTACK-CLASSES.md#Access control"],
};

const COVERAGE_DEFINITION_TWO: CoverageDefinition = {
  surface: "POST /documents/export",
  boundary: "tenant ownership",
  subsystem: "documents-export",
  attackClass: "Access control",
  lifecycle: "asynchronous export",
  startingPaths: ["src/export.ts"],
  methodologyRefs: ["ATTACK-CLASSES.md#Access control"],
};

const RECON_ONE = {
  status: "ok",
  result: {
    kind: "recon_result",
    coverageDefinitions: [COVERAGE_DEFINITION],
  },
};

const RECON_TWO = {
  status: "ok",
  result: {
    kind: "recon_result",
    coverageDefinitions: [COVERAGE_DEFINITION, COVERAGE_DEFINITION_TWO],
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
    reason: "Independent candidate verifier reproduced the source-level boundary failure.",
    validatedClaim: VALIDATED_CLAIM,
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
    assert.deepEqual(candidates[0].claim, VALIDATED_CLAIM);
    assert.match(candidates[0].candidateValidationReason ?? "", /reproduced/);

    const hunterTask = worker.tasks.find(
      (task): task is HunterWorkerTask => task.kind === "hunter",
    );
    assert(hunterTask);
    assert.deepEqual(hunterTask.definition, COVERAGE_DEFINITION);

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

test("recon semantic aliases are malformed before coverage ids are allocated", async () => {
  const { root, store } = tempStore();
  try {
    const worker = new ScriptedWorker([
      {
        status: "ok",
        result: {
          kind: "recon_result",
          coverageDefinitions: [
            COVERAGE_DEFINITION,
            {
              ...COVERAGE_DEFINITION,
              startingPaths: ["src/alternate.ts"],
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

    assert.equal(state.status, "incomplete");
    const recon = Object.values(state.assignments)[0];
    assert.equal(recon.outcome?.kind, "malformed_result");
    assert.deepEqual(Object.keys(state.coverageUnits), []);
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
          reason: "Independent verifier requires deployment context.",
          validatedClaim: VALIDATED_CLAIM,
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


const CRITIC_CLEAN_ONE = {
  status: "ok",
  result: {
    kind: "coverage_critic_result",
    reviewedCoverageIds: ["coverage-1"],
    reassignments: [],
    stop: true,
  },
};

const RECORD_ACCEPT = {
  status: "ok",
  result: {
    kind: "record_verification_result",
    disposition: "accept",
    reason: "Independent final verifier reconstructed and accepted the retained claim.",
  },
};

test("standard full audit requires two consecutive clean critic passes", async () => {
  const { root, store } = tempStore();
  try {
    const worker = new ScriptedWorker([
      RECON_ONE,
      HUNTER_COVERED,
      CRITIC_CLEAN_ONE,
      CRITIC_CLEAN_ONE,
    ]);
    const state = await new AuditOrchestrator(
      store,
      worker,
      new DeterministicIds(),
    ).runFullAudit(request(4, "standard"));

    assert.equal(state.status, "complete");
    const critics = worker.tasks.filter(
      (task): task is CoverageCriticWorkerTask => task.kind === "coverage_critic",
    );
    assert.equal(critics.length, 2);
    assert.notEqual(critics[0].workerId, critics[1].workerId);
    assert.deepEqual(critics[0].reopenableCoverageIds, ["coverage-1"]);
    assert.equal(critics[0].coverageUnits[0].status, "covered");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("quick critic reassignment reopens coverage and requires a fresh hunter before clean stop", async () => {
  const { root, store } = tempStore();
  try {
    const criticReassign = {
      status: "ok",
      result: {
        kind: "coverage_critic_result",
        reviewedCoverageIds: ["coverage-1"],
        reassignments: [
          { coverageId: "coverage-1", reason: "Review the alternate ownership path." },
        ],
        stop: false,
      },
    };
    const secondHunter = {
      status: "ok",
      result: {
        kind: "hunter_result",
        resolution: "covered",
        reviewedPaths: ["src/documents.ts", "src/alternate.ts"],
        checks: [
          {
            invariant: "All document reads remain tenant scoped.",
            method: "source",
            result: "Reviewed both primary and alternate lookup paths.",
            artifactRef: null,
          },
        ],
      },
    };
    const worker = new ScriptedWorker([
      RECON_ONE,
      HUNTER_COVERED,
      criticReassign,
      secondHunter,
      CRITIC_CLEAN_ONE,
    ]);
    const state = await new AuditOrchestrator(
      store,
      worker,
      new DeterministicIds(),
    ).runFullAudit(request(5, "quick"));

    assert.equal(state.status, "complete");
    const hunters = worker.tasks.filter((task) => task.kind === "hunter");
    assert.equal(hunters.length, 2);
    assert.notEqual(hunters[0].workerId, hunters[1].workerId);
    assert.deepEqual(state.coverageUnits["coverage-1"].reviewedPaths, [
      "src/documents.ts",
      "src/alternate.ts",
    ]);
    assert.equal(
      state.coverageUnits["coverage-1"].checks[0].result,
      "Reviewed both primary and alternate lookup paths.",
    );

    const events = store.readEvents("run-1");
    assert(events.some((event) => event.type === "coverage_reopened"));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("critic can reopen candidate coverage without duplicating the existing root cause", async () => {
  const { root, store } = tempStore();
  try {
    const criticReassign = {
      status: "ok",
      result: {
        kind: "coverage_critic_result",
        reviewedCoverageIds: ["coverage-1"],
        reassignments: [
          { coverageId: "coverage-1", reason: "Recheck the parallel lookup path." },
        ],
        stop: false,
      },
    };
    const worker = new ScriptedWorker([
      RECON_ONE,
      HUNTER_CANDIDATE,
      criticReassign,
      HUNTER_CANDIDATE,
      CRITIC_CLEAN_ONE,
      CONFIRMED,
      RECORD_ACCEPT,
    ]);
    const state = await new AuditOrchestrator(
      store,
      worker,
      new DeterministicIds(),
    ).runFullAudit(request(7, "quick"));

    assert.equal(state.status, "complete");
    assert.equal(Object.values(state.candidates).length, 1);
    const candidate = Object.values(state.candidates)[0];
    assert.deepEqual(candidate.coverageIds, ["coverage-1"]);
    assert.equal(state.coverageUnits["coverage-1"].status, "candidate");
    assert.deepEqual(state.coverageUnits["coverage-1"].candidateIds, [candidate.candidateId]);

    const hunters = worker.tasks.filter((task) => task.kind === "hunter");
    assert.equal(hunters.length, 2);
    assert.notEqual(hunters[0].workerId, hunters[1].workerId);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("critic clean-stop over blocked coverage is malformed and run becomes incomplete", async () => {
  const { root, store } = tempStore();
  try {
    const blocked = {
      status: "ok",
      result: {
        kind: "hunter_result",
        resolution: "blocked",
        ...HUNTER_EVIDENCE,
        unresolved: ["deployment fact missing"],
      },
    };
    const worker = new ScriptedWorker([RECON_ONE, blocked, CRITIC_CLEAN_ONE]);
    const state = await new AuditOrchestrator(
      store,
      worker,
      new DeterministicIds(),
    ).runFullAudit(request(3, "quick"));

    assert.equal(state.status, "incomplete");
    const critic = Object.values(state.assignments).find(
      (assignment) => assignment.kind === "coverage_critic",
    );
    assert.equal(critic?.outcome?.kind, "malformed_result");
    assert.equal(state.coverageUnits["coverage-1"].status, "blocked");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("critic provider failure is explicit incomplete state", async () => {
  const { root, store } = tempStore();
  try {
    const worker = new ScriptedWorker([
      RECON_ONE,
      HUNTER_COVERED,
      { status: "error", kind: "provider_error", detail: "critic unavailable" },
    ]);
    const state = await new AuditOrchestrator(
      store,
      worker,
      new DeterministicIds(),
    ).runFullAudit(request(3, "quick"));

    assert.equal(state.status, "incomplete");
    assert.match(state.terminalReason ?? "", /coverage critic ended with provider_error/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("critic budget exhaustion becomes incomplete before critic invocation", async () => {
  const { root, store } = tempStore();
  try {
    const worker = new ScriptedWorker([RECON_ONE, HUNTER_COVERED]);
    const state = await new AuditOrchestrator(
      store,
      worker,
      new DeterministicIds(),
    ).runFullAudit(request(2, "quick"));

    assert.equal(state.status, "incomplete");
    assert.match(state.terminalReason ?? "", /budget exhausted/);
    assert.equal(worker.tasks.filter((task) => task.kind === "coverage_critic").length, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("confirmed candidate passes independent final record verification and completes", async () => {
  const { root, store } = tempStore();
  try {
    const worker = new ScriptedWorker([
      RECON_ONE,
      HUNTER_CANDIDATE,
      CRITIC_CLEAN_ONE,
      CONFIRMED,
      RECORD_ACCEPT,
    ]);
    const state = await new AuditOrchestrator(
      store,
      worker,
      new DeterministicIds(),
    ).runFullAudit(request(5, "quick"));

    assert.equal(state.status, "complete");
    const candidate = Object.values(state.candidates)[0];
    assert.equal(candidate.verdict, "confirmed");
    assert(candidate.finalVerifierAssignmentId);
    assert.match(candidate.finalVerificationReason ?? "", /accepted/);

    const verifierTask = worker.tasks.find(
      (task): task is RecordVerifierWorkerTask => task.kind === "record_verifier",
    );
    assert(verifierTask);
    assert.equal(verifierTask.verdict, "confirmed");
    assert.deepEqual(verifierTask.claim, VALIDATED_CLAIM);
    assert.match(verifierTask.candidateValidationReason, /reproduced/);
    assert.deepEqual(verifierTask.coverageIds, ["coverage-1"]);

    const origin = state.assignments[candidate.originAssignmentId];
    const candidateVerifier = state.assignments[candidate.candidateVerifierAssignmentId ?? ""];
    const recordVerifier = state.assignments[candidate.finalVerifierAssignmentId ?? ""];
    assert.notEqual(recordVerifier.workerId, origin.workerId);
    assert.notEqual(recordVerifier.workerId, candidateVerifier.workerId);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("final record rejection converts retained candidate to rejected and still completes", async () => {
  const { root, store } = tempStore();
  try {
    const worker = new ScriptedWorker([
      RECON_ONE,
      HUNTER_CANDIDATE,
      CRITIC_CLEAN_ONE,
      CONFIRMED,
      {
        status: "ok",
        result: {
          kind: "record_verification_result",
          disposition: "reject",
          reason: "Independent reconstruction found the claimed boundary was not crossed.",
        },
      },
    ]);
    const state = await new AuditOrchestrator(
      store,
      worker,
      new DeterministicIds(),
    ).runFullAudit(request(5, "quick"));

    assert.equal(state.status, "complete");
    const candidate = Object.values(state.candidates)[0];
    assert.equal(candidate.verdict, "rejected");
    assert.match(candidate.finalVerificationReason ?? "", /not crossed/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("final rejection of needs_validation closes its handoff evidence before completion", async () => {
  const { root, store } = tempStore();
  try {
    const needsValidation = {
      status: "ok",
      result: {
        kind: "candidate_validation_result",
        verdict: "needs_validation",
        reason: "Independent verifier requires deployment context.",
        validatedClaim: VALIDATED_CLAIM,
        evidenceRequirements: [
          {
            kind: "deployment_fact",
            description: "Confirm production ingress behavior.",
          },
        ],
      },
    };
    const worker = new ScriptedWorker([
      RECON_ONE,
      HUNTER_CANDIDATE,
      CRITIC_CLEAN_ONE,
      needsValidation,
      {
        status: "ok",
        result: {
          kind: "record_verification_result",
          disposition: "reject",
          reason: "Source-level claim does not survive final reconstruction.",
        },
      },
    ]);
    const state = await new AuditOrchestrator(
      store,
      worker,
      new DeterministicIds(),
    ).runFullAudit(request(5, "quick"));

    assert.equal(state.status, "complete");
    assert.equal(Object.values(state.candidates)[0].verdict, "rejected");
    const requirement = Object.values(state.evidenceRequirements)[0];
    assert.equal(requirement.status, "resolved");
    assert.match(requirement.resolution ?? "", /Final record verifier rejected/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("record verifier failure prevents a complete report", async () => {
  const { root, store } = tempStore();
  try {
    const worker = new ScriptedWorker([
      RECON_ONE,
      HUNTER_CANDIDATE,
      CRITIC_CLEAN_ONE,
      CONFIRMED,
      { status: "error", kind: "timeout", detail: "final verifier deadline" },
    ]);
    const state = await new AuditOrchestrator(
      store,
      worker,
      new DeterministicIds(),
    ).runFullAudit(request(5, "quick"));

    assert.equal(state.status, "incomplete");
    assert.match(state.terminalReason ?? "", /record verifier ended with timeout/);
    assert.equal(Object.values(state.candidates)[0].finalVerifierAssignmentId, null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
