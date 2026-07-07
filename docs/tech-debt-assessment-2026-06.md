# Tech Debt Assessment & Direction Proposal — June 2026

**Status:** Superseded by [tech-debt-assessment-2026-07.md](tech-debt-assessment-2026-07.md)
**Date:** 2026-06-10
**Scope:** Full-repo audit at v0.1.36 (~70k lines TS; src/server 23.2k, src/client 13.9k, src/mcp 4.2k, src/cli 4.0k)

## Verdict

Code quality is better than the release velocity would suggest: zero `as any` across the codebase, real test suites, disciplined changelogs. Architecture quality is the problem. The debt is not scattered; it is one systemic disease: **n-way duplication with manual sync**. Almost every entry in `.learnings/` traces back to it.

## Tech debt, ranked

### 1. The 4-layer copy machine (critical)

Every operation is hand-written four times — `CanvasStateManager` → `PmxCanvas` → HTTP handler in `server.ts` → MCP tool in `src/mcp/server.ts` — each with its own validation and error shapes. The CLI (`src/cli/agent.ts`, 3,300 lines) duplicates it a fifth time with raw fetch calls instead of using the SDK.

Evidence from `.learnings/` that this is actively producing bugs:

- [LRN-20260606-006] Fix #32 applied to only one of two duplicated mutation paths (`updateNode()` vs `applyUpdates()`).
- [LRN-20260607-005] New `json-render` sourceSurface enum member silently took the permissive default because the `scoped` guard in `applyAxInteraction` was not updated. Security near-miss.
- [LRN-20260608-002] `readJson` hardening silently killed the documented bare-array shape of `POST /api/canvas/batch` (#49).

These are not three bugs. They are one architecture failing three times.

**Fix:** a single operation registry. One zod schema per canvas operation; derive the MCP tool, HTTP handler, CLI command, and SDK method from it. Collapses `server.ts` (5,934 lines, raw if-else routing, 14 mutable module-level globals) and `src/mcp/server.ts` (2,861 lines, ~70% schema boilerplate) as a side effect.

### 2. 69 MCP tools is bad AX (high)

A project whose thesis is agent experience ships a tool surface that consumes a large slice of every connected agent's context window. Many tools are near-identical passthroughs (`full`/`verbose` flag pairs copied across 12+ tools). Consolidate to roughly 20 composable tools. This is product debt, not just code debt. Depends on item 1.

### 3. CanvasStateManager mixes too many concerns (high)

`canvas-state.ts` (2,498 lines) handles node/edge CRUD, AX state, undo/redo, viewport, pins, SQLite persistence, and snapshots in one class. AX state is re-normalized against node IDs on every mutation, so deleting a node silently orphans work items with no event. AX data is split between snapshotted in-memory state and audit-only DB tables with no documented contract.

**Fix:** split canvas layout state from AX state; document the snapshotted-vs-audit-only partition explicitly (the CLAUDE.md section is a start, the code does not enforce it).

### 4. E2E is not a CI gate (high)

The Playwright/Bun ESM loader blocker ([ERR-20260508-001]) has been open for weeks. E2E was removed from the publish workflow after the apt-mirror hang ([LRN-20260603-002]) and does not gate PRs. The bugs that matter (iframe blank flicker, literal `\n` in ledger, SVG calc()) were all caught only by browser tests. Green CI can currently ship a broken canvas.

**Fix:** run Playwright via Node's runner in CI permanently, and make headless e2e a hard PR gate.

### 5. Triple-mirrored skill trees + duplicate agent docs (medium)

`.agents/skills/`, `.claude/skills/`, `.opencode/skills/` must be byte-identical, enforced by `validate-agent-skill-mirrors.sh`. CLAUDE.md and AGENTS.md are near-identical (4 diff lines as of today) and already drifting.

**Fix:** one canonical source, generate the mirrors at build time. ~20 lines of script replacing a permanent tax.

### 6. Dual rendering stack (medium)

Preact + signals for the canvas, plus React 19 + recharts + a separate Tailwind build for the json-render viewer: ~2.1MB of bundle, zero shared code, duplicate theming. Defensible as a deliberate choice, but it is weight carried for one node type. Decide whether json-render earns its stack or should slim down.

### 7. No API versioning despite breaking patch releases (medium)

0.1.35 and 0.1.36 both changed HTTP contract behavior in patch releases. No version negotiation, no deprecation path. Consumers cannot pin safely.

### Smaller items

- `readJson` silently returns `{}` on malformed input; handlers cannot distinguish bad requests from empty ones. Prefer loud validation errors (this pattern already caused #49).
- `listSnapshotsFromDB` interpolates `LIMIT ${limit}` instead of parameterizing. Safe only because of upstream normalization. Fragile.
- `server-api.test.ts` (4,950 lines) and `cli-node.test.ts` (2,877 lines) are integration tests against a live server posing as unit tests: slow, order-dependent, hard to debug.
- Client renderers and state bridges (sse-bridge, canvas-store) are e2e-tested only; no coverage visibility.
- Stale `dist/` bundle trap is documented but not guarded; the dev server should warn when the bundle is older than `src/client/`.

## What is actually fine

The TypeScript guardrails are working (zero `as any`). The SQLite persistence layer is mostly clean and parameterized. The AX primitive design (capability ceilings, surface scoping, single trust boundary in `applyAxInteraction`) is sound; the bugs were in the duplication around it, not the design. The `.learnings/` loop is genuinely catching and recording real failures.

## Direction proposal

### Phase 1 (now, 2–3 weeks): stop shipping features, fix the structure

1. Build the operation registry (item 1). This is the single highest-leverage change and the prerequisite for everything below.
2. Fix the Playwright gate (item 4) in the same window.
3. Kill the skill-mirror triplication (item 5).

### Phase 2: v0.2 as the stability release

- Versioned HTTP API with a published breaking-change policy.
- MCP tool surface consolidated to ~20 composable tools.
- CLI rebuilt on the SDK.
- Deliberate Bun-only decision: stay Bun-only for the SDK and treat MCP + HTTP as the universal surface. MCP is the real distribution channel; a Node dual-build is effort on the least differentiated path.

### Phase 3: double down on AX

The moat is not the canvas. Infinite canvases are a commodity. Pinned context, spatial semantics, approval gates, steering, and the human-curates-agent-reads loop are not — nobody else is building "the agent's extended working memory" as a primitive layer. Once the foundation is stable: document and version the AX contract, and consider speccing it so other canvas hosts could implement it. That is the difference between another agent dashboard and owning a category.

### The uncomfortable truth

16 releases in the last 8 days is agent-velocity outrunning architecture. The agents building this faithfully replicate the duplication because the structure rewards it. Fix the structure and the same velocity becomes safe instead of compounding.
