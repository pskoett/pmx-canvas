# Tech Debt Assessment — July 2026

**Status:** Proposed
**Date:** 2026-07-05
**Scope:** Full-repo audit at v0.2.7 (~53.4k lines TS in `src/`, ~23.8k lines in `tests/`, 53 test files, 6 bash scripts, 2 CI workflows)
**Supersedes:** [`tech-debt-assessment-2026-06.md`](tech-debt-assessment-2026-06.md) (v0.1.36)
**Method:** Six parallel subsystem audits (server core, client, MCP layer, CLI/SDK/json-render, tests/tooling, docs/config) plus verification runs: `tsc --noEmit` (clean), `bun test tests/unit` (566 pass / 1 flaky port-collision fail, passes in isolation), git churn analysis.

## Verdict

The June assessment's central diagnosis — one systemic disease of n-way duplication with manual sync — was correct, and the prescribed cure has been **half-administered**. The operation registry (`src/server/operations/`) now exists and is genuinely well-factored: one `defineOperation` record drives HTTP routing, MCP legacy tools, and MCP composites from a single zod schema. E2E Playwright is now a hard CI gate in `test.yml`. Those were June's top two priorities and they landed.

The debt that remains is overwhelmingly **the unfinished migration onto that registry**: `server.ts` still carries ~50 hand-written route branches and 44 "migrated to the operation registry" tombstone comments, `PmxCanvas` remains a fourth hand-maintained surface of 76 delegating methods, and the CLI still bypasses everything with 60 raw `fetch` calls. Meanwhile the two integration-test monoliths flagged in June have *grown* (5,213 and 2,903 lines), and a new category surfaced: **governance drift** — the project's own instructions (CLAUDE.md/AGENTS.md) mandate skill-mirror infrastructure that is gitignored and absent from a clean checkout, guarded by a CI check that validates nothing.

Code hygiene remains excellent for the velocity: zero `as any`, zero dynamic imports, strict TypeScript, clean typecheck, disciplined changelog. The problem is structural, not stylistic — and it is concentrated in exactly the files with the highest churn (`server.ts` was touched in 27 of the last 50 commits).

## Scorecard: June → July

| June finding | Status at v0.2.7 |
|---|---|
| #1 4-layer copy machine → build operation registry | **~60% done.** Registry exists (88 ops); `server.ts` shrank 5,934 → 3,873 lines; `src/mcp/server.ts` 2,861 → 1,009. Remaining: ~50 legacy routes, `PmxCanvas` (76 methods), CLI (60 raw calls). |
| #2 69 MCP tools → consolidate to ~20 | **Composites shipped, window overdue.** 15 composites exist, but all 69 legacy tools still register (84 total — *worse* than 69 for context weight). No dated removal commitment. |
| #3 CanvasStateManager mixes concerns | **Partially improved.** AX state largely moved to `ax-state.ts`/`ax-state-manager.ts`; `canvas-state.ts` still 2,136 lines / 87 methods with CRUD + undo + persistence + snapshots. |
| #4 E2E not a CI gate | **Fixed.** `test.yml` runs Playwright as a hard gate. `publish.yml` still skips e2e (relies on tag being green on main). |
| #5 Triple-mirrored skill trees + CLAUDE/AGENTS duplication | **Unresolved, and worse than described** — the mirror trees are now gitignored entirely, so docs + CI check reference infrastructure absent from the repo. CLAUDE.md/AGENTS.md are still 357-line near-identical twins (1 line differs). |
| #6 Dual rendering stack | **Unresolved.** Preact + React 19 + recharts + 7 exact-pinned `@json-render` packages all in runtime deps; json-render bundle is 1.37 MB unminified. |
| #7 No API versioning | **Improved.** `docs/api-stability.md` exists and documents the 0.3.0 legacy-removal intent. |
| Smaller: `readJson` swallows malformed input | **Unresolved** (`server.ts:923`; registry reader `operations/http.ts:43` inherits the same behavior). |
| Smaller: giant integration tests posing as unit tests | **Grew.** `server-api.test.ts` 4,950 → 5,213 lines; `cli-node.test.ts` 2,877 → 2,903. |
| Smaller: client covered by e2e only | **Unresolved.** Still zero component render tests; only pure-helper imports are unit-tested. |

## Findings, ranked

### Critical

#### C1. The registry migration is stalled at the halfway point
The target architecture exists and works; the old one hasn't been deleted. Evidence:

- `server.ts` (3,873 lines) interleaves `dispatchOperationRoute` with ~50 hand-written `if (url.pathname === …)` branches and 44 tombstone comments of the form `// POST /api/canvas/ax/mode … migrated to the operation registry (plan-007 Slice B wave 2)` (e.g. `server.ts:3700-3778`).
- `PmxCanvas` (`src/server/index.ts`, 76 public methods) bypasses the registry and calls `canvas-operations.ts` directly — a fourth hand-maintained surface. `node.add` alone exists as `canvasState.addNode`, `addCanvasNode`, the `node.add` operation, the `canvas_node` MCP action, and `PmxCanvas.addNode`.
- The CLI (`src/cli/agent.ts`) is a fifth surface: 60 raw `api('POST', '/api/canvas/…')` calls with literal path strings coexist with 26 `invokeOperation(...)` calls that use the registry (`agent.ts:117` vs `:167`) — two dispatch mechanisms with independently implemented error semantics inside one binary.

Half-migrated is the most expensive state: every change currently needs to check *both* systems. **Remediation:** finish it — move remaining routes into operations, make `PmxCanvas` a thin wrapper over `executeOperation`, migrate the CLI's raw calls onto the operation invoker. This deletes code in four files at once.

#### C2. Governance docs and a CI gate describe infrastructure that doesn't exist in the repo
CLAUDE.md/AGENTS.md (lines ~317-332) mandate: *"Agent-facing pipeline skills live in `.agents/skills/` and must be mirrored identically in `.claude/skills/` and `.opencode/skills/` … byte-for-byte identical; verify with `bun run validate:agent-skills`."* All three directories are gitignored/absent from a clean checkout. `scripts/validate-agent-skill-mirrors.sh` detects this and exits 0: *"No skills roots present in this checkout; nothing to validate (skipping)."* The 17 skill names it guards have zero overlap with the committed `skills/` tree. Every agent onboarded via CLAUDE.md is instructed to maintain phantom infrastructure, and the check wired into `package.json` guarantees nothing. **Remediation:** rewrite the skills section to describe the committed `skills/` layout (or move mirror governance to a personal dev doc), and repoint or delete the validator.

#### C3. Generated artifacts are committed; runtime output pollutes the tree
- **72 tracked files under `.pmx-canvas/`** — a full generated web-artifact scaffold (`artifacts/.web-artifacts/sdlc-control-room/` with `pnpm-lock.yaml`, shadcn `ui/*.tsx`, `bundle.html`). The `.gitignore` patterns `artifacts/.web-artifacts/` are root-anchored and don't match the `.pmx-canvas/` copies (`git check-ignore` confirms).
- **160 tracked files under `dist/`**, including `dist/client/index.js` (435 KB) — an orphaned bundle untouched since the repo's first commit (current builds output to `dist/canvas/`) — and 154 generated `.d.ts` files under `dist/types/`.
- Running `bun test tests/unit` drops an untracked `.pmx-canvas/canvas.db` in the repo root: at least one code path resolves the workspace to `process.cwd()` during tests. Related bug: `code-graph.ts:116` resolves workspace-relative imports against `process.cwd()` instead of the configured `workspaceRoot`, so the code graph silently mis-resolves whenever the server is started for another directory.

**Remediation:** `git rm -r --cached .pmx-canvas dist/client`, fix the `.gitignore` anchoring, decide deliberately whether `dist/canvas`/`dist/types` stay committed (if yes, add a staleness CI check), and thread `workspaceRoot` through `code-graph.ts`.

### High

#### H1. MCP legacy-tool overlap window is overdue with no exit criterion
84 tools ship today (15 composites + 69 legacy) — nearly double June's 69, and ~4× the ~20-tool target. 63 of the 69 legacy tools are cheap (registration-only, sharing the registry definition), but the window is self-perpetuating: `docs/api-stability.md:36` says legacy *"may be removed in 0.3.0"* with no tracking issue or dated commitment, and every connected agent pays the context-window cost per session. **Remediation:** commit to cutting 0.3.0; gate legacy registration behind one flag today so the removal is a one-line change.

#### H2. Six hand-written MCP tools duplicate the registry — three are fully parallel implementations
`canvas_add_html_node`, `canvas_add_html_primitive`, and `canvas_refresh_webpage_node` each carry their own zod schema in `src/mcp/server.ts` (~45 lines each, `server.ts:280-301`) *and* their own `CanvasAccess` methods, while `node.add` in `ops/nodes.ts:372-391` was separately extended to do the same work ("transport parity with MCP canvas_add_html_node (report #53)"). The Local/Remote `CanvasAccess` split has already produced field-level drift once (report #53): `LocalCanvasAccess.addHtmlNode` passes input straight through (`canvas-access.ts:126-130`) while `RemoteCanvasAccess` hand-destructures 8 fields (`canvas-access.ts:294-329`). Four of the six hand-written tools also lack the try/catch that gives registry tools clean `{isError:true}` failures. **Remediation:** delete the 3 redundant tools + their access methods; migrate the remainder onto the registry.

#### H3. `src/cli/agent.ts` is a 3,337-line monolith with 83 hand-registered commands
83 `cmd(...)` registrations in one file, routed by a manual three-then-two-then-one word lookup (`agent.ts:3287-3301`); 81 copy-pasted `if (flags.help || flags.h) return showCommandHelp(...)` preambles; a hand-rolled flag parser with a ~40-entry `BOOL_FLAGS` allowlist (`agent.ts:184-193`) that must be updated for every new boolean flag — while `src/cli/index.ts:43-87` independently implements a *second* parser with different rules. **Remediation:** per-domain command modules + a `defineCommand` wrapper + one shared arg parser (and see C1 for the transport).

#### H4. Daemon lifecycle management contradicts the server's own port behavior
The server does port fallback (`buildPortCandidates()`, `server.ts:2773`, bind loop at `:3533`), but the CLI daemon manager hardcodes `http://localhost:${options.port}/health` (`cli/index.ts:202,268,302`). If the child falls back, the parent polls the wrong port and reports a dead daemon that is actually running — orphaned and unkillable via `serve stop` since the pid file is only written after health succeeds (`:249`). Additional fragility: TOCTOU between the health check (`:206`) and spawn (`:225`) lets two concurrent `serve` calls double-spawn, and `isProcessRunning` treats `EPERM` as alive with no PID-recycling guard (`:105-115`). This same port-collision class caused the one flaky unit-test failure in this audit's verification run (`pmx-canvas-sdk.test.ts`, `EADDRINUSE` on candidate 4799; passes in isolation). **Remediation:** child reports its actual bound port (pidfile/stdout); parent locks before spawning and records pid immediately.

#### H5. sse-bridge maintains a second, divergent copy of node construction and thread state
`src/client/state/sse-bridge.ts` (1,066 lines, 34 handlers) has its own `DEFAULT_POSITIONS`/`makeNode` node factory (`:75-114`) fully separate from `canvas-store`'s `addNode`/`parseCanvasNode` — two factories with divergent defaults. Thread/turn reconciliation hand-mutates a `turns[]` array plus a module-level `responseToThreadMap` whose own comment admits it is *"Not cleaned on SSE reconnect"* (`:43`), with heuristic dedup (`:650-654`). Server-side, `syncEventToCanvasState` (`server.ts:3046`, ~330 lines) mirrors this as a giant if/else chain, with node geometry defaults duplicated against `ensureDefaultDockedNodes` under a comment saying *"keep geometry/dock defaults in sync if you change them"* (`:3006`). This is the exact drift class that Canvas Architecture Rule 2 exists to prevent. **Remediation:** one shared node factory; treat `canvas-layout-update` as the single source of truth for thread nodes; table-drive the event sync.

#### H6. No lint or format tooling exists — and RELEASE.md claims it does
No ESLint/Biome/Prettier config anywhere; no lint script. `docs/RELEASE.md:35` states `release:check` "bundles + lints" — it runs build + typecheck + tests only. 53k lines across two UI frameworks with zero automated consistency enforcement. **Remediation:** add Biome, wire into CI and `release:check`.

#### H7. Client rendering has zero unit-level coverage; big server modules untested; coverage is decorative
The 12 `client-*.test.ts` files import only pure exported helpers; no DOM testing library exists in the repo, so every component (`CanvasNode`, `PromptNode`, `ContextNode`, `ContextMenu`, …) plus `sse-bridge.ts` and `canvas-store.ts` are e2e-only. Server modules with no dedicated tests include `ax-state-manager.ts` (826 lines), `mcp-app-host.ts` (814), `canvas-schema.ts` (644), and `shared/semantic-attention.ts` (600 — appears in zero test files). CI collects coverage but nothing fails on a drop. Tests are also not typechecked (`tsconfig.json` includes only `src/**`). **Remediation:** add `happy-dom` + `@testing-library/preact`; unit-test the two pure-logic modules first; set a coverage threshold; add a tests tsconfig.

### Medium

- **M1. Dual rendering stack, unminified, dev tooling in prod.** Preact app + React 19 + react-dom + recharts as runtime deps; 7 `@json-render/*` packages exact-pinned at 0.19.0, three of them devtools (`@json-render/devtools*` imported at `renderer/index.tsx:20`, gated behind a window flag but shipped). Bundles: `dist/json-render/index.js` 1.37 MB, `dist/canvas/index.js` 599 KB — both readable/unminified (the `--minify` in `build:client` isn't reflected in the committed bundle). `scripts/build-json-render.sh` shells to `python3` for an mtime cache and has a timeout-then-use-stale-bundle fallback, making builds non-deterministic. **Remediation:** minify; move devtools to devDependencies; lazy-load the viewer; replace the Python mtime gate.
- **M2. Copy-pasted iframe AX bridge across three renderers.** An identical ~33-line `onAxMessage` listener appears in `HtmlNode.tsx:55-89`, `McpAppNode.tsx:89-121`, `ExtAppFrame.tsx:272-303`; the `pmx-canvas-ax` protocol string is spread across 9 sites; the `ax-update` push is likewise duplicated. This is the trust boundary for sandboxed surfaces — the one place copy-paste drift has already caused a security near-miss (June's LRN-20260607-005). **Remediation:** one `useAxSurfaceBridge` hook + a protocol-constants module.
- **M3. `ExtAppFrame.tsx` (915 lines) is a timing-hack concentration.** 12 refs, 7 `setTimeout`s, 5 rAFs, a WebKit black-tile remount driven by a global serialized slot counter with a 3000 ms reset (`:69-78`), a 1200 ms fallback bootstrap timer (`:619-640`), and two near-duplicate `buildHostContext` blocks (`:426-442` vs `:737-747`). Highest-churn client file (11 of last 50 commits). **Remediation:** extract a `useExtAppBridge` hook; single `buildHostContext`.
- **M4. Inconsistent HTTP envelopes and swallowed errors.** Registry ops return bare bodies, legacy ext-app handlers return `{ok:true,result}`, 404s are plaintext — three shapes on one API. `readJson` (`server.ts:923`) returns `{}` for malformed JSON so garbage requests silently no-op (caused June's #49); `canvas-state.ts` has 63 catch→warn→continue sites, so a full-disk/corrupt-DB save failure is invisible to clients. **Remediation:** one envelope; 400 on malformed bodies; surface persistence failure via `/health` degraded flag.
- **M5. Five byte-identical ext-app list handlers** (`server.ts:1894-1949`) differing only in the runtime function called; the ~30 `readJson → validate → responseJson` skeletons across legacy handlers are the same pattern the registry already solves declaratively. Folds into C1.
- **M6. Composite MCP schemas advertise every field optional.** `buildCompositeShape` (`mcp.ts:129`) flattens per-action requirements away, so `canvas_node {action:"add"}` without `type` passes schema validation and fails only in the handler. Agents get no schema-level signal. **Remediation:** per-action `oneOf` schemas or explicit per-action requirement docs.
- **M7. Confirmed cross-transport drift (small but real).** `search` `limit` applies in MCP only, not HTTP (`ops/query.ts:90`); `pin.set` emits `canvas-layout-update` from the SDK but only `context-pins-changed` via HTTP/MCP (`ops/query.ts:6-11`). Resource notifications over-fan-out: five `canvas://` URIs fire on *every* mutation regardless of type (`mcp/server.ts:95-99`).
- **M8. Test-suite structural debt.** The two integration monoliths (5,213 + 2,903 lines) under `tests/unit/`; `getAvailablePort()` copy-pasted verbatim in 5 files; `waitForPersistence(ms = 650)` fixed-sleep used across 9 files plus ~19 magic `Bun.sleep` literals; Playwright config lacks `retries` and `forbidOnly`; two hard `waitForTimeout` sleeps (`canvas.pw.ts:1929`, `showcase.pw.ts:985`). `test:e2e-cli` (517-line script) runs in no workflow — it's a manual-only gate. **Remediation:** `tests/integration/` tier, shared port/MCP-client helpers, poll instead of sleep, add retries/forbidOnly, wire `e2e-cli` into CI.
- **M9. CLAUDE.md/AGENTS.md are 357-line hand-maintained twins** differing by one line (which itself is drift — they disagree on what the demo board is). CLAUDE.md also carries a stray executable bit. **Remediation:** generate one from the other (or symlink); `chmod 644`.
- **M10. Packaging inconsistencies.** `bin` points at a raw `.ts` (Bun-only — consistent with ADR-001 but undocumented in the README install path); `files` ships both `src/` and `dist/`, roughly doubling the tarball with two import paths; `@types/turndown` sits in runtime `dependencies`. **Remediation:** pick one distribution; move `@types/*` to dev.
- **M11. Doc staleness.** `docs/node-types.md` omits the ext-app/webview node types that dominated v0.2.3–0.2.7; two live port env vars (`PMX_CANVAS_PORT` vs `PMX_WEB_CANVAS_PORT`) applied inconsistently across entry points (`canvas-access.ts:464` reads both, `cli/index.ts` only one, `cli/agent.ts` only the other); `PMX_DATA` (used 15×) and the `PMX_CANVAS_JSON_RENDER_*` / `PMX_MCP_APP_HOST_*` families are undocumented. `publish.yml` intentionally skips e2e with no verification that the tagged SHA passed `test.yml`.

### Low

- **L1.** Dead client code: `ContextPinHud.tsx` has zero references. Three pure re-export shims (`client/utils/placement.ts`, `client/utils/ext-app-tool-result.ts`, `server/ext-app-tool-result.ts`) add indirection without value.
- **L2.** Two parallel markdown-formatting stacks (`MdFormatBar`/`md-format.ts` vs `InlineFormatBar`/`inline-editor-commands.ts`) implementing overlapping bold/italic/code/link commands.
- **L3.** CSS: `global.css` is 3,746 lines/528 rule blocks with 11 `!important`, competing with 227 inline `style={{}}` objects (38 in `ContextNode.tsx` alone) and hard-coded `zIndex: 9998/10000/10001` outside any token scale.
- **L4.** Legacy JSON→SQLite migration code runs unconditionally on every boot (`canvas-state.ts:758,785`) with perpetual fallback branches; gate behind a one-shot marker and retire.
- **L5.** Two parallel suppression depth-counters (`_suppressRecordingDepth` in canvas-state, `suppressEmitDepth` in the registry — the latter's comment admits it "mirrors" the former); `onMutation` is a single-slot setter masquerading as a subscribe API and is wired twice (`server.ts:3500` and `index.ts:184`), currently harmless only because last-write-wins.
- **L6.** ~20 module-level mutable `let` bindings in `server.ts` plus module-global timers (the code-graph debounce timer survives `stopCanvasServer`, leaking across start/stop cycles); the remote SSE watcher in `mcp/server.ts:120-145` is a `while(true)` loop with no cancellation when the target changes.
- **L7.** `mcp-tool-freeze.test.ts` title says "83-tool list" while asserting 84; `tsconfig` lacks `noUncheckedIndexedAccess`; `scripts/seed-and-screenshot.sh` is the one script without `set -euo pipefail`; the June assessment doc cites gitignored `.learnings/` entries unreadable by future maintainers.

## What is actually fine

- **The operation registry is good architecture, correctly executed** — single zod schema driving HTTP + MCP + composites with uniform validation and error mapping. The debt is that migration onto it stopped, not the design.
- Zero `as any`, zero dynamic imports, `strict: true`, clean `tsc --noEmit` at 53k lines.
- Node chrome (titlebar/pin/resize/ports) is properly centralized in `CanvasNode.tsx` — renderers do not duplicate it.
- `src/shared/` is genuinely shared (9 client + 10 server importers), not a dumping ground; `server/placement.ts` extends rather than copies it.
- `examples/` compile against the current SDK; `skills/pmx-canvas/SKILL.md` is current at v0.2.7; tool/resource counts in docs match the code exactly.
- CI runs typecheck + build + unit + coverage + a real e2e gate; e2e predominantly uses `expect.poll`; 5 of 6 scripts are disciplined bash.
- CHANGELOG discipline is genuinely good.

## Direction

### Phase 1 — finish what was started (highest leverage, mostly deletion)
1. **Complete the registry migration** (C1): fold the ~50 legacy routes into operations, collapse `PmxCanvas` onto `executeOperation`, migrate the CLI's 60 raw calls. Deletes the M5 handler clones and most envelope inconsistency (M4) as side effects.
2. **Fix the governance/CI lie** (C2) and **untrack generated artifacts** (C3) — a day of work, permanent credibility win.
3. **Delete the 3 parallel MCP tool implementations** (H2) and set the dated 0.3.0 legacy-removal gate (H1).

### Phase 2 — make the safety net real
4. Add Biome (H6); typecheck tests; coverage threshold; Playwright retries + `forbidOnly`; wire `e2e-cli` into CI; split the integration monoliths (M8, H7).
5. Fix the daemon port/lock lifecycle (H4) — it is the root of both user-facing "dead daemon" confusion and the suite's one flaky test.

### Phase 3 — client consolidation
6. One node factory shared by sse-bridge and canvas-store; single AX-bridge hook; `useExtAppBridge` (H5, M2, M3).
7. Decide the json-render stack's future deliberately (M1): minify + lazy-load at minimum; a separate optional package if the React stack stays.

The pattern from June holds: agent velocity faithfully replicates whatever structure exists. The registry proved that fixing the structure works — `src/mcp/server.ts` shrank 65% while *adding* capability. The remaining risk is stopping halfway: two routing systems, two node factories, two arg parsers, and two governance stories are each more expensive than either one alone.
