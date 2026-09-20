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
  type CoverageCriticResult,
  type HunterWorkerResult,
  type RecordVerificationResult,
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

function sameCandidateClaim(left: Candidate["claim"], right: Candidate["claim"]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
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

    const incompleteReasons: string[] = [];

    for (const coverageId of recon.coverageIds) {
      const outcome = await this.huntCoverage(request.runId, coverageId);
      if (outcome === "terminal") return this.current(request.runId);
      if (outcome === "incomplete") {
        incompleteReasons.push("coverage " + coverageId + " remained unresolved");
      }
    }

    const firstCritic = await this.executeCoverageCritic(request.runId, "post_wave");
    if (firstCritic === null) return this.current(request.runId);

    if (firstCritic.observation.outcome.kind !== "valid_result") {
      incompleteReasons.push(
        "post-wave coverage critic ended with " + firstCritic.observation.outcome.kind,
      );
    } else {
      const result = firstCritic.observation.result as CoverageCriticResult;
      if (request.profile === "quick") {
        if (result.newCoverageIds.length > 0 || result.reassignCoverageIds.length > 0) {
          this.deferCriticWork(
            request.runId,
            firstCritic.assignmentId,
            result.newCoverageIds,
            result.reassignCoverageIds,
            "quick profile deferred critic-requested work",
          );
          incompleteReasons.push("quick profile deferred critic-requested work");
        }
      } else {
        this.openCriticWork(
          request.runId,
          firstCritic.assignmentId,
          result.newCoverageIds,
          result.reassignCoverageIds,
          "post-wave critic requested additional work",
        );

        for (const coverageId of [...result.newCoverageIds, ...result.reassignCoverageIds].sort()) {
          const outcome = await this.huntCoverage(request.runId, coverageId);
          if (outcome === "terminal") return this.current(request.runId);
          if (outcome === "incomplete") {
            incompleteReasons.push("critic-requested coverage " + coverageId + " remained unresolved");
          }
        }

        const finalCritic = await this.executeCoverageCritic(request.runId, "final_clean");
        if (finalCritic === null) return this.current(request.runId);
        if (finalCritic.observation.outcome.kind !== "valid_result") {
          incompleteReasons.push(
            "final-clean coverage critic ended with " + finalCritic.observation.outcome.kind,
          );
        } else {
          const finalResult = finalCritic.observation.result as CoverageCriticResult;
          if (
            finalResult.newCoverageIds.length > 0 ||
            finalResult.reassignCoverageIds.length > 0
          ) {
            this.deferCriticWork(
              request.runId,
              finalCritic.assignmentId,
              finalResult.newCoverageIds,
              finalResult.reassignCoverageIds,
              "bounded final-clean critic still requested work",
            );
            incompleteReasons.push("bounded final-clean critic still requested work");
          }
        }
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
        incompleteReasons.push(
          "candidate verifier for " +
            candidate.candidateId +
            " ended with " +
            execution.observation.outcome.kind,
        );
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

    let state = this.current(request.runId);
    if (
      Object.values(state.candidates).some((candidate) => candidate.verdict === "unvalidated")
    ) {
      return this.markIncomplete(
        request.runId,
        this.combineReasons(incompleteReasons, "unvalidated candidates remain"),
      );
    }

    this.append(request.runId, { type: "phase_advanced", to: "record_verification" });

    const retained = Object.values(this.current(request.runId).candidates)
      .filter(
        (candidate) =>
          candidate.verdict === "confirmed" || candidate.verdict === "needs_validation",
      )
      .sort((left, right) => left.candidateId.localeCompare(right.candidateId));

    for (const candidate of retained) {
      const execution = await this.executeRecordVerifier(request.runId, candidate);
      if (execution === null) return this.current(request.runId);
      if (execution.observation.outcome.kind !== "valid_result") {
        incompleteReasons.push(
          "record verifier for " +
            candidate.candidateId +
            " ended with " +
            execution.observation.outcome.kind,
        );
        continue;
      }

      const result = execution.observation.result as RecordVerificationResult;
      if (result.verdict === "needs_revision") {
        incompleteReasons.push(
          "record verifier requested revision for " +
            candidate.candidateId +
            ": " +
            (result.reason ?? "unspecified revision"),
        );
        continue;
      }

      this.append(request.runId, {
        type: "candidate_final_verified",
        candidateId: candidate.candidateId,
        verifierAssignmentId: execution.assignmentId,
      });
    }

    state = this.current(request.runId);
    if (
      Object.values(state.candidates).some(
        (candidate) =>
          (candidate.verdict === "confirmed" || candidate.verdict === "needs_validation") &&
          candidate.finalVerifierAssignmentId === null,
      )
    ) {
      return this.markIncomplete(
        request.runId,
        this.combineReasons(incompleteReasons, "retained records remain unverified"),
      );
    }

    this.append(request.runId, { type: "phase_advanced", to: "reporting" });

    state = this.current(request.runId);
    if (
      Object.values(state.coverageUnits).some(
        (coverage) => coverage.status === "blocked" || coverage.status === "deferred",
      )
    ) {
      incompleteReasons.push("coverage remains blocked or deferred");
    }

    if (incompleteReasons.length > 0) {
      return this.markIncomplete(request.runId, this.combineReasons(incompleteReasons));
    }

    return this.append(request.runId, { type: "run_completed" });
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
    return unique.length > 0 ? unique.join("; ") : "audit incomplete";
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
