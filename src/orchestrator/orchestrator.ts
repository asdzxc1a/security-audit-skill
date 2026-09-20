import crypto from "node:crypto";

import {
  DOMAIN_SCHEMA_VERSION,
  type AuditEvent,
  type AssignmentKind,
  type AuditRunState,
  type Candidate,
  type JsonValue,
  type WorkerAssignment,
  type WorkerOutcome,
} from "../domain/contracts";
import { DomainTransitionError } from "../domain/reducer";
import type { AuditEventStore } from "../storage/contracts";
import {
  ORCHESTRATION_SCHEMA_VERSION,
  type AuditRunRequest,
  type CandidateValidationResult,
  type CoverageCriticResult,
  type HunterWorkerResult,
  type RecordVerificationResult,
  type IdSource,
  type ParsedWorkerObservation,
  type ReconWorkerResult,
  type WorkerAdapter,
  type WorkerResult,
  type WorkerResultReceipt,
  type WorkerTask,
  type WorkerTaskReceipt,
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

function sameCandidateClaim(left: Candidate["claim"], right: Candidate["claim"]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

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

  async runToTerminal(request: AuditRunRequest): Promise<AuditRunState> {
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
    return this.resumeToTerminal(request.runId);
  }

  async resumeToTerminal(runId: string): Promise<AuditRunState> {
    if (this.store.loadState(runId) === null) {
      throw new OrchestrationError("run_missing", "run does not exist: " + runId);
    }

    for (let iteration = 0; iteration < 10_000; iteration++) {
      const state = this.current(runId);
      if (TERMINAL.has(state.status)) return state;

      switch (state.status) {
        case "created":
          this.append(runId, { type: "phase_advanced", to: "reconnaissance" });
          break;
        case "reconnaissance":
          await this.resumeReconnaissance(runId);
          break;
        case "coverage_planning":
          this.resumeCoveragePlanning(runId);
          break;
        case "hunting":
          await this.resumeHunting(runId);
          break;
        case "candidate_validation":
          await this.resumeCandidateValidation(runId);
          break;
        case "record_verification":
          await this.resumeRecordVerification(runId);
          break;
        case "reporting":
          return this.finishReporting(runId);
        default:
          throw new OrchestrationError(
            "unexpected_state",
            "unsupported active run status " + String(state.status),
          );
      }
    }

    throw new OrchestrationError(
      "unexpected_state",
      "resume loop exceeded bounded progress limit",
    );
  }

  private async resumeReconnaissance(runId: string): Promise<void> {
    const state = this.current(runId);
    const assignments = this.assignmentsOfKind(state, "recon");
    const latest = assignments.at(-1);

    if (!latest) {
      await this.executeRecon(runId);
      return;
    }

    if (latest.status === "planned") {
      await this.executeStoredAssignment(runId, latest);
      return;
    }

    if (latest.status === "in_progress") {
      this.interruptAssignment(runId, latest);
      return;
    }

    if (latest.status === "succeeded") {
      this.resultFromAssignment(runId, latest, "recon_result");
      this.append(runId, { type: "phase_advanced", to: "coverage_planning" });
      return;
    }

    if (latest.outcome?.kind === "orchestrator_interrupted") {
      await this.executeRecon(runId);
      return;
    }

    const reason =
      "recon worker ended with " + (latest.outcome?.kind ?? latest.status);
    this.recordIncompleteReason(runId, reason);
    this.markIncomplete(runId, reason);
  }

  private resumeCoveragePlanning(runId: string): void {
    const state = this.current(runId);
    const succeeded = this.assignmentsOfKind(state, "recon")
      .filter((assignment) => assignment.status === "succeeded")
      .at(-1);
    if (!succeeded) {
      throw new OrchestrationError(
        "unexpected_state",
        "coverage planning requires a succeeded recon assignment",
      );
    }

    const result = this.resultFromAssignment(runId, succeeded, "recon_result");
    for (const coverageId of result.coverageIds) {
      const current = this.current(runId);
      if (!current.coverageUnits[coverageId]) {
        this.append(runId, { type: "coverage_unit_registered", coverageId });
      }
    }
    this.append(runId, { type: "phase_advanced", to: "hunting" });
  }

  private async resumeHunting(runId: string): Promise<void> {
    const state = this.current(runId);
    const pending = Object.values(state.coverageUnits)
      .filter(
        (coverage) =>
          coverage.status === "planned" || coverage.status === "in_progress",
      )
      .sort((left, right) => left.coverageId.localeCompare(right.coverageId));

    if (pending.length > 0) {
      await this.resumeCoverageUnit(runId, pending[0].coverageId);
      return;
    }

    for (const coverage of Object.values(state.coverageUnits)) {
      if (coverage.status === "blocked" || coverage.status === "deferred") {
        this.recordIncompleteReason(
          runId,
          "coverage " + coverage.coverageId + " remains " + coverage.status,
        );
      }
    }

    const postWave = await this.resumeCriticRound(
      runId,
      "post_wave",
      state.profile === "quick" ? "defer" : "hunt",
      state.profile === "quick"
        ? "quick profile deferred critic-requested work"
        : "post-wave critic requested additional work",
    );
    if (postWave === "progressed") return;

    if (postWave === "failed" || state.profile === "quick") {
      this.append(runId, { type: "phase_advanced", to: "candidate_validation" });
      return;
    }

    const afterPostWave = this.current(runId);
    if (
      Object.values(afterPostWave.coverageUnits).some(
        (coverage) =>
          coverage.status === "planned" || coverage.status === "in_progress",
      )
    ) {
      return;
    }

    const finalClean = await this.resumeCriticRound(
      runId,
      "final_clean",
      "defer",
      "bounded final-clean critic still requested work",
    );
    if (finalClean === "progressed") return;

    this.append(runId, { type: "phase_advanced", to: "candidate_validation" });
  }

  private async resumeCoverageUnit(
    runId: string,
    coverageId: string,
  ): Promise<void> {
    const state = this.current(runId);
    const coverage = state.coverageUnits[coverageId];
    if (!coverage) {
      throw new OrchestrationError(
        "unexpected_state",
        "unknown coverage unit " + coverageId,
      );
    }

    if (coverage.status === "planned") {
      const planned = this.hunterAssignmentsForCoverage(state, coverageId)
        .filter((assignment) => assignment.status === "planned")
        .at(-1);
      if (planned) {
        await this.executeStoredAssignment(runId, planned);
      } else {
        await this.executeHunter(runId, coverageId);
      }
      return;
    }

    if (coverage.status !== "in_progress" || coverage.assignmentId === null) {
      throw new OrchestrationError(
        "unexpected_state",
        "pending coverage has inconsistent assignment state",
      );
    }

    const assignment = state.assignments[coverage.assignmentId];
    if (!assignment) {
      throw new OrchestrationError(
        "unexpected_state",
        "coverage references missing hunter assignment",
      );
    }

    if (assignment.status === "in_progress") {
      this.interruptAssignment(runId, assignment);
      return;
    }

    if (assignment.status === "succeeded") {
      const result = this.resultFromAssignment(runId, assignment, "hunter_result");
      this.applyHunterResult(runId, coverageId, assignment.assignmentId, result);
      return;
    }

    if (assignment.status === "failed" || assignment.status === "cancelled") {
      const reason =
        "hunter worker ended with " + (assignment.outcome?.kind ?? assignment.status);
      this.append(runId, {
        type: "coverage_requeued",
        coverageId,
        assignmentId: assignment.assignmentId,
        reason,
      });
      if (assignment.outcome?.kind !== "orchestrator_interrupted") {
        this.append(runId, {
          type: "coverage_classified",
          coverageId,
          status: "deferred",
          reason,
        });
        this.recordIncompleteReason(runId, reason);
      }
      return;
    }

    throw new OrchestrationError(
      "unexpected_state",
      "in-progress coverage points to planned assignment",
    );
  }

  private async resumeCriticRound(
    runId: string,
    round: "post_wave" | "final_clean",
    mode: "hunt" | "defer",
    workReason: string,
  ): Promise<"complete" | "progressed" | "failed"> {
    const state = this.current(runId);
    const assignments = this.criticAssignmentsForRound(state, round);
    const latest = assignments.at(-1);

    if (!latest) {
      await this.executeCoverageCritic(runId, round);
      return "progressed";
    }

    if (latest.status === "planned") {
      await this.executeStoredAssignment(runId, latest);
      return "progressed";
    }

    if (latest.status === "in_progress") {
      this.interruptAssignment(runId, latest);
      return "progressed";
    }

    if (latest.status === "failed" || latest.status === "cancelled") {
      if (latest.outcome?.kind === "orchestrator_interrupted") {
        await this.executeCoverageCritic(runId, round);
        return "progressed";
      }
      this.recordIncompleteReason(
        runId,
        (round === "post_wave" ? "post-wave" : "final-clean") +
          " coverage critic ended with " +
          (latest.outcome?.kind ?? latest.status),
      );
      return "failed";
    }

    const result = this.resultFromAssignment(runId, latest, "coverage_critic_result");
    const changed = this.applyCriticResult(
      runId,
      latest.assignmentId,
      result,
      mode,
      workReason,
    );
    return changed ? "progressed" : "complete";
  }

  private async resumeCandidateValidation(runId: string): Promise<void> {
    const state = this.current(runId);
    const candidates = Object.values(state.candidates).sort((left, right) =>
      left.candidateId.localeCompare(right.candidateId),
    );

    let permanentlyUnvalidated = false;

    for (const candidate of candidates) {
      if (candidate.verdict !== "unvalidated") continue;

      const assignments = this.assignmentsForCandidate(
        state,
        "candidate_verifier",
        candidate.candidateId,
      );
      const latest = assignments.at(-1);

      if (!latest) {
        await this.executeCandidateVerifier(runId, candidate);
        return;
      }
      if (latest.status === "planned") {
        await this.executeStoredAssignment(runId, latest);
        return;
      }
      if (latest.status === "in_progress") {
        this.interruptAssignment(runId, latest);
        return;
      }
      if (latest.status === "succeeded") {
        const result = this.resultFromAssignment(
          runId,
          latest,
          "candidate_validation_result",
        );
        this.applyCandidateValidationResult(
          runId,
          candidate,
          latest.assignmentId,
          result,
        );
        return;
      }
      if (latest.outcome?.kind === "orchestrator_interrupted") {
        await this.executeCandidateVerifier(runId, candidate);
        return;
      }

      permanentlyUnvalidated = true;
      this.recordIncompleteReason(
        runId,
        "candidate verifier for " +
          candidate.candidateId +
          " ended with " +
          (latest.outcome?.kind ?? latest.status),
      );
    }

    if (permanentlyUnvalidated) {
      this.markIncomplete(
        runId,
        this.combineReasons(
          this.current(runId).incompleteReasons,
          "unvalidated candidates remain",
        ),
      );
      return;
    }

    this.append(runId, { type: "phase_advanced", to: "record_verification" });
  }

  private async resumeRecordVerification(runId: string): Promise<void> {
    const state = this.current(runId);
    const retained = Object.values(state.candidates)
      .filter(
        (candidate) =>
          (candidate.verdict === "confirmed" ||
            candidate.verdict === "needs_validation") &&
          candidate.finalVerifierAssignmentId === null,
      )
      .sort((left, right) => left.candidateId.localeCompare(right.candidateId));

    let permanentlyUnverified = false;

    for (const candidate of retained) {
      const assignments = this.assignmentsForCandidate(
        state,
        "record_verifier",
        candidate.candidateId,
      );
      const latest = assignments.at(-1);

      if (!latest) {
        await this.executeRecordVerifier(runId, candidate);
        return;
      }
      if (latest.status === "planned") {
        await this.executeStoredAssignment(runId, latest);
        return;
      }
      if (latest.status === "in_progress") {
        this.interruptAssignment(runId, latest);
        return;
      }
      if (latest.status === "succeeded") {
        const result = this.resultFromAssignment(
          runId,
          latest,
          "record_verification_result",
        );
        if (result.verdict === "verified") {
          this.append(runId, {
            type: "candidate_final_verified",
            candidateId: candidate.candidateId,
            verifierAssignmentId: latest.assignmentId,
          });
          return;
        }

        permanentlyUnverified = true;
        this.recordIncompleteReason(
          runId,
          "record verifier requested revision for " +
            candidate.candidateId +
            ": " +
            (result.reason ?? "unspecified revision"),
        );
        continue;
      }
      if (latest.outcome?.kind === "orchestrator_interrupted") {
        await this.executeRecordVerifier(runId, candidate);
        return;
      }

      permanentlyUnverified = true;
      this.recordIncompleteReason(
        runId,
        "record verifier for " +
          candidate.candidateId +
          " ended with " +
          (latest.outcome?.kind ?? latest.status),
      );
    }

    if (permanentlyUnverified) {
      this.markIncomplete(
        runId,
        this.combineReasons(
          this.current(runId).incompleteReasons,
          "retained records remain unverified",
        ),
      );
      return;
    }

    this.append(runId, { type: "phase_advanced", to: "reporting" });
  }

  private finishReporting(runId: string): AuditRunState {
    const state = this.current(runId);
    for (const coverage of Object.values(state.coverageUnits)) {
      if (coverage.status === "blocked" || coverage.status === "deferred") {
        this.recordIncompleteReason(
          runId,
          "coverage " + coverage.coverageId + " remains " + coverage.status,
        );
      }
    }

    const refreshed = this.current(runId);
    if (refreshed.incompleteReasons.length > 0) {
      return this.markIncomplete(
        runId,
        this.combineReasons(refreshed.incompleteReasons),
      );
    }
    return this.append(runId, { type: "run_completed" });
  }

  private assignmentsOfKind(
    state: AuditRunState,
    kind: AssignmentKind,
  ): WorkerAssignment[] {
    return Object.values(state.assignments)
      .filter((assignment) => assignment.kind === kind)
      .sort((left, right) => left.createdSequence - right.createdSequence);
  }

  private hunterAssignmentsForCoverage(
    state: AuditRunState,
    coverageId: string,
  ): WorkerAssignment[] {
    return this.assignmentsOfKind(state, "hunter").filter((assignment) =>
      assignment.coverageIds.includes(coverageId),
    );
  }

  private assignmentsForCandidate(
    state: AuditRunState,
    kind: "candidate_verifier" | "record_verifier",
    candidateId: string,
  ): WorkerAssignment[] {
    return this.assignmentsOfKind(state, kind).filter(
      (assignment) => assignment.candidateId === candidateId,
    );
  }

  private criticAssignmentsForRound(
    state: AuditRunState,
    round: "post_wave" | "final_clean",
  ): WorkerAssignment[] {
    return this.assignmentsOfKind(state, "coverage_critic").filter(
      (assignment) => {
        const task = this.taskFromAssignment(assignment, state);
        return task.kind === "coverage_critic" && task.round === round;
      },
    );
  }

  private taskFromAssignment(
    assignment: WorkerAssignment,
    state: AuditRunState,
  ): WorkerTask {
    const receipt = assignment.taskReceipt;
    if (
      !isObject(receipt) ||
      receipt.schemaVersion !== ORCHESTRATION_SCHEMA_VERSION ||
      !isObject(receipt.task)
    ) {
      throw new OrchestrationError(
        "unexpected_state",
        "assignment " + assignment.assignmentId + " has invalid task receipt",
      );
    }

    const task = structuredClone(receipt.task) as unknown as WorkerTask;
    if (
      task.schemaVersion !== ORCHESTRATION_SCHEMA_VERSION ||
      task.assignmentId !== assignment.assignmentId ||
      task.workerId !== assignment.workerId ||
      task.kind !== assignment.kind ||
      task.runId !== state.runId ||
      task.sourceSnapshotId !== state.sourceSnapshotId ||
      task.profile !== state.profile
    ) {
      throw new OrchestrationError(
        "unexpected_state",
        "assignment " + assignment.assignmentId + " task receipt identity mismatch",
      );
    }

    if (
      task.kind === "hunter" &&
      (assignment.candidateId !== null ||
        assignment.coverageIds.length !== 1 ||
        assignment.coverageIds[0] !== task.coverageId)
    ) {
      throw new OrchestrationError(
        "unexpected_state",
        "hunter task receipt does not match assignment coverage",
      );
    }
    if (
      (task.kind === "candidate_verifier" || task.kind === "record_verifier") &&
      (assignment.coverageIds.length !== 0 ||
        assignment.candidateId !== task.candidateId)
    ) {
      throw new OrchestrationError(
        "unexpected_state",
        "verifier task receipt does not match assignment candidate",
      );
    }
    if (
      (task.kind === "recon" || task.kind === "coverage_critic") &&
      (assignment.coverageIds.length !== 0 || assignment.candidateId !== null)
    ) {
      throw new OrchestrationError(
        "unexpected_state",
        "non-hunter task receipt has unexpected assignment ownership",
      );
    }
    return task;
  }

  private resultFromAssignment<K extends WorkerResult["kind"]>(
    runId: string,
    assignment: WorkerAssignment,
    expectedKind: K,
  ): Extract<WorkerResult, { kind: K }> {
    if (
      assignment.status !== "succeeded" ||
      assignment.outcome?.kind !== "valid_result"
    ) {
      throw new OrchestrationError(
        "unexpected_state",
        "assignment " + assignment.assignmentId + " has no successful result",
      );
    }

    const receipt = assignment.resultReceipt;
    if (
      !isObject(receipt) ||
      receipt.schemaVersion !== ORCHESTRATION_SCHEMA_VERSION ||
      !isObject(receipt.result) ||
      receipt.result.kind !== expectedKind
    ) {
      throw new OrchestrationError(
        "unexpected_state",
        "assignment " + assignment.assignmentId + " has invalid result receipt",
      );
    }

    const task = this.taskFromAssignment(assignment, this.current(runId));
    const parsed = parseWorkerObservation(
      task,
      { status: "ok", result: structuredClone(receipt.result) },
      assignment.outcome.adapter ?? this.worker.ref,
    );
    if (parsed.result === null || parsed.result.kind !== expectedKind) {
      throw new OrchestrationError(
        "unexpected_state",
        "assignment " + assignment.assignmentId + " result receipt failed semantic validation",
      );
    }
    return structuredClone(
      parsed.result,
    ) as unknown as Extract<WorkerResult, { kind: K }>;
  }

  private async executeStoredAssignment(
    runId: string,
    assignment: WorkerAssignment,
  ): Promise<void> {
    if (assignment.status !== "planned") {
      throw new OrchestrationError(
        "unexpected_state",
        "only planned assignment can execute from task receipt",
      );
    }

    const task = this.taskFromAssignment(assignment, this.current(runId));
    this.append(runId, {
      type: "assignment_started",
      assignmentId: assignment.assignmentId,
    });
    const observation = await this.observe(task);
    this.append(runId, {
      type: "assignment_completed",
      assignmentId: assignment.assignmentId,
      outcome: observation.outcome,
      resultReceipt:
        observation.result === null
          ? null
          : ({
              schemaVersion: ORCHESTRATION_SCHEMA_VERSION,
              result: structuredClone(observation.result),
            } as unknown as JsonValue),
    });
  }

  private interruptAssignment(
    runId: string,
    assignment: WorkerAssignment,
  ): void {
    if (assignment.status !== "in_progress") {
      throw new OrchestrationError(
        "unexpected_state",
        "only in-progress assignment can be interrupted on resume",
      );
    }
    this.append(runId, {
      type: "assignment_completed",
      assignmentId: assignment.assignmentId,
      outcome: {
        kind: "orchestrator_interrupted",
        detail: "orchestrator restarted while assignment was in progress",
        adapter: null,
      },
      resultReceipt: null,
    });
  }

  private recordIncompleteReason(runId: string, reason: string): void {
    const state = this.current(runId);
    if (state.incompleteReasons.includes(reason)) return;
    this.append(runId, { type: "run_incomplete_reason_recorded", reason });
  }

  private applyCandidateValidationResult(
    runId: string,
    candidate: Candidate,
    verifierAssignmentId: string,
    result: CandidateValidationResult,
  ): void {
    if (result.verdict === "needs_validation") {
      for (const requirement of result.evidenceRequirements) {
        const state = this.current(runId);
        const exists = Object.values(state.evidenceRequirements).some(
          (stored) =>
            stored.candidateId === candidate.candidateId &&
            stored.scope === "finding_handoff" &&
            stored.kind === requirement.kind &&
            stored.description === requirement.description,
        );
        if (!exists) {
          this.append(runId, {
            type: "evidence_requirement_opened",
            requirementId: this.ids.next("requirement"),
            kind: requirement.kind,
            scope: "finding_handoff",
            candidateId: candidate.candidateId,
            description: requirement.description,
          });
        }
      }
    }

    const refreshed = this.current(runId).candidates[candidate.candidateId];
    if (refreshed?.verdict === "unvalidated") {
      this.append(runId, {
        type: "candidate_disposition_recorded",
        candidateId: candidate.candidateId,
        verdict: result.verdict,
        verifierAssignmentId,
      });
    }
  }

  private applyHunterResult(
    runId: string,
    coverageId: string,
    assignmentId: string,
    result: HunterWorkerResult,
  ): void {
    if (result.resolution === "covered") {
      this.append(runId, {
        type: "coverage_resolved",
        coverageId,
        assignmentId,
        resolution: "covered",
        candidateIds: [],
        reviewedPaths: [...result.reviewedPaths],
        checks: result.checks.map((check) => ({ ...check })),
        unresolved: [],
      });
      return;
    }

    if (result.resolution === "blocked") {
      this.append(runId, {
        type: "coverage_resolved",
        coverageId,
        assignmentId,
        resolution: "blocked",
        candidateIds: [],
        reviewedPaths: [...result.reviewedPaths],
        checks: result.checks.map((check) => ({ ...check })),
        unresolved: [...result.unresolved],
      });
      this.recordIncompleteReason(runId, "coverage " + coverageId + " remains blocked");
      return;
    }

    const preflight = this.current(runId);
    const conflicting = result.candidates.find((draft) => {
      const existing = Object.values(preflight.candidates).find(
        (candidate) => candidate.fingerprint === draft.fingerprint,
      );
      return existing !== undefined && !sameCandidateClaim(existing.claim, draft.claim);
    });
    if (conflicting) {
      this.append(runId, {
        type: "coverage_resolved",
        coverageId,
        assignmentId,
        resolution: "blocked",
        candidateIds: [],
        reviewedPaths: [...result.reviewedPaths],
        checks: result.checks.map((check) => ({ ...check })),
        unresolved: [
          "fingerprint " +
            conflicting.fingerprint +
            " conflicts with an existing candidate claim",
        ],
      });
      this.recordIncompleteReason(
        runId,
        "coverage " + coverageId + " has conflicting candidate fingerprint",
      );
      return;
    }

    const candidateIds: string[] = [];
    for (const draft of result.candidates) {
      const state = this.current(runId);
      const existing = Object.values(state.candidates).find(
        (candidate) => candidate.fingerprint === draft.fingerprint,
      );
      if (existing) {
        if (!existing.coverageIds.includes(coverageId)) {
          this.append(runId, {
            type: "candidate_linked_to_coverage",
            candidateId: existing.candidateId,
            coverageId,
            assignmentId,
          });
        }
        candidateIds.push(existing.candidateId);
        continue;
      }

      const candidateId = this.ids.next("candidate");
      this.append(runId, {
        type: "candidate_registered",
        candidateId,
        fingerprint: draft.fingerprint,
        coverageId,
        originAssignmentId: assignmentId,
        claim: structuredClone(draft.claim),
      });
      candidateIds.push(candidateId);
    }

    const currentCoverage = this.current(runId).coverageUnits[coverageId];
    if (currentCoverage?.status === "in_progress") {
      this.append(runId, {
        type: "coverage_resolved",
        coverageId,
        assignmentId,
        resolution: "candidate",
        candidateIds,
        reviewedPaths: [...result.reviewedPaths],
        checks: result.checks.map((check) => ({ ...check })),
        unresolved: [],
      });
    }
  }

  private applyCriticResult(
    runId: string,
    criticAssignmentId: string,
    result: CoverageCriticResult,
    mode: "hunt" | "defer",
    reason: string,
  ): boolean {
    let changed = false;
    const events = this.store.readEvents(runId);

    for (const coverageId of [...result.newCoverageIds].sort()) {
      const alreadyAdded = events.some(
        (event) =>
          event.type === "coverage_unit_added_by_critic" &&
          event.criticAssignmentId === criticAssignmentId &&
          event.coverageId === coverageId,
      );
      if (!alreadyAdded) {
        if (this.current(runId).coverageUnits[coverageId]) {
          throw new OrchestrationError(
            "unexpected_state",
            "critic new coverage collides with existing coverage " + coverageId,
          );
        }
        this.append(runId, {
          type: "coverage_unit_added_by_critic",
          coverageId,
          criticAssignmentId,
          reason,
        });
        changed = true;
      }
    }

    for (const coverageId of [...result.reassignCoverageIds].sort()) {
      const alreadyReopened = events.some(
        (event) =>
          event.type === "coverage_reopened" &&
          event.criticAssignmentId === criticAssignmentId &&
          event.coverageId === coverageId,
      );
      if (!alreadyReopened) {
        const coverage = this.current(runId).coverageUnits[coverageId];
        if (!coverage || coverage.status !== "covered") {
          throw new OrchestrationError(
            "unexpected_state",
            "critic reassignment no longer references covered work " + coverageId,
          );
        }
        this.append(runId, {
          type: "coverage_reopened",
          coverageId,
          criticAssignmentId,
          reason,
        });
        changed = true;
      }
    }

    if (mode === "defer") {
      for (const coverageId of [
        ...result.newCoverageIds,
        ...result.reassignCoverageIds,
      ].sort()) {
        const coverage = this.current(runId).coverageUnits[coverageId];
        if (coverage?.status === "planned") {
          this.append(runId, {
            type: "coverage_classified",
            coverageId,
            status: "deferred",
            reason,
          });
          this.recordIncompleteReason(runId, reason);
          changed = true;
        }
      }
    }

    return changed;
  }

  private async huntCoverage(
    runId: string,
    coverageId: string,
  ): Promise<"resolved" | "incomplete" | "terminal"> {
    const execution = await this.executeHunter(runId, coverageId);
    if (execution === null) return "terminal";

    if (execution.observation.outcome.kind !== "valid_result") {
      const reason = "hunter worker ended with " + execution.observation.outcome.kind;
      this.append(runId, {
        type: "coverage_requeued",
        coverageId,
        assignmentId: execution.assignmentId,
        reason,
      });
      this.append(runId, {
        type: "coverage_classified",
        coverageId,
        status: "deferred",
        reason,
      });
      return "incomplete";
    }

    const result = execution.observation.result as HunterWorkerResult;
    if (result.resolution === "covered") {
      this.append(runId, {
        type: "coverage_resolved",
        coverageId,
        assignmentId: execution.assignmentId,
        resolution: "covered",
        candidateIds: [],
        reviewedPaths: [...result.reviewedPaths],
        checks: result.checks.map((check) => ({ ...check })),
        unresolved: [],
      });
      return "resolved";
    }

    if (result.resolution === "blocked") {
      this.append(runId, {
        type: "coverage_resolved",
        coverageId,
        assignmentId: execution.assignmentId,
        resolution: "blocked",
        candidateIds: [],
        reviewedPaths: [...result.reviewedPaths],
        checks: result.checks.map((check) => ({ ...check })),
        unresolved: [...result.unresolved],
      });
      return "incomplete";
    }

    const preflight = this.current(runId);
    const conflicting = result.candidates.find((draft) => {
      const existing = Object.values(preflight.candidates).find(
        (candidate) => candidate.fingerprint === draft.fingerprint,
      );
      return existing !== undefined && !sameCandidateClaim(existing.claim, draft.claim);
    });
    if (conflicting) {
      this.append(runId, {
        type: "coverage_resolved",
        coverageId,
        assignmentId: execution.assignmentId,
        resolution: "blocked",
        candidateIds: [],
        reviewedPaths: [...result.reviewedPaths],
        checks: result.checks.map((check) => ({ ...check })),
        unresolved: [
          "fingerprint " + conflicting.fingerprint + " conflicts with an existing candidate claim",
        ],
      });
      return "incomplete";
    }

    const candidateIds: string[] = [];
    for (const draft of result.candidates) {
      const current = this.current(runId);
      const existing = Object.values(current.candidates).find(
        (candidate) => candidate.fingerprint === draft.fingerprint,
      );

      if (existing) {
        if (!existing.coverageIds.includes(coverageId)) {
          this.append(runId, {
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
      this.append(runId, {
        type: "candidate_registered",
        candidateId,
        fingerprint: draft.fingerprint,
        coverageId,
        originAssignmentId: execution.assignmentId,
        claim: structuredClone(draft.claim),
      });
      candidateIds.push(candidateId);
    }
    this.append(runId, {
      type: "coverage_resolved",
      coverageId,
      assignmentId: execution.assignmentId,
      resolution: "candidate",
      candidateIds,
      reviewedPaths: [...result.reviewedPaths],
      checks: result.checks.map((check) => ({ ...check })),
      unresolved: [],
    });
    return "resolved";
  }

  private openCriticWork(
    runId: string,
    criticAssignmentId: string,
    newCoverageIds: readonly string[],
    reassignCoverageIds: readonly string[],
    reason: string,
  ): void {
    for (const coverageId of [...newCoverageIds].sort()) {
      this.append(runId, {
        type: "coverage_unit_added_by_critic",
        coverageId,
        criticAssignmentId,
        reason,
      });
    }
    for (const coverageId of [...reassignCoverageIds].sort()) {
      this.append(runId, {
        type: "coverage_reopened",
        coverageId,
        criticAssignmentId,
        reason,
      });
    }
  }

  private deferCriticWork(
    runId: string,
    criticAssignmentId: string,
    newCoverageIds: readonly string[],
    reassignCoverageIds: readonly string[],
    reason: string,
  ): void {
    this.openCriticWork(
      runId,
      criticAssignmentId,
      newCoverageIds,
      reassignCoverageIds,
      reason,
    );
    for (const coverageId of [...newCoverageIds, ...reassignCoverageIds].sort()) {
      this.append(runId, {
        type: "coverage_classified",
        coverageId,
        status: "deferred",
        reason,
      });
    }
  }

  private combineReasons(reasons: readonly string[], extra?: string): string {
    const values = [...reasons];
    if (extra) values.push(extra);
    const unique = [...new Set(values)];
    if (unique.length === 0) return "audit incomplete";

    const maxBytes = 12 * 1024;
    const selected: string[] = [];
    for (const reason of unique) {
      const candidate = [...selected, reason].join("; ");
      if (Buffer.byteLength(candidate, "utf8") > maxBytes) break;
      selected.push(reason);
    }

    const omitted = unique.length - selected.length;
    if (selected.length === 0) {
      return omitted > 0
        ? "audit incomplete; " + omitted + " incomplete reasons omitted from terminal summary"
        : "audit incomplete";
    }
    if (omitted === 0) return selected.join("; ");

    const suffix = "; +" + omitted + " more incomplete reasons";
    while (
      selected.length > 0 &&
      Buffer.byteLength(selected.join("; ") + suffix, "utf8") > maxBytes
    ) {
      selected.pop();
    }
    return (
      (selected.length > 0 ? selected.join("; ") : "audit incomplete") +
      suffix
    );
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

  private async executeCoverageCritic(
    runId: string,
    round: "post_wave" | "final_clean",
  ): Promise<AssignmentExecution | null> {
    const state = this.current(runId);
    const coverage = Object.values(state.coverageUnits)
      .map((unit) => ({
        coverageId: unit.coverageId,
        status: unit.status,
        candidateIds: [...unit.candidateIds],
        reviewedPaths: [...unit.reviewedPaths],
        checks: unit.checks.map((check) => ({ ...check })),
        unresolved: [...unit.unresolved],
      }))
      .sort((left, right) => left.coverageId.localeCompare(right.coverageId));

    return this.executeAssignment(
      runId,
      "coverage_critic",
      [],
      null,
      (assignmentId, workerId): WorkerTask => ({
        schemaVersion: ORCHESTRATION_SCHEMA_VERSION,
        kind: "coverage_critic",
        runId,
        assignmentId,
        workerId,
        sourceSnapshotId: state.sourceSnapshotId,
        profile: state.profile,
        round,
        coverage,
      }),
    );
  }

  private async executeRecordVerifier(
    runId: string,
    candidate: Candidate,
  ): Promise<AssignmentExecution | null> {
    const state = this.current(runId);
    if (candidate.verdict !== "confirmed" && candidate.verdict !== "needs_validation") {
      throw new OrchestrationError(
        "unexpected_state",
        "record verifier requires retained candidate " + candidate.candidateId,
      );
    }
    const retainedVerdict: "confirmed" | "needs_validation" = candidate.verdict;
    const openEvidenceRequirements = Object.values(state.evidenceRequirements)
      .filter(
        (requirement) =>
          requirement.candidateId === candidate.candidateId &&
          requirement.scope === "finding_handoff" &&
          requirement.status === "open",
      )
      .map((requirement) => ({
        requirementId: requirement.requirementId,
        kind: requirement.kind,
        description: requirement.description,
      }))
      .sort((left, right) => left.requirementId.localeCompare(right.requirementId));

    return this.executeAssignment(
      runId,
      "record_verifier",
      [],
      candidate.candidateId,
      (assignmentId, workerId): WorkerTask => ({
        schemaVersion: ORCHESTRATION_SCHEMA_VERSION,
        kind: "record_verifier",
        runId,
        assignmentId,
        workerId,
        sourceSnapshotId: state.sourceSnapshotId,
        profile: state.profile,
        candidateId: candidate.candidateId,
        fingerprint: candidate.fingerprint,
        verdict: retainedVerdict,
        coverageIds: [...candidate.coverageIds],
        claim: structuredClone(candidate.claim),
        openEvidenceRequirements,
      }),
    );
  }

  private async executeAssignment(
    runId: string,
    kind: "recon" | "hunter" | "coverage_critic" | "candidate_verifier" | "record_verifier",
    coverageIds: readonly string[],
    candidateId: string | null,
    taskFactory: (assignmentId: string, workerId: string) => WorkerTask,
  ): Promise<AssignmentExecution | null> {
    const assignmentId = this.ids.next("assignment");
    const workerId = this.ids.next("worker");

    const task = taskFactory(assignmentId, workerId);
    const taskReceipt = {
      schemaVersion: ORCHESTRATION_SCHEMA_VERSION,
      task: structuredClone(task),
    } as unknown as JsonValue;

    try {
      this.append(runId, {
        type: "assignment_created",
        assignmentId,
        kind,
        workerId,
        coverageIds: [...coverageIds],
        candidateId,
        taskReceipt,
      });
    } catch (error) {
      if (error instanceof DomainTransitionError && error.code === "budget_exhausted") {
        this.markIncomplete(runId, "worker invocation budget exhausted");
        return null;
      }
      throw error;
    }

    this.append(runId, { type: "assignment_started", assignmentId });
    const observation = await this.observe(task);
    this.append(runId, {
      type: "assignment_completed",
      assignmentId,
      outcome: observation.outcome,
      resultReceipt:
        observation.result === null
          ? null
          : ({
              schemaVersion: ORCHESTRATION_SCHEMA_VERSION,
              result: structuredClone(observation.result),
            } as unknown as JsonValue),
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
