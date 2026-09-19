"use strict";
const fs=require("node:fs"),path=require("node:path");
const fv=require("../skills/security-audit/validate-findings.cjs");
const cv=require("../skills/security-audit/validate-coverage-ledger.cjs");
const BASE="c1c8a8c1471069fb0e188eeaff69b8e8db6564a8";
const OUTCOMES=["valid_result","malformed_result","model_refusal","provider_error","timeout","permission_denied","sandbox_failure","cancelled"];
const RANK={rejected:0,needs_validation:1,confirmed:2};
function obj(v){return v&&typeof v==="object"&&!Array.isArray(v)}
function text(v){return typeof v==="string"&&v.trim()===v&&/\\S/u.test(v)}
function read(file){const s=fs.lstatSync(file);if(!s.isFile()||s.isSymbolicLink())throw Error("unsafe JSON file "+file);return JSON.parse(fs.readFileSync(file,"utf8"))}
function safe(v){return fv.isSafeRelativeSourcePath(v)}
function validateCase(c){
 const e=[]; if(!obj(c))return["expected object"];
 if(c.schema_version!==1)e.push("schema_version must be 1");
 if(!/^[a-z0-9][a-z0-9-]{0,63}$/.test(c.id||""))e.push("invalid case id");
 if(c.upstream_baseline!==BASE)e.push("case baseline drift");
 if(!obj(c.target)||!safe(c.target.root)||!["quick","standard","deep"].includes(c.target.recommended_profile))e.push("invalid target");
 for(const k of ["expected_findings","decoys","coverage_obligations"])if(!Array.isArray(c[k]))e.push(k+" must be array");
 const ids=new Set();
 for(const [kind,list] of [["expected",c.expected_findings||[]],["decoy",c.decoys||[]]]){
  for(const x of list){if(!x||!text(x.id)||!Array.isArray(x.anchors)||!x.anchors.length)e.push("invalid "+kind+" spec");else{if(ids.has(x.id))e.push("duplicate id "+x.id);ids.add(x.id);for(const a of x.anchors)if(!a||!safe(a.file)||!text(a.scope))e.push("invalid anchor "+x.id)}if(kind==="expected"&&!["confirmed","needs_validation"].includes(x.expected_verdict))e.push("invalid expected verdict")}
 }
 for(const x of c.coverage_obligations||[]){if(!x||!text(x.id)||!obj(x.selectors)||!Object.keys(x.selectors).length)e.push("invalid coverage obligation");else{if(ids.has(x.id))e.push("duplicate id "+x.id);ids.add(x.id)}}
 return e;
}
function validateRun(r,c){
 const e=[]; if(!obj(r))return["expected run object"];
 if(r.schema_version!==1)e.push("run schema_version must be 1");
 if(r.case_id!==c.id)e.push("run case mismatch");
 if(r.upstream_baseline!==BASE)e.push("run baseline drift");
 if(!["quick","standard","deep"].includes(r.profile))e.push("invalid profile");
 if(!obj(r.host)||!text(r.host.name)||(r.host.model!==null&&!text(r.host.model)))e.push("invalid host");
 if(!obj(r.artifacts)||!safe(r.artifacts.findings)||!safe(r.artifacts.coverage_ledger))e.push("invalid artifacts");
 if(!obj(r.usage))e.push("invalid usage"); else for(const k of ["input_tokens","output_tokens","total_tokens","cost_usd"]){const v=r.usage[k];if(v!==null&&(!Number.isFinite(v)||v<0))e.push("invalid usage "+k)}
 if(!obj(r.worker_outcomes))e.push("invalid worker_outcomes"); else for(const k of OUTCOMES)if(!Number.isInteger(r.worker_outcomes[k])||r.worker_outcomes[k]<0)e.push("invalid outcome "+k);
 return e;
}
function inside(root,rel){if(!safe(rel))throw Error("unsafe relative path "+rel);const a=path.resolve(root),b=path.resolve(a,rel);if(!b.startsWith(a+path.sep))throw Error("path escape");return b}
function loadCase(dir){const c=read(path.join(dir,"case.json")),e=validateCase(c);if(e.length)throw Error(e.join("\n"));const target=inside(dir,c.target.root);if(!fs.statSync(target).isDirectory())throw Error("target root missing");return c}
function loadRun(c,dir){
 const r=read(path.join(dir,"run-record.json")),re=validateRun(r,c);if(re.length)throw Error(re.join("\n"));
 const findings=read(inside(dir,r.artifacts.findings)),ledger=read(inside(dir,r.artifacts.coverage_ledger));
 const schema=read(path.resolve(__dirname,"../skills/security-audit/report-schema.json"));
 const fe=fv.validateDocument(findings,schema);if(fe.length)throw Error("findings invalid: "+fe.join("; "));
 const ce=cv.validateDocument(ledger);if(ce.length)throw Error("coverage invalid: "+ce.join("; "));
 return{record:r,findings,ledger};
}
function match(rec,spec){return spec.anchors.every(a=>(rec.trace||[]).some(t=>t.file===a.file&&t.scope===a.scope))}
function coverageMatch(u,s){const map={surface_contains:"surface",boundary_contains:"boundary",subsystem_contains:"subsystem",attack_class_contains:"attack_class",lifecycle_contains:"lifecycle"};return Object.entries(s).every(([k,v])=>typeof u[map[k]]==="string"&&u[map[k]].includes(v))}
function ratio(n,d){return d? n/d:null}
function score(c,run){
 const used=new Set(),details=[];let detected=0,correct=0,over=0,under=0,correctConfirmed=0;
 for(const spec of c.expected_findings){let idx=-1,best=-1;run.findings.forEach((f,i)=>{if(!used.has(i)&&match(f,spec)&&(RANK[f.verdict]??-1)>best){idx=i;best=RANK[f.verdict]??-1}});if(idx>=0)used.add(idx);const f=idx>=0?run.findings[idx]:null,det=!!f&&f.verdict!=="rejected",ok=!!f&&f.verdict===spec.expected_verdict;if(det)detected++;if(ok)correct++;if(ok&&spec.expected_verdict==="confirmed")correctConfirmed++;if(f&&RANK[f.verdict]>RANK[spec.expected_verdict])over++;if(f&&RANK[f.verdict]<RANK[spec.expected_verdict])under++;details.push({id:spec.id,expected_verdict:spec.expected_verdict,actual_verdict:f?f.verdict:null,fingerprint:f?f.fingerprint:null,detected:det,correct_verdict:ok})}
 const confirmed=run.findings.map((f,i)=>f.verdict==="confirmed"?i:-1).filter(i=>i>=0);
 const correctIdx=new Set();details.forEach((d)=>{if(d.correct_verdict&&d.expected_verdict==="confirmed"){const i=run.findings.findIndex(f=>f.fingerprint===d.fingerprint);if(i>=0)correctIdx.add(i)}});
 const fps=confirmed.filter(i=>!correctIdx.has(i));
 const decoys=[];for(const d of c.decoys)for(const f of run.findings)if(f.verdict!=="rejected"&&match(f,d))decoys.push({decoy_id:d.id,fingerprint:f.fingerprint,verdict:f.verdict});
 const cov=c.coverage_obligations.map(o=>{const m=run.ledger.filter(u=>coverageMatch(u,o.selectors));return{id:o.id,mapped:!!m.length,evidence_attempted:m.some(u=>["covered","candidate","blocked"].includes(u.status)),resolved:m.some(u=>["covered","candidate"].includes(u.status)),coverage_ids:m.map(u=>u.coverage_id).sort()}});
 return{schema_version:1,case_id:c.id,run_id:run.record.run_id,metrics:{expected_findings:c.expected_findings.length,detected_expected:detected,correct_verdict_expected:correct,detection_recall:ratio(detected,c.expected_findings.length),correct_verdict_recall:ratio(correct,c.expected_findings.length),confirmed_findings:confirmed.length,correctly_confirmed_expected:correctConfirmed,confirmed_precision:ratio(correctConfirmed,confirmed.length),false_positive_confirmed:fps.length,decoy_hits:decoys.length,verdict_overclaims:over,verdict_underclaims:under},expected:details,false_positive_fingerprints:fps.map(i=>run.findings[i].fingerprint).sort(),decoy_hits:decoys,coverage:{total:cov.length,mapped:cov.filter(x=>x.mapped).length,evidence_attempted:cov.filter(x=>x.evidence_attempted).length,resolved:cov.filter(x=>x.resolved).length,details:cov},usage:run.record.usage,worker_outcomes:run.record.worker_outcomes};
}
function scoreDir(cd,rd){const c=loadCase(cd);return score(c,loadRun(c,rd))}
function corpus(){
 const cr=path.join(__dirname,"cases"),rr=path.join(__dirname,"reference-runs"),cases=new Map(),errs=[];
 for(const n of fs.readdirSync(cr).sort()){try{const d=path.join(cr,n),c=loadCase(d);if(c.id!==n)throw Error("directory/id mismatch");cases.set(c.id,d)}catch(e){errs.push("case "+n+": "+e.message)}}
 for(const n of fs.readdirSync(rr).sort()){try{const rd=path.join(rr,n),r=read(path.join(rd,"run-record.json")),cd=cases.get(r.case_id);if(!cd)throw Error("unknown case");scoreDir(cd,rd)}catch(e){errs.push("run "+n+": "+e.message)}}
 if(cases.size<3)errs.push("need at least three cases");if(errs.length)throw Error(errs.join("\n"));return cases.size;
}
if(require.main===module){try{const cmd=process.argv[2];if(cmd==="check"){const n=corpus();console.log("PASS:",n,"evaluation cases and reference runs valid")}else if(cmd==="score"){console.log(JSON.stringify(scoreDir(path.resolve(process.argv[3]),path.resolve(process.argv[4])),null,2))}else throw Error("Usage: node evals/harness.cjs check | score <case-dir> <run-dir>")}catch(e){console.error("FAIL:",e.message);process.exit(1)}}
module.exports={BASE,loadCase,loadRun,score,scoreDir,validateCase,validateRun};
