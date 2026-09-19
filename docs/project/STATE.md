# Project State

Updated: 2026-09-19

## Current truth

- Repository: asdzxc1a/security-audit-skill
- Upstream: cloudflare/security-audit-skill
- Pinned methodology baseline: c1c8a8c1471069fb0e188eeaff69b8e8db6564a8
- Gates 0, 1, 2, 2b, and all Gate 3 slices are complete.
- Gate 3e schema-compatibility/review hardening merged as d9346e6efbf8e13ed9b2ab0afc62018a2dbe00b6.
- Gate 4a now implements provider-neutral immutable source snapshots, explicit scoped/diff/repository selection, Cloudflare-compatible methodology block selection, and deterministic bounded context bundles.
- Current code preserves the Cloudflare audit methodology; hosted source/context/orchestration behavior is owned separately.
- Worker/provider output is untrusted observation; accepted owned events and reducer replay remain canonical audit truth.
- Worker context is compiled from owned immutable inputs, never from chat history or ambient project-memory history.

## Current gate

- Gate: 4a — Deterministic context compiler foundation
- Active issue: #20
- Branch: gate-4/context-compiler
- PR: not opened yet
- Status: full fresh-clone evidence green; ready for focused PR

## Blockers

None known for Gate 4a.

Real GitHub/GitLab source adapters and wiring bundles into durable worker task receipts remain the next bounded slice.

## Verified evidence

Fresh-clone `npm ci && npm run check && git diff --check` on final Gate 4a head:

- npm dependency audit: 0 vulnerabilities
- project-memory invariants: PASS
- upstream Cloudflare validators: 65/65 PASS
- Gate 1 eval/adapter tests: 13/13 PASS
- strict TypeScript compile: PASS
- context/compiler tests: 16/16 PASS
- existing domain/storage/orchestrator tests: 71/71 PASS
- combined domain/context suite: 87/87 PASS
- diff whitespace check: PASS

Gate 4a evidence includes:

- source snapshot IDs are content-addressed and independent of input file order;
- snapshot contents/hashes/byte counts are revalidated before context compilation;
- unsafe/traversal paths and oversized paths are rejected;
- path scope cannot expand outside explicit roots;
- diff scope selects only changed paths intersecting allowed roots and records unavailable changed paths;
- diff base/head refs participate in context bundle identity;
- repository scope requires explicit mode;
- project-memory/history paths are excluded by default and require explicit opt-in;
- methodology selection is explicit and preserves Cloudflare heading plus bold attack-class refs such as `ATTACK-CLASSES.md#Access control`;
- methodology contents/hashes are revalidated before inclusion;
- file/methodology ordering is locale-independent;
- task metadata canonicalization has depth/node limits;
- source file/count/total, methodology block/count/total, task metadata, and final bundle size all fail closed on overflow;
- equal owned inputs produce byte-identical serialized bundles and bundle hashes.

Decision D-013 records the deterministic context contract.

## Next action

Open the focused Gate 4a PR, require GitHub CI/review green, then merge. After merge keep #20 active for Gate 4b: bind context bundles into durable task receipts and add the first real Git/PR-diff source adapter.
