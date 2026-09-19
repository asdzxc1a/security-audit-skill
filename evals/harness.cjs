"use strict";

const fs = require("node:fs");
const path = require("node:path");

const findingsValidator = require("../skills/security-audit/validate-findings.cjs");
const coverageValidator = require("../skills/security-audit/validate-coverage-ledger.cjs");

const BASE = "c1c8a8c1471069fb0e188eeaff69b8e8db6564a8";
const OUTCOMES = [
  "valid_result",
  "malformed_result",
  "model_refusal",
  "provider_error",
  "timeout",
  "permission_denied",
  "sandbox_failure",
  "cancelled",
];
const RUN_STATUSES = new Set(["complete", "incomplete", "failed"]);
const VERDICT_RANK = { rejected: 0, needs_validation: 1, confirmed: 2 };

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function visibleText(value) {
  return typeof value === "string" && value.trim() === value && /\S/u.test(value);
}

function safeRelativePath(value) {
  return findingsValidator.isSafeRelativeSourcePath(value);
}

function readJson(file) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error("unsafe JSON file " + file);
  }
  if (stat.size > 2 * 1024 * 1024) {
    throw new Error("JSON file exceeds eval limit " + file);
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function validateCase(definition) {
  const errors = [];
  if (!isObject(definition)) return ["expected object"];
  if (definition.schema_version !== 1) errors.push("schema_version must be 1");
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(definition.id || "")) errors.push("invalid case id");
  if (!visibleText(definition.title)) errors.push("invalid title");
  if (!visibleText(definition.description)) errors.push("invalid description");
  if (definition.upstream_baseline !== BASE) errors.push("case baseline drift");

  if (
    !isObject(definition.target) ||
    !safeRelativePath(definition.target.root) ||
    !["quick", "standard", "deep"].includes(definition.target.recommended_profile)
  ) {
    errors.push("invalid target");
  }

  for (const field of ["expected_findings", "decoys", "coverage_obligations"]) {
    if (!Array.isArray(definition[field])) errors.push(field + " must be array");
  }

  const ids = new Set();
  for (const [kind, list] of [
    ["expected", definition.expected_findings || []],
    ["decoy", definition.decoys || []],
  ]) {
    for (const item of list) {
      if (!item || !visibleText(item.id) || !Array.isArray(item.anchors) || item.anchors.length === 0) {
        errors.push("invalid " + kind + " spec");
        continue;
      }
      if (ids.has(item.id)) errors.push("duplicate id " + item.id);
      ids.add(item.id);
      for (const anchor of item.anchors) {
        if (!anchor || !safeRelativePath(anchor.file) || !visibleText(anchor.scope)) {
          errors.push("invalid anchor " + item.id);
        }
      }
      if (kind === "expected" && !["confirmed", "needs_validation"].includes(item.expected_verdict)) {
        errors.push("invalid expected verdict");
      }
    }
  }

  for (const item of definition.coverage_obligations || []) {
    if (!item || !visibleText(item.id) || !isObject(item.selectors) || Object.keys(item.selectors).length === 0) {
      errors.push("invalid coverage obligation");
      continue;
    }
    if (ids.has(item.id)) errors.push("duplicate id " + item.id);
    ids.add(item.id);
    for (const value of Object.values(item.selectors)) {
      if (!visibleText(value)) errors.push("invalid coverage selector " + item.id);
    }
  }
  return errors;
}

function nullableArtifact(value) {
  return value === null || safeRelativePath(value);
}

function validateRun(record, definition) {
  const errors = [];
  if (!isObject(record)) return ["expected run object"];
  if (record.schema_version !== 1) errors.push("run schema_version must be 1");
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(record.run_id || "")) errors.push("invalid run id");
  if (record.case_id !== definition.id) errors.push("run case mismatch");
  if (record.upstream_baseline !== BASE) errors.push("run baseline drift");
  if (!RUN_STATUSES.has(record.status)) errors.push("invalid run status");
  if (!visibleText(record.source_ref)) errors.push("invalid source_ref");
  if (!["quick", "standard", "deep"].includes(record.profile)) errors.push("invalid profile");

  if (
    !isObject(record.host) ||
    !visibleText(record.host.name) ||
    (record.host.model !== null && !visibleText(record.host.model))
  ) {
    errors.push("invalid host");
  }

  if (!isObject(record.artifacts)) {
    errors.push("invalid artifacts");
  } else {
    const findings = record.artifacts.findings;
    const ledger = record.artifacts.coverage_ledger;
    if (!nullableArtifact(findings) || !nullableArtifact(ledger)) errors.push("invalid artifacts");
    if (record.status === "complete" && (!safeRelativePath(findings) || !safeRelativePath(ledger))) {
      errors.push("complete run requires findings and coverage artifacts");
    }
  }

  if (!isObject(record.usage)) {
    errors.push("invalid usage");
  } else {
    for (const field of ["input_tokens", "output_tokens", "total_tokens", "cost_usd"]) {
      const value = record.usage[field];
      if (value !== null && (!Number.isFinite(value) || value < 0)) {
        errors.push("invalid usage " + field);
      }
    }
  }

  if (!isObject(record.worker_outcomes)) {
    errors.push("invalid worker_outcomes");
  } else {
    for (const field of OUTCOMES) {
      if (!Number.isInteger(record.worker_outcomes[field]) || record.worker_outcomes[field] < 0) {
        errors.push("invalid outcome " + field);
      }
    }
    for (const field of Object.keys(record.worker_outcomes)) {
      if (!OUTCOMES.includes(field)) errors.push("unexpected outcome " + field);
    }
  }

  if (record.host_error !== null && record.host_error !== undefined && !visibleText(record.host_error)) {
    errors.push("invalid host_error");
  }
  return errors;
}

function inside(root, relative) {
  if (!safeRelativePath(relative)) throw new Error("unsafe relative path " + relative);
  const base = path.resolve(root);
  const resolved = path.resolve(base, relative);
  if (!resolved.startsWith(base + path.sep)) throw new Error("path escape");
  return resolved;
}

function loadCase(directory) {
  const definition = readJson(path.join(directory, "case.json"));
  const errors = validateCase(definition);
  if (errors.length) throw new Error(errors.join("\n"));
  const target = inside(directory, definition.target.root);
  if (!fs.statSync(target).isDirectory()) throw new Error("target root missing");
  return definition;
}

function loadRun(definition, directory) {
  const record = readJson(path.join(directory, "run-record.json"));
  const errors = validateRun(record, definition);
  if (errors.length) throw new Error(errors.join("\n"));
  if (record.status !== "complete") {
    return { record, findings: null, ledger: null };
  }

  const findings = readJson(inside(directory, record.artifacts.findings));
  const ledger = readJson(inside(directory, record.artifacts.coverage_ledger));
  const schema = readJson(path.resolve(__dirname, "../skills/security-audit/report-schema.json"));

  const findingErrors = findingsValidator.validateDocument(findings, schema);
  if (findingErrors.length) throw new Error("findings invalid: " + findingErrors.join("; "));

  const coverageErrors = coverageValidator.validateDocument(ledger);
  if (coverageErrors.length) throw new Error("coverage invalid: " + coverageErrors.join("; "));

  return { record, findings, ledger };
}

function recordMatches(record, spec) {
  return spec.anchors.every((anchor) =>
    (record.trace || []).some((step) => step.file === anchor.file && step.scope === anchor.scope),
  );
}

function coverageMatches(unit, selectors) {
  const fields = {
    surface_contains: "surface",
    boundary_contains: "boundary",
    subsystem_contains: "subsystem",
    attack_class_contains: "attack_class",
    lifecycle_contains: "lifecycle",
  };
  return Object.entries(selectors).every(([selector, value]) => {
    const field = fields[selector];
    return field && typeof unit[field] === "string" && unit[field].includes(value);
  });
}

function ratio(numerator, denominator) {
  return denominator ? numerator / denominator : null;
}

function score(definition, run) {
  if (run.record.status !== "complete" || !Array.isArray(run.findings) || !Array.isArray(run.ledger)) {
    throw new Error("only complete runs with validated artifacts can be scored");
  }

  const used = new Set();
  const expected = [];
  let detected = 0;
  let correct = 0;
  let overclaims = 0;
  let underclaims = 0;
  let correctlyConfirmed = 0;

  for (const spec of definition.expected_findings) {
    let chosen = -1;
    let bestRank = -1;
    run.findings.forEach((finding, index) => {
      if (used.has(index) || !recordMatches(finding, spec)) return;
      const rank = VERDICT_RANK[finding.verdict] ?? -1;
      if (rank > bestRank) {
        chosen = index;
        bestRank = rank;
      }
    });
    if (chosen >= 0) used.add(chosen);

    const finding = chosen >= 0 ? run.findings[chosen] : null;
    const isDetected = Boolean(finding && finding.verdict !== "rejected");
    const correctVerdict = Boolean(finding && finding.verdict === spec.expected_verdict);
    if (isDetected) detected++;
    if (correctVerdict) correct++;
    if (correctVerdict && spec.expected_verdict === "confirmed") correctlyConfirmed++;

    if (finding) {
      if ((VERDICT_RANK[finding.verdict] ?? -1) > VERDICT_RANK[spec.expected_verdict]) overclaims++;
      if ((VERDICT_RANK[finding.verdict] ?? -1) < VERDICT_RANK[spec.expected_verdict]) underclaims++;
    }

    expected.push({
      id: spec.id,
      expected_verdict: spec.expected_verdict,
      actual_verdict: finding ? finding.verdict : null,
      fingerprint: finding ? finding.fingerprint : null,
      detected: isDetected,
      correct_verdict: correctVerdict,
    });
  }

  const confirmedIndexes = run.findings
    .map((finding, index) => (finding.verdict === "confirmed" ? index : -1))
    .filter((index) => index >= 0);

  const correctlyConfirmedIndexes = new Set();
  for (const detail of expected) {
    if (!detail.correct_verdict || detail.expected_verdict !== "confirmed") continue;
    const index = run.findings.findIndex((finding) => finding.fingerprint === detail.fingerprint);
    if (index >= 0) correctlyConfirmedIndexes.add(index);
  }
  const falsePositiveIndexes = confirmedIndexes.filter((index) => !correctlyConfirmedIndexes.has(index));

  const decoyHits = [];
  for (const decoy of definition.decoys) {
    for (const finding of run.findings) {
      if (finding.verdict !== "rejected" && recordMatches(finding, decoy)) {
        decoyHits.push({ decoy_id: decoy.id, fingerprint: finding.fingerprint, verdict: finding.verdict });
      }
    }
  }

  const coverageDetails = definition.coverage_obligations.map((obligation) => {
    const matches = run.ledger.filter((unit) => coverageMatches(unit, obligation.selectors));
    return {
      id: obligation.id,
      mapped: matches.length > 0,
      evidence_attempted: matches.some((unit) => ["covered", "candidate", "blocked"].includes(unit.status)),
      resolved: matches.some((unit) => ["covered", "candidate"].includes(unit.status)),
      coverage_ids: matches.map((unit) => unit.coverage_id).sort(),
    };
  });

  return {
    schema_version: 1,
    case_id: definition.id,
    run_id: run.record.run_id,
    metrics: {
      expected_findings: definition.expected_findings.length,
      detected_expected: detected,
      correct_verdict_expected: correct,
      detection_recall: ratio(detected, definition.expected_findings.length),
      correct_verdict_recall: ratio(correct, definition.expected_findings.length),
      confirmed_findings: confirmedIndexes.length,
      correctly_confirmed_expected: correctlyConfirmed,
      confirmed_precision: ratio(correctlyConfirmed, confirmedIndexes.length),
      false_positive_confirmed: falsePositiveIndexes.length,
      decoy_hits: decoyHits.length,
      verdict_overclaims: overclaims,
      verdict_underclaims: underclaims,
    },
    expected,
    false_positive_fingerprints: falsePositiveIndexes.map((index) => run.findings[index].fingerprint).sort(),
    decoy_hits: decoyHits,
    coverage: {
      total: coverageDetails.length,
      mapped: coverageDetails.filter((item) => item.mapped).length,
      evidence_attempted: coverageDetails.filter((item) => item.evidence_attempted).length,
      resolved: coverageDetails.filter((item) => item.resolved).length,
      details: coverageDetails,
    },
    usage: run.record.usage,
    worker_outcomes: run.record.worker_outcomes,
  };
}

function scoreDirectory(caseDirectory, runDirectory) {
  const definition = loadCase(caseDirectory);
  return score(definition, loadRun(definition, runDirectory));
}

function checkCorpus() {
  const casesRoot = path.join(__dirname, "cases");
  const runsRoot = path.join(__dirname, "reference-runs");
  const cases = new Map();
  const errors = [];

  for (const name of fs.readdirSync(casesRoot).sort()) {
    try {
      const directory = path.join(casesRoot, name);
      const definition = loadCase(directory);
      if (definition.id !== name) throw new Error("directory/id mismatch");
      cases.set(definition.id, directory);
    } catch (error) {
      errors.push("case " + name + ": " + error.message);
    }
  }

  for (const name of fs.readdirSync(runsRoot).sort()) {
    try {
      const directory = path.join(runsRoot, name);
      const record = readJson(path.join(directory, "run-record.json"));
      const caseDirectory = cases.get(record.case_id);
      if (!caseDirectory) throw new Error("unknown case");
      const definition = loadCase(caseDirectory);
      const run = loadRun(definition, directory);
      if (record.status === "complete") score(definition, run);
    } catch (error) {
      errors.push("run " + name + ": " + error.message);
    }
  }

  if (cases.size < 3) errors.push("need at least three cases");
  if (errors.length) throw new Error(errors.join("\n"));
  return cases.size;
}

if (require.main === module) {
  try {
    const command = process.argv[2];
    if (command === "check") {
      const count = checkCorpus();
      console.log("PASS:", count, "evaluation cases and reference runs valid");
    } else if (command === "score") {
      console.log(JSON.stringify(scoreDirectory(path.resolve(process.argv[3]), path.resolve(process.argv[4])), null, 2));
    } else {
      throw new Error("Usage: node evals/harness.cjs check | score <case-dir> <run-dir>");
    }
  } catch (error) {
    console.error("FAIL:", error.message);
    process.exit(1);
  }
}

module.exports = {
  BASE,
  OUTCOMES,
  checkCorpus,
  loadCase,
  loadRun,
  readJson,
  score,
  scoreDirectory,
  validateCase,
  validateRun,
};
