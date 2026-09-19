import crypto from "node:crypto";

import {
  DOMAIN_SCHEMA_VERSION,
  type AuditEvent,
  type AuditRunState,
  type Candidate,
  type WorkerOutcome,
} from "../domain/contracts";
import { DomainTransitionError } from "../domain/reducer";
import type { AuditEventStore } from "../storage/contracts";
import {
  ORCHESTRATION_SCHEMA_VERSION,
  type AuditRunRequest,
  type CandidateValidationResult,
  type HunterWorkerResult,
  type IdSource,
  type ParsedWorkerObservation,
  type ReconWorkerResult,
  type WorkerAdapter,
  type WorkerTask,
} from "./contracts";
import {
  ObservationParseError,
  malformedOutcome,
  parseWorkerObservation,
  providerErrorOutcome,
} from "./observation";

export type OrchestrationErrorCode =
  | "run_exists"
  | "run_missing"
  | "unexpected_state";

export class OrchestrationError extends Error {
  readonly code: OrchestrationErrorCode;

  constructor(code: OrchestrationErrorCode, message: string) {
    super(message);
    this.name = "OrchestrationError";
    this.code = code;
  }
}

export class RandomIdSource implements IdSource {
  next(prefix: string): string {
    return prefix + "-" + crypto.randomUUID();
  }
}

interface AssignmentExecution {
  readonly assignmentId: string;
  readonly workerId: string;
  readonly observation: ParsedWorkerObservation;
}

const TERMINAL = new Set(["complete", "incomplete", "cancelled", "failed"]);

export class AuditOrchestrator {
  constructor(
    private readonly store: AuditEventStore,
    private readonly worker: WorkerAdapter,
    private readonly ids: IdSource = new RandomIdSource(),
  ) {}

  async runThroughCandidateValidation(request: AuditRunRequest): Promise<AuditRunState> {
    if (this.store.loadState(request.runId) !== null) {
      throw new OrchestrationError("run_exists", "run already exists: " + request.runId);
    }

    this.append(request.runId, {
      type: "run_created",
      sourceSnapshotId: request.sourceSnapshotId,
      profile: request.profile,
      scopePaths: [...request.scopePaths],
      maxWorkerInvocations: request.maxWorkerInvocations,
    });
    this.append(request.runId, { type: "phase_advanced", to: "reconnaissance" });

    const reconExecution = await this.executeRecon(request.runId);
    if (reconExecution === null) return this.current(request.runId);
    if (reconExecution.observation.outcome.kind !== "valid_result") {
      return this.markIncomplete(
        request.runId,
        "recon worker ended with " + reconExecution.observation.outcome.kind,
      );
    }

    const recon = reconExecution.observation.result as ReconWorkerResult;
    this.append(request.runId, { type: "phase_advanced", to: "coverage_planning" });
    for (const coverageId of recon.coverageIds) {
      this.append(request.runId, { type: "coverage_unit_registered", coverageId });
    }
    this.append(request.runId, { type: "phase_advanced", to: "hunting" });

    let incomplete = false;

    for (const coverageId of recon.coverageIds) {
      const execution = await this.executeHunter(request.runId, coverageId);
      if (execution === null) return this.current(request.runId);

      if (execution.observation.outcome.kind !== "valid_result") {
        const reason = "hunter worker ended with " + execution.observation.outcome.kind;
        this.append(request.runId, {
          type: "coverage_requeued",
          coverageId,
          assignmentId: execution.assignmentId,
          reason,
        });
        this.append(request.runId, {
          type: "coverage_classified",
          coverageId,
          status: "deferred",
          reason,
        });
        incomplete = true;
        continue;
      }

      const result = execution.observation.result as HunterWorkerResult;
      if (result.resolution === "covered") {
        this.append(request.runId, {
          type: "coverage_resolved",
          coverageId,
          assignmentId: execution.assignmentId,
          resolution: "covered",
          candidateIds: [],
          reviewedPaths: [...result.reviewedPaths],
          checks: result.checks.map((check) => ({ ...check })),
          unresolved: [],
        });
      } else if (result.resolution === "blocked") {
        this.append(request.runId, {
          type: "coverage_resolved",
          coverageId,
          assignmentId: execution.assignmentId,
          resolution: "blocked",
          candidateIds: [],
          reviewedPaths: [...result.reviewedPaths],
          checks: result.checks.map((check) => ({ ...check })),
          unresolved: [...result.unresolved],
        });
        incomplete = true;
      } else {
        const candidateIds: string[] = [];
        for (const draft of result.candidates) {
          const current = this.current(request.runId);
          const existing = Object.values(current.candidates).find(
            (candidate) => candidate.fingerprint === draft.fingerprint,
          );

          if (existing) {
            if (!existing.coverageIds.includes(coverageId)) {
              this.append(request.runId, {
                type: "candidate_linked_to_coverage",
                candidateId: existing.candidateId,
                coverageId,
                assignmentId: execution.assignmentId,
              });
            }
            candidateIds.push(existing.candidateId);
            continue;
          }

          const candidateId = this.ids.next("candidate");
          this.append(request.runId, {
            type: "candidate_registered",
            candidateId,
            fingerprint: draft.fingerprint,
            coverageId,
            originAssignmentId: execution.assignmentId,
            claim: structuredClone(draft.claim),
          });
          candidateIds.push(candidateId);
        }
        this.append(request.runId, {
          type: "coverage_resolved",
          coverageId,
          assignmentId: execution.assignmentId,
          resolution: "candidate",
          candidateIds,
          reviewedPaths: [...result.reviewedPaths],
          checks: result.checks.map((check) => ({ ...check })),
          unresolved: [],
        });
      }
    }

    this.append(request.runId, { type: "phase_advanced", to: "candidate_validation" });

    const candidates = Object.values(this.current(request.runId).candidates).sort((left, right) =>
      left.candidateId.localeCompare(right.candidateId),
    );

    for (const candidate of candidates) {
      if (candidate.verdict !== "unvalidated") continue;
      const execution = await this.executeCandidateVerifier(request.runId, candidate);
      if (execution === null) return this.current(request.runId);

      if (execution.observation.outcome.kind !== "valid_result") {
        incomplete = true;
        continue;
      }

      const result = execution.observation.result as CandidateValidationResult;
      if (result.verdict === "needs_validation") {
        for (const requirement of result.evidenceRequirements) {
          this.append(request.runId, {
            type: "evidence_requirement_opened",
            requirementId: this.ids.next("requirement"),
            kind: requirement.kind,
            scope: "finding_handoff",
            candidateId: candidate.candidateId,
            description: requirement.description,
          });
        }
      }

      this.append(request.runId, {
        type: "candidate_disposition_recorded",
        candidateId: candidate.candidateId,
        verdict: result.verdict,
        verifierAssignmentId: execution.assignmentId,
      });
    }

    const state = this.current(request.runId);
    const unresolvedCandidate = Object.values(state.candidates).some(
      (candidate) => candidate.verdict === "unvalidated",
    );
    const unresolvedCoverage = Object.values(state.coverageUnits).some(
      (coverage) => coverage.status === "blocked" || coverage.status === "deferred",
    );

    if (incomplete || unresolvedCandidate || unresolvedCoverage) {
      return this.markIncomplete(
        request.runId,
        "audit has unresolved worker, candidate, or coverage work",
      );
    }

    return this.append(request.runId, {
      type: "phase_advanced",
      to: "record_verification",
    });
  }

  private async executeRecon(runId: string): Promise<AssignmentExecution | null> {
    const state = this.current(runId);
    return this.executeAssignment(
      runId,
      "recon",
      [],
      null,
      (assignmentId, workerId): WorkerTask => ({
        schemaVersion: ORCHESTRATION_SCHEMA_VERSION,
        kind: "recon",
        runId,
        assignmentId,
        workerId,
        sourceSnapshotId: state.sourceSnapshotId,
        profile: state.profile,
        scopePaths: [...state.scopePaths],
      }),
    );
  }

  private async executeHunter(
    runId: string,
    coverageId: string,
  ): Promise<AssignmentExecution | null> {
    const state = this.current(runId);
    return this.executeAssignment(
      runId,
      "hunter",
      [coverageId],
      null,
      (assignmentId, workerId): WorkerTask => ({
        schemaVersion: ORCHESTRATION_SCHEMA_VERSION,
        kind: "hunter",
        runId,
        assignmentId,
        workerId,
        sourceSnapshotId: state.sourceSnapshotId,
        profile: state.profile,
        coverageId,
      }),
    );
  }

  private async executeCandidateVerifier(
    runId: string,
    candidate: Candidate,
  ): Promise<AssignmentExecution | null> {
    const state = this.current(runId);
    return this.executeAssignment(
      runId,
      "candidate_verifier",
      [],
      candidate.candidateId,
      (assignmentId, workerId): WorkerTask => ({
        schemaVersion: ORCHESTRATION_SCHEMA_VERSION,
        kind: "candidate_verifier",
        runId,
        assignmentId,
        workerId,
        sourceSnapshotId: state.sourceSnapshotId,
        profile: state.profile,
        candidateId: candidate.candidateId,
        fingerprint: candidate.fingerprint,
        coverageIds: [...candidate.coverageIds],
        claim: structuredClone(candidate.claim),
      }),
    );
  }

  private async executeAssignment(
    runId: string,
    kind: "recon" | "hunter" | "candidate_verifier",
    coverageIds: readonly string[],
    candidateId: string | null,
    taskFactory: (assignmentId: string, workerId: string) => WorkerTask,
  ): Promise<AssignmentExecution | null> {
    const assignmentId = this.ids.next("assignment");
    const workerId = this.ids.next("worker");

    try {
      this.append(runId, {
        type: "assignment_created",
        assignmentId,
        kind,
        workerId,
        coverageIds: [...coverageIds],
        candidateId,
      });
    } catch (error) {
      if (error instanceof DomainTransitionError && error.code === "budget_exhausted") {
        this.markIncomplete(runId, "worker invocation budget exhausted");
        return null;
      }
      throw error;
    }

    this.append(runId, { type: "assignment_started", assignmentId });
    const task = taskFactory(assignmentId, workerId);
    const observation = await this.observe(task);
    this.append(runId, {
      type: "assignment_completed",
      assignmentId,
      outcome: observation.outcome,
    });

    return { assignmentId, workerId, observation };
  }

  private async observe(task: WorkerTask): Promise<ParsedWorkerObservation> {
    let raw: unknown;
    try {
      raw = await this.worker.execute(task);
    } catch (error) {
      return {
        outcome: providerErrorOutcome(this.worker.ref, error),
        result: null,
      } as ParsedWorkerObservation;
    }

    try {
      return parseWorkerObservation(task, raw, this.worker.ref);
    } catch (error) {
      if (!(error instanceof ObservationParseError)) throw error;
      return {
        outcome: malformedOutcome(this.worker.ref, error),
        result: null,
      } as ParsedWorkerObservation;
    }
  }

  private append(
    runId: string,
    payload: { type: AuditEvent["type"] } & Record<string, unknown>,
  ): AuditRunState {
    const state = this.store.loadState(runId);
    const event = {
      schemaVersion: DOMAIN_SCHEMA_VERSION,
      eventId: this.ids.next("event"),
      runId,
      sequence: (state?.sequence ?? 0) + 1,
      ...payload,
    } as AuditEvent;
    return this.store.append(event);
  }

  private current(runId: string): AuditRunState {
    const state = this.store.loadState(runId);
    if (state === null) throw new OrchestrationError("run_missing", "run does not exist: " + runId);
    return state;
  }

  private markIncomplete(runId: string, reason: string): AuditRunState {
    const state = this.current(runId);
    if (TERMINAL.has(state.status)) return state;
    return this.append(runId, { type: "run_marked_incomplete", reason });
  }
}
