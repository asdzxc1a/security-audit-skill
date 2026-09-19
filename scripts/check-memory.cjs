#!/usr/bin/env node
const fs=require("node:fs"),path=require("node:path"),root=path.resolve(__dirname,".."),errors=[];
const required=["AGENTS.md","docs/project/PROJECT_MEMORY_SYSTEM.md","docs/project/STATE.md","docs/project/PLAN.md","docs/project/TEST_STRATEGY.md","docs/project/CHARTER.md","docs/project/DECISIONS.md","docs/project/LESSONS.md","docs/project/history/2026-09-19-upstream-research-baseline.md",".github/ISSUE_TEMPLATE/gate.md",".github/pull_request_template.md"];
function read(rel){const f=path.join(root,rel);if(!fs.existsSync(f)){errors.push("missing "+rel);return""}const s=fs.lstatSync(f);if(!s.isFile()||s.isSymbolicLink()){errors.push("unsafe memory file "+rel);return""}return fs.readFileSync(f,"utf8")}
const docs=new Map(required.map(r=>[r,read(r)])),agents=docs.get("AGENTS.md")||"",state=docs.get("docs/project/STATE.md")||"",plan=docs.get("docs/project/PLAN.md")||"";
if(!agents.includes("docs/project/PROJECT_MEMORY_SYSTEM.md"))errors.push("AGENTS must link memory protocol");
if(!agents.includes("Chat is context, not project state."))errors.push("AGENTS must reject chat as project state");
if(state.split(/\r?\n/).length>140)errors.push("STATE too large");
for(const h of["## Current truth","## Current gate","## Blockers","## Verified evidence","## Next action"])if(!state.includes(h))errors.push("STATE missing "+h);
if(!state.includes("c1c8a8c1471069fb0e188eeaff69b8e8db6564a8"))errors.push("STATE missing pinned baseline");
for(const m of["<!-- CURRENT_GATE_START -->","<!-- CURRENT_GATE_END -->"])if(plan.split(m).length-1!==1)errors.push("PLAN needs exactly one "+m);
const a=plan.indexOf("<!-- CURRENT_GATE_START -->"),b=plan.indexOf("<!-- CURRENT_GATE_END -->"),gate=a>=0&&b>a?plan.slice(a,b):"";
for(const x of["### Goal","### Scope","### Acceptance","### Non-goals","### Exit"])if(!gate.includes(x))errors.push("current gate missing "+x);
if(!/Issue:\s*#\d+/.test(gate))errors.push("current gate missing issue");
const secret=[/\bgh[opsu]_[A-Za-z0-9_]{20,}\b/g,/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,/\bsk-[A-Za-z0-9_-]{20,}\b/g,/\bAKIA[0-9A-Z]{16}\b/g];
for(const [r,t] of docs)for(const p of secret){p.lastIndex=0;if(p.test(t))errors.push(r+" appears to contain a secret")}
if(errors.length){errors.forEach(e=>console.error("ERROR:",e));console.error("FAIL:",errors.length,"memory invariant(s)");process.exit(1)}
console.log("PASS: project-memory invariants valid");
