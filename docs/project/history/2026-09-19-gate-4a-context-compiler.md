# Gate 4a Deterministic Context Compiler Evidence — 2026-09-19

## Scope

Gate 4a builds the provider-neutral context compiler foundation without changing Cloudflare audit methodology or invoking any model/provider.

Base is reconciled with completed Gate 3f at `cde946a63e89b1e6ead91c9eb52cda54542282be`.

Reconciled tested head before final memory-only updates: `b9d5974ac4b7298338f2a7cfd3cd5ea7019b758e`.

## Owned inputs

### Source snapshot

- UTF-8 text files only;
- safe repository-relative paths;
- duplicate/traversal/NUL/invalid-scalar rejection;
- content SHA-256 and byte count per file;
- strictly sorted manifest;
- content-addressed `src1_...` snapshot identity;
- runtime integrity revalidation before compile.

### Scope

- `paths`: explicit roots only;
- `diff`: changed paths intersect optional allowed roots;
- base/head refs retained in context identity;
- unavailable changed paths retained explicitly;
- `repository`: only when explicitly selected;
- project-memory/history paths excluded by default with explicit opt-in.

### Methodology

Catalog is loaded from the existing `skills/security-audit/*.md` corpus.

It recognizes Markdown heading blocks and Cloudflare top-level bold attack-class labels.

Real refs validated in tests include:

- `ATTACK-CLASSES.md#Access control`;
- `WEB-PROTOCOL-AND-AUTH.md#Host and forwarded-header trust`;
- `AI-AND-LLM.md#Core discipline (include in every agent prompt for this domain)`.

Selection is explicit. Unknown, duplicate, or integrity-mismatched blocks fail closed.

## Deterministic bundle

The compiler emits a provider-neutral `WorkerContextBundle`.

Identity is `ctx1_` plus SHA-256 over the canonical payload containing source snapshot ID, resolved scope, normalized task metadata, selected source files, selected methodology blocks, and byte metrics.

Ordering uses locale-independent lexical comparison. Equal owned inputs produce byte-identical canonical serialization and the same bundle ID.

## Bounds

Fail-closed limits cover scope list cardinality, repository path byte length, source file count/size/total, methodology block count/size/total, task metadata bytes, canonical JSON depth/node count, and final serialized bundle bytes.

No semantic truncation occurs.

## Verification

Fresh clone of the final Gate 4a branch:

- `npm ci`: PASS, 0 dependency vulnerabilities;
- `npm run check:memory`: PASS;
- upstream Cloudflare validator tests: 65/65 PASS;
- Gate 1 eval/adapter tests: 13/13 PASS;
- strict TypeScript compile: PASS;
- context/compiler tests: 16/16 PASS;
- existing domain/storage/orchestrator tests: 74/74 PASS;
- combined domain/context suite: 90/90 PASS;
- `git diff --check`: PASS.

## Deliberate non-goals

- no GitHub/GitLab source-provider adapter yet;
- no provider/model request renderer;
- no prompt tuning;
- no MCP server;
- no sandbox;
- no UI.

Gate 4b will bind these context bundles to durable worker task receipts and add the first real Git/PR-diff source adapter.
