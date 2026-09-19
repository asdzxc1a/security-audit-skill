"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const h = require("./harness.cjs");
const root = __dirname;

function memoryRun(findings = [], ledger = []) {
  return {
    record: {
      status: "complete",
      run_id: "memory",
      usage: { input_tokens: null, output_tokens: null, total_tokens: null, cost_usd: null },
      worker_outcomes: Object.fromEntries(h.OUTCOMES.map((outcome) => [outcome, 0])),
    },
    findings,
    ledger,
  };
}

test("three pinned cases validate", () => {
  for (const id of ["tenant-documents", "clean-documents", "trusted-proxy-identity"]) {
    assert.equal(h.loadCase(path.join(root, "cases", id)).upstream_baseline, h.BASE);
  }
});

test("scoring demo separates true positive from false-positive decoy", () => {
  const score = h.scoreDirectory(
    path.join(root, "cases/tenant-documents"),
    path.join(root, "reference-runs/tenant-documents-demo"),
  );
  assert.equal(score.metrics.detection_recall, 1);
  assert.equal(score.metrics.correct_verdict_recall, 1);
  assert.equal(score.metrics.confirmed_precision, 0.5);
  assert.equal(score.metrics.false_positive_confirmed, 1);
  assert.equal(score.metrics.decoy_hits, 1);
  assert.equal(score.coverage.mapped, 2);
  assert.equal(score.coverage.resolved, 2);
});

test("clean case keeps zero denominators explicit", () => {
  const definition = h.loadCase(path.join(root, "cases/clean-documents"));
  const score = h.score(definition, memoryRun());
  assert.equal(score.metrics.detection_recall, null);
  assert.equal(score.metrics.confirmed_precision, null);
});

test("needs-validation overclaim is measured", () => {
  const definition = h.loadCase(path.join(root, "cases/trusted-proxy-identity"));
  const finding = {
    verdict: "confirmed",
    fingerprint: "proxy.overclaim",
    trace: [{ file: "index.js", scope: "resolveIdentity" }],
  };
  const score = h.score(definition, memoryRun([finding], []));
  assert.equal(score.metrics.detection_recall, 1);
  assert.equal(score.metrics.correct_verdict_recall, 0);
  assert.equal(score.metrics.verdict_overclaims, 1);
  assert.equal(score.metrics.confirmed_precision, 0);
});

test("run validation rejects baseline drift and negative usage", () => {
  const definition = h.loadCase(path.join(root, "cases/clean-documents"));
  const record = {
    schema_version: 1,
    run_id: "bad-run",
    case_id: definition.id,
    upstream_baseline: "bad",
    status: "complete",
    source_ref: "fixture:test",
    profile: "quick",
    host: { name: "x", model: null },
    artifacts: { findings: "findings.json", coverage_ledger: "coverage-ledger.json" },
    usage: { input_tokens: -1, output_tokens: null, total_tokens: null, cost_usd: null },
    worker_outcomes: Object.fromEntries(h.OUTCOMES.map((outcome) => [outcome, 0])),
    host_error: null,
  };
  const errors = h.validateRun(record, definition);
  assert(errors.some((error) => error.includes("baseline")));
  assert(errors.some((error) => error.includes("input_tokens")));
});
