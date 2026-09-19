"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const harness = require("./harness.cjs");
const runner = require("./run-baseline.cjs");

test("execution requires an explicit positive budget cap", () => {
  assert.throws(() => runner.parseArgs(["--case", "tenant-documents", "--execute"]), /max-budget-usd/);
  const parsed = runner.parseArgs(["--case", "tenant-documents", "--execute", "--max-budget-usd", "1.25"]);
  assert.equal(parsed.execute, true);
  assert.equal(parsed.maxBudgetUsd, 1.25);
});

test("dry-run is source-only and does not grant Bash", () => {
  const plan = runner.dryRun({ ...runner.parseArgs(["--case", "tenant-documents", "--model", "sonnet"]), runId: "ignored" });
  assert.equal(plan.source_only, true);
  assert.equal(plan.command, "claude");
  const joined = plan.args.join(" ");
  assert.match(joined, /Read,Glob,Grep,Write,Agent/);
  assert.doesNotMatch(joined, /Bash/);
  assert.match(joined, /No OS-enforced sandbox/);
  assert.doesNotMatch(joined, /case\.json/);
});

test("fixture source hash is stable and content-sensitive", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "eval-hash-"));
  try {
    fs.writeFileSync(path.join(temp, "a.txt"), "alpha");
    const first = runner.hashTree(temp);
    const second = runner.hashTree(temp);
    assert.equal(first, second);
    fs.writeFileSync(path.join(temp, "a.txt"), "beta");
    assert.notEqual(runner.hashTree(temp), first);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("incomplete run record can preserve failure without fake artifacts", () => {
  const definition = harness.loadCase(path.join(__dirname, "cases", "tenant-documents"));
  const outcomes = runner.emptyOutcomes();
  outcomes.model_refusal = 1;
  const record = {
    schema_version: 1,
    run_id: "tenant-documents-refusal",
    case_id: definition.id,
    upstream_baseline: harness.BASE,
    status: "incomplete",
    source_ref: "sha256:" + "a".repeat(64),
    profile: "quick",
    host: { name: "claude-code", model: "sonnet" },
    artifacts: { findings: null, coverage_ledger: null },
    usage: { input_tokens: null, output_tokens: null, total_tokens: null, cost_usd: null },
    worker_outcomes: outcomes,
    host_error: "model refused the audit",
  };
  assert.deepEqual(harness.validateRun(record, definition), []);
});

test("refusal classifier is conservative and explicit", () => {
  assert.equal(runner.looksLikeRefusal("I cannot assist with this request."), true);
  assert.equal(runner.looksLikeRefusal("Audit complete. No confirmed findings."), false);
});

test("usage extraction preserves unavailable telemetry as null", () => {
  assert.deepEqual(runner.usageFrom({}), {
    input_tokens: null,
    output_tokens: null,
    total_tokens: null,
    cost_usd: null,
  });
  assert.deepEqual(runner.usageFrom({ usage: { input_tokens: 10, output_tokens: 5 }, total_cost_usd: 0.01 }), {
    input_tokens: 10,
    output_tokens: 5,
    total_tokens: 15,
    cost_usd: 0.01,
  });
});
