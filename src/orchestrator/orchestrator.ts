import crypto from "node:crypto";

import {
  DOMAIN_SCHEMA_VERSION,
  type AuditEvent,
  type AuditRunState,
  type Candidate,
  type CoverageUnit,
} from "../domain/contracts";
import { DomainTransitionError } from "../domain/reducer";
import type { AuditEventStore } from "../storage/contracts";
import {
  ORCHESTRATION_SCHEMA_VERSION,
  type AuditRunRequest,
  type CandidateValidationResult,
  type CoverageCriticResult,
  type HunterWorkerResult,
  type IdSource,
  type ParsedWorkerObservation,
  type ReconWorkerResult,
  type RecordVerificationResult,
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

type HunterResolution = "resolved" | "unresolved" | "terminal";

const TERMINAL = new Set(["complete", "incomplete", "cancelled", "failed"]);
const MAX_CRITIC_PASSES = 8;

export class AuditOrchestrator {
  constructor(
    private readonly store: AuditEventStore,
    private readonly worker: WorkerAdapter,
    private readonly ids: IdSource = new RandomIdSource(),
  ) {}

  async runThroughCandidateValidation(request: AuditRunRequest): Promise<AuditRunState> {
    return this.runDiscovery(request, false);
  }

  async runFullAudit(request: AuditRunRequest): Promise<AuditRunState> {
    const discovered = await this.runDiscovery(request, true);
    if (TERMINAL.has(discovered.status)) return discovered;
    if (discovered.status !== "record_verification") {
      throw new OrchestrationError(
        "unexpected_state",
        "full audit expected record_verification, got " + discovered.status,
      );
    }
    return this.finalizeRun(request.runId);
  }

  private async runDiscovery(
    request: AuditRunRequest,
    withCoverageCritics: boolean,
  ): Promise<AuditRunState> {
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
    const coverageIds: string[] = [];
    for (const definition of recon.coverageDefinitions) {
      const coverageId = this.ids.next("coverage");
      this.append(request.runId, {
        type: "coverage_unit_registered",
        coverageId,
        definition: structuredClone(definition),
      });
      coverageIds.push(coverageId);
    }
    this.append(request.runId, { type: "phase_advanced", to: "hunting" });

    let unresolved = false;
    for (const coverageId of coverageIds) {
      const resolution = await this.runHunterForCoverage(request.runId, coverageId);
      if (resolution === "terminal") return this.current(request.runId);
      if (resolution === "unresolved") unresolved = true;
    }

    if (withCoverageCritics) {
      const criticsClean = await this.runCoverageCriticCycle(request.runId);
      if (!criticsClean || TERMINAL.has(this.current(request.runId).status)) {
        return this.current(request.runId);
      }
      unresolved = Object.values(this.current(request.runId).coverageUnits).some(
        (coverage) => coverage.status === "blocked" || coverage.status === "deferred",
      );
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
        unresolved = true;
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
        reason: result.reason,
        validatedClaim:
          result.validatedClaim === null ? null : structuredClone(result.validatedClaim),
      });
    }

    const state = this.current(request.runId);
    const unresolvedCandidate = Object.values(state.candidates).some(
      (candidate) => candidate.verdict === "unvalidated",
    );
    const unresolvedCoverage = Object.values(state.coverageUnits).some(
      (coverage) => coverage.status === "blocked" || coverage.status === "deferred",
    );

    if (unresolved || unresolvedCandidate || unresolvedCoverage) {
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

  private async runHunterForCoverage(
    runId: string,
    coverageId: string,
  ): Promise<HunterResolution> {
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
      return "unresolved";
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
      return "unresolved";
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

  private async runCoverageCriticCycle(runId: string): Promise<boolean> {
    const profile = this.current(runId).profile;
    const requiredCleanPasses = profile === "quick" ? 1 : 2;
    let consecutiveClean = 0;
    let passes = 0;

    while (consecutiveClean < requiredCleanPasses) {
      if (passes >= MAX_CRITIC_PASSES) {
        this.markIncomplete(runId, "coverage critic pass limit exhausted");
        return false;
      }
      passes += 1;

      const execution = await this.executeCoverageCritic(runId);
      if (execution === null) return false;
      if (execution.observation.outcome.kind !== "valid_result") {
        this.markIncomplete(
          runId,
          "coverage critic ended with " + execution.observation.outcome.kind,
        );
        return false;
      }

      const result = execution.observation.result as CoverageCriticResult;
      if (result.stop) {
        consecutiveClean += 1;
        continue;
      }

      consecutiveClean = 0;
      for (const reassignment of result.reassignments) {
        this.append(runId, {
          type: "coverage_reopened",
          coverageId: reassignment.coverageId,
          criticAssignmentId: execution.assignmentId,
          reason: reassignment.reason,
        });
      }

      for (const reassignment of result.reassignments) {
        const resolution = await this.runHunterForCoverage(runId, reassignment.coverageId);
        if (resolution === "terminal") return false;
      }
    }

    return true;
  }

  private async finalizeRun(runId: string): Promise<AuditRunState> {
    const state = this.current(runId);
    if (state.status !== "record_verification") {
      throw new OrchestrationError(
        "unexpected_state",
        "finalization requires record_verification state",
      );
    }

    const retained = Object.values(state.candidates)
      .filter(
        (candidate) =>
          candidate.verdict === "confirmed" || candidate.verdict === "needs_validation",
      )
      .sort((left, right) => left.candidateId.localeCompare(right.candidateId));

    for (const candidate of retained) {
      const execution = await this.executeRecordVerifier(runId, candidate);
      if (execution === null) return this.current(runId);
      if (execution.observation.outcome.kind !== "valid_result") {
        return this.markIncomplete(
          runId,
          "record verifier ended with " + execution.observation.outcome.kind,
        );
      }

      const result = execution.observation.result as RecordVerificationResult;
      if (result.disposition === "accept") {
        this.append(runId, {
          type: "candidate_final_verified",
          candidateId: candidate.candidateId,
          verifierAssignmentId: execution.assignmentId,
          reason: result.reason,
        });
      } else {
        this.append(runId, {
          type: "candidate_final_rejected",
          candidateId: candidate.candidateId,
          verifierAssignmentId: execution.assignmentId,
          reason: result.reason,
        });

        const requirements = Object.values(this.current(runId).evidenceRequirements)
          .filter(
            (requirement) =>
              requirement.candidateId === candidate.candidateId &&
              requirement.status === "open",
          )
          .sort((left, right) => left.requirementId.localeCompare(right.requirementId));
        for (const requirement of requirements) {
          this.append(runId, {
            type: "evidence_requirement_resolved",
            requirementId: requirement.requirementId,
            resolution: "Final record verifier rejected candidate: " + result.reason,
          });
        }
      }
    }

    this.append(runId, { type: "phase_advanced", to: "reporting" });

    try {
      return this.append(runId, { type: "run_completed" });
    } catch (error) {
      if (
        error instanceof DomainTransitionError &&
        (error.code === "unresolved_work" || error.code === "invalid_evidence")
      ) {
        return this.markIncomplete(runId, "reporting could not satisfy completion invariants");
      }
      throw error;
    }
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
    const coverage = state.coverageUnits[coverageId];
    if (!coverage) {
      throw new OrchestrationError("unexpected_state", "unknown coverage unit " + coverageId);
    }
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
        definition: structuredClone(coverage.definition),
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

  private async executeCoverageCritic(runId: string): Promise<AssignmentExecution | null> {
    const state = this.current(runId);
    const coverageUnits = Object.values(state.coverageUnits)
      .map((coverage) => structuredClone(coverage))
      .sort((left, right) => left.coverageId.localeCompare(right.coverageId));
    const reopenableCoverageIds = coverageUnits
      .filter(
        (coverage) =>
          coverage.status === "covered" ||
          coverage.status === "candidate" ||
          coverage.status === "blocked" ||
          coverage.status === "deferred",
      )
      .map((coverage) => coverage.coverageId);

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
        coverageUnits,
        reopenableCoverageIds,
      }),
    );
  }

  private async executeRecordVerifier(
    runId: string,
    candidate: Candidate,
  ): Promise<AssignmentExecution | null> {
    const state = this.current(runId);
    const retainedVerdict = candidate.verdict;
    if (retainedVerdict !== "confirmed" && retainedVerdict !== "needs_validation") {
      throw new OrchestrationError("unexpected_state", "record verifier received non-retained candidate");
    }
    const candidateValidationReason = candidate.candidateValidationReason;
    if (candidateValidationReason === null) {
      throw new OrchestrationError(
        "unexpected_state",
        "record verifier requires candidate validation rationale",
      );
    }
    const evidenceRequirements = Object.values(state.evidenceRequirements)
      .filter(
        (requirement) =>
          requirement.candidateId === candidate.candidateId &&
          requirement.status === "open",
      )
      .map((requirement) => structuredClone(requirement))
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
        coverageIds: [...candidate.coverageIds],
        claim: structuredClone(candidate.claim),
        verdict: retainedVerdict,
        candidateValidationReason,
        evidenceRequirements,
      }),
    );
  }

  private async executeAssignment(
    runId: string,
    kind:
      | "recon"
      | "hunter"
      | "coverage_critic"
      | "candidate_verifier"
      | "record_verifier",
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
