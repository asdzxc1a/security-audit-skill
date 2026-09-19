#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const required = [
  "AGENTS.md",
  "docs/project/PROJECT_MEMORY_SYSTEM.md",
  "docs/project/STATE.md",
  "docs/project/PLAN.md",
  "docs/project/TEST_STRATEGY.md",
  "docs/project/CHARTER.md",
  "docs/project/DECISIONS.md",
  "docs/project/LESSONS.md",
  "docs/project/history/2026-09-19-upstream-research-baseline.md",
  ".github/ISSUE_TEMPLATE/gate.md",
  ".github/pull_request_template.md"
];

const errors = [];

function read(rel) {
  const file = path.join(root, rel);
  if (!fs.existsSync(file)) {
    errors.push("missing required file: " + rel);
    return "";
  }
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    errors.push("required memory path must be a regular non-symlink file: " + rel);
    return "";
  }
  return fs.readFileSync(file, "utf8");
}

const docs = new Map(required.map((rel) => [rel, read(rel)]));

const agents = docs.get("AGENTS.md") || "";
if (!agents.includes("docs/project/PROJECT_MEMORY_SYSTEM.md")) {
  errors.push("AGENTS.md must link the full memory protocol");
}
if (!agents.includes("Chat is context, not project state.")) {
  errors.push("AGENTS.md must state that chat is not project state");
}

const state = docs.get("docs/project/STATE.md") || "";
const stateLines = state.split(/\r?\n/).length;
if (stateLines > 140) {
  errors.push("STATE.md is too large for boot context: " + stateLines + " lines (max 140)");
}
for (const heading of [
  "## Current truth",
  "## Current gate",
  "## Blockers",
  "## Verified evidence",
  "## Next action"
]) {
  if (!state.includes(heading)) errors.push("STATE.md missing " + heading);
}
if (!state.includes("c1c8a8c1471069fb0e188eeaff69b8e8db6564a8")) {
  errors.push("STATE.md must identify the pinned upstream baseline");
}

const plan = docs.get("docs/project/PLAN.md") || "";
for (const marker of ["<!-- CURRENT_GATE_START -->", "<!-- CURRENT_GATE_END -->"]) {
  const count = plan.split(marker).length - 1;
  if (count !== 1) errors.push("PLAN.md must contain exactly one " + marker + " marker");
}
const start = plan.indexOf("<!-- CURRENT_GATE_START -->");
const end = plan.indexOf("<!-- CURRENT_GATE_END -->");
if (start === -1 || end === -1 || end <= start) {
  errors.push("PLAN.md current gate markers are malformed");
} else {
  const gate = plan.slice(start, end);
  for (const requiredText of ["Issue: #1", "### Goal", "### Scope", "### Acceptance", "### Non-goals", "### Exit"]) {
    if (!gate.includes(requiredText)) errors.push("current gate missing " + requiredText);
  }
}

const decisions = docs.get("docs/project/DECISIONS.md") || "";
if (!decisions.includes("Status: Accepted")) {
  errors.push("DECISIONS.md must contain at least one accepted decision");
}

const memoryFiles = [
  "AGENTS.md",
  "docs/project/PROJECT_MEMORY_SYSTEM.md",
  "docs/project/STATE.md",
  "docs/project/PLAN.md",
  "docs/project/TEST_STRATEGY.md",
  "docs/project/CHARTER.md",
  "docs/project/DECISIONS.md",
  "docs/project/LESSONS.md"
];

const secretPatterns = [
  ["GitHub token", /\bgh[opsu]_[A-Za-z0-9_]{20,}\b/g],
  ["GitHub fine-grained token", /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g],
  ["OpenAI-style secret", /\bsk-[A-Za-z0-9_-]{20,}\b/g],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/g]
];

for (const rel of memoryFiles) {
  const text = docs.get(rel) || "";
  if (text.includes("\0")) errors.push(rel + " contains a NUL byte");
  for (const [name, pattern] of secretPatterns) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) errors.push(rel + " appears to contain a " + name);
  }
}

const historyDir = path.join(root, "docs/project/history");
if (!fs.existsSync(historyDir) || !fs.statSync(historyDir).isDirectory()) {
  errors.push("docs/project/history must exist");
} else {
  for (const name of fs.readdirSync(historyDir)) {
    if (!/^\d{4}-\d{2}-\d{2}-[a-z0-9][a-z0-9-]*\.md$/.test(name)) {
      errors.push("history filename must be YYYY-MM-DD-topic.md: " + name);
    }
  }
}

if (errors.length > 0) {
  for (const error of errors) console.error("ERROR:", error);
  console.error("FAIL:", errors.length, "project-memory invariant(s) failed");
  process.exit(1);
}

console.log("PASS: project-memory invariants valid");
