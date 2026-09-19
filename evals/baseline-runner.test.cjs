"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const harness = require("./harness.cjs");
const runner = require("./run-baseline.cjs");

const repoRoot = path.resolve(__dirname, "..");

test("execution requires an explicit positive budget cap", () => {
  assert.throws(() => runner.parseArgs(["--case", "tenant-documents", "--execute"]), /max-budget-usd/);
  const parsed = runner.parseArgs(["--case", "tenant-documents", "--execute", "--max-budget-usd", "1.25"]);
  assert.equal(parsed.execute, true);
  assert.equal(parsed.maxBudgetUsd, 1.25);
});

test("dry-run is source-only and does not grant Bash", () => {
  const plan = runner.dryRun({
    ...runner.parseArgs(["--case", "tenant-documents", "--model", "sonnet"]),
    runId: "ignored",
  });
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
  assert.deepEqual(
    runner.usageFrom({ usage: { input_tokens: 10, output_tokens: 5 }, total_cost_usd: 0.01 }),
    { input_tokens: 10, output_tokens: 5, total_tokens: 15, cost_usd: 0.01 },
  );
});

function writeFakeClaude(directory, source) {
  const file = path.join(directory, "claude");
  fs.writeFileSync(file, "#!/usr/bin/env node\n" + source);
  fs.chmodSync(file, 0o755);
  return file;
}

test("execute path captures complete artifacts and score with a fake host", { skip: process.platform === "win32" }, () => {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), "fake-claude-bin-"));
  const runId = "stub-complete-" + process.pid;
  const runDirectory = path.join(repoRoot, ".eval-runs", runId);
  const workDirectory = path.join(repoRoot, ".eval-work", runId);
  try {
    writeFakeClaude(
      bin,
      `const fs=require("node:fs");
fs.writeFileSync("output/findings.json","[]\\n");
fs.writeFileSync("output/coverage-ledger.json","[]\\n");
process.stdout.write(JSON.stringify({result:"audit complete",usage:{input_tokens:12,output_tokens:3},total_cost_usd:0.02}));
`,
    );
    const result = spawnSync(
      process.execPath,
      [
        path.join(__dirname, "run-baseline.cjs"),
        "--case", "tenant-documents",
        "--execute",
        "--max-budget-usd", "1",
        "--run-id", runId,
      ],
      {
        cwd: repoRoot,
        encoding: "utf8",
        env: { ...process.env, PATH: bin + path.delimiter + process.env.PATH },
      },
    );
    assert.equal(result.status, 0, result.stderr);
    const record = JSON.parse(fs.readFileSync(path.join(runDirectory, "run-record.json"), "utf8"));
    const score = JSON.parse(fs.readFileSync(path.join(runDirectory, "score.json"), "utf8"));
    assert.equal(record.status, "complete");
    assert.equal(record.worker_outcomes.valid_result, 1);
    assert.equal(record.usage.total_tokens, 15);
    assert.equal(record.usage.cost_usd, 0.02);
    assert.equal(score.metrics.detection_recall, 0);
    assert.equal(score.coverage.mapped, 0);
    assert.equal(fs.existsSync(workDirectory), false);
  } finally {
    fs.rmSync(bin, { recursive: true, force: true });
    fs.rmSync(runDirectory, { recursive: true, force: true });
    fs.rmSync(workDirectory, { recursive: true, force: true });
  }
});

test("execute path preserves refusal without manufacturing artifacts", { skip: process.platform === "win32" }, () => {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), "fake-claude-bin-"));
  const runId = "stub-refusal-" + process.pid;
  const runDirectory = path.join(repoRoot, ".eval-runs", runId);
  const workDirectory = path.join(repoRoot, ".eval-work", runId);
  try {
    writeFakeClaude(
      bin,
      'process.stdout.write(JSON.stringify({result:"I cannot assist with this request.",usage:{input_tokens:4,output_tokens:2}}));\n',
    );
    const result = spawnSync(
      process.execPath,
      [
        path.join(__dirname, "run-baseline.cjs"),
        "--case", "tenant-documents",
        "--execute",
        "--max-budget-usd", "1",
        "--run-id", runId,
      ],
      {
        cwd: repoRoot,
        encoding: "utf8",
        env: { ...process.env, PATH: bin + path.delimiter + process.env.PATH },
      },
    );
    assert.equal(result.status, 2, result.stderr);
    const record = JSON.parse(fs.readFileSync(path.join(runDirectory, "run-record.json"), "utf8"));
    assert.equal(record.status, "incomplete");
    assert.equal(record.worker_outcomes.model_refusal, 1);
    assert.equal(record.artifacts.findings, null);
    assert.equal(record.artifacts.coverage_ledger, null);
    assert.equal(fs.existsSync(path.join(runDirectory, "score.json")), false);
  } finally {
    fs.rmSync(bin, { recursive: true, force: true });
    fs.rmSync(runDirectory, { recursive: true, force: true });
    fs.rmSync(workDirectory, { recursive: true, force: true });
  }
});
