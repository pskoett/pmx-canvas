# Plan 009 — Tech debt backlog (open findings from the July 2026 assessment)

**Status:** Open
**Date:** 2026-07-06
**Motivation:** [`docs/tech-debt-assessment-2026-07.md`](../tech-debt-assessment-2026-07.md) (revised 2026-07-06). The v0.3.0 tree plus the same-day fix pass closed H1, H2, M12, and the small residuals of C2/C3/M4/M7/M9/L7. This plan records everything still open so it survives the release. Finding IDs below refer to the assessment, which carries the full `file:line` evidence.

Each item is tagged by shape: **project** (multi-day, own plan/PR), **decision** (needs a maintainer call before code), or **small** (safe standalone change).

## Phase 1 — finish what was started

| Item | Source | What's open | Shape |
|---|---|---|---|
| Complete the registry migration | C1 | Fold the ~50 remaining hand-written routes (44 tombstone comments) in `server.ts` into operations; collapse the 76-method `PmxCanvas` onto `executeOperation`; migrate the CLI's 60 raw `fetch` calls onto the operation invoker. Deletes the M5 handler clones and most M4 envelope inconsistency as side effects. | project |
| One HTTP envelope | M4 residual | Registry ops return bare bodies, legacy ext-app handlers `{ok:true,result}`, 404s plaintext. Unify (naturally falls out of C1). Also: surface persistence save failures via a `/health` degraded flag — `canvas-state.ts` has 63 catch→warn→continue sites. | project (with C1) |
| `dist/` commit policy | C3 residual | **Decided + done post-0.3.0:** `dist/` stays committed; `test.yml` now has a `dist/types` staleness gate (rebuild + fail on drift). The `dist/canvas`/`dist/json-render` bundles are deliberately not byte-checked — bundler output varies across bun versions; their staleness story folds into M1. | done |
| Skill-mirror validator | C2 residual | `validate:agent-skills` exits 0 when the (local-only, gitignored) trees are absent. Docs are honest about this now; decide whether to repoint, gate, or delete the check. | decision |
| Generate CLAUDE.md/AGENTS.md from one source | M9 residual | The twins are byte-identical again but still hand-maintained; generate or symlink to prevent the next drift. | small |

## Phase 2 — make the safety net real

| Item | Source | What's open | Shape |
|---|---|---|---|
| Lint/format tooling | H6 | No ESLint/Biome/Prettier anywhere; `docs/RELEASE.md` claims `release:check` lints (it doesn't). Adopt Biome, wire into CI and `release:check`. First run will be a large mechanical diff — land it standalone. | decision + project |
| Client + server unit coverage | H7 | Zero component render tests (no DOM test lib in repo); untested big modules: `ax-state-manager.ts` (826 lines), `mcp-app-host.ts` (814), `canvas-schema.ts` (644), `shared/semantic-attention.ts` (600, in zero test files). Coverage is collected but gates nothing; tests aren't typechecked. Add `happy-dom` + `@testing-library/preact`, a tests tsconfig, and a coverage threshold. | project |
| Daemon port/lock lifecycle | H4 | **Fixed post-0.3.0** (`src/cli/daemon.ts` + `tests/unit/cli-daemon.test.ts`). Note the original finding was partly wrong: the daemon child was already strict-port (`PmxCanvas.start` pins `allowPortFallback: false`), so fallback-blind polling could not occur. The real defects — fixed — were: the pre-check accepted any responsive `/health` as "already running" (even a foreign workspace's daemon), a TOCTOU double-spawn window, the pid recorded only after health passed (slow start → unkillable orphan), and no PID-recycling guard. The flaky `pmx-canvas-sdk.test.ts` port collision is NOT this — it's M8's copy-pasted `getAvailablePort()` racing. | done |
| Test-suite structure | M8 | Integration monoliths under `tests/unit/` (`server-api` 5,213 lines, `cli-node` 2,903); `getAvailablePort()` copy-pasted in 5 files; `waitForPersistence(650ms)` fixed sleeps in 9 files + ~19 magic `Bun.sleep`s; Playwright lacks `retries`/`forbidOnly`; `test:e2e-cli` (517-line script) runs in no CI workflow. | project |
| `noUncheckedIndexedAccess` | L7 residual | Enable in tsconfig; will surface many index-access errors — treat as its own sweep. | small (noisy) |

## Phase 3 — client consolidation

| Item | Source | What's open | Shape |
|---|---|---|---|
| One node factory | H5 | `sse-bridge.ts` (1,066 lines) keeps its own `DEFAULT_POSITIONS`/`makeNode` divergent from `canvas-store`; `responseToThreadMap` is not cleaned on SSE reconnect; server-side `syncEventToCanvasState` (~330 lines) mirrors it as an if/else chain with geometry defaults duplicated against `ensureDefaultDockedNodes`. Share one factory; treat `canvas-layout-update` as the single source of truth; table-drive the event sync. | project |
| Shared AX iframe bridge | M2 | The ~33-line `onAxMessage` listener is copy-pasted in `HtmlNode.tsx`, `McpAppNode.tsx`, `ExtAppFrame.tsx`; `pmx-canvas-ax` protocol string spread across 9 sites. This is the sandboxed-surface trust boundary (prior near-miss: LRN-20260607-005). Extract `useAxSurfaceBridge` + a protocol-constants module. | project (security-adjacent) |
| `ExtAppFrame.tsx` timing hacks | M3 | 915 lines, 12 refs, 7 `setTimeout`s, 5 rAFs, WebKit remount slot counter, 1200 ms fallback bootstrap, two near-duplicate `buildHostContext` blocks. Extract `useExtAppBridge`; single `buildHostContext`. | project |
| json-render stack decision | M1 | Preact + React 19 + recharts all runtime deps; 7 exact-pinned `@json-render/*` incl. 3 devtools packages shipped; `dist/json-render/index.js` 1.37 MB and `dist/canvas/index.js` 599 KB both unminified; build script shells to python3 with a stale-bundle fallback. Minimum: minify, move devtools to devDependencies, lazy-load the viewer, replace the python mtime gate. Bigger call: separate optional package if the React stack stays. | decision + project |
| Client dead code / duplication | L1, L2, L3 | `ContextPinHud.tsx` unreferenced; three pure re-export shims; two parallel markdown-format stacks; `global.css` 3,746 lines with 11 `!important` vs 227 inline styles and unscaled z-indexes. | small (batchable) |

## Smaller items (no phase, pick up opportunistically)

| Item | Source | What's open |
|---|---|---|
| Per-action composite schemas | M6 | Composite tools advertise every field optional; per-action required fields fail only at runtime. Decide: `oneOf` schemas vs per-action requirement docs. (Now the only schema surface agents see.) |
| Packaging | M10 | `files` ships both `src/` and `dist/` (~double tarball, two import paths); `bin` points at raw `.ts` (undocumented Bun-only constraint); `@types/turndown` in runtime deps. |
| Env var hygiene | M11 residual | `PMX_CANVAS_PORT` vs `PMX_WEB_CANVAS_PORT` applied inconsistently across entry points; `PMX_DATA` (15 uses) and the `PMX_CANVAS_JSON_RENDER_*` / `PMX_MCP_APP_HOST_*` families undocumented. |
| `publish.yml` e2e gap | M11 residual | Publishing skips e2e with no verification that the tagged SHA passed `test.yml`. |
| MCP notification fan-out | M7 residual | Five `canvas://` resource URIs notify on every mutation regardless of type (`mcp/server.ts:95-99`). |
| Legacy migration code on every boot | L4 | JSON→SQLite migration runs unconditionally (`canvas-state.ts:758,785`); gate behind a one-shot marker and retire. |
| Suppression/mutation plumbing | L5 | Two parallel suppression depth-counters; `onMutation` is a single-slot setter wired twice (last-write-wins). |
| Module-global lifecycle leaks | L6 | ~20 module-level `let`s in `server.ts`; code-graph debounce timer survives `stopCanvasServer`; remote SSE watcher loop has no cancellation. |
| June doc citations | L7 residual | `tech-debt-assessment-2026-06.md` cites gitignored `.learnings/` entries future maintainers can't read. |
