"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const harness = require("./harness.cjs");

const ROOT = path.resolve(__dirname, "..");
const CASES_ROOT = path.join(__dirname, "cases");
const WORK_ROOT = path.join(os.tmpdir(), "security-audit-eval-work");
const RUN_ROOT = path.join(ROOT, ".eval-runs");
const SKILL_SOURCE = path.join(ROOT, "skills", "security-audit");

function parseArgs(argv) {
  const options = {
    host: "claude",
    model: "sonnet",
    execute: false,
    maxBudgetUsd: null,
    timeoutSeconds: 900,
    keepWorkspace: false,
    caseId: null,
    runId: null,
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    const next = () => {
      if (index + 1 >= argv.length) throw new Error("missing value for " + arg);
      return argv[++index];
    };

    if (arg === "--case") options.caseId = next();
    else if (arg === "--host") options.host = next();
    else if (arg === "--model") options.model = next();
    else if (arg === "--run-id") options.runId = next();
    else if (arg === "--max-budget-usd") options.maxBudgetUsd = Number(next());
    else if (arg === "--timeout-seconds") options.timeoutSeconds = Number(next());
    else if (arg === "--execute") options.execute = true;
    else if (arg === "--keep-workspace") options.keepWorkspace = true;
    else if (arg === "--dry-run") options.execute = false;
    else throw new Error("unknown argument " + arg);
  }

  if (!options.caseId) throw new Error("--case is required");
  if (options.host !== "claude") throw new Error("only --host claude is implemented in this gate");
  if (!Number.isFinite(options.timeoutSeconds) || options.timeoutSeconds <= 0) {
    throw new Error("--timeout-seconds must be positive");
  }
  if (options.execute && (!Number.isFinite(options.maxBudgetUsd) || options.maxBudgetUsd <= 0)) {
    throw new Error("--execute requires a positive --max-budget-usd");
  }
  if (options.runId && !/^[a-z0-9][a-z0-9-]{0,63}$/.test(options.runId)) {
    throw new Error("invalid --run-id");
  }
  return options;
}

function regularFiles(root, prefix = "") {
  const entries = fs.readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  const result = [];
  for (const entry of entries) {
    const relative = prefix ? prefix + "/" + entry.name : entry.name;
    const absolute = path.join(root, entry.name);
    const stat = fs.lstatSync(absolute);
    if (stat.isSymbolicLink()) throw new Error("symlink not allowed in baseline input: " + relative);
    if (stat.isDirectory()) result.push(...regularFiles(absolute, relative));
    else if (stat.isFile()) result.push({ relative, absolute });
    else throw new Error("special file not allowed in baseline input: " + relative);
  }
  return result;
}

function hashTree(root) {
  const hash = crypto.createHash("sha256");
  for (const file of regularFiles(root)) {
    hash.update(file.relative);
    hash.update("\0");
    hash.update(fs.readFileSync(file.absolute));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function copyTree(source, destination) {
  fs.mkdirSync(destination, { recursive: true });
  for (const file of regularFiles(source)) {
    const target = path.join(destination, file.relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(file.absolute, target, fs.constants.COPYFILE_EXCL);
  }
}

function defaultRunId(caseId, model, now = new Date()) {
  const compact = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "z").toLowerCase();
  const modelPart = String(model).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 16) || "model";
  return (caseId + "-claude-" + modelPart + "-" + compact).slice(0, 64);
}

function buildAgents() {
  return {
    research: {
      description: "Focused source exploration and factual verification for an authorized defensive audit.",
      prompt: "Read only the assigned source and return source-grounded facts. Do not execute target-controlled code or contact external services.",
    },
    general: {
      description: "Broad source investigation for an authorized defensive audit.",
      prompt: "Investigate the assigned security invariant deeply from source. Do not execute target-controlled code or contact external services.",
    },
  };
}

function buildPrompt(context) {
  return [
    "This is an authorized defensive baseline evaluation against a synthetic local fixture.",
    "Read skill/SKILL.md and follow that exact Cloudflare security-audit workflow in full audit mode.",
    "Do not modify the skill files.",
    "Target repository: target",
    "Output directory: output",
    "Requested profile: " + context.profile,
    "Trusted harness source reference: sha256:" + context.sourceHash,
    "",
    "HOST CAPABILITY DECLARATION:",
    "- Source inspection is available.",
    "- No OS-enforced sandbox satisfying the skill's target-controlled execution contract is available in this host adapter.",
    "- Therefore DO NOT run target-controlled builds, tests, processes, fixtures, browsers, fuzzers, package scripts, or imported target modules.",
    "- Do not contact external services, web endpoints, package registries, or live infrastructure.",
    "- If local execution is decisive, follow the skill's own rule: retain the exact blocker / needs_validation or mark the run incomplete rather than executing unsafely.",
    "- The outer harness will validate any produced findings.json and coverage-ledger.json after the session.",
    "",
    "Tool access is intentionally source-only. Work only inside this workspace.",
    "The evaluation answer key is not present in this workspace.",
    "Complete as much of the six-phase workflow as the declared host capabilities safely permit, and write durable artifacts into output.",
  ].join("\n");
}

function buildClaudeCommand(context, options) {
  const args = [
    "-p",
    buildPrompt(context),
    "--output-format",
    "json",
    "--no-session-persistence",
    "--setting-sources",
    "project",
    "--strict-mcp-config",
    "--mcp-config",
    JSON.stringify({ mcpServers: {} }),
    "--disable-slash-commands",
    "--no-chrome",
    "--model",
    options.model,
    "--permission-mode",
    "dontAsk",
    "--tools",
    "Read,Glob,Grep,Write,Agent",
    "--agents",
    JSON.stringify(buildAgents()),
  ];
  if (options.execute) args.push("--max-budget-usd", String(options.maxBudgetUsd));
  return { command: "claude", args };
}

function prepareWorkspace(options) {
  const caseDirectory = path.join(CASES_ROOT, options.caseId);
  const definition = harness.loadCase(caseDirectory);
  const sourceDirectory = path.join(caseDirectory, definition.target.root);
  const sourceHash = hashTree(sourceDirectory);
  const runId = options.runId || defaultRunId(options.caseId, options.model);
  const workspace = path.join(WORK_ROOT, runId);
  const runDirectory = path.join(RUN_ROOT, runId);

  if (fs.existsSync(workspace) || fs.existsSync(runDirectory)) {
    throw new Error("run id already exists: " + runId);
  }

  fs.mkdirSync(workspace, { recursive: true });
  fs.mkdirSync(runDirectory, { recursive: true });
  copyTree(sourceDirectory, path.join(workspace, "target"));
  copyTree(SKILL_SOURCE, path.join(workspace, "skill"));
  fs.mkdirSync(path.join(workspace, "output"), { recursive: true });

  return {
    caseDirectory,
    definition,
    sourceHash,
    runId,
    workspace,
    runDirectory,
    profile: definition.target.recommended_profile,
  };
}

function emptyOutcomes() {
  return Object.fromEntries(harness.OUTCOMES.map((outcome) => [outcome, 0]));
}

function resultText(parsed, stdout) {
  if (parsed && typeof parsed.result === "string") return parsed.result;
  return stdout || "";
}

function looksLikeRefusal(value) {
  const text = String(value || "").toLowerCase();
  return [
    "cannot fulfill",
    "cannot assist",
    "cannot comply",
    "can't assist",
    "unable to assist",
    "i cannot perform",
  ].some((needle) => text.includes(needle));
}

function usageFrom(parsed) {
  const usage = parsed && parsed.usage && typeof parsed.usage === "object" ? parsed.usage : {};
  const numeric = (value) => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null);
  const input = numeric(usage.input_tokens);
  const output = numeric(usage.output_tokens);
  return {
    input_tokens: input,
    output_tokens: output,
    total_tokens: numeric(usage.total_tokens) ?? (input !== null && output !== null ? input + output : null),
    cost_usd: numeric(parsed && parsed.total_cost_usd),
  };
}

function copyIfRegular(source, destination) {
  if (!fs.existsSync(source)) return false;
  const stat = fs.lstatSync(source);
  if (!stat.isFile() || stat.isSymbolicLink()) return false;
  fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
  return true;
}

function writeRecord(context, options, classification, parsed, hostError, artifactsComplete) {
  const outcomes = emptyOutcomes();
  outcomes[classification] = 1;
  const record = {
    schema_version: 1,
    run_id: context.runId,
    case_id: context.definition.id,
    upstream_baseline: harness.BASE,
    status: artifactsComplete ? "complete" : (["provider_error", "timeout"].includes(classification) ? "failed" : "incomplete"),
    source_ref: "sha256:" + context.sourceHash,
    profile: context.profile,
    host: { name: "claude-code", model: options.model },
    artifacts: {
      findings: artifactsComplete ? "findings.json" : null,
      coverage_ledger: artifactsComplete ? "coverage-ledger.json" : null,
    },
    usage: usageFrom(parsed),
    worker_outcomes: outcomes,
    host_error: hostError || null,
  };
  const errors = harness.validateRun(record, context.definition);
  if (errors.length) throw new Error("generated invalid run record: " + errors.join("; "));
  fs.writeFileSync(path.join(context.runDirectory, "run-record.json"), JSON.stringify(record, null, 2) + "\n");
  return record;
}

function executeBaseline(options) {
  const context = prepareWorkspace(options);
  const invocation = buildClaudeCommand(context, options);
  const started = Date.now();
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: context.workspace,
    encoding: "utf8",
    timeout: options.timeoutSeconds * 1000,
    maxBuffer: 16 * 1024 * 1024,
    env: process.env,
  });

  fs.writeFileSync(path.join(context.runDirectory, "host-stdout.json"), result.stdout || "");
  fs.writeFileSync(path.join(context.runDirectory, "host-stderr.txt"), result.stderr || "");

  let parsed = null;
  try {
    parsed = result.stdout ? JSON.parse(result.stdout) : null;
  } catch {
    parsed = null;
  }

  let classification = "valid_result";
  let hostError = null;
  if (result.error && result.error.code === "ETIMEDOUT") {
    classification = "timeout";
    hostError = "Claude Code baseline invocation timed out";
  } else if (result.status !== 0) {
    classification = "provider_error";
    hostError = "Claude Code exited nonzero" + (result.status === null ? "" : " (" + result.status + ")");
  } else if (looksLikeRefusal(resultText(parsed, result.stdout))) {
    classification = "model_refusal";
    hostError = "Claude Code returned refusal-like output";
  }

  const output = path.join(context.workspace, "output");
  const findingsSource = path.join(output, "findings.json");
  const ledgerSource = path.join(output, "coverage-ledger.json");
  let artifactsComplete = false;

  if (classification === "valid_result") {
    const findingsCopied = copyIfRegular(findingsSource, path.join(context.runDirectory, "findings.json"));
    const ledgerCopied = copyIfRegular(ledgerSource, path.join(context.runDirectory, "coverage-ledger.json"));
    if (!findingsCopied || !ledgerCopied) {
      classification = "malformed_result";
      hostError = "Claude Code completed without both required structured artifacts";
    } else {
      try {
        const temporary = {
          schema_version: 1,
          run_id: context.runId,
          case_id: context.definition.id,
          upstream_baseline: harness.BASE,
          status: "complete",
          source_ref: "sha256:" + context.sourceHash,
          profile: context.profile,
          host: { name: "claude-code", model: options.model },
          artifacts: { findings: "findings.json", coverage_ledger: "coverage-ledger.json" },
          usage: usageFrom(parsed),
          worker_outcomes: emptyOutcomes(),
          host_error: null,
        };
        fs.writeFileSync(path.join(context.runDirectory, "run-record.json"), JSON.stringify(temporary, null, 2) + "\n");
        harness.loadRun(context.definition, context.runDirectory);
        fs.rmSync(path.join(context.runDirectory, "run-record.json"));
        artifactsComplete = true;
      } catch (error) {
        classification = "malformed_result";
        hostError = "captured audit artifacts failed validation: " + error.message;
      }
    }
  }

  const record = writeRecord(context, options, classification, parsed, hostError, artifactsComplete);
  if (artifactsComplete) {
    const score = harness.scoreDirectory(context.caseDirectory, context.runDirectory);
    fs.writeFileSync(path.join(context.runDirectory, "score.json"), JSON.stringify(score, null, 2) + "\n");
  }

  fs.writeFileSync(
    path.join(context.runDirectory, "invocation.json"),
    JSON.stringify({
      host: "claude-code",
      model: options.model,
      timeout_seconds: options.timeoutSeconds,
      max_budget_usd: options.maxBudgetUsd,
      elapsed_ms: Date.now() - started,
      source_only: true,
      ambient_settings: "project-only",
      mcp_config: "empty-strict",
      slash_commands: "disabled",
      chrome_integration: "disabled",
      tool_set: ["Read", "Glob", "Grep", "Write", "Agent"],
    }, null, 2) + "\n",
  );

  if (!options.keepWorkspace) fs.rmSync(context.workspace, { recursive: true, force: true });
  return { record, runDirectory: context.runDirectory };
}

function dryRun(options) {
  const definition = harness.loadCase(path.join(CASES_ROOT, options.caseId));
  const sourceDirectory = path.join(CASES_ROOT, options.caseId, definition.target.root);
  const context = {
    profile: definition.target.recommended_profile,
    sourceHash: hashTree(sourceDirectory),
  };
  const invocation = buildClaudeCommand(context, options);
  return {
    execute: false,
    case_id: options.caseId,
    host: "claude-code",
    model: options.model,
    profile: context.profile,
    source_ref: "sha256:" + context.sourceHash,
    source_only: true,
    ambient_settings: "project-only",
    mcp_config: "empty-strict",
    slash_commands: "disabled",
    chrome_integration: "disabled",
    max_budget_usd: options.maxBudgetUsd,
    timeout_seconds: options.timeoutSeconds,
    command: invocation.command,
    args: invocation.args,
  };
}

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (!options.execute) {
      console.log(JSON.stringify(dryRun(options), null, 2));
      return;
    }
    const result = executeBaseline(options);
    console.log(JSON.stringify({ status: result.record.status, run_id: result.record.run_id, run_directory: result.runDirectory }, null, 2));
    if (result.record.status !== "complete") process.exitCode = 2;
  } catch (error) {
    console.error("FAIL:", error.message);
    process.exit(1);
  }
}

if (require.main === module) main();

module.exports = {
  buildClaudeCommand,
  buildPrompt,
  defaultRunId,
  dryRun,
  emptyOutcomes,
  hashTree,
  looksLikeRefusal,
  parseArgs,
  usageFrom,
  WORK_ROOT,
};
