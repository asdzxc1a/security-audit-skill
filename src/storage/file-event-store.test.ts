import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  DOMAIN_SCHEMA_VERSION,
  type AuditEvent,
  type CandidateClaim,
  type CoverageCheck,
  type CoverageDefinition,
  type WorkerOutcome,
} from "../domain/contracts";
import { DomainTransitionError, replayAuditEvents } from "../domain/reducer";
import { EventStoreError, FileAuditEventStore } from "./file-event-store";
import { projectAuditState } from "./projection";

const VALID: WorkerOutcome = { kind: "valid_result", detail: null, adapter: null };

const CLAIM: CandidateClaim = {
  title: "Stored candidate",
  description: "Substantive candidate claim survives replay.",
  claimedRootCause: "A trust-boundary control is missing.",
  intendedBehavior: "The boundary must remain enforced.",
  trace: [
    { file: "src/a.ts", line: 1, scope: "entry", description: "Entry point." },
  ],
  evidence: [
    { file: "src/a.ts", line: 2, scope: "sink", description: "Boundary failure." },
  ],
  conditions: [],
};

const COVERAGE_DEFINITION: CoverageDefinition = {
  surface: "GET /documents/:id",
  boundary: "tenant ownership",
  subsystem: "documents",
  attackClass: "Access control",
  lifecycle: null,
  startingPaths: ["src/a.ts"],
  methodologyRefs: ["ATTACK-CLASSES.md#Access control"],
};

const CHECKS: readonly CoverageCheck[] = [
  {
    invariant: "Boundary must hold.",
    method: "source",
    result: "Source review completed.",
    artifactRef: null,
  },
];

const REVIEWED = ["src/a.ts"] as const;

function auditEvent(
  sequence: number,
  payload: { type: AuditEvent["type"] } & Record<string, unknown>,
): AuditEvent {
  return {
    schemaVersion: DOMAIN_SCHEMA_VERSION,
    eventId: "event-" + sequence,
    runId: "run-1",
    sequence,
    ...payload,
  } as AuditEvent;
}

function confirmedLifecycle(): AuditEvent[] {
  return [
    auditEvent(1, {
      type: "run_created",
      sourceSnapshotId: "snapshot-1",
      profile: "standard",
      scopePaths: ["src"],
      maxWorkerInvocations: 3,
    }),
    auditEvent(2, { type: "phase_advanced", to: "reconnaissance" }),
    auditEvent(3, { type: "phase_advanced", to: "coverage_planning" }),
    auditEvent(4, {
      type: "coverage_unit_registered",
      coverageId: "coverage-1",
      definition: COVERAGE_DEFINITION,
    }),
    auditEvent(5, { type: "phase_advanced", to: "hunting" }),
    auditEvent(6, {
      type: "assignment_created",
      assignmentId: "hunt-1",
      kind: "hunter",
      workerId: "hunter-a",
      coverageIds: ["coverage-1"],
      candidateId: null,
    }),
    auditEvent(7, { type: "assignment_started", assignmentId: "hunt-1" }),
    auditEvent(8, { type: "assignment_completed", assignmentId: "hunt-1", outcome: VALID }),
    auditEvent(9, {
      type: "candidate_registered",
      candidateId: "candidate-1",
      fingerprint: "root-cause-1",
      coverageId: "coverage-1",
      originAssignmentId: "hunt-1",
      claim: CLAIM,
    }),
    auditEvent(10, {
      type: "coverage_resolved",
      coverageId: "coverage-1",
      assignmentId: "hunt-1",
      resolution: "candidate",
      candidateIds: ["candidate-1"],
      reviewedPaths: REVIEWED,
      checks: CHECKS,
      unresolved: [],
    }),
    auditEvent(11, { type: "phase_advanced", to: "candidate_validation" }),
    auditEvent(12, {
      type: "assignment_created",
      assignmentId: "candidate-verify-1",
      kind: "candidate_verifier",
      workerId: "verifier-a",
      coverageIds: [],
      candidateId: "candidate-1",
    }),
    auditEvent(13, { type: "assignment_started", assignmentId: "candidate-verify-1" }),
    auditEvent(14, {
      type: "assignment_completed",
      assignmentId: "candidate-verify-1",
      outcome: VALID,
    }),
    auditEvent(15, {
      type: "candidate_disposition_recorded",
      candidateId: "candidate-1",
      verdict: "confirmed",
      verifierAssignmentId: "candidate-verify-1",
      reason: "Independent verifier reconstructed the retained claim.",
      validatedClaim: CLAIM,
    }),
    auditEvent(16, { type: "phase_advanced", to: "record_verification" }),
    auditEvent(17, {
      type: "assignment_created",
      assignmentId: "record-verify-1",
      kind: "record_verifier",
      workerId: "verifier-b",
      coverageIds: [],
      candidateId: "candidate-1",
    }),
    auditEvent(18, { type: "assignment_started", assignmentId: "record-verify-1" }),
    auditEvent(19, {
      type: "assignment_completed",
      assignmentId: "record-verify-1",
      outcome: VALID,
    }),
    auditEvent(20, {
      type: "candidate_final_verified",
      candidateId: "candidate-1",
      verifierAssignmentId: "record-verify-1",
      reason: "Independent final verification accepted the retained record.",
    }),
    auditEvent(21, { type: "phase_advanced", to: "reporting" }),
    auditEvent(22, { type: "run_completed" }),
  ];
}

function tempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "audit-event-store-"));
}

function singleRunDirectory(root: string): string {
  const entries = fs.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  assert.equal(entries.length, 1);
  return path.join(root, entries[0].name);
}

function eventFile(runDirectory: string, sequence: number): string {
  return path.join(runDirectory, "events", String(sequence).padStart(16, "0") + ".json");
}

function expectStoreCode(fn: () => unknown, code: EventStoreError["code"]): void {
  assert.throws(
    fn,
    (error: unknown) => error instanceof EventStoreError && error.code === code,
  );
}

test("accepted event stream survives restart and replays to identical canonical state", () => {
  const root = tempRoot();
  try {
    const events = confirmedLifecycle();
    const store = new FileAuditEventStore(root);
    let appendedState = null;
    for (const event of events) appendedState = store.append(event);

    const expected = replayAuditEvents(events);
    assert.deepEqual(appendedState, expected);

    const restarted = new FileAuditEventStore(root);
    assert.deepEqual(restarted.readEvents("run-1"), events);
    assert.deepEqual(restarted.loadState("run-1"), expected);
    assert.deepEqual(restarted.loadProjection("run-1"), projectAuditState(assertState(expected)));

    const projection = restarted.loadProjection("run-1");
    assert.equal(projection?.status, "complete");
    assert.equal(projection?.coverageUnits[0]?.coverageId, "coverage-1");
    assert.equal(projection?.candidates[0]?.verdict, "confirmed");
    assert.equal(projection?.budget.spentWorkerInvocations, 3);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("reducer-rejected event is never persisted", () => {
  const root = tempRoot();
  try {
    const store = new FileAuditEventStore(root);
    store.append(confirmedLifecycle()[0]);

    const invalid = auditEvent(2, { type: "phase_advanced", to: "hunting" });
    assert.throws(
      () => store.append(invalid),
      (error: unknown) =>
        error instanceof DomainTransitionError && error.code === "invalid_phase",
    );

    assert.equal(store.readEvents("run-1").length, 1);
    assert.equal(store.loadState("run-1")?.status, "created");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("duplicate event id is rejected before persistence", () => {
  const root = tempRoot();
  try {
    const store = new FileAuditEventStore(root);
    store.append(confirmedLifecycle()[0]);

    const duplicateId = {
      ...auditEvent(2, { type: "phase_advanced", to: "reconnaissance" }),
      eventId: "event-1",
    } as AuditEvent;
    expectStoreCode(() => store.append(duplicateId), "duplicate_event_id");
    assert.equal(store.readEvents("run-1").length, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});



test("exact append retry is idempotent but event-id reuse with different content fails", () => {
  const root = tempRoot();
  try {
    const store = new FileAuditEventStore(root);
    const created = confirmedLifecycle()[0];
    const first = store.append(created);
    const retried = store.append(created);

    assert.deepEqual(retried, first);
    assert.equal(store.readEvents("run-1").length, 1);

    const changed = {
      ...created,
      sourceSnapshotId: "different-snapshot",
    } as AuditEvent;
    expectStoreCode(() => store.append(changed), "duplicate_event_id");
    assert.equal(store.readEvents("run-1").length, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});



test("oversized reducer-accepted envelope is rejected before durable publication", () => {
  const root = tempRoot();
  try {
    const store = new FileAuditEventStore(root);
    const oversized = {
      ...auditEvent(1, {
        type: "run_created",
        sourceSnapshotId: "snapshot-1",
        profile: "standard",
        scopePaths: ["src"],
        maxWorkerInvocations: 1,
      }),
      ignoredPadding: "x".repeat(1024 * 1024),
    } as unknown as AuditEvent;

    expectStoreCode(() => store.append(oversized), "event_too_large");
    assert.deepEqual(store.readEvents("run-1"), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("event checksum detects modified stored payload", () => {
  const root = tempRoot();
  try {
    const store = new FileAuditEventStore(root);
    store.append(confirmedLifecycle()[0]);

    const runDirectory = singleRunDirectory(root);
    const file = eventFile(runDirectory, 1);
    const envelope = JSON.parse(fs.readFileSync(file, "utf8")) as {
      event: { sourceSnapshotId: string };
    };
    envelope.event.sourceSnapshotId = "tampered";
    fs.writeFileSync(file, JSON.stringify(envelope, null, 2) + "\n");

    const restarted = new FileAuditEventStore(root);
    expectStoreCode(() => restarted.loadState("run-1"), "corrupt_store");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("HEAD detects a deleted durable tail event", () => {
  const root = tempRoot();
  try {
    const store = new FileAuditEventStore(root);
    store.append(confirmedLifecycle()[0]);
    store.append(confirmedLifecycle()[1]);

    const runDirectory = singleRunDirectory(root);
    fs.unlinkSync(eventFile(runDirectory, 2));

    const restarted = new FileAuditEventStore(root);
    expectStoreCode(() => restarted.loadState("run-1"), "corrupt_store");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("missing HEAD is recovered from a complete checksum-validated event stream", () => {
  const root = tempRoot();
  try {
    const store = new FileAuditEventStore(root);
    store.append(confirmedLifecycle()[0]);
    store.append(confirmedLifecycle()[1]);

    const runDirectory = singleRunDirectory(root);
    const head = path.join(runDirectory, "HEAD.json");
    fs.unlinkSync(head);

    const restarted = new FileAuditEventStore(root);
    const state = restarted.loadState("run-1");
    assert.equal(state?.sequence, 2);
    assert.equal(state?.status, "reconnaissance");
    assert.equal(fs.existsSync(head), true);

    const recoveredHead = JSON.parse(fs.readFileSync(head, "utf8")) as {
      runId: string;
      sequence: number;
      checksum: string;
    };
    assert.equal(recoveredHead.runId, "run-1");
    assert.equal(recoveredHead.sequence, 2);
    assert.match(recoveredHead.checksum, /^[a-f0-9]{64}$/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("unpublished temp event files are ignored during recovery", () => {
  const root = tempRoot();
  try {
    const store = new FileAuditEventStore(root);
    store.append(confirmedLifecycle()[0]);
    const runDirectory = singleRunDirectory(root);
    fs.writeFileSync(path.join(runDirectory, "events", ".tmp-crash-leftover"), "{broken");

    const restarted = new FileAuditEventStore(root);
    assert.equal(restarted.loadState("run-1")?.sequence, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function assertState<T>(state: T | null): T {
  assert.notEqual(state, null);
  return state as T;
}
