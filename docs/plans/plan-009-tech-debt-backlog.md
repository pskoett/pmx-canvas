# Plan 009 — Tech debt backlog (open findings from the July 2026 assessment)

**Status:** Open
**Date:** 2026-07-06
**Motivation:** [`docs/tech-debt-assessment-2026-07.md`](../tech-debt-assessment-2026-07.md) (revised 2026-07-06). The v0.3.0 tree plus the same-day fix pass closed H1, H2, M12, and the small residuals of C2/C3/M4/M7/M9/L7. This plan records everything still open so it survives the release. Finding IDs below refer to the assessment, which carries the full `file:line` evidence.

Each item is tagged by shape: **project** (multi-day, own plan/PR), **decision** (needs a maintainer call before code), or **small** (safe standalone change).

## Decision analysis (2026-07-08, maintainer-approved)

**SDK clarification, 2026-10-15:** the historical "no further collapse" conclusion below is
superseded by [vision move 6b](../product-vision-2026-09.md#6b-generate-every-surface-from-the-registry-l-two-releases--pending-the-maintainers-decision).
The local SDK may remain synchronous while sharing mutation-policy checks. All supported
writers must converge on the relevant policy and commit guarantees; asynchronous durable
completion is a separate contract decision, not a prerequisite for fixing lock parity.

The remaining items were re-analyzed with pros/cons and tiered; the maintainer approved this ordering:

- **Tier 1 (do):** CLI raw fetches → operation invoker **together with** the H3 parser/module split (same file, one project); H7 test coverage **as a prerequisite** for any client refactor; M2 AX-bridge dedup (first client task after H7); the M8 flake subset (mock the Excalidraw network tests, share `getAvailablePort`, Playwright `retries`/`forbidOnly`, `e2e-cli` into CI). *C1b done (2026-07-08):* all 60 raw `api()` calls migrated onto the invoker (9-agent verified mapping; `webartifact.build` gained `errorBodyAsResult`; batch failure prints the envelope + exits 1; the `api()` helper is deleted; two deliberate raw `fetch` sites remain — binary screenshot, SSE watch). *H3 module split done (2026-07-09):* `agent.ts` is a 227-line entry over `src/cli/shared.ts` (cycle-free core: registry, parser, transport) + 11 `src/cli/commands/*` domain modules, moved byte-identically; ax-parity reads the whole cli tree. **Parser sub-item reshaped:** `parseFlags`/`BOOL_FLAGS` is now single-sited in shared.ts; `index.ts` keeps its intentionally tiny fixed-flag launcher reader (different domain — server launch, not agent commands). The spec-driven per-command flag parser (`defineCommand`) remains the ideal but is a redesign of all 83 command surfaces — deferred to a future CLI UX change, not worth manufactured churn now.
- **Tier 2 — async-SDK question DECIDED NO (2026-08-03, v0.4.0):** the sync `PmxCanvas` facade is the contract. Post-registry the 57 sync methods are thin presentation over the shared operation cores (single logic site — the tier's own analysis), so forcing them async would break every SDK consumer to remove zero duplication. The already-async/void methods dispatch through `executeOperation`; the rest stay sync by design. No further collapse is planned.
- **Tier 2 (original analysis):** the PmxCanvas→executeOperation collapse is **not** mechanical — `executeOperation` is async while 57/76 SDK methods are sync with typed returns, so a full collapse is a breaking SDK change. Verdict: migrate only the already-async/void methods now; decide the full async-SDK question as a **v0.4 breaking item** with the `canvas_snapshot` composite. Post-registry the sync methods are thin presentation over the shared cores (single logic site) — not logic duplication. H5 (sse-bridge factory) proceeds **after H7**. M6 gets the middle path: runtime per-action required-field errors, no `oneOf` schema break (many MCP hosts handle `oneOf` poorly). M1 gets the minimum four (minify, devtools→devDeps, lazy-load, replace the python mtime gate); the React-stack decision stays open.
- **Tier 3 (cheap batch):** CI check that CLAUDE.md/AGENTS.md stay identical (instead of doc generation); document `PMX_DATA` + the `PMX_CANVAS_JSON_RENDER_*`/`PMX_MCP_APP_HOST_*` env families; publish.yml verifies the tag SHA passed test.yml; `@types/turndown` → devDependencies; L1 dead `ContextPinHud`; L4 one-shot migration marker; L6 timer-leak fixes.
- **Tier 4 (closed as by-design / parked):** the six server-coupled routes (nothing to dedup — injection machinery for single-copy handlers isn't worth it); M3 ExtAppFrame refactor (the timing hacks are load-bearing WebKit fixes — document invariants, enter only when a feature forces it); M7 notification fan-out, L2, L3, `noUncheckedIndexedAccess` (parked); M10 packaging closed after the `@types` one-liner (`bin`→`src` under Bun and shipped `dist/` are both load-bearing by design).

## Phase 1 — finish what was started

| Item | Source | What's open | Shape |
|---|---|---|---|
| Complete the registry migration | C1 | Fold the remaining hand-written routes in `server.ts` into operations; collapse the 76-method `PmxCanvas` onto `executeOperation`; migrate the CLI's 60 raw `fetch` calls onto the operation invoker. **Slice 1 done post-0.3.0:** the 7 `/api/ext-app/*` routes moved to `ops/ext-app.ts` (~290 lines out of `server.ts`, the 5 clone handlers — old M5 — collapsed to one parametrized definition; wire envelopes byte-identical, no new MCP tools). **Slice 2 done:** the 15 ax wire routes (8 GET lists + `ax/context` + `ax/surface-snapshot` + `pinned-context` + `code-graph` + `ax/activity` + `ax/interaction` + legacy `PATCH /api/canvas/ax`) moved to `ops/ax-read.ts` (~370 more lines out of `server.ts`); `open-external` stays hand-written (coupled to the live server port + system browser opener). **Slice 3 done:** theme GET/POST, canvas update, viewport, annotation POST, and node `:id/refresh` moved to the registry (`ops/canvas-wire.ts`, plus additions to `ops/viewport.ts`, `ops/annotation.ts`, `ops/nodes.ts`); the two dispatch gates unified into one `/api/` gate; `server.ts` is at ~2,980 lines (from 3,873 at the audit). **Remaining routes (~20)** are the deliberate poor fits (SSE, binary, HTML/static, file bodies) plus four server-coupled handlers: `prompt` + workbench `state`/`open`/`intent` (module-local `primaryWorkbench*` session state), `render` (Excalidraw URL-normalizer chain), `open-external` (live port + system browser). Those need state injection like the webview runner — a deliberate follow-up, not mechanical. **Status (2026-08-03):** the CLI fetches are done (C1b) and the `PmxCanvas` collapse is closed by the async-SDK decision (sync facade stays). The 4 server-coupled routes (`prompt`, workbench `state`/`open`/`intent`, `render`, `open-external`) remain the only open C1 work — internal state-injection refactor, zero wire impact, deliberately post-0.4. | tail open (post-0.4) |
| One HTTP envelope | M4 residual | **Done (2026-08-03, v0.4.0):** every hand-written error response is now a JSON `{ ok:false, error }` envelope with unchanged status codes (matching the registry dispatcher); `/health` gained a `persistence` block that reports degraded durability after a failed save (ok again on the next success). The ext-app `{ok:true,result}` wrapper is KEPT deliberately — it is the app-bridge proxy contract our own panel parses; changing it bought no consumer value. | done |
| `dist/` commit policy | C3 residual | **Decided + done post-0.3.0:** `dist/` stays committed; `test.yml` now has a `dist/types` staleness gate (rebuild + fail on drift). The `dist/canvas`/`dist/json-render` bundles are deliberately not byte-checked — bundler output varies across bun versions; their staleness story folds into M1. | done |
| Skill-mirror validator | C2 residual | **Decided + done (2026-08-03):** the script prints a labeled SKIPPED notice when trees are absent (local behavior unchanged), and the permanently-no-op CI step was removed with a comment. | done |
| Generate CLAUDE.md/AGENTS.md from one source | M9 residual | **Done (tier-3 batch):** CI fails on any CLAUDE.md/AGENTS.md byte drift (`test.yml` identity gate) — the cheap alternative to generation the decision analysis chose. Generation/symlinking stays unnecessary while the gate holds. | done |

## Phase 2 — make the safety net real

| Item | Source | What's open | Shape |
|---|---|---|---|
| Lint/format tooling | H6 | **Done post-0.3.0:** Biome 2.5 adopted — `bun run lint` / `lint:fix`, wired into `release:check` (making RELEASE.md's "lints" claim true) and CI. First-run format sweep landed as its own mechanical commit; 7 lint errors hand-fixed (incl. a real conditional-hooks bug in `SelectionBar.tsx`). Deliberately disabled rules to revisit: a11y group, `useExhaustiveDependencies` (misfires on Preact signals), `noNonNullAssertion` (143 deliberate uses), `noArrayIndexKey` (13 sites). ~77 warnings (unused imports/vars, optional-chain) left as a burn-down list — warnings don't fail the gate. | done |
| Client + server unit coverage | H7 | **Done post-0.3.3 (first tranche):** happy-dom + @testing-library/preact harness under `tests/client/` (own preload so DOM globals never leak into server suites); 20 client render tests incl. the SelectionBar conditional-hooks regression; `semantic-attention` (25 tests) and `canvas-schema` (21 tests incl. an M12 stale-tool-drift invariant) covered; tests are TYPECHECKED (`tsconfig.tests.json`, 270 latent errors fixed, wired into `typecheck` + CI); coverage now GATES via `scripts/check-coverage.ts` total floors (bun's bunfig threshold is per-file and its table form is silently ignored — documented). **Done (2026-08-03):** dedicated suites for `ax-state-manager.ts` (39 tests, injected-deps harness + in-memory SQLite) and `mcp-app-host.ts` (15 tests; stateful paths in hermetic subprocesses). Unit-test scripts now pin `PMX_MCP_APP_HOST_STATE_FILE` to a scratch path so suites never touch the real home-dir state. Client suite grows alongside H5. | done |
| Daemon port/lock lifecycle | H4 | **Fixed post-0.3.0** (`src/cli/daemon.ts` + `tests/unit/cli-daemon.test.ts`). Note the original finding was partly wrong: the daemon child was already strict-port (`PmxCanvas.start` pins `allowPortFallback: false`), so fallback-blind polling could not occur. The real defects — fixed — were: the pre-check accepted any responsive `/health` as "already running" (even a foreign workspace's daemon), a TOCTOU double-spawn window, the pid recorded only after health passed (slow start → unkillable orphan), and no PID-recycling guard. The flaky `pmx-canvas-sdk.test.ts` port collision is NOT this — it's M8's copy-pasted `getAvailablePort()` racing. | done |
| Test-suite structure | M8 | Integration monoliths under `tests/unit/` (`server-api` 5,213 lines, `cli-node` 2,903); `getAvailablePort()` copy-pasted in 5 files; `waitForPersistence(650ms)` fixed sleeps in 9 files + ~19 magic `Bun.sleep`s; Playwright lacks `retries`/`forbidOnly`; `test:e2e-cli` (517-line script) runs in no CI workflow. *Post-0.3.0:* `operation-parity` now binds port 0 and derives the port from the base URL (removes one reserve-then-rebind race); the shared-helper dedup and the rest remain. Also noted: `ax-parity.test.ts` is a string-matching source-analysis test whose needles broke when Biome re-wrapped `cmd(` calls — its CLI needles are now layout-independent, but any future needle should avoid depending on line layout. **Also noted (2026-07-07):** the `server-api` Excalidraw diagram tests do real network round-trips to the hosted `mcp.excalidraw.com` MCP server and intermittently time out (30s) under full parallel runs. **M8 subset done (2026-07-08):** those tests now run against the local stdio fixture via `PMX_CANVAS_EXCALIDRAW_MCP_COMMAND`; `getAvailablePort` is one shared helper; Playwright has `retries`/`forbidOnly` on CI; `e2e-cli` is a CI job. **Sleep sweep done (2026-08-03):** fixed persistence sleeps replaced by condition polling via a shared helper. **Remaining (post-0.4, test organization only):** the `tests/unit/` monolith split. | sleep sweep done |
| `noUncheckedIndexedAccess` | L7 residual | Enable in tsconfig; will surface many index-access errors — treat as its own sweep. | small (noisy) |

## Phase 3 — client consolidation

| Item | Source | What's open | Shape |
|---|---|---|---|
| One node factory | H5 | **Client half done (2026-08-03):** the `responseToThreadMap` reconnect leak is fixed (cleared in the shared per-connection reset path; mutation-verified test) and all four sse-bridge construction sites route through a shared `node-factory.ts`. **Premise correction:** `canvas-store` holds no node-creation defaults — the real divergences are client-vs-SERVER (server `defaultNodeSize` vs the client table; `ensureDefaultDockedNodes` seeding collapsed/docked vs the bridge's expanded/undocked; a same-class `serverResponseToThreadMap` leak at server.ts:2469) — all catalogued in the factory for the deferred server half (table-drive `syncEventToCanvasState`, single source of truth). | client half done |
| Shared AX iframe bridge | M2 | **Done (2026-08-03):** `useAxSurfaceBridge` (`src/client/nodes/use-ax-surface-bridge.ts`) single-sites the sandboxed-surface trust boundary previously copy-pasted in `HtmlNode.tsx`, `McpAppNode.tsx`, `ExtAppFrame.tsx`; `src/shared/ax-surface-protocol.ts` owns the wire tags (`pmx-canvas-ax`, `-ack`, `pmx-canvas-html-node`, the ext-app boot beacon) — client parsers import them, generated surface scripts (html-surface.ts, ext-app builders, json-render viewer) interpolate them byte-identically. Client render tests pin the validation gates + submit→ack round-trip (`tests/client/use-ax-surface-bridge.test.tsx`). | done |
| `ExtAppFrame.tsx` timing hacks | M3 | 915 lines, 12 refs, 7 `setTimeout`s, 5 rAFs, WebKit remount slot counter, 1200 ms fallback bootstrap, two near-duplicate `buildHostContext` blocks. Extract `useExtAppBridge`; single `buildHostContext`. | project |
| json-render stack decision | M1 | **Minimum-four done (2026-08-03):** both bundles verified minified (the audit's "unminified" was stale — React+recharts dominate the 1.31 MiB minified size); the 2 `@json-render/devtools*` packages moved to devDependencies; the viewer is already a separate page bundle (nothing to lazy-load — verified, no churn manufactured); the python mtime gate is now Bun with parity-tested exit codes. **Still open (decision):** the React-stack question — a separate optional package remains the only real size lever. | decision |
| Client dead code / duplication | L1, L2, L3 | `ContextPinHud.tsx` unreferenced; three pure re-export shims; two parallel markdown-format stacks; `global.css` 3,746 lines with 11 `!important` vs 227 inline styles and unscaled z-indexes. | small (batchable) |

## Smaller items (no phase, pick up opportunistically)

| Item | Source | What's open |
|---|---|---|
| Per-action composite schemas | M6 | **Done (2026-08-03, middle path per the decision analysis):** composite dispatch re-enforces each member op's required MCP fields at runtime and names the missing field (`requiredMcpFields` in `operations/mcp.ts`) — no `oneOf` schema break (many MCP hosts handle `oneOf` poorly). Advertised schemas stay all-optional by design. |
| Packaging | M10 | `files` ships both `src/` and `dist/` (~double tarball, two import paths); `bin` points at raw `.ts` (undocumented Bun-only constraint); `@types/turndown` in runtime deps. |
| Env var hygiene | M11 residual | **Done (2026-08-03):** server startup now falls back `--port` → `PMX_WEB_CANVAS_PORT` → `PMX_CANVAS_PORT` → 4313, so setting only the client var no longer splits client and server ports; documented in `docs/environment.md`. |
| `publish.yml` e2e gap | M11 residual | **Done (tier-3 batch):** publish.yml verifies the tagged SHA has a successful `test.yml` run before publishing. |
| MCP notification fan-out | M7 residual | Five `canvas://` resource URIs notify on every mutation regardless of type (`mcp/server.ts:95-99`). |
| Legacy migration code on every boot | L4 | **Done (2026-08-03, v0.4.0 breaking window):** the pre-0.2 import path is deleted (~150 lines); fresh-boot bootstrapping untouched; `PMX_CANVAS_STATE_FILE` survives only as a `.db`-path alias with a boot warning otherwise. Verified with a legacy-artifacts smoke (files untouched, no `.bak`). |
| Suppression/mutation plumbing | L5 | **Done (2026-08-03):** the "two counters" are semantically distinct by design (emit-suppression for batch vs recording-suppression for undo/redo — merging breaks one or the other; documented at both declarations). The redundant second `onMutation` wire in `PmxCanvas.start` was deleted; the slot contract is documented. |
| Module-global lifecycle leaks | L6 | ~20 module-level `let`s in `server.ts`; code-graph debounce timer survives `stopCanvasServer`; remote SSE watcher loop has no cancellation. |
| June doc citations | L7 residual | **Done (2026-08-03):** each cited entry's substance is inlined so the doc stands alone; one miscitation corrected. |

## Added post-0.3.3 (2026-08-03 sweep)

| Item | What's open |
|---|---|
| Windows web-artifacts | The artifact build pipeline is bash-script-backed (POSIX-only); `tests/unit/web-artifacts.test.ts` self-skips on win32 and docs now state the boundary. Decide: port the build scripts to a cross-platform runner, or keep the documented "build on POSIX, render anywhere" stance. |
| Composite parity no longer machine-checked | Since v0.3.0 removed the legacy standalones, the byte-identical composite-vs-legacy guarantee has no head-to-head test — regressions in `buildInput`/`formatResult` reuse surface only via output-shape assertions. Accepted at review; revisit if a composite drifts. |
| Portal-layer ext-app mount (contingency) | If the maintainer sets the WebKit UX bar at "never any visible gap", inline ext-app iframes must render outside the world transform — an architectural change that reopens the parked M3. 0.4.1 shipped the cheaper mimic (post-settle WebKit repaint nudge, `repaint-nudge` trail event) and the 0.4.1 Copilot report confirms the nudge RUNS but residual black tiles still appear (Diamond on first-load settle, Ellipse after restart settle) — the contingency's trigger condition is now met. 0.4.3 Codex hardens the evidence: three ready tiles blank in WebKit with **byte-identical** early/late screenshots while the recovery trail reported initialized/settled — DOM-level recovery completion does not prove compositor paint, so no DOM-side nudge can close this. This portal-layer mount is the designated next Finding N step; scope it as its own project (drag/zoom sync, z-order, clipping, minimap interplay), not a patch-release bolt-on. |

## Added post-0.4.0 (2026-08-04 report cycle)

| Item | What's open |
|---|---|
| Finding S — frame documents vs server restart | **Done + field-confirmed (0.4.1 reports, both hosts):** the browser revalidates minted frame-document URLs on every reconnect epoch (`workbenchConnectionEpoch`, HEAD probe) and re-mints against the new process when the store is gone; `/api/canvas/frame-documents/:id` answers HEAD. Copilot: IDs fully rotated, all post-restart 200, no frame-not-found tiles. Codex: re-mint without workbench reload. Server-side persistence deliberately NOT done — frames are client-derived and re-mintable. |
| Amp portal nested-iframe embedding | **Done (2026-08-04):** boot-time embed probe (`/api/canvas/iframe-probe`) + fetch()+srcdoc fallback for all same-origin surfaces (`useSurfaceFrame`, `useIframeDocument` srcdoc short-circuit), `?iframe-mode` override, e2e-forced-mode coverage. External (cross-origin) app URLs cannot be inlined — documented limitation. |
| Copilot adapter `canvas_snapshot list` descriptor lag | Host-side cached tool schema still requires `name`; fresh `--mcp` is correct. Adapter/packaging issue, not a daemon defect — nothing to change in core; 0.4.2 cycle saw the legacy tools gone from the host list after refresh. |
| Finding T — theme/More menu mis-anchored | **Done + field-confirmed (0.4.3 reports, both hosts):** menus moved inside `.toolbar-menu-anchor` wrappers around their triggers. Copilot measured button/menu right edges equal; Codex measured delta 0. Anchor-geometry e2e regression tests in place. |
| Finding U — sticky `-32001` session-error banner over rendering content | **Presentation fix field-confirmed (0.4.3 reports, both hosts); root cause open:** forced error state renders the soft saved-content notice. The underlying stressed-reconnect MCP timeout is still not clean-reproducible — investigate session re-establishment retry/backoff if a future cycle reproduces it. |
| Skill-mirror drift automation | **Done (2026-08-05):** `pmx-canvas skills sync` (+ `--check`, exit 1 on drift) discovers the skill copies already installed in the workspace — no assumed host layout, per maintainer direction — and whole-tree-replaces them from the package. Closes the recurring every-cycle hand-sync complaint in the audit addenda. Remaining audit ask: a true model-vs-baseline benchmark of the 17 eval prompts (a test-harness task, not a repo artifact). |
| Registry-migration dead-code sweep | **Done (2026-08-03):** removed the orphaned `describeOp`/`describeGateOp` (composites.ts, dead since the v0.3.0 registration filter) and the `compactNodePayload`/`compactLayoutPayload`/`wantsFullPayload` duplicates in `mcp/server.ts` (live copies are in `ops/nodes.ts`). |

## Added during rail-chrome-v2 (2026-08-23, phases 1–5)

Recorded while the redesign's phases land so nothing rides in silently. The redesign's plan was retired into `docs/design.md` and `docs/ax-state-contract.md` (2026-10-04).

| Item | What's open |
|---|---|
| `window.prompt`-based rail creates | The rail's palette (`ToolRail.tsx` `promptedCreate`) collects a title/URL via `window.prompt`, which headless hosts and some embedded WebViews suppress (the create silently no-ops). Replace with an inline popover form once the phase-7 command-palette restyle lands; until then it is the same behavior the old toolbar had. |
| `dockPosition` retirement (phase 5c) | **Done (2026-08-23, rail-chrome-v2 phase 5c):** the HUD pill layer, `DockedNode`, first-run seeding, `undockNode`/`hasOpenDockedContextPanel`, the validator's `hiddenEdgeEndpoints` rule, the `--dock-position` CLI flag, the `dock_position` SQLite columns (dead column left in existing DBs, no migration), and the HUD/docked/context-dock CSS are all removed; the demo fixture was regenerated. Note for future removals: `tsc` never deletes stale emits under the committed `dist/types/` — delete the orphaned `.d.ts` by hand. |
| `annotationMode` / `annotationTool` redundancy | `CanvasViewport` takes both a boolean `annotationMode` prop and the `annotationTool` enum, and `App.tsx` derives the former from the latter (`annotationTool !== null`). Collapse to the enum alone in the phase-7 quality wave — `CanvasViewport.tsx` only. |
| Agents can resolve their own gates | Pre-existing design question surfaced by the session panel: `ax.approval.resolve` accepts any caller, so an agent could approve its own gate over HTTP/MCP. The panel and the `held` TTL path assume the human answers. Either gate `resolve` on the workbench marker (like the scope fence) or document it as a cooperating-agent contract; decide before the next adapter ships. |
| Batch never carries `fromWorkbench` | `canvas.batch` inner dispatches are always agent writes (the browser never uses batch), so the scope fence and presence treat them as such. Holds by construction today; if the client ever adopts batch, the marker must thread through `ops/batch.ts`. Comment at the dispatch site. |
| Presence registry is a second single-slot listener family | `setSessionStartListener` / `setSessionEndListener` / `setEmitter` on `agentPresence` follow architecture rule 8 (owned by `server.ts`). If a third consumer ever needs session lifecycle (e.g. an audit log), fan out inside the existing registration — do not add a competing one. |

## Wave 3 maintainability review (2026-10-11)

Scope: remaining Wave 3 changes against the published foundation, the preceding
`Sweep tech debt before 0.9.0` commit, and the next stages in `docs/design.md` and
`docs/product-vision-2026-09.md`. This is a source/data-flow review with disposable
scale measurements, not an exhaustive re-audit of every historical row above.
The owner requested self-review, not Oracle. Stabilization evidence is in plan 018.

**Fixed in this batch:** AX context computed the same library qualification three times
for pins and focus. It now shares one request-local result. Fit also reuses its captured
layout rather than loading the whole layout again just to inspect edges. The initial
resetting preset menu and its orphaned highlight-menu state are gone. The vision's
“planned, not implemented” lifecycle status is corrected. No dependency or cache was added.

Measurement: Bun 1.4.2 in the Linux orb, nine warm samples per case, short Markdown cards,
no review history or dependencies. At 30 boards × 150 cards, AX context median falls from
138.6 to 48.3 ms; at 10 × 150, from 44.0 to 13.6 ms. Single-card reads remain approximately
46 ms at 4,500 cards. The qualification object is 1,302,961 JSON characters. These are
lower-bound server measurements, not browser latency or a supported capacity guarantee.
Logs: `/tmp/pmx-w3-debt-baseline.zPoaEM/log` and `/tmp/pmx-w3-debt-after.iXN2fq/log`.

| Priority / boundary | Evidence and disposition |
|---|---|
| Before larger-library scaling | `lifecycle-status.ts` reads every board and each card's full review history even for one-card requests. `KnowledgeSync` reloads workspace qualifications after board changes. Bound narrow reads to the dependency closure, batch/index review summaries, and separate folder aggregates from card detail when scaling this path. Measure populated review histories and long dependency chains as well as empty history. Avoid a TTL cache: cadence, sessions, retirement and source changes have different invalidation clocks. |
| Wave 4, frame host | `ExtAppFrame.tsx` still owns 1,597 lines of bridge/recovery behavior. Consolidate mount budget, theme delivery and visible fallback with the planned frame host, preserving working draft/refresh behavior. Do not start another recovery ladder or infer native WebKit paint from Chromium tests. |
| Wave 5, groups and agent output | Keep board-qualified relation/provenance identities when moving cards into or out of a board. Review records currently outlive snapshots and are keyed by board + card; define their move semantics before adding make-board/inline-board. Do not clone validation as if a new claim had been checked. |
| Journal and shared/hosted stages | The due evaluator still reads the local `canvasState` singleton. Separate runtime acquisition from qualification when a second runtime needs it, not by speculative package splitting now. Filter authorized sources before summaries, titles and lifecycle reasons are computed. Categories are not permissions. Keep validation audit distinct from an undoable content journal and finish the authoritative mutation-path decision before event sourcing. |
| Test maintenance | Large integration files remain (`server-api.test.ts`, `canvas.pw.ts`). Split by owning domain when those domains next change, preserving isolation and race cases. Do not replace human browser or real transport checks with source-string assertions to make the suite cheaper. |

The earlier gate-resolution question is superseded by vision move 7 and plan 010:
approvals are attributed coordination, not a human-only security boundary. Tour cleanup
remains explicitly deferred in vision move 12. Neither is reopened in this batch.
The codebase supports continued staged vision work; this review is not release approval.

### Home acceptance integration review (2026-10-12)

The combined Home and acceptance review keeps one server graph projection and one set of
board-qualified writes. `memory-layout.ts` owns Map geometry and D3 view particles; the
simulation never changes saved board coordinates, content or validation. D3 is now a direct
dependency rather than an accidental transitive one. Live reads coalesce while a request is
running, discard responses from superseded views and preserve camera/selection. Library
browsing unmounts the canvas and gates board controls so a paste or shortcut cannot mutate
the agent's hidden active board.

Real transport review found the MCP node-type enum duplicated the canonical list and omitted
board portals. Both now use `NODE_TYPES`, with a discriminating MCP regression. Live visual
review also caught the library context chip omitting a pinned active board; it now lists all
board pins without exposing hidden-board card controls. Neither finding justifies another
adapter or graph store. Category deletion refuses explicit assignments even to empty folders;
the simplified review form retains captured content/source revision guards.

The live-library checkpoint in the vision records the next boundaries: explicit per-tab
editor ownership before concurrent board editing, and measured fetch/force/paint costs before
workers or culling. The 13-board/101-card browser fixture is acceptance evidence, not a large
library capacity claim. Map and Graph now have separate view owners, sharing discovery loading
and inspector docking only; the superseded combined view and Graph layouts are removed. The codebase is
healthy enough for staged vision work with these constraints, not debt-free or fully validated
in native hosts. The reported Amp embedded-portal context-pill opening failure is still
unverified and distinct from the fixed pin count.

## Private wiki-import findings (2026-10-18, locally fixed and retested)

Source: [private import-test handoff](https://ampcode.com/threads/T-01a14f43-f513-7397-8ec4-f6a85551dff0).
Reported environment: PMX Canvas 0.8.2 at
[`92c2930`](https://github.com/pskoett/pmx-canvas/commit/92c293029e98a5fc1c04f43821470eb35fe500c6),
Bun 1.4.2, headed Chromium in a Linux orb. Synthetic MCP reproductions subsequently
confirmed the findings. Local fixes build on the pushed Graph candidate
[`150aeba`](https://github.com/pskoett/pmx-canvas/commit/150aebad08c03909a0170660d12bd33f558735a9).
After-fix checks use the official SDK Client and StdioClientTransport attached to a
disposable source daemon, plus headed Chromium for rendered effects. This is not a
native-host or published-package claim. The source database and private documents
were not imported; the owner's running workbench was not changed.

Private evidence remains in the source thread's workspace: `wiki-load-before.json`,
`wiki-load-after.json`, `wiki-backlog-cards.png` and `wiki-linkedin-cards.png` under
`.amp/in/artifacts/`, plus `.learnings/wiki-load-probe.js` and `.learnings/ERRORS.md`.
Screenshots and full notes contain private wiki content. Keep them within authorized private
work; use synthetic fixtures or redaction for any public reproduction or report.

### WI-01, high: embedded base64 Markdown images make parsing and board loading slow

**Status:** locally fixed and retested with identical inline image content, not a data conversion.
Marked's long destination and unmatched setext scans caused the reproduced parser cost.
The wiki parser now avoids those scans while preserving reference and rendered-image output.
Controlled 1,106,157-character parser runs changed from 1245–1503 ms to 17–31 ms;
the short-reference control changed from 7–10 ms to 3–4 ms. These synthetic parser
measurements are not end-to-end load or universal speedup claims. MCP-created inline
and file-reference boards both render and decode the same SHA-256-checked 800×600 image.
Payload duplication, offscreen render requests and full-layout SSE remain possible
amplifiers, not solved or independently established causes of all loading outliers.

The source test measured board-open request through ready card bodies and loaded pictures
(including natural image dimensions), not just HTTP response time. Each cell lists three
runs in milliseconds. The workaround changed import data, not product code: seven embedded
images became file-backed image nodes on their owning boards, referenced through
`/api/canvas/image/<id>`. Served bytes matched the originals by SHA-256. The documents and
pictures were retained, with extra figure cards; this is not an identical-card-count comparison.

| Workload | Before workaround | After data-only workaround | State payload, before → after |
|---|---|---|---|
| 9 Markdown cards, 5 pictures originally | 5329 / 5609 / 5714 | 782 / 879 / 817 | 3,195,186 → 649,194 bytes |
| 12 cards, 2 pictures originally | 9364 / 4011 / 7403 | 710 / 904 / 759 | Not reported → 211,414 bytes |
| 29-card text-only control | 1566 / 1419 / 1643 | 1372 / 1021 / 1275 | Not reported |

Direct isolation on one 924,640-character card measured `wikiReferences` at
1422 / 1194 / 1170 ms and `renderWikiMarkdown` at 1183 / 1187 / 1189 ms. Replacing only base64
URLs with short URLs reduced the source to 11,728 characters and parsing to 2–11 ms, retaining
11 wiki references and four image tags. This isolates parsing cost, not image downloading.
The server was already running, caches were not cleared, and transport was local to the orb.
Small-board transitions also occasionally took about three seconds. No universal speedup or
single cause for every outlier is established. File-backed assets must accompany the database.

Reported amplifiers to inspect at reproduction: `src/server/wiki-links.ts`;
`handleRender` in `src/server/server.ts` lexing persisted Markdown twice and rendering again;
`src/server/canvas-serialization.ts` duplicating source at top level and `data.content`;
`MarkdownNode.tsx` posting each mounted card's entire source to `/api/render`, including
offscreen cards; and full-layout SSE payloads. These are investigation leads from the tested
revision, not independently verified causes on the candidate.

**Next:** measure remaining payload/paint costs separately if large real boards still stall.
Retain reference/image-preservation checks before changing parser or transport behavior again.

### WI-02, medium: relative image creation ignores the configured workspace root

**Status:** locally fixed and retested through MCP. Relative paths now resolve against
the configured workspace root. A daemon launched outside that root creates the synthetic
relative-path image successfully, and served bytes match the original hash. The serving
route's realpath confinement is unchanged.

Launch from directory A with `PMX_CANVAS_WORKSPACE_ROOT=B`, with a valid picture at
`B/wiki/assets/diagram.png`. `POST /api/canvas/node` with
`{type:"image",content:"wiki/assets/diagram.png"}` returned 400,
`Invalid image node: diagram.png does not exist`. The absolute path succeeded, as did all
seven image imports using that workaround.

The source investigation identified `buildImageNodeData` in
`src/server/canvas-operations.ts` using `resolve(src)`, unlike file-node creation's
`resolve(canvasState.getWorkspaceRoot(), rawPath)`.

**Guardrail:** keep separate launch/workspace coverage and realpath confinement; relative
creation must not weaken the file-serving boundary.

### WI-03, low: review/lifecycle badge protrudes beside grouped cards

**Status:** locally fixed and visually retested independently of freshness noise removal.
The group's sole body child was stretched by the content flex rule. Its footer now lives
in the bottom frame chrome. A deliberately due, zero-review group has a 22.44 CSS px footer
at 68% zoom, versus 259.76 px in the source reproduction. All 36 width/theme cases hit-test
the footer, and a real pointer click opens that group's Review drawer. Fresh children stay
unmarked. This does not resolve or identify the separately reported Updates badge.

With Knowledge lifecycle enabled, a dense group at 68% zoom showed a partly obscured amber
review badge beside a middle-left card; a similar artifact appeared on another board.
Capture conditions were 1600 × 1100 CSS pixels, DPR 2. All nine cards in the dense group fit
and rendered. This is not established as the separately reported floating Updates badge.

**Guardrail:** test explicit group due/source warnings as well as fresh content, so removing
inherited policy noise cannot conceal a broken badge layout.

**Not counted as product bugs:** source-draft chronology, poor initial import board
granularity, and unescaped wiki-alias pipes in Markdown tables. An unescaped table alias can
produce zero parsed references, so zero unresolved links alone is not a preservation check.
The initial handoff's wiki-import guidance was local-only. A later handoff reports it pushed
to `origin/main` in
[`48013e1`](https://github.com/pskoett/pmx-canvas/commit/48013e1346ea34f107c11f93dca3f4cace1f7a23).
It has not been integrated into this checkout.

### WI-04, priority pending: incomplete provenance is silently discarded on node creation

**Status:** locally fixed and retested through MCP. Explicit incomplete/invalid provenance
is rejected with field-specific errors; valid source dependencies survive readback. Omitted
provenance still uses normal inference for sourced node types.

The source test submitted `data.provenance` with `sourceKind:'agent'`,
`snapshotContent:true`, `sources:[{boardId,cardId,contentRevision,availability:'cached'}]`
and `recipe:{tool,prompt}`, omitting `sourceUri` and `refreshStrategy`. Creation succeeded,
but a subsequent GET returned `provenance:null`, losing the submitted source dependencies.
The payload was incomplete and `agent` is not an advertised source kind. This does not claim
that valid provenance was rejected or lost.

The source investigation points to `normalizeExistingProvenance` in
`src/server/canvas-provenance.ts` returning null for missing required fields, after which
the ensure path deletes provenance. The data-only repair supplied `sourceKind:'recipe'`,
`sourceUri` and `refreshStrategy:'agent-request'`; the source thread verified all 20 repaired
cards, 54 source references/revisions and persistence after restart. That repair was data-only.

**Guardrail:** keep the rejected incomplete payload and valid source-preservation control.

### WI-05, usability: short library queries rank picture filenames above content

**Status:** locally improved and retested through MCP. Exact and whole-term match tiers
precede embedded substrings; field weights only break ties within a tier. `V2 platform`
ranks above `TV2 pictures` for `V2`, while the latter remains discoverable. Search scope,
filters and stable tie ordering are covered by regression tests.

A short query ranked picture filenames containing the token ahead of the intended platform
content. No private content is needed to investigate this. Use synthetic titles, body content
and overlapping filename tokens to assess relevance; establish the intended ranking before
calling matching results incorrect.

### WI-06, product requirement: schedule new content's first review by type and decay

**Status:** locally implemented and retested through MCP and browser. New authored content
starts fresh without a review record. Medium first expires at creation plus cadence;
Fast/Slow at a later use/resumed session. Imports and existing undated content gain no
synthetic freshness. Edits preserve the baseline. Group/portal nodes skip inherited factual
decay unless explicitly assigned a card override; source/dependency warnings still apply.

The source inspection used local and remote `main` at
[`676fd1d`](https://github.com/pskoett/pmx-canvas/commit/676fd1d37727e0e4cc8d393b450500ef658ac052).
A new work overview inherited a fast category policy and returned `records:[]`,
`lastValidation:null`, `unknown:false`, `due:true`, with reason "Fast: check at use."
A new planning overview inherited medium/90 days and reported
"Review every 90 days; never validated." The snapshot contained 258 review-queue items,
including group frames. The importing agent assigned the broad policy, amplifying the noise;
this is not a measurement of the current candidate's queue.

The source investigation reports that `src/server/lifecycle-status.ts` evaluates all node
types: medium cadence treats `checked === null` as immediately due, while fast cadence
requires current-session validation on the active board. `LifecycleChrome.tsx` presents both
as the same amber review-due badge. Null per-card lifecycle inherits policy, rather than
opting out. Source log: `ERR-20261018-005`, pattern `canvas.review_policy_import_noise`.

**Required behavior, superseding the earlier emphasis on badge distinctions:** newly authored
content must not enter the review queue solely because it has no validation record. Schedule
its first review later according to its effective content type/decay policy, including the
new work overview. Relabeling an immediate warning alone does not satisfy this requirement.
Freshness and evidence validation remain distinct; creation does not establish validation.
Imported historical content and edit-reset semantics need separate treatment, not a blanket
reset that treats every import or edit as freshly established evidence.

**Guardrail:** server-owned initial freshness is persisted independently of validation.
Tests cover cadence boundaries, inherited policies, later sessions, imports, edits,
undo/redo and snapshot restore. Historical text creation must declare
`data.contentOrigin: "imported"`; origin is immutable. Do not fabricate review records or
blanket-reclassify facts as durable. This remains separate from WI-03's layout fix.

### WI-07, capability: create on an inactive board without switching the human's board

**Status:** locally implemented and MCP-retested for static node creation. `destinationBoardId`
selects the stored destination; `expectedBoardId` remains an active-board guard. The singleton
commits without temporarily opening the destination, altering active undo or creating ghosts.
Both boards' scope fences are conservatively enforced. Runtime-backed nodes, generated
primitives, intents and membership mutations are explicitly unsupported, as are inactive
updates/removals. These are documented boundaries, not silent fallback paths.

### WI-08, retry safety: distinguish retries from intentional identical creations

**Status:** locally implemented and MCP-retested. Optional `requestId` persists an atomic
creation receipt with the node. Same input/destination replays the original receipt; mismatched
reuse conflicts. New ids preserve intentional identical creations. Regression tests exercise
restart, removal, rollback at receipt failure, endpoint clocks and named batch references.
Receipts survive individual node deletion but are deleted with the owning board. Existing
named batch edge/group references already worked and remain a passing control.
